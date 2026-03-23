-- Login verification codes (email 2nd-factor)
-- Run this in Supabase SQL Editor.

-- Stores short-lived 6-digit codes sent via email.
-- Service role key (server-side) reads/writes this table.
-- RLS is enabled with NO policies, so anon/auth clients cannot read/write.

create table if not exists public.login_verification_codes (
  email text primary key,
  code text not null,
  expires_at timestamptz not null,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.login_verification_codes enable row level security;

-- Keep updated_at current
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_login_verification_codes_updated_at on public.login_verification_codes;
create trigger trg_login_verification_codes_updated_at
before update on public.login_verification_codes
for each row
execute function public.set_updated_at();
