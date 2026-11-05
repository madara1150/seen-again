-- Handouts: what each recognised person received, and when (e.g. a food-giving stall)

-- things that are handed out: "ข้าวกล่อง", "น้ำ", ...
create table public.items (
  id          bigint generated always as identity primary key,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  unit        text not null default '',
  sort        int not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index items_owner_idx on public.items (owner, sort, id);

-- one row per hand-over; items in use cannot be deleted (archive them instead)
create table public.handouts (
  id          bigint generated always as identity primary key,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id   bigint not null references public.people (id) on delete cascade,
  item_id     bigint not null references public.items (id) on delete restrict,
  qty         int not null default 1 check (qty > 0),
  camera      text,
  created_at  timestamptz not null default now()
);
create index handouts_owner_created_idx on public.handouts (owner, created_at desc);
create index handouts_person_created_idx on public.handouts (person_id, created_at desc);
create index handouts_item_idx on public.handouts (item_id);

alter table public.items enable row level security;
alter table public.handouts enable row level security;

create policy "items: owner only" on public.items
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- the person and item must be visible to (i.e. owned by) the same user
create policy "handouts: owner only" on public.handouts
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (
    owner = (select auth.uid())
    and exists (select 1 from public.people p where p.id = person_id)
    and exists (select 1 from public.items i where i.id = item_id)
  );

-- merging two people now also moves their handouts
create or replace function public.merge_people(p_source bigint, p_target bigint)
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
  update public.handouts set person_id = p_target where person_id = p_source;
  update public.people t
    set created_at = least(t.created_at, s.created_at),
        last_seen  = greatest(t.last_seen, s.last_seen),
        thumb_path = coalesce(t.thumb_path, s.thumb_path)
    from public.people s
    where t.id = p_target and s.id = p_source;
  delete from public.people where id = p_source;
end;
$$;

grant select, insert, update, delete on public.items, public.handouts to authenticated;
revoke all on public.items, public.handouts from anon;
