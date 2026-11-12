-- Uploading a member Excel now replaces the earlier uploaded list. People added one at a time with
-- Add Member have to survive that, but were stored like Excel members, so mark them.
alter table members add column added_by_hand boolean not null default false;

update members m set added_by_hand = true
where m.created_source = 'excel_import'
  and exists (select 1 from audit_log l where l.action = 'member.add' and l.entity_id = m.id::text);
