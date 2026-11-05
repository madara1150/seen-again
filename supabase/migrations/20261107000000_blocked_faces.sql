-- Blocked people: someone who asked not to be recorded.
-- Only face descriptors are kept (no name, photo, times or hand-outs), so the camera can recognise
-- the face and skip it; everything else about the person is deleted when they are blocked.

create table public.blocked_faces (
  id          bigint generated always as identity primary key,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- groups the descriptors of one blocked person, so they can be unblocked together
  block_id    uuid not null,
  embedding   extensions.vector(128) not null,
  created_at  timestamptz not null default now()
);
create index blocked_faces_owner_idx on public.blocked_faces (owner, block_id);

alter table public.blocked_faces enable row level security;

create policy "blocked_faces: owner only" on public.blocked_faces
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- Block people: keep their descriptors as blocked faces, then delete the people
-- (visits, descriptors and hand-outs go with them). Returns how many were blocked.
-- Thumbnails live in Storage; the caller removes them.
create function public.block_people(p_ids bigint[])
returns int
language plpgsql security invoker set search_path = ''
as $$
declare
  n int;
begin
  insert into public.blocked_faces (block_id, embedding)
  select b.block_id, d.embedding
  from public.face_descriptors d
  join (select unnest(p_ids) as person_id, gen_random_uuid() as block_id) b using (person_id);

  delete from public.people where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Is this face blocked? Checked by every camera before registering a new person.
create function public.is_blocked(query extensions.vector(128), max_distance float8 default 0.5)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.blocked_faces b
    where (b.embedding operator(extensions.<->) query) < max_distance
  );
$$;

grant select, insert, delete on public.blocked_faces to authenticated;
revoke all on public.blocked_faces from anon;
revoke execute on function public.block_people(bigint[]) from public, anon;
revoke execute on function public.is_blocked(extensions.vector, float8) from public, anon;
grant execute on function public.block_people(bigint[]) to authenticated;
grant execute on function public.is_blocked(extensions.vector, float8) to authenticated;
