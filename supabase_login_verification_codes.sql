-- Login verification codes (DB-backed, server-only)
-- Run this in Supabase SQL Editor.

create table if not exists public.login_verification_codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  last_sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep this table server-only.
alter table public.login_verification_codes enable row level security;

-- Optional cleanup index (expires lookup)
create index if not exists login_verification_codes_expires_at_idx
  on public.login_verification_codes (expires_at);
