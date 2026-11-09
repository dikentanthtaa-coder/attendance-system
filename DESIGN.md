# Design

A working tool. It should disappear into the task, with familiar controls and no decoration. Tokens are in `src/app/globals.css`.

## What makes it this product's

- **The three-day strip:** Day 1, 2 and 3 as one connected object, with the status on each. It appears for officers (to choose a day) and Admin (to run the event). Don't split it into separate cards.
- **The mark:** three strokes for three days.
- **Mukta Vaani:** one family throughout. It covers Latin and Gujarati script, so a name in either reads properly, and has true tabular figures.
- **The page tint:** `#f2f5f8`, taken from the navy of the requirements document (`#1f4e79`).

## Colour

Colour carries meaning, and the chrome stays neutral.

| Use | Token |
| --- | --- |
| Primary action, focus, selected day | `brand` |
| Page ground, white work surfaces | `canvas`, white |
| Male and female data only (validated for colour-blind separation) | `male`, `female` |
| Active status, success | `ok`, `ok-soft` |
| Already Present, duplicate warning | `warn`, `warn-soft` |
| Errors, removing or ending something | `danger`, `danger-soft` |

Text is always `ink` or `muted`, never a series colour. Words reach 4.5:1 on their surface, placeholders included.

## Type

14px body, 12px meta, 16px section titles, 24px page titles. Inputs are 16px or more on phones, so the page doesn't zoom. The largest figure is the combined attendance at 32px. Numbers use tabular figures and sit right-aligned in columns.

## Surfaces

- A 1px border or a shadow, never both. Shadows are only for what floats: menus, dialogs, tooltips, toasts.
- Radius is 8px on surfaces and 6px on controls.
- No cards inside cards. Related figures share one container split by hairlines.
- Tables are rules and alignment: 12px grey sentence-case headers, no zebra stripes.

## Behaviour

- Touch targets are at least 44px on phones. Below `md`, tables become two-line lists and every field is kept.
- One filled primary button at a time. Search results use outlined buttons, and only a single match gets a filled one.
- Confirmation appears beside the search box and toasts at the top of the screen, because a phone keyboard can hide the bottom.
- Quick Entry lives on the page. Dialogs are only for confirming something hard to undo, or for short edits.
- Motion is 150-180ms and reports state only. Nothing performs an entrance.
- Every data block has its loading, empty and error state. Zeros print as zeros; missing values are a grey dash.

## Don't

Gradients, glass, glows, pulsing dots, labels above headings, icons in tinted squares, emoji or Unicode characters as icons, sparklines, placeholder-only labels, a dark or saturated header, or violet.
