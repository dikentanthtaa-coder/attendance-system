-- Attendance Management System - initial schema.
-- The app talks to Postgres directly from the server. No table is meant to be
-- reachable through Supabase's public API, so RLS is on with no policies.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create table app_users (
  id              uuid primary key default gen_random_uuid(),
  username        text not null unique check (username = lower(username)),
  display_name    text not null,
  password_hash   text not null,
  role            text not null check (role in ('admin', 'officer')),
  gender_scope    text check (gender_scope in ('Male', 'Female')),
  is_active       boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  -- An officer always has exactly one gender; an admin never has one.
  check ((role = 'officer') = (gender_scope is not null))
);

create table event_sessions (
  event_day  smallint primary key check (event_day between 1 and 3),
  name       text not null,
  status     text not null default 'not_started'
             check (status in ('not_started', 'active', 'ended')),
  started_at timestamptz,
  ended_at   timestamptz,
  started_by uuid references app_users (id),
  ended_by   uuid references app_users (id)
);

insert into event_sessions (event_day, name) values
  (1, 'Gyansatr Day 1'),
  (2, 'Gyansatr Day 2'),
  (3, 'Gyansatr Day 3');

-- Business rule 2: at most one event day can be active, even under concurrent requests.
create unique index event_sessions_one_active
  on event_sessions ((true)) where status = 'active';

create table members (
  id                integer generated always as identity primary key,
  global_member_id  text,
  name              text not null check (length(name) > 0),
  mobile            text not null check (mobile ~ '^[0-9]{10}$'),
  gender            text not null check (gender in ('Male', 'Female')),
  center            text not null check (length(center) > 0),
  created_source    text not null check (created_source in ('excel_import', 'quick_entry')),
  created_by        uuid references app_users (id),
  created_event_day smallint references event_sessions (event_day),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- MemberID is optional, but when present it identifies exactly one member.
create unique index members_global_member_id_key
  on members (global_member_id) where global_member_id is not null;

-- Search indexes. Every search is scoped to one gender.
create index members_id_prefix_idx on members (global_member_id text_pattern_ops);
create index members_mobile_idx on members (mobile);
create index members_mobile_trgm_idx on members using gin (mobile extensions.gin_trgm_ops);
create index members_name_trgm_idx on members using gin (name extensions.gin_trgm_ops);
create index members_gender_name_idx on members (gender, name);

create table attendance (
  id            integer generated always as identity primary key,
  member_id     integer not null references members (id) on delete cascade,
  event_day     smallint not null references event_sessions (event_day),
  marked_at     timestamptz not null default now(),
  marked_by     uuid not null references app_users (id),
  status        text not null default 'present' check (status in ('present', 'cancelled')),
  cancelled_at  timestamptz,
  cancelled_by  uuid references app_users (id),
  cancel_reason text,
  -- Business rule 8: one attendance per member per event day.
  unique (member_id, event_day)
);

create index attendance_day_status_idx on attendance (event_day, status);
create index attendance_marked_at_idx on attendance (marked_at desc);

-- Business rule 9: who did what, and when.
create table audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  user_id   uuid references app_users (id),
  username  text not null,
  action    text not null,
  entity_id text,
  details   jsonb not null default '{}'::jsonb
);

create index audit_log_at_idx on audit_log (at desc);

-- Close the Supabase public API. The app's own role owns these tables and is unaffected.
alter table app_users enable row level security;
alter table event_sessions enable row level security;
alter table members enable row level security;
alter table attendance enable row level security;
alter table audit_log enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
    end if;
  end loop;
end $$;
