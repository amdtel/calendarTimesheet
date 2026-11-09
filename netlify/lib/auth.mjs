import { getStore } from '@netlify/blobs';
import { SignJWT, jwtVerify } from 'jose';
import { decode } from 'cbor-x';
import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { bech32 } from '@scure/base';

export const ROLES = ['admin', 'office', 'worker'];
const COOKIE = 'ct_session';
const SESSION_SECONDS = 12 * 60 * 60;
const NONCE_SECONDS = 5 * 60;

const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (s) => {
  if (typeof s !== 'string' || s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error('bad hex');
  return new Uint8Array(Buffer.from(s, 'hex'));
};

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

export const users = () => getStore({ name: 'ct-users', consistency: 'strong' });
const nonces = () => getStore({ name: 'ct-nonces', consistency: 'strong' });

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ chars)');
  return new TextEncoder().encode(s);
};

// Wallet addresses (bech32) that are always admin, so the first admin can bootstrap.
export const envAdmins = () => (process.env.ADMIN_STAKE_ADDRESSES || '').split(',').map((s) => s.trim()).filter(Boolean);

// Mainnet stake (reward) or key-based payment address; returns its bech32 identity and the key hash that must sign.
const identify = (bytes) => {
  const type = bytes[0] >> 4;
  if ((bytes[0] & 0xf) !== 1) return null;
  if ((type === 0xe && bytes.length === 29) || ([0, 2, 4, 6].includes(type) && bytes.length >= 29)) {
    return { id: bech32.encode(type === 0xe ? 'stake' : 'addr', bech32.toWords(bytes), 250), keyHash: hex(bytes.slice(1, 29)) };
  }
  return null;
};

export const isWalletAddress = (a) => {
  try {
    const { prefix, words } = bech32.decode(a, 250);
    const found = identify(bech32.fromWords(words));
    return !!found && found.id === a && (prefix === 'stake' || prefix === 'addr');
  } catch {
    return false;
  }
};

export async function createChallenge(origin) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const issued = Date.now();
  await nonces().setJSON(nonce, { issued });
  const message = `Sign in to Calendar Timesheet\nOrigin: ${origin}\nNonce: ${nonce}\nIssued: ${new Date(issued).toISOString()}`;
  return { nonce, message };
}

// CIP-8/CIP-30 signData: COSE_Sign1 signed by the key behind a stake or payment address.
export async function verifySignature({ signature, key, nonce, origin, address }) {
  const record = await nonces().get(nonce, { type: 'json' });
  await nonces().delete(nonce);
  if (!record || Date.now() - record.issued > NONCE_SECONDS * 1000) throw new Error('challenge expired');
  const expected = `Sign in to Calendar Timesheet\nOrigin: ${origin}\nNonce: ${nonce}\nIssued: ${new Date(record.issued).toISOString()}`;

  const [protectedBytes, , payload, sig] = decode(unhex(signature));
  const coseKey = decode(unhex(key));
  const pub = coseKey.get ? coseKey.get(-2) : coseKey[-2];
  if (!(pub instanceof Uint8Array) || pub.length !== 32 || sig.length !== 64) throw new Error('bad key');
  if (Buffer.from(payload).toString('utf8') !== expected) throw new Error('payload mismatch');

  const headers = decode(protectedBytes);
  // Some wallets omit the address header; the key-hash check below still binds it to the signing key.
  const addr = (headers.get ? headers.get('address') : headers.address) ?? unhex(address);
  const found = addr instanceof Uint8Array && identify(addr);
  if (!found) throw new Error('unsupported address');
  if (hex(blake2b(pub, { dkLen: 28 })) !== found.keyHash) throw new Error('key does not match address');

  const bstr = (b) => {
    const n = b.length;
    const head = n < 24 ? [0x40 | n] : n < 256 ? [0x58, n] : [0x59, n >> 8, n & 255];
    return Buffer.concat([Buffer.from(head), b]);
  };
  const sigStructure = Buffer.concat([
    Buffer.from([0x84, 0x6a]), Buffer.from('Signature1'),
    bstr(protectedBytes), bstr(new Uint8Array(0)), bstr(payload),
  ]);
  if (!ed25519.verify(sig, sigStructure, pub)) throw new Error('bad signature');
  return found.id;
}

export async function getUser(stake) {
  const stored = await users().get(stake, { type: 'json' });
  if (envAdmins().includes(stake)) return { name: 'Admin', ...stored, stake, role: 'admin', active: true };
  return stored && stored.active ? stored : null;
}

export async function issueSession(stake) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(stake)
    .setIssuedAt().setExpirationTime(`${SESSION_SECONDS}s`).sign(secret());
  const secure = process.env.CONTEXT === 'dev' ? '' : '; Secure';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_SECONDS}${secure}`;
}

export const clearSession = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0`;

// Returns the active user for the request, or a Response to send back.
export async function requireRole(req, allowed) {
  const cookie = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!cookie) return json({ error: 'unauthenticated' }, 401);
  let stake;
  try {
    ({ payload: { sub: stake } } = await jwtVerify(cookie.slice(COOKIE.length + 1), secret(), { algorithms: ['HS256'] }));
  } catch {
    return json({ error: 'unauthenticated' }, 401);
  }
  const user = await getUser(stake);
  if (!user) return json({ error: 'unauthenticated' }, 401);
  if (!allowed.includes(user.role)) return json({ error: 'forbidden' }, 403);
  if (req.method !== 'GET' && !(req.headers.get('content-type') || '').includes('application/json')) return json({ error: 'json required' }, 415);
  return user;
}
