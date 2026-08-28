-- Workspace branding and client identity foundation.
-- Source-only until explicitly reviewed and rolled out.
--
-- Storage bucket note:
-- Create `workspace-brand-assets` through the supported Supabase Storage API / Studio,
-- not by mutating storage.buckets directly. Configure it as PUBLIC because company logos
-- are intentionally public brand assets used by future email/chatbot surfaces.
-- Recommended bucket limits: 2 MiB; image/png, image/jpeg, image/webp.

create table if not exists public.workspace_branding (
  workspace_id uuid primary key
    references public.workspaces(id) on delete cascade,
  company_name text not null
    check (char_length(btrim(company_name)) between 1 and 160),
  logo_path text
    check (logo_path is null or char_length(logo_path) <= 500),
  primary_color text not null default '#2493F1'
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null default '#0F172A'
    check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  website_url text
    check (
      website_url is null
      or (
        char_length(website_url) <= 500
        and website_url ~* '^https?://'
      )
    ),
  sender_name text
    check (sender_name is null or char_length(sender_name) <= 160),
  reply_to_email text
    check (
      reply_to_email is null
      or (
        char_length(reply_to_email) <= 320
        and reply_to_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ),
  email_signature text
    check (email_signature is null or char_length(email_signature) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspace_branding is
  'One reusable client identity profile per workspace for UI previews and future outbound communication/chatbot surfaces.';
comment on column public.workspace_branding.logo_path is
  'Object path inside the public workspace-brand-assets Storage bucket. Logos are non-sensitive public brand assets.';
comment on column public.workspace_branding.sender_name is
  'Default display name for future outbound templates. This does not itself authorize or send email.';
comment on column public.workspace_branding.reply_to_email is
  'Default reply-to identity for future outbound templates. Provider verification is handled by the outbound email layer.';

drop trigger if exists trg_workspace_branding_updated_at
  on public.workspace_branding;
create trigger trg_workspace_branding_updated_at
before update on public.workspace_branding
for each row execute function private.set_updated_at();

alter table public.workspace_branding enable row level security;

drop policy if exists workspace_branding_member_read
  on public.workspace_branding;
create policy workspace_branding_member_read
on public.workspace_branding
for select
to authenticated
using (
  (select private.is_workspace_member(workspace_branding.workspace_id))
);

drop policy if exists workspace_branding_admin_update
  on public.workspace_branding;
create policy workspace_branding_admin_update
on public.workspace_branding
for update
to authenticated
using (
  (select private.is_workspace_member(
    workspace_branding.workspace_id,
    array['owner'::text, 'admin'::text]
  ))
)
with check (
  (select private.is_workspace_member(
    workspace_branding.workspace_id,
    array['owner'::text, 'admin'::text]
  ))
);

revoke all on table public.workspace_branding from anon;
revoke all on table public.workspace_branding from authenticated;
grant select on table public.workspace_branding to authenticated;
grant update (
  company_name,
  logo_path,
  primary_color,
  secondary_color,
  website_url,
  sender_name,
  reply_to_email,
  email_signature
) on table public.workspace_branding to authenticated;
grant all on table public.workspace_branding to service_role;

insert into public.workspace_branding (workspace_id, company_name)
select w.id, w.name
from public.workspaces w
on conflict (workspace_id) do nothing;

create or replace function private.ensure_workspace_branding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_branding (workspace_id, company_name)
  values (new.id, new.name)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

revoke all on function private.ensure_workspace_branding() from public;
revoke all on function private.ensure_workspace_branding() from anon;
revoke all on function private.ensure_workspace_branding() from authenticated;

drop trigger if exists trg_workspaces_ensure_branding on public.workspaces;
create trigger trg_workspaces_ensure_branding
after insert on public.workspaces
for each row execute function private.ensure_workspace_branding();

create or replace function private.brand_asset_workspace_id(p_name text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_folder text;
begin
  v_folder := (storage.foldername(p_name))[1];
  if v_folder is null then return null; end if;
  return v_folder::uuid;
exception
  when invalid_text_representation then return null;
end;
$$;

revoke all on function private.brand_asset_workspace_id(text) from public;
revoke all on function private.brand_asset_workspace_id(text) from anon;
grant execute on function private.brand_asset_workspace_id(text) to authenticated;
grant execute on function private.brand_asset_workspace_id(text) to service_role;

drop policy if exists workspace_brand_assets_member_select on storage.objects;
create policy workspace_brand_assets_member_select
on storage.objects for select to authenticated
using (
  bucket_id = 'workspace-brand-assets'
  and array_length(storage.foldername(name), 1) = 1
  and (select private.is_workspace_member(private.brand_asset_workspace_id(name)))
);

drop policy if exists workspace_brand_assets_admin_insert on storage.objects;
create policy workspace_brand_assets_admin_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'workspace-brand-assets'
  and array_length(storage.foldername(name), 1) = 1
  and lower(storage.filename(name)) = any (array['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp'])
  and lower(storage.extension(name)) = any (array['png', 'jpg', 'jpeg', 'webp'])
  and (select private.is_workspace_member(private.brand_asset_workspace_id(name), array['owner'::text, 'admin'::text]))
);

drop policy if exists workspace_brand_assets_admin_update on storage.objects;
create policy workspace_brand_assets_admin_update
on storage.objects for update to authenticated
using (
  bucket_id = 'workspace-brand-assets'
  and (select private.is_workspace_member(private.brand_asset_workspace_id(name), array['owner'::text, 'admin'::text]))
)
with check (
  bucket_id = 'workspace-brand-assets'
  and array_length(storage.foldername(name), 1) = 1
  and lower(storage.filename(name)) = any (array['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp'])
  and lower(storage.extension(name)) = any (array['png', 'jpg', 'jpeg', 'webp'])
  and (select private.is_workspace_member(private.brand_asset_workspace_id(name), array['owner'::text, 'admin'::text]))
);

drop policy if exists workspace_brand_assets_admin_delete on storage.objects;
create policy workspace_brand_assets_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'workspace-brand-assets'
  and (select private.is_workspace_member(private.brand_asset_workspace_id(name), array['owner'::text, 'admin'::text]))
);
