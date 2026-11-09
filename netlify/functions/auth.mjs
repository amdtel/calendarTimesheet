import { json, createChallenge, verifySignature, getUser, issueSession, clearSession, requireRole, ROLES } from '../lib/auth.mjs';

export const config = { path: ['/api/auth/challenge', '/api/auth/verify', '/api/auth/logout', '/api/auth/me'] };

export default async (req) => {
  const url = new URL(req.url);
  const action = url.pathname.split('/').pop();

  if (action === 'challenge' && req.method === 'POST') {
    return json(await createChallenge(url.origin));
  }

  if (action === 'verify' && req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'invalid body' }, 400); }
    let stake;
    try {
      stake = await verifySignature({ signature: body.signature, key: body.key, nonce: String(body.nonce), origin: url.origin, address: body.address });
    } catch {
      return json({ error: 'signature rejected' }, 401);
    }
    const user = await getUser(stake);
    if (!user) return json({ error: 'This wallet is not registered', stake }, 401);
    return json({ stake, name: user.name, role: user.role }, 200, { 'set-cookie': await issueSession(stake) });
  }

  if (action === 'logout' && req.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': clearSession() });
  }

  if (action === 'me' && req.method === 'GET') {
    const user = await requireRole(req, ROLES);
    return user instanceof Response ? user : json({ stake: user.stake, name: user.name, role: user.role });
  }

  return json({ error: 'not found' }, 404);
};
