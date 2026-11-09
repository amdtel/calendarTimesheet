import test from 'node:test';
import assert from 'node:assert/strict';
import { encode } from 'cbor-x';
import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { bech32 } from '@scure/base';
import { SignJWT } from 'jose';
import { createChallenge, verifySignature, isWalletAddress } from '../netlify/lib/auth.mjs';
import { login } from '../src/lib/wallet.js';

const origin = 'http://localhost:8888';
const testSecret = 'test-only-session-secret-not-for-deployment';
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const privateKey = new Uint8Array(32).fill(7);
const publicKey = ed25519.getPublicKey(privateKey);
const credential = blake2b(publicKey, { dkLen: 28 });
const addressBytes = Uint8Array.from([0x01, ...credential, ...new Uint8Array(28).fill(1)]);
const alternateBytes = Uint8Array.from([0x01, ...credential, ...new Uint8Array(28).fill(2)]);
const address = bech32.encode('addr', bech32.toWords(addressBytes), 250);
const alternate = bech32.encode('addr', bech32.toWords(alternateBytes), 250);
const stakeBytes = Uint8Array.from([0xe1, ...credential]);
const stakeAddress = bech32.encode('stake', bech32.toWords(stakeBytes), 250);

function signatureFor(message, headerAddress = addressBytes, signingKey = privateKey) {
  const headers = new Map([[1, -8]]);
  if (headerAddress) headers.set('address', Buffer.from(headerAddress));
  const protectedBytes = encode(headers);
  const payload = Buffer.from(message);
  const structure = encode(['Signature1', protectedBytes, Buffer.alloc(0), payload]);
  return {
    signature: hex(encode([protectedBytes, new Map(), payload, Buffer.from(ed25519.sign(structure, signingKey))])),
    key: hex(encode(new Map([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(publicKey)]]))),
  };
}

function memoryStore() {
  const records = new Map();
  return {
    records,
    async get(key) { return records.get(key) ?? null; },
    async set(key, value, options = {}) {
      if (options.onlyIfNew && records.has(key)) return { modified: false };
      records.set(key, value);
      return { modified: true };
    },
    async setJSON(key, value, options) { return this.set(key, value, options); },
  };
}

async function signedChallenge(store, selectedAddress = address, headerAddress = addressBytes) {
  const challenge = await createChallenge(origin, selectedAddress, store);
  return { ...challenge, ...signatureFor(challenge.message, headerAddress), origin };
}

async function verify(signed, store) {
  return verifySignature(signed, store, async (nonce) => (await store.set(`used/${nonce}`, 'used', { onlyIfNew: true })).modified);
}

test('valid payment and stake signatures, including absent address header', async () => {
  for (const [selectedAddress, headerAddress] of [[address, addressBytes], [address, null], [stakeAddress, stakeBytes]]) {
    const store = memoryStore();
    const signed = await signedChallenge(store, selectedAddress, headerAddress);
    assert.equal(await verify(signed, store), selectedAddress);
    await assert.rejects(verify(signed, store));
  }
});

test('rejects tampering and invalid signatures without consuming the challenge', async () => {
  const store = memoryStore();
  const signed = await signedChallenge(store);
  await assert.rejects(verify({ ...signed, ...signatureFor(signed.message, alternateBytes) }, store));
  await assert.rejects(verify({ ...signed, ...signatureFor(signed.message.replace(address, alternate), null) }, store));
  await assert.rejects(verify({ ...signed, ...signatureFor(signed.message, null, new Uint8Array(32).fill(9)) }, store));
  const otherKey = ed25519.getPublicKey(new Uint8Array(32).fill(9));
  await assert.rejects(verify({ ...signed, key: hex(encode(new Map([[-2, Buffer.from(otherKey)]]))) }, store));
  await assert.rejects(verify({ ...signed, origin: 'https://other.example' }, store));
  await assert.rejects(verify({ ...signed, nonce: '../invalid' }, store));
  assert.equal(await verify({ ...signed, address: alternate }, store), address);
});

test('rejects expired and future challenges', async () => {
  for (const issued of [Date.now() - 300001, Date.now() + 300000]) {
    const store = memoryStore();
    const signed = await signedChallenge(store);
    store.records.get(signed.nonce).issued = issued;
    await assert.rejects(verify(signed, store), /expired/);
  }
});

test('accepts at most one concurrent verification', async () => {
  const store = memoryStore();
  const signed = await signedChallenge(store);
  const results = await Promise.allSettled(Array.from({ length: 30 }, () => verify(signed, store)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
});

test('rejects a valid signature when nonce storage fails', async () => {
  const store = memoryStore();
  const signed = await signedChallenge(store);
  await assert.rejects(verifySignature(signed, store, async () => { throw new Error('database unavailable'); }), /database unavailable/);
});

test('rejects non-mainnet and script addresses', () => {
  assert.equal(isWalletAddress(bech32.encode('addr_test', bech32.toWords(Uint8Array.from([0x60, ...credential])), 250)), false);
  assert.equal(isWalletAddress(bech32.encode('addr', bech32.toWords(Uint8Array.from([0x71, ...credential])), 250)), false);
  assert.equal(isWalletAddress(bech32.encode('addr', bech32.toWords(Uint8Array.from([0x01, ...credential])), 250)), false);
  assert.equal(isWalletAddress(bech32.encode('addr', bech32.toWords(Uint8Array.from([0x41, ...credential, 1, 2, 3])), 250)), true);
  assert.equal(isWalletAddress(bech32.encode('addr', bech32.toWords(Uint8Array.from([0x41, ...credential, 1, 2, 0x80])), 250)), false);
});

test('wallet login binds a Brave-style payment address in the challenge', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let signedPayload;
  try {
    globalThis.window = { cardano: { brave: { enable: async () => ({
      getRewardAddresses: async () => { throw new Error('not implemented'); },
      getUsedAddresses: async () => [hex(addressBytes)],
      signData: async (selected, payload) => {
        assert.equal(selected, hex(addressBytes));
        signedPayload = Buffer.from(payload, 'hex').toString();
        return { signature: 'signature', key: 'key' };
      },
    }) } } };
    globalThis.fetch = async (path, options) => {
      const body = JSON.parse(options.body);
      if (path === '/api/auth/challenge') {
        assert.equal(body.address, address);
        return Response.json({ nonce: 'nonce', message: `Address: ${address}` });
      }
      assert.equal(path, '/api/auth/verify');
      assert.deepEqual(body, { nonce: 'nonce', signature: 'signature', key: 'key' });
      return Response.json({ stake: address });
    };
    assert.equal((await login('brave')).stake, address);
    assert.equal(signedPayload, `Address: ${address}`);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

const testUrl = process.env.CT_TEST_URL;
test('Netlify login fails closed without the nonce database', { skip: !process.env.CT_TEST_NO_DB_URL }, async () => {
  const parsedUrl = new URL(process.env.CT_TEST_NO_DB_URL);
  assert.equal(parsedUrl.protocol, 'http:');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname), 'endpoint tests must target local Netlify Dev');
  const post = (path, body) => fetch(`${parsedUrl.origin}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const challenge = await post('/api/auth/challenge', { address });
  assert.equal(challenge.status, 200);
  const { nonce, message } = await challenge.json();
  const response = await post('/api/auth/verify', { nonce, ...signatureFor(message, null) });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await response.json()).error, 'Authentication database unavailable. Check server configuration.');
});

test('Netlify endpoints enforce login, replay, sessions and roles', { skip: !testUrl }, async () => {
  const parsedUrl = new URL(testUrl);
  assert.equal(parsedUrl.protocol, 'http:');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname), 'endpoint tests must target local Netlify Dev');
  const request = (path, options = {}) => fetch(`${testUrl}${path}`, options);
  const post = (path, body, cookie, method = 'POST') => request(path, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });
  const challenge = async (selectedAddress) => {
    const response = await post('/api/auth/challenge', { address: selectedAddress });
    assert.equal(response.status, 200);
    return response.json();
  };
  const login = async (selectedAddress, headerAddress) => {
    const current = await challenge(selectedAddress);
    return post('/api/auth/verify', { nonce: current.nonce, ...signatureFor(current.message, headerAddress) });
  };
  assert.equal((await request('/api/auth/me')).status, 401);
  assert.equal((await request('/api/auth/challenge', { method: 'POST' })).status, 415);
  assert.equal((await post('/api/auth/challenge', { address: 'invalid' })).status, 400);
  const unregistered = await login(stakeAddress, stakeBytes);
  assert.equal(unregistered.status, 401);
  assert.equal((await unregistered.json()).stake, stakeAddress);

  const current = await challenge(address);
  const signed = { nonce: current.nonce, ...signatureFor(current.message, null) };
  const responses = await Promise.all(Array.from({ length: 20 }, () => post('/api/auth/verify', signed)));
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(responses.filter((response) => response.status === 401).length, 19);
  const adminCookie = responses.find((response) => response.status === 200).headers.get('set-cookie').split(';')[0];
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await challenge(address);
    const body = { nonce: next.nonce, ...signatureFor(next.message, null) };
    const concurrent = await Promise.all(Array.from({ length: 20 }, () => post('/api/auth/verify', body)));
    assert.equal(concurrent.filter((response) => response.status === 200).length, 1);
    assert.equal(concurrent.filter((response) => response.status === 401).length, 19);
  }
  assert.equal((await request('/api/auth/me', { headers: { cookie: adminCookie } })).status, 200);
  assert.equal((await post('/api/admin/users', null, adminCookie)).status, 400);

  const expired = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(address)
    .setAudience('ct-wallet-v2').setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(new TextEncoder().encode(testSecret));
  assert.equal((await request('/api/auth/me', { headers: { cookie: `ct_session=${expired}` } })).status, 401);
  const oldToken = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(address)
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(testSecret));
  assert.equal((await request('/api/auth/me', { headers: { cookie: `ct_session=${oldToken}` } })).status, 401);
  const missingExpiry = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(address)
    .setAudience('ct-wallet-v2').setIssuedAt().sign(new TextEncoder().encode(testSecret));
  assert.equal((await request('/api/auth/me', { headers: { cookie: `ct_session=${missingExpiry}` } })).status, 401);
  assert.equal((await request('/api/auth/me', { headers: { cookie: `${adminCookie}tampered` } })).status, 401);

  const worker = await post('/api/admin/users', { stake: alternate, name: 'Test worker', role: 'worker' }, adminCookie);
  assert.equal(worker.status, 200);
  try {
    const workerLogin = await login(alternate, alternateBytes);
    assert.equal(workerLogin.status, 200);
    const workerCookie = workerLogin.headers.get('set-cookie').split(';')[0];
    assert.ok([403, 404].includes((await request('/api/admin/users', { headers: { cookie: workerCookie } })).status));
    assert.ok([403, 404].includes((await post('/api/admin/users', { stake: alternate, name: 'Escalated', role: 'admin' }, workerCookie)).status));
    assert.equal((await post('/api/admin/users', { stake: alternate, name: 'Test office', role: 'office' }, adminCookie)).status, 200);
    assert.equal((await request('/api/admin/users', { headers: { cookie: workerCookie } })).status, 200);
    assert.ok([403, 404].includes((await post('/api/admin/users', { stake: alternate, name: 'Escalated', role: 'admin' }, workerCookie)).status));
    assert.equal((await post('/api/admin/users', { stake: alternate, name: 'Test worker', role: 'worker', active: false }, adminCookie)).status, 200);
    assert.equal((await request('/api/auth/me', { headers: { cookie: workerCookie } })).status, 401);
    assert.equal((await login(alternate, alternateBytes)).status, 401);
  } finally {
    assert.equal((await post('/api/admin/users', { stake: alternate }, adminCookie, 'DELETE')).status, 200);
  }
  assert.equal((await post('/api/auth/logout', {}, adminCookie)).status, 200);
});

export { address };