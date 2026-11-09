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

`/admin/` is a separate page, not part of the installable app, for managing who may use the system. It signs in with a Cardano wallet through CIP-30. Netlify Functions use Netlify Blobs for users and challenges and PostgreSQL for replay protection. Phase 1 and 2 are implemented: wallet sign-in and an admin-managed user list with `admin`, `office` and `worker` roles. Jobs assignment and timesheet sync are not built yet.

### How sign-in works

1. The browser selects a wallet address and sends it to `POST /api/auth/challenge`. The server validates and stores the address with a random nonce, and returns a message containing the exact address, site origin, nonce and timestamp.
2. The wallet signs that message with `signData` (CIP-30 / CIP-8 `COSE_Sign1`). No transaction is created, nothing is sent on chain, and no funds or tokens are involved. Wallets that expose a reward address sign with the stake key; Brave Wallet has no `getRewardAddresses`, so the client falls back to the payment address.
3. The browser posts the signature and public key to `POST /api/auth/verify`. The server checks, in order:
   - the nonce exists and has not expired (5 minutes);
   - the signed payload is byte-for-byte the expected message for this nonce and origin;
   - the address is a mainnet stake address or a key-based payment address (script and testnet addresses are rejected);
   - the Blake2b-224 hash of the supplied public key equals the key hash inside that address;
   - an address in the protected header, if present, matches the address in the signed message;
   - the Ed25519 signature is valid over the `Signature1` structure;
   - a nonce marker is inserted in PostgreSQL under a unique primary key; an existing marker rejects the attempt.
4. The authenticated identity is the exact address in the signed challenge, never an address supplied only at verification. It must match a user an admin registered (or an address in `ADMIN_STAKE_ADDRESSES`), and the user must be active.
5. The server sets a 12 hour session cookie (`HttpOnly`, `SameSite=Strict`, `Secure` outside dev, path `/api`). Every API call re-reads the user record, so disabling or removing a user ends their access immediately. Cookies from the previous authentication protocol are rejected and users must sign in again.

### Security model

What it protects against:

- **Key ownership:** the signature must verify under a public key whose hash matches the address credential. Sending an address or public key alone does not prove ownership of its signing key.
- **Replay mitigation:** nonces are random and expire after 5 minutes. The exact address, origin and timestamp are signed. A valid verification inserts a permanent PostgreSQL marker using a primary-key constraint; concurrent inserts cannot both succeed. Invalid signatures do not consume the nonce. Authentication fails closed if the database is unavailable.
- **Role escalation:** roles come only from the server-side user record (or the environment list), not from the token or the client. Admin and office checks run in every function; the static `/admin/` page is not a security boundary.
- **Sessions:** cookies are HMAC-signed with `SESSION_SECRET`, HttpOnly and SameSite=Strict. State-changing authenticated calls also require a JSON content type. A stolen cookie can still be replayed until it expires or the user is disabled.
- **Unregistered wallets:** a valid signature from an unknown wallet is refused and gets no session. The response returns an address associated with the signing key so an admin can register it.

Known limits:

- **Database durability:** all function instances must use the same writable PostgreSQL database with durable commits and no lossy failover. Restoring an older backup, clearing markers, or switching to an independent database can make recently consumed challenges replayable; invalidate or wait out all outstanding challenges before doing so. The local concurrency test is not a production deployment test. Independently test the actual provider and deployment before using sensitive data.
- **Why not Blobs for consumption:** Netlify's [API reference](https://docs.netlify.com/build/data-and-storage/netlify-blobs/#set) calls conditional writes atomic, while its troubleshooting section says Blobs has no concurrency control. In a local Netlify Dev race, two concurrent `onlyIfNew` writes both succeeded. Blobs is therefore not used to consume nonces.
- **Phishing relay:** a lookalike site could fetch a real challenge and ask a user to sign it. The wallet shows the message including the real origin, so users should check it before approving. CIP-30 does not bind the requesting website into the signature.
- **Wallet or secret compromise:** anyone holding the wallet's keys can sign in as that user. Anyone holding `SESSION_SECRET` can forge sessions, so keep it only in Netlify environment variables and rotate it if it leaks (this signs everyone out).
- **No server-side logout:** logging out clears the cookie but an already copied token stays valid until it expires (12 hours) unless the user is disabled.
- **No rate limiting or automatic cleanup:** challenge requests create blobs, and verified sign-ins also create PostgreSQL markers. Do not delete a consumed marker while its challenge could still be accepted. Add rate limiting and carefully designed expiry cleanup before wider use.
- **Payment vs stake identity:** a wallet that signs with its payment address is identified by that exact address. Different addresses from the same wallet are different users, so register the address the wallet actually signs with (shown on the sign-in page when the wallet is not yet registered).
- **Payment credentials:** the signature proves control of the payment key, not control of any stake credential embedded in a base address. A payment key can be associated with multiple addresses. Do not interpret a payment-address login as proof of stake-key ownership.
- **Wallet compatibility:** the automated suite simulates Brave's missing reward-address API and signatures without an address header, but a real Brave Wallet and hardware wallets have not been tested with the longer address-containing message. Wallets that cannot sign that full message cannot use this login; there is no unsigned-address fallback.
- **Mainnet only:** testnet addresses are rejected.

### Set up

Create `.env` (ignored by Git; see `example.env`) for local development. Set these variables separately for deployed Netlify Functions, using a separate hosted database and a separate session secret:

```
SESSION_SECRET=<32+ random characters, e.g. from: openssl rand -hex 32>
ADMIN_STAKE_ADDRESSES=addr1...,stake1...
AUTH_DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<database>?sslmode=verify-full
```

`ADMIN_STAKE_ADDRESSES` is a comma-separated list of exact wallet addresses that are always admins and bootstrap the first login. Other users are registered from `/admin/` and stored in Netlify Blobs. Do not commit credentials.

For deployment:

1. Provision a durable, writable hosted PostgreSQL database. The database on your development computer is not available to Netlify Functions. Netlify Database or a separate PostgreSQL provider are options; neither is configured by this repository automatically.
2. Apply `netlify/auth-schema.sql` once with a schema-owner account, for example in the provider's SQL editor or with `psql` using a connection string from your environment. The application database role needs `INSERT` and `SELECT` on `ct_auth_consumed_nonces`.
3. Configure `AUTH_DATABASE_URL`, `SESSION_SECRET` and `ADMIN_STAKE_ADDRESSES` in Netlify's environment variables for the Functions scope and intended deploy context, then deploy. `AUTH_DATABASE_URL` must be the hosted database's writable connection string with verified TLS; this code does not automatically read a provider-specific database variable.
4. Test sign-in and concurrent replay against the actual provider and deployment before using sensitive data. Use a separate database for local development. All function instances accepting the same challenges must use the same durable database; do not use a copied or independently branched database for them.

Netlify Database consumes plan credits, and external database providers can have separate limits or charges. Free tiers may suspend service or block writes when limits are reached, preventing login. Check current provider pricing and account usage before deployment.

Run the site and functions together with `npx netlify dev` (open `http://localhost:8888/admin/`). `npm run dev` serves only the Astro pages without the API. Local Blobs data lives under `.netlify/`, which is ignored by Git.

If sign-in reports `Authentication database unavailable`, check that `AUTH_DATABASE_URL` is set in the Netlify Dev environment, the database is reachable, and the schema has been applied. Restart `npx netlify dev` after changing environment variables. `/api/auth/me` returns 401 until a session has been issued. A `signature rejected` response means the signature or challenge failed verification; wallet compatibility has not yet been verified with real devices. The service worker excludes `/api/` and `/admin`, but may cache other same-origin scripts. To rule out an outdated script, bypass the service worker or use a private browser window; do not clear site data without first exporting a JSON backup.

Run the isolated signature and nonce tests with `npm test`. For the endpoint test, provision a separate disposable local PostgreSQL database and initialize it with the schema above. Start Netlify Dev with that local database URL and the synthetic credentials below. These tests write and remove a synthetic local user and must not run against production; the test refuses non-local endpoint URLs.

```sh
ADMIN_STAKE_ADDRESSES="$(node --input-type=module -e "import {ed25519} from '@noble/curves/ed25519.js'; import {blake2b} from '@noble/hashes/blake2.js'; import {bech32} from '@scure/base'; const key=ed25519.getPublicKey(new Uint8Array(32).fill(7)); const addr=Uint8Array.from([1,...blake2b(key,{dkLen:28}),...new Uint8Array(28).fill(1)]); console.log(bech32.encode('addr',bech32.toWords(addr),250))")" SESSION_SECRET='test-only-session-secret-not-for-deployment' AUTH_DATABASE_URL='postgresql://<local-user>:<local-password>@127.0.0.1:5432/<test-database>' CONTEXT=dev npx netlify dev --offline --no-open --port 8899 --target-port 4333 --functions-port 9999 --command 'npm run dev -- --port 4333 --strictPort'
```

In a second terminal, run `CT_TEST_URL=http://localhost:8899 npm test`.

To get a wallet's address, open `/admin/` and sign in; an unregistered wallet is shown its address. The Cardano wallet must support CIP-30 `signData`; Brave Wallet (desktop 1.88 or later) and common extension wallets do.

## Data and limitations

Jobs, time entries, active sessions, invoices and draft-number reservations are stored in the browser's `localStorage` on that device. PostgreSQL and Netlify Blobs support admin authentication only; there is no server database for jobs or timesheets, cloud backup, or automatic sync between devices. Browser data can be removed by clearing site storage, so export a JSON backup regularly and before clearing browser data or reinstalling.

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
