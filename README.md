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

## Admin area and wallet login

`/admin/` is a separate page, not part of the installable app, for managing who may use the system. It signs in with a Cardano wallet through CIP-30 and is backed by Netlify Functions (`netlify/functions/`) and Netlify Blobs, both available on the free tier. Phase 1 and 2 are implemented: wallet sign-in and an admin-managed user list with `admin`, `office` and `worker` roles. Jobs assignment and timesheet sync are not built yet.

### How sign-in works

1. The browser asks `POST /api/auth/challenge` for a challenge. The server stores a random nonce and returns a message containing the site origin, the nonce and a timestamp.
2. The wallet signs that message with `signData` (CIP-30 / CIP-8 `COSE_Sign1`). No transaction is created, nothing is sent on chain, and no funds or tokens are involved. Wallets that expose a reward address sign with the stake key; Brave Wallet has no `getRewardAddresses`, so the client falls back to the payment address.
3. The browser posts the signature and public key to `POST /api/auth/verify`. The server checks, in order:
   - the nonce exists and has not expired (5 minutes); it is deleted during verification;
   - the signed payload is byte-for-byte the expected message for this nonce and origin;
   - the address is a mainnet stake address or a key-based payment address (script and testnet addresses are rejected);
   - the Blake2b-224 hash of the supplied public key equals the key hash inside that address;
   - the Ed25519 signature is valid over the `Signature1` structure.
4. The address comes from the signed headers if present, or otherwise from the client request, and its key hash must match the verified signing key. It must match a user an admin registered (or an address in `ADMIN_STAKE_ADDRESSES`), and the user must be active.
5. The server sets a 12 hour session cookie (`HttpOnly`, `SameSite=Strict`, `Secure` outside dev, path `/api`). Every API call re-reads the user record, so disabling or removing a user ends their access immediately.

### Security model

What it protects against:

- **Key ownership:** the signature must verify under a public key whose hash matches the address credential. Sending an address or public key alone does not prove ownership of its signing key.
- **Replay mitigation:** nonces are random and expire after 5 minutes, and the origin and timestamp are part of the signed text. Nonce consumption is not atomic, so concurrent replay remains possible.
- **Role escalation:** roles come only from the server-side user record (or the environment list), not from the token or the client. Admin and office checks run in every function; the static `/admin/` page is not a security boundary.
- **Sessions:** cookies are HMAC-signed with `SESSION_SECRET`, HttpOnly and SameSite=Strict. State-changing authenticated calls also require a JSON content type. A stolen cookie can still be replayed until it expires or the user is disabled.
- **Unregistered wallets:** a valid signature from an unknown wallet is refused and gets no session. The response returns an address associated with the signing key so an admin can register it.

Known limits:

- **Not ready for sensitive production data:** nonce consumption is a separate read and delete, allowing concurrent reuse. When a signed address header is absent, the request supplies the address; for payment addresses, only the payment key hash is checked, not the other address fields. Fix and independently test these limitations before relying on the login for real worker or client data.
- **Phishing relay:** a lookalike site could fetch a real challenge and ask a user to sign it. The wallet shows the message including the real origin, so users should check it before approving. CIP-30 does not bind the requesting website into the signature.
- **Wallet or secret compromise:** anyone holding the wallet's keys can sign in as that user. Anyone holding `SESSION_SECRET` can forge sessions, so keep it only in Netlify environment variables and rotate it if it leaks (this signs everyone out).
- **No server-side logout:** logging out clears the cookie but an already copied token stays valid until it expires (12 hours) unless the user is disabled.
- **No rate limiting:** unauthenticated challenge requests each store a small blob that is not cleaned up if unused. This is fine for a small prototype; add rate limiting or cleanup before wider use.
- **Payment vs stake identity:** a wallet that signs with its payment address is identified by that exact address. Different addresses from the same wallet are different users, so register the address the wallet actually signs with (shown on the sign-in page when the wallet is not yet registered).
- **Mainnet only:** testnet addresses are rejected.

### Set up

Create `.env` (ignored by Git; see `example.env`) for local development and set the same variables in Netlify under Site settings, Environment variables:

```
SESSION_SECRET=<32+ random characters, e.g. from: openssl rand -hex 32>
ADMIN_STAKE_ADDRESSES=addr1...,stake1...
```

`ADMIN_STAKE_ADDRESSES` is a comma-separated list of wallet addresses that are always admins and bootstrap the first login. Other users are registered from `/admin/` and stored in Netlify Blobs.

Run the site and functions together with `npx netlify dev` (open `http://localhost:8888/admin/`). `npm run dev` serves only the Astro pages without the API. Local Blobs data lives under `.netlify/`, which is ignored by Git.

To get a wallet's address, open `/admin/` and sign in; an unregistered wallet is shown its address. The Cardano wallet must support CIP-30 `signData`; Brave Wallet (desktop 1.88 or later) and common extension wallets do.

## Data and limitations

Jobs, time entries, active sessions, invoices and draft-number reservations are stored in the browser's `localStorage` on that device. There is currently no database, account, cloud backup, or automatic sync between devices. Browser data can be removed by clearing site storage, so export a JSON backup regularly and before clearing browser data or reinstalling.

The invoice prototype currently has no business identity/address settings, client postal addresses, payment instructions, tax calculation, or partial fixed-quote billing. Client information is currently a free-text field on each job. Invoice numbering and the records are local to this browser profile, not centrally allocated.

## Project layout

- `src/pages/`: Astro route shells.
- `src/layouts/Layout.astro`: shared navigation and client component imports.
- `src/components/`: Lit interface components.
- `src/lib/store.js`: local data model, persistence and time calculations.
- `src/pages/admin.astro`, `src/components/ct-admin.js`, `src/lib/wallet.js`: admin sign-in page and CIP-30 wallet helper.
- `netlify/functions/`: `auth.mjs` (challenge, verify, logout, me) and `admin-users.mjs` (user management); `netlify/lib/auth.mjs` holds signature verification, sessions and role checks.
- `src/styles/global.css`: responsive interface and invoice print rules.
- `public/`: PWA manifest, icons and service worker.
- `.github/copilot-instructions.md`: repository context and implementation invariants for future Copilot chats.
