-- Run after the existing CORE Supabase schema. No destructive changes.
begin;
alter table public.memories add column if not exists category text not null default 'personal';
alter table public.memories drop constraint if exists core_memory_category_check;
alter table public.memories add constraint core_memory_category_check check (category in ('personal','business','knowledge','task'));
alter table public.memories enable row level security;
-- Restrictive policy also constrains existing permissive policies.
drop policy if exists core_memory_owner_guard on public.memories;
create policy core_memory_owner_guard on public.memories as restrictive for all to public using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists core_memory_owner_access on public.memories;
create policy core_memory_owner_access on public.memories for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists core_memory_owner_category_idx on public.memories(user_id,category,created_at desc);
commit;
