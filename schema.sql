-- ============================================
-- CALLM8 SUPABASE SCHEMA
-- Run this in Supabase SQL Editor
-- ============================================

-- CLIENTS TABLE
create table if not exists clients (
  id uuid default gen_random_uuid() primary key,
  business_name text not null,
  bland_number text unique,
  owner_mobile text not null,
  notify_sms text,
  notify_email text,
  business_type text default 'clinic',
  plan text default 'starter',
  active boolean default true,
  stripe_customer_id text,
  stripe_session_id text,
  created_at timestamp with time zone default timezone('utc', now()),
  updated_at timestamp with time zone default timezone('utc', now())
);

-- CALLS TABLE
create table if not exists calls (
  id uuid default gen_random_uuid() primary key,
  call_id text unique not null,
  client_id uuid references clients(id) on delete set null,
  caller_number text,
  inbound_number text,
  summary text,
  transcript text,
  duration numeric,
  status text default 'completed',
  raw_payload jsonb,
  created_at timestamp with time zone default timezone('utc', now())
);

-- INDEXES for fast lookups
create index if not exists clients_bland_number_idx on clients(bland_number);
create index if not exists clients_active_idx on clients(active);
create index if not exists calls_call_id_idx on calls(call_id);
create index if not exists calls_client_id_idx on calls(client_id);
create index if not exists calls_created_at_idx on calls(created_at desc);

-- AUTO UPDATE updated_at on clients
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

create trigger clients_updated_at
  before update on clients
  for each row execute function update_updated_at();

-- ============================================
-- SAMPLE DATA (for testing — delete in prod)
-- ============================================
-- insert into clients (business_name, bland_number, owner_mobile, notify_sms, notify_email, business_type, plan)
-- values ('Test Physio Clinic', '+61299991234', '+61423141142', '+61423141142', 'test@example.com', 'physio', 'starter');
