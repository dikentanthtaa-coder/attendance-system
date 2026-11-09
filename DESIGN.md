# Design

A friendly, clear tool for a busy registration desk. Colour and structure show people where to look and what to tap. Tokens are in `src/app/globals.css`.

## Reuse before you style

Every screen is built from `src/components/ui/`. Import from `@/components/ui`. If a screen needs a new look, add or extend a component there rather than styling it in the screen, so the change reaches the whole app.

| Need | Component |
| --- | --- |
| Page frame, header, navigation, log out | `AppShell`, `Logo` |
| Page title | `PageHeader` |
| A block of content | `Card`, `CardHeader` |
| Actions | `Button`, `LinkButton` |
| Form fields | `Field` with `TextInput`, `PasswordInput`, `SearchInput` or `Select` |
| A custom dropdown list | `ListPopup`, `ListOption` |
| File upload | `FileDrop` |
| Status and labels | `Badge`, `StatusBadge`, `AttendanceBadge`, `OfficerStatusBadge`, `GenderBadge`, `SourceBadge` |
| Headline numbers | `StatCard`, `StatList` |
| Lists of records | `DataTable`, `PersonRow`, `PersonCell`, `MetaList`, `Avatar`, `Pagination` |
| Messages | `Alert`, `useToast` |
| Loading and empty | `Spinner`, `Skeleton`, `EmptyState` |
| Dialogs | `Modal`, `ModalActions`, `ConfirmDialog` |

App-specific blocks are in `src/components/`: `AuthFrame` for the signed-out screens, `EventDayTabs`, `EventDayCard`, `CenterSelect`.

## Colour

| Use | Token |
| --- | --- |
| Header, hero figure, login panel | `brand-deep`, `brand-dark` |
| Primary action, focus, selected tab | `brand` |
| The middle stroke of the logo and small highlights on navy only | `accent` |
| Mark Present, active day, success | `ok` |
| Mark Absent uses the `danger-outline` button, so Present stays the main action | `danger` |
| Male and female data (chart colours validated for colour-blind separation) | `male`, `female` |
| Already Present, duplicate warning, Quick Entry | `warn` |
| Errors, removing or ending something | `danger` |

Chart text stays `ink` or `muted`, never a series colour. Words reach 4.5:1 on their surface, placeholders included. Status always has a word beside its colour.

## Type

Mukta Vaani throughout: it covers Latin and Gujarati, and has true tabular figures. 15px body, 14px controls and tables, 12px meta, 16px card titles, 24px page titles. Inputs are 16px or more on phones, so the page doesn't zoom.

## Surfaces

- Cards are white with a 14px radius, a 1px border and a soft shadow. Controls have a 10px radius.
- The page ground is `canvas`. Tables use a `canvas` header row and a hairline between rows.
- Colour is flat, with no gradients. Solid navy marks the header, the hero figure and the login panel.

## Behaviour

- Touch targets are at least 44px on phones. Below `lg`, `DataTable` shows a list instead of a table, and every field is kept.
- One main action per view: Mark Present is green, and everything else is quieter.
- Confirmation appears beside the search box and toasts at the top of the screen, because a phone keyboard can hide the bottom.
- Dropdowns are always `Select` or `CenterSelect`, never the browser's own `<select>` or `<datalist>`, which can't be styled and differ on every device. A filter in use is tinted, so it's clear why the numbers are narrowed.
- Quick Entry lives on the page. Dialogs are only for confirming something hard to undo, or for short edits.
- Every data block has its loading, empty and error state. Zeros print as zeros; missing values are a grey dash.
- Motion is 150-180ms, and `prefers-reduced-motion` turns it off.
