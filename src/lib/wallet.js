import { bech32 } from '@scure/base';

// CIP-30 sign-in: the wallet signs a server challenge with the key behind its stake or payment address.
const toHex = (s) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');

function bech32Form(hex) {
  const bytes = Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
  const prefix = (bytes[0] >> 4) === 0xe ? 'stake' : 'addr';
  return bech32.encode(prefix, bech32.toWords(bytes), 250);
}

export function wallets() {
  return Object.entries(window.cardano || {})
    .filter(([, w]) => w && typeof w.enable === 'function' && w.name)
    .map(([id, w]) => ({ id, name: w.name, icon: w.icon }));
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `request failed (${res.status})`), { stake: data.stake });
  return data;
}

export async function login(walletId) {
  const api = await window.cardano[walletId].enable();

  // Reward addresses are preferred; Brave lacks them and only signs with its payment address.
  const candidates = [];
  for (const get of ['getRewardAddresses', 'getUsedAddresses', 'getUnusedAddresses', 'getChangeAddress']) {
    try {
      const got = await api[get]();
      candidates.push(...[].concat(got || []));
    } catch { /* method not supported by this wallet */ }
  }
  if (!candidates.length) throw new Error('wallet exposes no addresses');

  let failure;
  for (const address of new Set(candidates)) {
    let nonce, payload, bech32Address;
    try {
      bech32Address = bech32Form(address);
      const challenge = await post('/api/auth/challenge', { address: bech32Address });
      nonce = challenge.nonce;
      payload = toHex(challenge.message);
    } catch (e) {
      failure = e;
      continue;
    }
    // Some wallets only accept the bech32 form of the address.
    for (const form of [address, bech32Address]) {
      try {
        const { signature, key } = await api.signData(form, payload);
        return post('/api/auth/verify', { nonce, signature, key });
      } catch (e) {
        failure = e;
        if (e?.code === 3) throw e;
      }
    }
  }
  throw failure;
}

export const logout = () => post('/api/auth/logout');

export async function me() {
  const res = await fetch('/api/auth/me');
  return res.ok ? res.json() : null;
}
