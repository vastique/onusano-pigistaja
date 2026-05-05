-- Run this in Supabase > SQL Editor

drop table if exists public.compression_runs cascade;

create table public.compression_runs (
  id                  uuid        default gen_random_uuid() primary key,
  created_at          timestamptz default now() not null,
  user_id             uuid        references auth.users not null,
  email               text        not null,
  file_count          integer     not null,
  total_input_bytes   bigint      not null,
  total_output_bytes  bigint      not null,
  banner_sizes        text[]      not null default '{}'
);

alter table public.compression_runs enable row level security;

-- Authenticated users can insert their own rows
create policy "insert_own" on public.compression_runs
  for insert to authenticated
  with check (auth.uid() = user_id);

-- Users can read their own rows
create policy "select_own" on public.compression_runs
  for select to authenticated
  using (auth.uid() = user_id);

-- Admin can read all rows
create policy "admin_select_all" on public.compression_runs
  for select to authenticated
  using (auth.jwt() ->> 'email' = 'sanel.mittal@delfi.ee');
