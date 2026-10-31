# Calendar Timesheet Project Context

## Purpose and current state

This is a mobile-first, installable job calendar and timesheet for one person or a small operator. It supports job scheduling and status tracking, time tracking, local JSON/CSV exports, and basic GBP invoicing. The app is a prototype: its data is stored only in the current browser/device, with no server database or automatic cross-device sync.

## Stack and structure

- Astro 5 builds a static site for Netlify.
- Lit web components provide interactive screens; keep client-side JavaScript small and avoid adding a framework.
- `src/lib/store.js` owns the `ct.v1` localStorage data model and dispatches `ct-change` after writes.
- `src/lib/base.js` provides the shared Lit base class and renders in light DOM for global styles.
- `src/components/` contains the Clock, Jobs, Calendar, Hours, Backup, and Invoices views.
- `src/pages/` contains the static Astro route shells; `src/layouts/Layout.astro` owns the shared nav, component imports, manifest link and service-worker registration.
- `src/styles/global.css` owns screen and print styles.
- `public/sw.js` caches the app shell and same-origin GET resources; increment its cache name when needed to replace deployed cached resources.
- `public/manifest.webmanifest` and the PNGs in `public/` define PWA metadata and icons.

## Data and behavior invariants

- Keep jobs, completed session entries, invoices and the active session in the local store so JSON backup/restore covers the full app.
- A job session is one completed entry from start to finish. Its `segments` contain `work` or `travel` intervals; paused gaps are not segments and are not billable.
- Use `entryDuration`, `entrySegments`, `segmentDuration`, `activeDuration`, and `durationForDate` from the store instead of calculating `end - start` directly. Legacy entries without segments represent uninterrupted work.
- Only one active session is supported. It can switch between work and travel, pause for a break, or remain paused overnight and resume later.
- Hourly invoices include completed, unbilled sessions and bill both work and travel at the job rate. `entryIds` mark sessions included by invoices and prevent duplicate billing.
- Fixed invoices use the job's quote amount. Only one draft invoice per job is allowed; replacement keeps the draft number. Draft deletion releases its entries and reserves its number for redrafting that job. Sent and paid invoices are retained as history.
- Invoice currency is GBP and tax is currently not calculated.
- Keep old backups loadable when adding fields: supply safe defaults in `load()` and `replaceAll()`.
- Lit reactive properties must be initialized in constructors, not with class-field initializers that shadow Lit accessors.

## Development and deployment

- Install dependencies with `npm install`.
- Run locally with `npm run dev`.
- Verify production output with `npm run build`; preview it with `npm run preview`.
- Netlify publishes `dist/`; `netlify.toml` sets the manifest MIME type and disables service-worker caching.
- PWA install requires a deployed HTTPS origin and a compatible browser. Offline use begins after the app shell has been loaded and cached; clearing browser site data also deletes local jobs, sessions and invoices, so export a JSON backup first.

When changing billing or time tracking, test session totals, pause exclusion, travel inclusion, draft replacement/deletion, invoice status preservation, backup compatibility, and the production build.