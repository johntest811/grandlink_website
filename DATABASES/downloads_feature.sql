-- Downloads page + APK storage setup
-- Run in Supabase SQL Editor

-- 1) Ensure Downloads bucket exists
insert into storage.buckets (id, name, public)
values ('Downloads', 'Downloads', true)
on conflict (id) do update set public = true;

-- 2) Storage policies for public APK downloads and authenticated/admin management
-- Public can read files in Downloads bucket
drop policy if exists "Public read Downloads files" on storage.objects;
create policy "Public read Downloads files"
on storage.objects
for select
to public
using (bucket_id = 'Downloads');

-- Authenticated users can upload files to Downloads bucket
drop policy if exists "Authenticated upload Downloads files" on storage.objects;
create policy "Authenticated upload Downloads files"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'Downloads');

-- Authenticated users can update/delete files in Downloads bucket
drop policy if exists "Authenticated manage Downloads files" on storage.objects;
create policy "Authenticated manage Downloads files"
on storage.objects
for update
to authenticated
using (bucket_id = 'Downloads')
with check (bucket_id = 'Downloads');

drop policy if exists "Authenticated delete Downloads files" on storage.objects;
create policy "Authenticated delete Downloads files"
on storage.objects
for delete
to authenticated
using (bucket_id = 'Downloads');

-- 3) Singleton content table for website Download page
create table if not exists public.downloads_content (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique default 'downloads',
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_downloads_content_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_downloads_content_updated_at on public.downloads_content;
create trigger trg_downloads_content_updated_at
before update on public.downloads_content
for each row
execute function public.set_downloads_content_updated_at();

alter table public.downloads_content enable row level security;

-- Public can read Downloads page content
drop policy if exists "Public read downloads content" on public.downloads_content;
create policy "Public read downloads content"
on public.downloads_content
for select
to public
using (true);

-- 4) Seed singleton row with defaults
insert into public.downloads_content (id, slug, content)
values (
  '00000000-0000-0000-0000-000000000001',
  'downloads',
  jsonb_build_object(
    'heroTitle', 'Download GrandLink Mobile',
    'heroDescription', 'Install our Android app to access reservations and updates from your phone.',
    'cardTitle', 'GrandLink Android APK',
    'cardDescription', 'Official installer package from GrandLink.',
    'buttonLabel', 'Download APK',
    'releaseNotes', 'Initial release',
    'apkUrl', '',
    'apkVersion', '',
    'apkSize', '',
    'apkFileName', '',
    'enabled', true
  )
)
on conflict (id) do update
set slug = excluded.slug,
    content = excluded.content,
    updated_at = now();

-- 5) RBAC page entry so Downloads appears in roles/access control
insert into public.rbac_pages (key, name, path, group_name)
values (
  'content_management_downloads',
  'Content Management - Downloads Page',
  '/dashboard/Content_management/downloads',
  'Content Management'
)
on conflict (key) do update
set name = excluded.name,
    path = excluded.path,
    group_name = excluded.group_name;
