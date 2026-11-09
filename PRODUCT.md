# Product

**Gyansatr Attendance** records who attended each day of the three-day Gyansatr event.

## Who uses it, and where

- **Male Officer and Female Officer:** one login each, shared across several devices at the registration desks, on a phone or tablet, with a queue in front of them. They need to find a person and mark them present in seconds, usually one-handed, often with the on-screen keyboard open.
- **Admin:** on a laptop. Uploads the member list before the event, starts and ends each day, watches the counts, exports the report, and corrects mistakes.

## What each screen must answer first

- **Officer:** "Is this person marked present?" The most frequent job is search, then one tap.
- **Officer totals and history:** "How many have I marked, how many has everyone marked, and did that person go through?"
- **Admin dashboard:** "Which day is running, and how many have attended, male and female?" The most frequent jobs are starting or ending a day and exporting.

## Rules the design has to respect

- There are only three accounts, and no signup. An officer only ever sees their own gender's members.
- Marking is Present only. Removing attendance is Admin only, and needs a reason.
- Name search is by the start of each name in order: `jay kan` finds first name Jay..., last name Kan...
- Attendance can only be marked on the active day, so a day's status must be readable at a glance.
- The officer must always get visible confirmation, even with the keyboard open.
- An officer can't undo Present, so an accidental tap should be hard to make.

## Tone

Plain, calm and quick. Labels use the document's own words: Gyansatr Day 1, Quick Entry, Already Present. The duplicate-mobile warning keeps its exact Roman Gujarati wording from the requirements.
