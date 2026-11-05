-- Teach the camera what each item looks like: image embeddings (MobileNet v2, 1280-d, L2-normalised)
-- captured in the browser and matched with k-nearest-neighbours. item_id null = "nothing / empty scene".

alter table public.items add column emoji text not null default '';

create table public.item_samples (
  id          bigint generated always as identity primary key,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id     bigint references public.items (id) on delete cascade,
  embedding   real[] not null check (array_length(embedding, 1) = 1280),
  created_at  timestamptz not null default now()
);
create index item_samples_owner_idx on public.item_samples (owner, item_id);

alter table public.item_samples enable row level security;

create policy "item_samples: owner only" on public.item_samples
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (
    owner = (select auth.uid())
    and (item_id is null or exists (select 1 from public.items i where i.id = item_id))
  );

-- samples are training data, not history: deleting an item drops them, but handouts still block the delete
grant select, insert, delete on public.item_samples to authenticated;
revoke all on public.item_samples from anon;
