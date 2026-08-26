create table if not exists public.automation_idempotency_keys (
  idempotency_key text primary key,
  scope text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists automation_idempotency_expires_idx on public.automation_idempotency_keys(expires_at);

alter table public.automation_idempotency_keys enable row level security;
revoke all on table public.automation_idempotency_keys from anon, authenticated;
grant select, insert, update, delete on table public.automation_idempotency_keys to service_role;
;
