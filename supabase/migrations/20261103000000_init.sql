-- Face Visit Tracker schema
-- Every row is owned by the signed-in user (auth.uid()); RLS keeps accounts isolated.

create extension if not exists vector with schema extensions;

-- ---------- tables ----------
create table public.people (
  id          bigint generated always as identity primary key,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default '',
  thumb_path  text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index people_owner_last_seen_idx on public.people (owner, last_seen desc);

-- 128-d face-api.js descriptors; several per person (angles, lighting)
create table public.face_descriptors (
  id          bigint generated always as identity primary key,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id   bigint not null references public.people (id) on delete cascade,
  embedding   extensions.vector(128) not null,
  created_at  timestamptz not null default now()
);
create index face_descriptors_person_idx on public.face_descriptors (person_id);
create index face_descriptors_embedding_idx on public.face_descriptors
  using hnsw (embedding extensions.vector_l2_ops);

-- one row per visit: a continuous period in front of the camera
create table public.visits (
  id          bigint generated always as identity primary key,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id   bigint not null references public.people (id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz not null default now(),
  reports     int not null default 1,
  thumb_path  text,
  camera      text
);
create index visits_person_started_idx on public.visits (person_id, started_at desc);
create index visits_owner_started_idx on public.visits (owner, started_at desc);

-- ---------- row level security ----------
alter table public.people enable row level security;
alter table public.face_descriptors enable row level security;
alter table public.visits enable row level security;

create policy "people: owner only" on public.people
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

create policy "face_descriptors: owner only" on public.face_descriptors
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (
    owner = (select auth.uid())
    and exists (select 1 from public.people p where p.id = person_id)
  );

create policy "visits: owner only" on public.visits
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (
    owner = (select auth.uid())
    and exists (select 1 from public.people p where p.id = person_id)
  );

-- ---------- views ----------
create view public.people_stats with (security_invoker = true) as
select
  p.*,
  count(v.id)::int     as visit_count,
  min(v.started_at)    as first_visit
from public.people p
left join public.visits v on v.person_id = p.id
group by p.id;

create view public.visits_numbered with (security_invoker = true) as
select
  v.*,
  row_number() over w                                            as visit_no,
  extract(epoch from v.started_at - lag(v.ended_at) over w)::float8 as gap_seconds
from public.visits v
window w as (partition by v.person_id order by v.started_at);

-- ---------- functions ----------
-- closest known face; null row set when nothing is within max_distance
create function public.match_face(query extensions.vector(128), max_distance float8 default 0.5)
returns table (person_id bigint, distance float8)
language sql stable security invoker set search_path = ''
as $$
  select m.person_id, m.distance
  from (
    select d.person_id, (d.embedding operator(extensions.<->) query)::float8 as distance
    from public.face_descriptors d
    order by d.embedding operator(extensions.<->) query
    limit 1
  ) m
  where m.distance < max_distance;
$$;

-- extends the current visit, or opens a new one when the person was away longer than gap_seconds.
-- Runs on server time so several cameras agree on what "now" is.
create function public.record_sighting(p_person_id bigint, p_gap_seconds int, p_camera text default null)
returns table (visit_id bigint, visit_no int, is_new boolean, gap_seconds float8)
language plpgsql security invoker set search_path = ''
as $$
declare
  last_visit public.visits;
begin
  -- serialise concurrent reports for the same person (e.g. two cameras)
  perform 1 from public.people where id = p_person_id for update;
  if not found then
    raise exception 'person % not found', p_person_id;
  end if;

  select * into last_visit
  from public.visits
  where person_id = p_person_id
  order by started_at desc
  limit 1;

  if last_visit.id is not null and last_visit.ended_at >= now() - make_interval(secs => p_gap_seconds) then
    update public.visits
      set ended_at = greatest(ended_at, now()), reports = reports + 1
      where id = last_visit.id;
    visit_id := last_visit.id;
    is_new := false;
    gap_seconds := null;
  else
    insert into public.visits (person_id, camera) values (p_person_id, p_camera)
      returning id into visit_id;
    is_new := true;
    gap_seconds := case when last_visit.id is null then null
                        else extract(epoch from now() - last_visit.ended_at)::float8 end;
  end if;

  update public.people set last_seen = now() where id = p_person_id;
  select count(*)::int into visit_no from public.visits where person_id = p_person_id;
  return next;
end;
$$;

-- move everything from p_source into p_target, then drop p_source
create function public.merge_people(p_source bigint, p_target bigint)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if p_source = p_target then
    raise exception 'cannot merge a person into themselves';
  end if;
  if (select count(*) from public.people where id in (p_source, p_target)) <> 2 then
    raise exception 'person not found';
  end if;

  update public.face_descriptors set person_id = p_target where person_id = p_source;
  update public.visits set person_id = p_target where person_id = p_source;
  update public.people t
    set created_at = least(t.created_at, s.created_at),
        last_seen  = greatest(t.last_seen, s.last_seen),
        thumb_path = coalesce(t.thumb_path, s.thumb_path)
    from public.people s
    where t.id = p_target and s.id = p_source;
  delete from public.people where id = p_source;
end;
$$;

-- ---------- grants (explicit, in case the project doesn't auto-expose new objects) ----------
grant select, insert, update, delete on public.people, public.face_descriptors, public.visits to authenticated;
grant select on public.people_stats, public.visits_numbered to authenticated;
revoke all on public.people, public.face_descriptors, public.visits, public.people_stats, public.visits_numbered from anon;

revoke execute on function public.match_face(extensions.vector, float8) from public, anon;
revoke execute on function public.record_sighting(bigint, int, text) from public, anon;
revoke execute on function public.merge_people(bigint, bigint) from public, anon;
grant execute on function public.match_face(extensions.vector, float8) to authenticated;
grant execute on function public.record_sighting(bigint, int, text) to authenticated;
grant execute on function public.merge_people(bigint, bigint) to authenticated;

-- ---------- storage: private bucket, one folder per user ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('faces', 'faces', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy "faces: own folder" on storage.objects
  for all to authenticated
  using (bucket_id = 'faces' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'faces' and (storage.foldername(name))[1] = (select auth.uid())::text);
