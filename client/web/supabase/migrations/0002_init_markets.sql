create table if not exists public.markets (
  market_pubkey text primary key
);

alter table public.markets add column if not exists question       text;
alter table public.markets add column if not exists description    text;
alter table public.markets add column if not exists creator_wallet text;
alter table public.markets add column if not exists creator_name   text;
alter table public.markets add column if not exists image_url      text;
alter table public.markets add column if not exists answers        text[];

alter table public.markets enable row level security;

drop policy if exists "Enable read access for all users" on public.markets;
create policy "Enable read access for all users"
on public.markets
for select
to anon, authenticated
using ( true );

drop policy if exists "Enable insert access for all users" on public.markets;
create policy "Enable insert access for all users"
on public.markets
for insert
to anon, authenticated
with check ( true );

drop policy if exists "Enable update access for all users" on public.markets;
create policy "Enable update access for all users"
on public.markets
for update
to anon, authenticated
using ( true )
with check ( true );









