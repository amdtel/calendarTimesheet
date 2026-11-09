import { getStore } from '@netlify/blobs';
import { SignJWT, jwtVerify } from 'jose';
import { decode } from 'cbor-x';
import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { bech32 } from '@scure/base';
import pg from 'pg';

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
let authPool;

export class AuthDatabaseError extends Error {}

const consumeNonce = async (nonce) => {
  if (!process.env.AUTH_DATABASE_URL) throw new AuthDatabaseError('authentication database unavailable');
  try {
    authPool ??= new pg.Pool({ connectionString: process.env.AUTH_DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
    const result = await authPool.query('INSERT INTO ct_auth_consumed_nonces (nonce) VALUES ($1) ON CONFLICT DO NOTHING RETURNING nonce', [nonce]);
    return result.rowCount === 1;
  } catch {
    throw new AuthDatabaseError('authentication database unavailable');
  }
};

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
  let validPointer = false;
  if (type === 4 && bytes.length >= 32) {
    let offset = 29;
    let fields = 0;
    while (offset < bytes.length && fields < 3) {
      const start = offset;
      while (offset < bytes.length && bytes[offset] & 0x80) offset++;
      if (offset >= bytes.length || offset - start >= 10 || (offset > start && bytes[start] === 0x80)) break;
      offset++;
      fields++;
    }
    validPointer = fields === 3 && offset === bytes.length;
  }
  if ((type === 0xe && bytes.length === 29) || ([0, 2].includes(type) && bytes.length === 57) || (type === 6 && bytes.length === 29) || validPointer) {
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

export async function createChallenge(origin, address, store = nonces()) {
  if (!isWalletAddress(address)) throw new Error('invalid wallet address');
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const issued = Date.now();
  const { modified } = await store.setJSON(nonce, { issued, address }, { onlyIfNew: true });
  if (!modified) throw new Error('challenge collision');
  const message = `Sign in to Calendar Timesheet\nOrigin: ${origin}\nAddress: ${address}\nNonce: ${nonce}\nIssued: ${new Date(issued).toISOString()}`;
  return { nonce, message };
}

// CIP-8/CIP-30 signData: COSE_Sign1 signed by the key behind a stake or payment address.
export async function verifySignature({ signature, key, nonce, origin }, store = nonces(), consume = consumeNonce) {
  if (typeof nonce !== 'string' || !/^[0-9a-f]{32}$/.test(nonce)) throw new Error('invalid nonce');
  const record = await store.get(nonce, { type: 'json' });
  if (!record || !Number.isSafeInteger(record.issued) || record.issued > Date.now() || Date.now() - record.issued >= NONCE_SECONDS * 1000 || !isWalletAddress(record.address)) throw new Error('challenge expired');
  const expected = `Sign in to Calendar Timesheet\nOrigin: ${origin}\nAddress: ${record.address}\nNonce: ${nonce}\nIssued: ${new Date(record.issued).toISOString()}`;

  const [protectedBytes, , payload, sig] = decode(unhex(signature));
  const coseKey = decode(unhex(key));
  const pub = coseKey.get ? coseKey.get(-2) : coseKey[-2];
  if (!(pub instanceof Uint8Array) || pub.length !== 32 || sig.length !== 64) throw new Error('bad key');
  if (!(payload instanceof Uint8Array) || !Buffer.from(payload).equals(Buffer.from(expected))) throw new Error('payload mismatch');

  const headers = decode(protectedBytes);
  const signedAddress = headers.get ? headers.get('address') : headers.address;
  const addr = bech32.fromWords(bech32.decode(record.address, 250).words);
  if (signedAddress !== undefined && (!(signedAddress instanceof Uint8Array) || !Buffer.from(signedAddress).equals(Buffer.from(addr)))) throw new Error('address mismatch');
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
  if (Date.now() - record.issued >= NONCE_SECONDS * 1000) throw new Error('challenge expired');
  if (!await consume(nonce)) throw new Error('challenge already used');
  if (Date.now() - record.issued >= NONCE_SECONDS * 1000) throw new Error('challenge expired');
  return found.id;
}

export async function getUser(stake) {
  const stored = await users().get(stake, { type: 'json' });
  if (envAdmins().includes(stake)) return { name: 'Admin', ...stored, stake, role: 'admin', active: true };
  return stored && stored.active ? stored : null;
}

export async function issueSession(stake) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(stake)
    .setAudience('ct-wallet-v2').setIssuedAt().setExpirationTime(`${SESSION_SECONDS}s`).sign(secret());
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
    ({ payload: { sub: stake } } = await jwtVerify(cookie.slice(COOKIE.length + 1), secret(), { algorithms: ['HS256'], audience: 'ct-wallet-v2', requiredClaims: ['sub', 'iat', 'exp'] }));
  } catch {
    return json({ error: 'unauthenticated' }, 401);
  }
  if (!isWalletAddress(stake)) return json({ error: 'unauthenticated' }, 401);
  const user = await getUser(stake);
  if (!user) return json({ error: 'unauthenticated' }, 401);
  if (!allowed.includes(user.role)) return json({ error: 'forbidden' }, 403);
  if (req.method !== 'GET' && !/^application\/json(?:\s*;|\s*$)/i.test(req.headers.get('content-type') || '')) return json({ error: 'json required' }, 415);
  return user;
}
