create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  name text not null default '' check (length(name) <= 120),
  language text not null default 'auto' check (language in ('auto','de','en')),
  voice text not null default '',
  volume real not null default 0.8 check (volume between 0 and 1),
  speech boolean not null default false,
  memory_enabled boolean not null default false
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (length(title) between 1 and 150),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  conversation_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null check (length(content) between 1 and 24000),
  created_at timestamptz not null default now(),
  foreign key (conversation_id,user_id) references public.conversations(id,user_id) on delete cascade
);
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  content text not null check (length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on public.conversations(user_id, updated_at desc);
create index on public.messages(conversation_id, created_at);
create index on public.memories(user_id, created_at desc);
do $$
declare t text;
begin
  foreach t in array array['profiles','conversations','messages','memories'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy owner_access on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
create policy memory_consent on public.memories as restrictive for insert to authenticated
  with check (exists(select 1 from public.profiles where user_id = auth.uid() and memory_enabled));
create policy memory_update_consent on public.memories as restrictive for update to authenticated
  with check (exists(select 1 from public.profiles where user_id = auth.uid() and memory_enabled));

create function public.search_conversations(search_query text)
returns table(id uuid, title text, updated_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.title, c.updated_at
  from public.conversations c
  where c.user_id = auth.uid()
    and length(trim(search_query)) between 1 and 150
    and (
      strpos(lower(c.title), lower(trim(search_query))) > 0
      or exists (
        select 1 from public.messages m
        where m.conversation_id = c.id and m.user_id = c.user_id
          and strpos(lower(m.content), lower(trim(search_query))) > 0
      )
    )
  order by c.updated_at desc, c.id
  limit 100;
$$;
revoke execute on function public.search_conversations(text) from public, anon;
grant execute on function public.search_conversations(text) to authenticated;
