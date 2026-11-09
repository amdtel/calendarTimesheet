import { json, createChallenge, verifySignature, getUser, issueSession, clearSession, requireRole, ROLES, AuthDatabaseError } from '../lib/auth.mjs';

export const config = { path: ['/api/auth/challenge', '/api/auth/verify', '/api/auth/logout', '/api/auth/me'] };

export default async (req) => {
  const url = new URL(req.url);
  const action = url.pathname.split('/').pop();

  if (req.method === 'POST' && !/^application\/json(?:\s*;|\s*$)/i.test(req.headers.get('content-type') || '')) {
    return json({ error: 'json required' }, 415);
  }

  if (action === 'challenge' && req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'invalid body' }, 400); }
    if (!body || typeof body.address !== 'string') return json({ error: 'invalid wallet address' }, 400);
    try { return json(await createChallenge(url.origin, body.address)); } catch (error) {
      if (error.message === 'invalid wallet address') return json({ error: error.message }, 400);
      throw error;
    }
  }

  if (action === 'verify' && req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'invalid body' }, 400); }
    let stake;
    try {
      stake = await verifySignature({ signature: body.signature, key: body.key, nonce: body.nonce, origin: url.origin });
    } catch (error) {
      if (error instanceof AuthDatabaseError) return json({ error: 'Authentication database unavailable. Check server configuration.' }, 503);
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
