// Shared helpers for the Vercel server functions in /api.
// Secrets (service role key, e-mail API key) only exist here, never in the browser bundle.

export const env = {
  url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  resendKey: process.env.RESEND_API_KEY || '',
  mailFrom: process.env.MAIL_FROM || '',
  mailReplyTo: process.env.MAIL_REPLY_TO || '',
};

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readJson(req, limitBytes = 6 * 1024 * 1024) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw Object.assign(new Error('Requête trop volumineuse.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('JSON invalide.'), { status: 400 });
  }
}

/** Calls a Postgres function through PostgREST with the caller's own JWT (RLS + permission checks apply). */
export async function rpcAsUser(token, fn, args = {}) {
  const r = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw Object.assign(new Error(data?.message || `Erreur ${r.status}`), { status: r.status === 401 ? 401 : 403 });
  return data;
}

/** Resolves the signed-in staff member from the Authorization header, or throws 401/403. */
export async function requireStaff(req) {
  if (!env.url || !env.anonKey) throw Object.assign(new Error('Supabase n’est pas configuré sur le serveur.'), { status: 501 });
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw Object.assign(new Error('Non authentifié.'), { status: 401 });
  const access = await rpcAsUser(token, 'get_my_access');
  if (!access || !access.is_active) throw Object.assign(new Error('Compte inactif ou non autorisé.'), { status: 403 });
  const can = (perm) => access.role_id === 'super_admin' || (access.permissions || []).includes(perm);
  return { token, access, can };
}

/** Service-role call (server only). */
export async function service(path, { method = 'GET', body, headers = {} } = {}) {
  if (!env.serviceKey) throw Object.assign(new Error('SUPABASE_SERVICE_ROLE_KEY manquant sur le serveur.'), { status: 501 });
  const r = await fetch(`${env.url}${path}`, {
    method,
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!r.ok) throw Object.assign(new Error(data?.msg || data?.message || data?.error_description || `Erreur ${r.status}`), { status: r.status >= 500 ? 502 : 400 });
  return data;
}

export function fail(res, e) {
  const status = e && e.status ? e.status : 500;
  send(res, status, { error: status === 500 ? 'Erreur serveur.' : e.message });
}

export const isEmail = (v) => typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v.trim()) && v.length <= 200;

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
