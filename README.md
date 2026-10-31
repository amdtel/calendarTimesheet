# Calendar Timesheet

A mobile-first, installable job calendar and timesheet for scheduling work, tracking time, and creating basic invoices. The app is built with Astro and Lit, and is designed to keep working when a phone is offline after the app has loaded and cached its shell.

## What it does

- **Calendar:** schedule jobs by date and see their estimate, proposal, booked or done status.
- **Jobs:** keep a job name, client, status, date, notes, fixed quote amount, or hourly billing rate.
- **Clock:** start one job session as work or travel, switch between work and travel, pause for breaks, and pause overnight to resume the same session another day. Finish the job to save one session entry.
- **Hours:** review completed sessions by week, month or all time, including separate work and travel durations.
- **Invoices:** create fixed-quote or hourly invoices in GBP, mark them draft, sent or paid, and print or save them as PDF. Hourly invoices include both work and travel and exclude paused breaks. A job has at most one draft at a time; replacing it keeps its invoice number, and deleting it makes its included time available to redraft.
- **Backup:** export all local app data as JSON and export timesheet rows as CSV; restore a JSON backup on the device.

## Run locally

Requirements: Node.js and npm.

```sh
npm install
npm run dev
```

Astro prints a local URL, normally `http://localhost:4321/`.

Check a production build with:

```sh
npm run build
npm run preview
```

## Install and deploy

The site is a static Astro build published from `dist/` on Netlify. Push the repository to the connected Git remote and Netlify will run `npm run build`. PWA installation requires an HTTPS deployment and a browser that supports installation. Open the deployed site once while online so its service worker can cache the app shell; after that, the cached pages and local data can be used offline.

The PWA manifest and icons are under `public/`. The service worker is `public/sw.js`; update its cache version when changing cached app-shell behavior. The manifest response type and service-worker cache headers are configured in `netlify.toml`.

## Data and limitations

Jobs, time entries, active sessions, invoices and draft-number reservations are stored in the browser's `localStorage` on that device. There is currently no database, account, cloud backup, or automatic sync between devices. Browser data can be removed by clearing site storage, so export a JSON backup regularly and before clearing browser data or reinstalling.

The invoice prototype currently has no business identity/address settings, client postal addresses, payment instructions, tax calculation, or partial fixed-quote billing. Client information is currently a free-text field on each job. Invoice numbering and the records are local to this browser profile, not centrally allocated.

## Project layout

- `src/pages/`: Astro route shells.
- `src/layouts/Layout.astro`: shared navigation and client component imports.
- `src/components/`: Lit interface components.
- `src/lib/store.js`: local data model, persistence and time calculations.
- `src/styles/global.css`: responsive interface and invoice print rules.
- `public/`: PWA manifest, icons and service worker.
- `.github/copilot-instructions.md`: repository context and implementation invariants for future Copilot chats.
