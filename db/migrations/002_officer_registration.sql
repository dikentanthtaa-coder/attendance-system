-- Attendance Officers now register themselves and Admin approves them, instead of two fixed
-- accounts split by gender. Any approved officer can search and mark any member.

alter table app_users
  add column first_name      text,
  add column last_name       text,
  add column mobile          text check (mobile ~ '^[0-9]{10}$'),
  add column email           text check (email = lower(email)),
  add column approval_status text not null default 'approved'
             check (approval_status in ('pending', 'approved', 'rejected')),
  add column reviewed_at     timestamptz,
  add column reviewed_by     uuid references app_users (id);

-- Existing accounts stay approved above; anything created from now on must be approved explicitly.
alter table app_users alter column approval_status set default 'pending';

-- A person registers once. These also let them log in with either one.
create unique index app_users_email_key on app_users (email) where email is not null;
create unique index app_users_mobile_key on app_users (mobile) where mobile is not null;

-- The fixed Male Officer and Female Officer accounts can no longer log in. They are kept, not
-- deleted, because attendance already marked points to them as "Marked by".
update app_users set is_active = false where role = 'officer';

alter table app_users drop column gender_scope;

-- An officer can now record that a member didn't attend. 'cancelled' is Admin's removal.
alter table attendance drop constraint attendance_status_check;
alter table attendance add constraint attendance_status_check
  check (status in ('present', 'absent', 'cancelled'));

-- Searches are no longer split by gender. The member list is sorted by name.
drop index members_gender_name_idx;
create index members_name_idx on members (name);
