-- The event is spelled Gyansatra. Only names still in the original "Gyansatr ..." form are
-- corrected, so a session name Admin typed differently is left as it is.
update event_sessions
set name = 'Gyansatra' || substr(name, length('Gyansatr') + 1)
where name like 'Gyansatr %';
