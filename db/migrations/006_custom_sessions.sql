-- Admin can add event sessions beyond the first three, with any name, and rename or remove them.
-- event_day stays the session's key and order: a new session takes the next number.

alter table event_sessions drop constraint event_sessions_event_day_check;
alter table event_sessions add constraint event_sessions_event_day_check check (event_day >= 1);

alter table event_sessions add constraint event_sessions_name_check check (length(btrim(name)) between 1 and 60);

-- Two sessions with the same name would be impossible to tell apart in filters and reports.
create unique index event_sessions_name_key on event_sessions (lower(btrim(name)));
