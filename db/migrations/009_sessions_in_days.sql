-- A day can hold several sessions, such as Morning, Evening and Night. Each session still has its own
-- attendance, exactly as before: day_no only groups sessions under their day and puts them in order.
-- It's left nullable so the app version running while this is applied can still add a session; the
-- app reads an empty day_no as "a day of its own" (its event_day).
alter table event_sessions add column day_no smallint check (day_no >= 1);
update event_sessions set day_no = event_day;
