import { json, users, requireRole, isWalletAddress, envAdmins, ROLES } from '../lib/auth.mjs';

export const config = { path: ['/api/admin/users'] };

export default async (req) => {
  const user = await requireRole(req, req.method === 'GET' ? ['admin', 'office'] : ['admin']);
  if (user instanceof Response) return user;
  const store = users();

  if (req.method === 'GET') {
    const { blobs } = await store.list();
    const list = (await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })))).filter(Boolean);
    for (const stake of envAdmins()) if (!list.some((u) => u.stake === stake)) list.push({ stake, name: 'Admin (env)', role: 'admin', active: true, fromEnv: true });
    return json(list.sort((a, b) => a.name.localeCompare(b.name)));
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid body' }, 400); }
  const stake = String(body.stake || '').trim();
  if (!isWalletAddress(stake)) return json({ error: 'invalid wallet address' }, 400);

  if (req.method === 'DELETE') {
    if (stake === user.stake) return json({ error: 'cannot remove yourself' }, 400);
    await store.delete(stake);
    return json({ ok: true });
  }

  if (req.method === 'POST') {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name || !ROLES.includes(body.role)) return json({ error: 'name and valid role required' }, 400);
    const active = body.active !== false;
    if (stake === user.stake && (body.role !== 'admin' || !active)) return json({ error: 'cannot demote yourself' }, 400);
    const record = { stake, name, role: body.role, active, updated: new Date().toISOString() };
    await store.setJSON(stake, record);
    return json(record);
  }

  return json({ error: 'method not allowed' }, 405);
};
