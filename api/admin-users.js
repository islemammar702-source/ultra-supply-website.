// POST /api/admin-users — staff account management that requires the Supabase service role:
//   { action: 'create', email, full_name, role_id, password }
//   { action: 'set_password', user_id, password }
//   { action: 'set_active', user_id, active }
// Only callers holding users.manage may use it; only super administrators may touch super administrators.
import { fail, isEmail, readJson, requireStaff, send, service } from '../server/supabase.js';

const ROLES = ['super_admin', 'administrator', 'commercial', 'accountant', 'stock_manager', 'employee'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const strongEnough = (p) => typeof p === 'string' && p.length >= 10 && p.length <= 72 && /[a-z]/i.test(p) && /\d/.test(p);

async function staffRow(id) {
  const rows = await service(`/rest/v1/users?id=eq.${id}&select=id,email,role_id,is_active`);
  return rows && rows[0];
}

async function log(action, id, label, details) {
  await service('/rest/v1/activity_logs', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: { user_id: details.by_id, user_email: details.by, action, entity_type: 'users', entity_id: id, entity_label: label, details },
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée.' });
  try {
    const { access, can } = await requireStaff(req);
    if (!can('users.manage')) return send(res, 403, { error: 'Permission refusée (users.manage).' });
    const isSuper = access.role_id === 'super_admin';
    const body = await readJson(req, 64 * 1024);
    const by = { by: access.email, by_id: access.user_id };

    if (body.action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const fullName = String(body.full_name || '').trim().slice(0, 120);
      const role = String(body.role_id || '');
      if (!isEmail(email)) return send(res, 400, { error: 'E-mail invalide.' });
      if (!ROLES.includes(role)) return send(res, 400, { error: 'Rôle invalide.' });
      if (role === 'super_admin' && !isSuper) return send(res, 403, { error: 'Seul un super administrateur peut créer un super administrateur.' });
      if (!strongEnough(body.password)) return send(res, 400, { error: 'Mot de passe : 10 caractères minimum, avec des lettres et des chiffres.' });

      const user = await service('/auth/v1/admin/users', {
        method: 'POST',
        body: { email, password: body.password, email_confirm: true, user_metadata: { full_name: fullName } },
      });
      const id = user?.id || user?.user?.id;
      if (!id) return send(res, 502, { error: 'Création du compte impossible.' });
      // The on_auth_user_created trigger inserted an inactive profile: activate it with the chosen role.
      await service(`/rest/v1/users?id=eq.${id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: { full_name: fullName, role_id: role, is_active: true, created_by: access.user_id },
      });
      await log('user.created', id, email, { ...by, role });
      return send(res, 200, { ok: true, id });
    }

    const id = String(body.user_id || '');
    if (!UUID.test(id)) return send(res, 400, { error: 'Utilisateur invalide.' });
    const target = await staffRow(id);
    if (!target) return send(res, 404, { error: 'Utilisateur introuvable.' });
    if (target.role_id === 'super_admin' && !isSuper) return send(res, 403, { error: 'Réservé aux super administrateurs.' });

    if (body.action === 'set_password') {
      if (!strongEnough(body.password)) return send(res, 400, { error: 'Mot de passe : 10 caractères minimum, avec des lettres et des chiffres.' });
      await service(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: { password: body.password } });
      await log('user.password_reset', id, target.email, by);
      return send(res, 200, { ok: true });
    }

    if (body.action === 'set_active') {
      const active = Boolean(body.active);
      if (id === access.user_id) return send(res, 400, { error: 'Vous ne pouvez pas désactiver votre propre compte.' });
      if (!active && target.role_id === 'super_admin') {
        const supers = await service('/rest/v1/users?role_id=eq.super_admin&is_active=is.true&select=id');
        if ((supers || []).length <= 1) return send(res, 400, { error: 'Il doit rester au moins un super administrateur actif.' });
      }
      await service(`/rest/v1/users?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { is_active: active } });
      // Block (or unblock) sign-in at the authentication level too.
      await service(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: { ban_duration: active ? 'none' : '876000h' } });
      await log(active ? 'user.activated' : 'user.deactivated', id, target.email, by);
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: 'Action inconnue.' });
  } catch (e) {
    return fail(res, e);
  }
}
