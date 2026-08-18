-- ============================================================
-- Mission Chat Sessions + Messages
-- Full-screen conversational AI assistant inside each mission.
-- Run this in Supabase Dashboard → SQL Editor before deploying.
-- ============================================================

-- Chat sessions (one per conversation thread)
create table if not exists mission_chats (
  id          uuid primary key default gen_random_uuid(),
  mission_id  uuid not null,
  tenant_id   uuid not null,
  title       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_mission_chats_lookup
  on mission_chats (mission_id, tenant_id, created_at desc);

-- Individual messages inside a session
create table if not exists mission_chat_messages (
  id                uuid primary key default gen_random_uuid(),
  chat_id           uuid not null references mission_chats(id) on delete cascade,
  tenant_id         uuid not null,
  role              text not null check (role in ('user', 'assistant')),
  content           text not null,
  action_payload    jsonb,
  action_applied    boolean default false,
  input_tokens      int,
  output_tokens     int,
  credits_deducted  int,
  created_at        timestamptz default now()
);

create index if not exists idx_mission_chat_messages_lookup
  on mission_chat_messages (chat_id, created_at asc);

-- RLS
alter table mission_chats enable row level security;
alter table mission_chat_messages enable row level security;

create policy "tenant_own_chats" on mission_chats
  for all using (tenant_id = auth.uid());

create policy "tenant_own_chat_messages" on mission_chat_messages
  for all using (tenant_id = auth.uid());
