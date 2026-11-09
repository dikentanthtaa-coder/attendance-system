-- Real member lists have people with no mobile number on record. They still need to be found and
-- marked, by name or Member ID. The existing check still requires 10 digits when a number is given.
-- Quick Entry keeps requiring one, for its duplicate-mobile warning.
alter table members alter column mobile drop not null;
