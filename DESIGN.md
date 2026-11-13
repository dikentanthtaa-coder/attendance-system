# Design

A friendly, clear tool for a busy registration desk. Colour and structure show people where to look and what to tap. Tokens are in `src/app/globals.css`.

## Reuse before you style

Every screen is built from `src/components/ui/`. Import from `@/components/ui`. If a screen needs a new look, add or extend a component there rather than styling it in the screen, so the change reaches the whole app.

| Need | Component |
| --- | --- |
| Page frame, header, navigation, log out | `AppShell`, `Logo` |
| Installing the app, and being offline | `InstallButton`, `OfflineNotice`, `ServiceWorker` |
| Page title | `PageHeader` |
| A block of content | `Card`, `CardHeader` |
| Actions | `Button`, `LinkButton` |
| Form fields | `Field` with `TextInput`, `PasswordInput`, `SearchInput` or `Select` |
| A custom dropdown list | `ListPopup`, `ListOption` |
| File upload | `FileDrop` |
| Status and labels | `Badge`, `StatusBadge`, `GenderBadge`, `SourceBadge` |
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

- The marking screen shows attendance and history side by side from 1024px, with history staying in view. Below that, one at a time, with a bottom bar to switch.
- It installs as an app. The service worker stores only code, icons and the offline page, never pages or replies with member details.
- Touch targets are at least 44px on phones. Below `lg`, `DataTable` shows a list instead of a table, and every field is kept.
- One main action per view: Mark Present is green, and everything else is quieter. The exception is Quick Entry on the marking screen: full width and filled, so officers find it at once.
- Everyone finds people by search only, Admin included. There's no "Not marked yet" list.
- Below 1024px the header is one short row: a menu button, the app name, and the role and current page under it. Every page, Install app and Log out are in a drawer that slides in from the left. From 1024px the links sit in the header.
- On phones, page-title buttons share one full-width row, an alert's button drops under its message at full width, and a list row's actions can drop under the details (`stackActions`), so nothing is squeezed into a narrow column.
- Rare actions that can't be undone (Clear Attendance, replacing the member list, Delete Filtered on Members) ask for the Admin login password, and Clear Attendance sits at the foot of the Dashboard, away from everyday buttons. Delete Filtered only appears once a search or filter is in use, lists the filters in its dialog, and is refused if the number matching changed since Admin saw it.
- Totals show the person's own figure next to the whole: "My present" beside "Total present" for an officer, each officer beside "All officers" for Admin. Long lists show page numbers.
- Confirmation appears beside the search box and toasts at the top of the screen, because a phone keyboard can hide the bottom.
- Dropdowns are always `Select` or `CenterSelect`, never the browser's own `<select>` or `<datalist>`, which can't be styled and differ on every device. A filter in use is tinted, so it's clear why the numbers are narrowed.
- Quick Entry lives on the page. Dialogs are only for confirming something hard to undo, or for short edits.
- Every data block has its loading, empty and error state. Zeros print as zeros; missing values are a grey dash.
- Motion is 150-180ms, and `prefers-reduced-motion` turns it off.
