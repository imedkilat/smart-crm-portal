create or replace function private.is_workspace_member(p_workspace_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = (select auth.uid())
      and (p_roles is null or wm.role = any(p_roles))
  );
$$;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('cmp_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 240),
  domain text,
  website text,
  industry text,
  employee_band text,
  annual_revenue numeric(18,2),
  notes text,
  owner_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index companies_workspace_domain_unique on public.companies(workspace_id, lower(domain)) where domain is not null;
create index companies_workspace_name_idx on public.companies(workspace_id, name);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('con_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  first_name text,
  last_name text,
  display_name text not null check (char_length(display_name) between 1 and 240),
  email text,
  phone text,
  title text,
  lifecycle_stage text not null default 'prospect' check (lifecycle_stage in ('lead','prospect','customer','partner','other')),
  owner_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_workspace_email_idx on public.contacts(workspace_id, lower(email)) where email is not null;
create index contacts_company_idx on public.contacts(company_id);
create index contacts_workspace_name_idx on public.contacts(workspace_id, display_name);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('deal_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete restrict,
  pipeline_stage_id uuid not null references public.pipeline_stages(id) on delete restrict,
  primary_contact_id uuid references public.contacts(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  origin_lead_id bigint references public.leads(id) on delete set null,
  name text not null check (char_length(name) between 1 and 240),
  amount numeric(18,2) not null default 0 check (amount >= 0),
  currency_code text not null default 'USD' check (currency_code = 'USD'),
  probability smallint not null default 10 check (probability between 0 and 100),
  expected_close_date date,
  status text not null default 'open' check (status in ('open','won','lost')),
  owner_user_id uuid references auth.users(id) on delete set null,
  won_at timestamptz,
  lost_at timestamptz,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deals_workspace_stage_idx on public.deals(workspace_id, pipeline_stage_id, status);
create index deals_workspace_owner_idx on public.deals(workspace_id, owner_user_id, status);
create index deals_company_idx on public.deals(company_id);
create index deals_primary_contact_idx on public.deals(primary_contact_id);

create table public.deal_contacts (
  deal_id uuid not null references public.deals(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role text,
  created_at timestamptz not null default now(),
  primary key (deal_id, contact_id)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('tag_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index tags_workspace_name_unique on public.tags(workspace_id, lower(name));

create table public.record_tags (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  record_type text not null check (record_type in ('lead','contact','company','deal')),
  record_id text not null,
  created_at timestamptz not null default now(),
  primary key (tag_id, record_type, record_id)
);
create index record_tags_record_idx on public.record_tags(workspace_id, record_type, record_id);

create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('fld_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  object_type text not null check (object_type in ('lead','contact','company','deal')),
  name text not null check (char_length(name) between 1 and 100),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  field_type text not null check (field_type in ('text','number','date','boolean','select','multi_select','url','email','phone')),
  options jsonb not null default '[]'::jsonb,
  is_required boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, object_type, field_key)
);

create table public.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  field_id uuid not null references public.custom_fields(id) on delete cascade,
  record_type text not null check (record_type in ('lead','contact','company','deal')),
  record_id text not null,
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(field_id, record_id)
);
create index custom_values_record_idx on public.custom_field_values(workspace_id, record_type, record_id);

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('view_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  object_type text not null check (object_type in ('lead','contact','company','deal','task')),
  name text not null check (char_length(name) between 1 and 100),
  filters jsonb not null default '[]'::jsonb,
  sort jsonb not null default '[]'::jsonb,
  columns jsonb not null default '[]'::jsonb,
  is_shared boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('act_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  record_type text not null check (record_type in ('lead','contact','company','deal','task','workspace','automation')),
  record_id text not null,
  activity_type text not null,
  title text not null,
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);
create index crm_activities_record_idx on public.crm_activities(workspace_id, record_type, record_id, occurred_at desc);
create index crm_activities_workspace_idx on public.crm_activities(workspace_id, occurred_at desc);

alter table public.leads add column converted_contact_id uuid references public.contacts(id) on delete set null;
alter table public.leads add column converted_company_id uuid references public.companies(id) on delete set null;
alter table public.leads add column converted_deal_id uuid references public.deals(id) on delete set null;
alter table public.leads add column converted_at timestamptz;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_companies_updated_at before update on public.companies for each row execute function private.set_updated_at();
create trigger trg_contacts_updated_at before update on public.contacts for each row execute function private.set_updated_at();
create trigger trg_deals_updated_at before update on public.deals for each row execute function private.set_updated_at();
create trigger trg_custom_fields_updated_at before update on public.custom_fields for each row execute function private.set_updated_at();
create trigger trg_saved_views_updated_at before update on public.saved_views for each row execute function private.set_updated_at();

create or replace function private.log_deal_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_activities(workspace_id, record_type, record_id, activity_type, title, metadata, actor_user_id)
    values (new.workspace_id, 'deal', new.public_id, 'deal_created', 'Deal created', jsonb_build_object('amount',new.amount,'stage_id',new.pipeline_stage_id,'status',new.status), auth.uid());
  elsif old.pipeline_stage_id is distinct from new.pipeline_stage_id then
    insert into public.crm_activities(workspace_id, record_type, record_id, activity_type, title, metadata, actor_user_id)
    values (new.workspace_id, 'deal', new.public_id, 'deal_stage_changed', 'Deal stage changed', jsonb_build_object('from_stage_id',old.pipeline_stage_id,'to_stage_id',new.pipeline_stage_id), auth.uid());
  end if;
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.crm_activities(workspace_id, record_type, record_id, activity_type, title, metadata, actor_user_id)
    values (new.workspace_id, 'deal', new.public_id, 'deal_status_changed', 'Deal status changed', jsonb_build_object('from_status',old.status,'to_status',new.status), auth.uid());
  end if;
  return new;
end;
$$;

create trigger trg_log_deal_insert after insert on public.deals for each row execute function private.log_deal_change();
create trigger trg_log_deal_update after update of pipeline_stage_id, status on public.deals for each row execute function private.log_deal_change();

alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.deals enable row level security;
alter table public.deal_contacts enable row level security;
alter table public.tags enable row level security;
alter table public.record_tags enable row level security;
alter table public.custom_fields enable row level security;
alter table public.custom_field_values enable row level security;
alter table public.saved_views enable row level security;
alter table public.crm_activities enable row level security;

create policy companies_read on public.companies for select to authenticated using (private.is_workspace_member(workspace_id));
create policy companies_write on public.companies for all to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy contacts_read on public.contacts for select to authenticated using (private.is_workspace_member(workspace_id));
create policy contacts_write on public.contacts for all to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy deals_read on public.deals for select to authenticated using (private.is_workspace_member(workspace_id));
create policy deals_write on public.deals for all to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy deal_contacts_read on public.deal_contacts for select to authenticated using (private.is_workspace_member(workspace_id));
create policy deal_contacts_write on public.deal_contacts for all to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy tags_read on public.tags for select to authenticated using (private.is_workspace_member(workspace_id));
create policy tags_write on public.tags for all to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy record_tags_read on public.record_tags for select to authenticated using (private.is_workspace_member(workspace_id));
create policy record_tags_write on public.record_tags for all to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy custom_fields_read on public.custom_fields for select to authenticated using (private.is_workspace_member(workspace_id));
create policy custom_fields_admin_write on public.custom_fields for all to authenticated using (private.is_workspace_member(workspace_id, array['owner','admin'])) with check (private.is_workspace_member(workspace_id, array['owner','admin']));
create policy custom_values_read on public.custom_field_values for select to authenticated using (private.is_workspace_member(workspace_id));
create policy custom_values_write on public.custom_field_values for all to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy saved_views_read on public.saved_views for select to authenticated using (private.is_workspace_member(workspace_id));
create policy saved_views_write on public.saved_views for all to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy crm_activities_read on public.crm_activities for select to authenticated using (private.is_workspace_member(workspace_id));
create policy crm_activities_insert on public.crm_activities for insert to authenticated with check (private.is_workspace_member(workspace_id));;
