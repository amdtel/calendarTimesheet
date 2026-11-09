# Calendar Timesheet Project Context

## Purpose and current state

This is a mobile-first, installable job calendar and timesheet for one person or a small operator. It supports job scheduling and status tracking, time tracking, local JSON/CSV exports, and basic GBP invoicing. The app is a prototype: job and timesheet data is stored only in the current browser/device, with no automatic cross-device sync. Admin authentication uses Netlify Blobs and PostgreSQL.

## Stack and structure

- Astro 5 builds a static site for Netlify.
- Lit web components provide interactive screens; keep client-side JavaScript small and avoid adding a framework.
- `src/lib/store.js` owns the `ct.v1` localStorage data model and dispatches `ct-change` after writes.
- `src/lib/base.js` provides the shared Lit base class and renders in light DOM for global styles.
- `src/components/` contains the Clock, Jobs, Calendar, Hours, Backup, and Invoices views.
- `src/pages/` contains the static Astro route shells; `src/layouts/Layout.astro` owns the shared nav, component imports, manifest link and service-worker registration.
- `src/styles/global.css` owns screen and print styles.
- `netlify/functions/` and `netlify/lib/auth.mjs` implement the admin API: CIP-30 wallet sign-in (nonce challenge, COSE_Sign1 verification, key-hash check against a mainnet stake or key-based payment address), HMAC-signed JWT cookie sessions, a role-based user list in Netlify Blobs, and PostgreSQL nonce-consumption markers. `/admin/` (`src/pages/admin.astro`, `src/components/ct-admin.js`, `src/lib/wallet.js`) is the sign-in and user-management UI and is not part of the installable app.
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

## Admin auth invariants

- Challenges bind the exact mainnet address into the signed message; verify any protected address header matches it and check the signing key hash. Never accept an unsigned verify-request address as identity. Payment signatures do not prove ownership of the embedded stake credential.
- A valid signature consumes a nonce through a unique PostgreSQL insert. Never fall back to Netlify Blobs: a local concurrent `onlyIfNew` test admitted two requests. All functions must use the same durable writable database; never delete markers, restore an older database, or switch databases while challenges may still be accepted.
- Version the session audience when changing authentication guarantees, so previously issued cookies cannot bypass them. Cookies are not individually revoked on logout.
- Roles (`admin`, `office`, `worker`) come only from the stored user record or `ADMIN_STAKE_ADDRESSES`; every function must call `requireRole`. Do not trust the static `/admin/` page.
- Required env vars: `SESSION_SECRET` (32+ chars), `ADMIN_STAKE_ADDRESSES`, and `AUTH_DATABASE_URL` (PostgreSQL with the schema in `netlify/auth-schema.sql`). Never commit `.env`.
- Local and deployed environments need separate database URLs and session secrets. Provision the hosted database and apply the schema explicitly; a Netlify Database or provider-specific connection variable is not automatically used as `AUTH_DATABASE_URL`. Deploy previews must not share challenges across independently branched nonce databases.
- Netlify dev turns 403 function responses into a 404 retry, so sign-in failures use 401.
- Use `npx netlify dev` (port 8888) to test functions; `npm run dev` has no API. The service worker must not cache `/api/` or `/admin`.
- Run `npm test` for signature, address, expiry and replay tests. The optional `CT_TEST_URL` endpoint suite requires the synthetic local credentials and disposable PostgreSQL described in the README and must never target production. Test the actual database provider and deployment before sensitive data; real Brave and hardware-wallet compatibility remains unverified.

## Development and deployment

- Install dependencies with `npm install`.
- Run locally with `npm run dev`.
- Verify production output with `npm run build`; preview it with `npm run preview`.
- Netlify publishes `dist/`; `netlify.toml` sets the manifest MIME type and disables service-worker caching.
- PWA install requires a deployed HTTPS origin and a compatible browser. Offline use begins after the app shell has been loaded and cached; clearing browser site data also deletes local jobs, sessions and invoices, so export a JSON backup first.

When changing billing or time tracking, test session totals, pause exclusion, travel inclusion, draft replacement/deletion, invoice status preservation, backup compatibility, and the production build.