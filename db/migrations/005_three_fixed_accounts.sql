-- Back to three fixed accounts: Admin, Male Officer and Female Officer. Each officer account can be
-- logged in on many devices at once, and only reaches members of its own gender.

alter table app_users add column gender_scope text check (gender_scope in ('Male', 'Female'));

update app_users set gender_scope = 'Male', is_active = true, approval_status = 'approved' where username = 'male.officer';
update app_users set gender_scope = 'Female', is_active = true, approval_status = 'approved' where username = 'female.officer';

-- Registered accounts can no longer log in. They are kept, not deleted, because attendance they
-- marked points to them as "Marked by".
update app_users set is_active = false where role = 'officer' and gender_scope is null;

-- An active officer always has a gender, and there is at most one active officer per gender.
alter table app_users add constraint app_users_active_officer_has_gender
  check (role <> 'officer' or not is_active or gender_scope is not null);
create unique index app_users_one_officer_per_gender on app_users (gender_scope) where is_active and role = 'officer';

-- Searches and lists are split by gender again.
create index members_gender_name_idx on members (gender, name);
