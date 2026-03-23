-- Invoices table for GrandLink
-- Paste into Supabase SQL Editor and run.

create extension if not exists "pgcrypto";

-- 1) Table
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_item_id uuid not null references public.user_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_number text not null,
  currency text not null default 'PHP',
  subtotal numeric not null default 0,
  addons_total numeric not null default 0,
  discount_value numeric not null default 0,
  reservation_fee numeric not null default 0,
  total_amount numeric not null default 0,
  payment_method text,
  issued_at timestamptz not null default now(),
  invoice_html text not null,
  meta jsonb not null default '{}'::jsonb,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_user_item_unique unique (user_item_id),
  constraint invoices_invoice_number_unique unique (invoice_number)
);

-- 2) Indexes
create index if not exists invoices_user_id_idx on public.invoices (user_id);
create index if not exists invoices_user_item_id_idx on public.invoices (user_item_id);
create index if not exists invoices_issued_at_idx on public.invoices (issued_at desc);

-- 3) Keep updated_at current
create or replace function public.set_invoices_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_invoices_updated_at on public.invoices;
create trigger set_invoices_updated_at
before update on public.invoices
for each row execute function public.set_invoices_updated_at();

-- 4) RLS (optional but recommended)
alter table public.invoices enable row level security;

drop policy if exists "Users can read own invoices" on public.invoices;
create policy "Users can read own invoices"
on public.invoices
for select
using (auth.uid() = user_id);
