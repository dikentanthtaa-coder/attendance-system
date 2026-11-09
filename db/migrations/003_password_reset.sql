-- Admin can reset an officer's password. The officer must then choose a new one, and any device
-- still logged in with the old one is signed out.
-- Existing sessions carry no version and count as 0, so nobody is logged out by this change.
alter table app_users
  add column must_change_password boolean not null default false,
  add column session_version      integer not null default 0;
