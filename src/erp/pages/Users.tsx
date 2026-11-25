import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2, Pencil, Power, Save, UserPlus } from 'lucide-react';
import { Modal, PageHeader, toast } from '@/admin/ui';
import { accessToken, errMsg, rpc, sb, unwrap } from '../lib/db';
import { invalidate, useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { fmtDateTime } from '../lib/format';
import { ACTION_PERM_LABEL, MODULE_LABEL } from '../lib/status';
import type { Permission, Role, StaffUser } from '../lib/types';
import { ConfirmModal, DataTable, ErrorBox, Field, LoadingBlock, Pill, SearchBar, SelectInput, TextInput } from '../components/ui';

async function adminUsers(body: Record<string, unknown>) {
  const res = await fetch('/api/admin-users', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken()}` }, body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) throw new Error('Serveur injoignable.');
  const out = await res.json().catch(() => ({})) as { error?: string; id?: string };
  if (res.status === 404) throw new Error('La fonction serveur /api/admin-users n’est pas déployée (Vercel).');
  if (!res.ok) throw new Error(out.error || `Erreur ${res.status}`);
  return out;
}

const strong = (p: string) => p.length >= 10 && /[a-z]/i.test(p) && /\d/.test(p);

export default function UsersPage() {
  const { can, access } = useAccess();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [pwd, setPwd] = useState<StaffUser | null>(null);
  const [toggle, setToggle] = useState<StaffUser | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const [users, roles] = await Promise.all([
      sb().from('users').select('id,email,full_name,phone,role_id,is_active,last_login_at,created_at').order('full_name').then(unwrap) as Promise<StaffUser[]>,
      sb().from('roles').select('*').order('sort_order').then(unwrap) as Promise<Role[]>,
    ]);
    return { users, roles };
  }, []);
  const roleLabel = (id: string) => data?.roles.find((r) => r.id === id)?.label ?? id;
  const rows = useMemo(() => (data?.users ?? []).filter((u) => !q || [u.full_name, u.email, roleLabel(u.role_id)].join(' ').toLowerCase().includes(q.toLowerCase())), [data, q]);
  const manage = can('users.manage');
  const isSuper = access?.role_id === 'super_admin';
  const done = async () => { invalidate('staff'); await reload(); };

  return (
    <>
      <PageHeader title="Utilisateurs" subtitle="Comptes du personnel, rôles et activation. Les mots de passe ne sont jamais visibles."
        actions={manage && <button className="btn btn-red !min-h-[42px]" onClick={() => setCreating(true)}><UserPlus className="h-4 w-4" /> Nouvel utilisateur</button>} />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="border-b border-navy/10 p-4"><SearchBar value={q} onChange={setQ} placeholder="Nom, e-mail, rôle…" /></div>
        <DataTable loading={loading} rows={rows} columns={[
          { key: 'n', header: 'Utilisateur', render: (u) => <div><p className="font-semibold text-navy">{u.full_name || '—'}{u.id === access?.user_id && <span className="ml-2 text-xs font-normal text-navy/50">(vous)</span>}</p><p className="text-xs text-navy/50">{u.email}</p></div> },
          { key: 'r', header: 'Rôle', render: (u) => <Pill tone={u.role_id === 'super_admin' ? 'red' : u.role_id === 'administrator' ? 'navy' : 'gray'}>{roleLabel(u.role_id)}</Pill> },
          { key: 'a', header: 'Statut', render: (u) => u.is_active ? <Pill tone="green">Actif</Pill> : <Pill tone="gray">Inactif</Pill> },
          { key: 'l', header: 'Dernière connexion', render: (u) => <span className="text-navy/60">{fmtDateTime(u.last_login_at)}</span> },
          { key: 'x', header: '', align: 'right', render: (u) => manage && u.id !== access?.user_id && (u.role_id !== 'super_admin' || isSuper) && (
            <div className="flex justify-end">
              <button className="p-2 text-navy/50 hover:text-navy" title="Modifier" onClick={() => setEditing(u)}><Pencil className="h-4 w-4" /></button>
              <button className="p-2 text-navy/50 hover:text-navy" title="Nouveau mot de passe" onClick={() => setPwd(u)}><KeyRound className="h-4 w-4" /></button>
              <button className={`p-2 ${u.is_active ? 'text-navy/50 hover:text-brand-red' : 'text-emerald-600'}`} title={u.is_active ? 'Désactiver' : 'Activer'} onClick={() => setToggle(u)}><Power className="h-4 w-4" /></button>
            </div>
          ) },
        ]} />
      </div>
      {creating && data && <CreateUser roles={data.roles.filter((r) => r.id !== 'super_admin' || isSuper)} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void done(); }} />}
      {editing && data && <EditUser user={editing} roles={data.roles.filter((r) => r.id !== 'super_admin' || isSuper)} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void done(); }} />}
      {pwd && <PasswordModal user={pwd} onClose={() => setPwd(null)} />}
      <ConfirmModal open={Boolean(toggle)} danger={toggle?.is_active} title={toggle?.is_active ? 'Désactiver le compte' : 'Activer le compte'} confirmLabel={toggle?.is_active ? 'Désactiver' : 'Activer'}
        onClose={() => setToggle(null)}
        message={toggle?.is_active ? <>{toggle.email} ne pourra plus se connecter. L’historique de ses actions est conservé.</> : <>{toggle?.email} pourra de nouveau se connecter avec son rôle actuel.</>}
        onConfirm={async () => { await adminUsers({ action: 'set_active', user_id: toggle!.id, active: !toggle!.is_active }); toast('Compte mis à jour'); await done(); }} />
    </>
  );
}

function CreateUser({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ email: '', full_name: '', role_id: 'employee', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return setError('E-mail invalide.');
    if (!f.full_name.trim()) return setError('Le nom est obligatoire.');
    if (!strong(f.password)) return setError('Mot de passe : 10 caractères minimum, avec des lettres et des chiffres.');
    setBusy(true); setError(null);
    try { await adminUsers({ action: 'create', ...f }); toast('Utilisateur créé'); onDone(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Nouvel utilisateur" onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[42px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={submit}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Créer le compte</button>
      </>}>
      <div className="space-y-4">
        <Field label="Nom complet" required><TextInput value={f.full_name} onChange={(v) => setF({ ...f, full_name: v })} /></Field>
        <Field label="E-mail (identifiant)" required><TextInput type="email" value={f.email} onChange={(v) => setF({ ...f, email: v })} autoComplete="off" /></Field>
        <Field label="Rôle">
          <SelectInput value={f.role_id} onChange={(v) => setF({ ...f, role_id: v })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</SelectInput>
        </Field>
        <p className="text-xs text-navy/55">{roles.find((r) => r.id === f.role_id)?.description}</p>
        <Field label="Mot de passe provisoire" required hint="10 caractères minimum, lettres et chiffres. Communiquez-le de façon sûre ; l’utilisateur pourra le changer depuis « Compte ».">
          <TextInput type="text" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" />
        </Field>
      </div>
    </Modal>
  );
}

function EditUser({ user, roles, onClose, onDone }: { user: StaffUser; roles: Role[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ full_name: user.full_name, phone: user.phone ?? '', role_id: user.role_id });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { unwrap(await sb().from('users').update({ full_name: f.full_name.trim(), phone: f.phone.trim() || null, role_id: f.role_id }).eq('id', user.id)); toast('Utilisateur mis à jour'); onDone(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open title={`Modifier — ${user.email}`} onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[42px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={submit}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer</button>
      </>}>
      <div className="space-y-4">
        <Field label="Nom complet"><TextInput value={f.full_name} onChange={(v) => setF({ ...f, full_name: v })} /></Field>
        <Field label="Téléphone"><TextInput value={f.phone} onChange={(v) => setF({ ...f, phone: v })} /></Field>
        <Field label="Rôle"><SelectInput value={f.role_id} onChange={(v) => setF({ ...f, role_id: v })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</SelectInput></Field>
      </div>
    </Modal>
  );
}

function PasswordModal({ user, onClose }: { user: StaffUser; onClose: () => void }) {
  const [p, setP] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open title={`Nouveau mot de passe — ${user.email}`} onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[42px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={async () => {
          if (!strong(p)) return setError('10 caractères minimum, avec des lettres et des chiffres.');
          setBusy(true); setError(null);
          try { await adminUsers({ action: 'set_password', user_id: user.id, password: p }); toast('Mot de passe modifié'); onClose(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
        }}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Définir</button>
      </>}>
      <Field label="Mot de passe provisoire" hint="Communiquez-le de façon sûre à l’utilisateur."><TextInput value={p} onChange={setP} autoComplete="new-password" /></Field>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Roles & permission matrix (editable by super administrators)
// ---------------------------------------------------------------------------
export function RolesPage() {
  const { access } = useAccess();
  const isSuper = access?.role_id === 'super_admin';
  const [role, setRole] = useState('administrator');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useAsync(async () => {
    const [roles, permissions, links] = await Promise.all([
      sb().from('roles').select('*').order('sort_order').then(unwrap) as Promise<Role[]>,
      sb().from('permissions').select('*').order('module').then(unwrap) as Promise<Permission[]>,
      sb().from('role_permissions').select('role_id,permission_id').then(unwrap) as Promise<{ role_id: string; permission_id: string }[]>,
    ]);
    return { roles, permissions, links };
  }, []);

  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.links.filter((l) => l.role_id === role).map((l) => l.permission_id));
    setSelected(new Set(data.permissions.filter((p) => ids.has(p.id)).map((p) => `${p.module}.${p.action}`)));
  }, [data, role]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <LoadingBlock />;
  const modules = Array.from(new Set(data.permissions.map((p) => p.module)));
  const r = data.roles.find((x) => x.id === role);
  const editable = isSuper && role !== 'super_admin';
  const toggle = (key: string) => { const s = new Set(selected); if (s.has(key)) s.delete(key); else s.add(key); setSelected(s); };

  return (
    <>
      <PageHeader title="Rôles & droits" subtitle="Droits par module et par action. Appliqués côté serveur (sécurité au niveau des lignes de la base)." />
      <div className="mb-4 flex flex-wrap gap-1">
        {data.roles.map((x) => <button key={x.id} onClick={() => setRole(x.id)} className={`min-h-[42px] px-4 text-xs font-semibold ${role === x.id ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-navy-100'}`}>{x.label}</button>)}
      </div>
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy/10 px-5 py-4">
          <div><p className="font-semibold text-navy">{r?.label}</p><p className="text-sm text-navy/60">{r?.description}</p></div>
          {editable && <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await rpc('set_role_permissions', { p_role_id: role, p_permissions: Array.from(selected) }); toast('Droits enregistrés'); await reload(); } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(false); }
          }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer</button>}
        </div>
        {role === 'super_admin' && <p className="border-b border-navy/10 bg-mist px-5 py-3 text-sm text-navy/70">Le super administrateur dispose de tous les droits, y compris la gestion des rôles.</p>}
        {!isSuper && <p className="border-b border-navy/10 bg-mist px-5 py-3 text-sm text-navy/70">Lecture seule : seul un super administrateur peut modifier les droits.</p>}
        <div className="divide-y divide-navy/10">
          {modules.map((m) => (
            <div key={m} className="grid gap-2 px-5 py-3 md:grid-cols-4">
              <p className="font-semibold text-navy">{MODULE_LABEL[m] ?? m}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2 md:col-span-3">
                {data.permissions.filter((p) => p.module === m).map((p) => {
                  const key = `${p.module}.${p.action}`;
                  const on = role === 'super_admin' || selected.has(key);
                  return (
                    <label key={key} className={`flex items-center gap-2 text-sm ${editable ? 'cursor-pointer' : ''}`} title={p.label}>
                      <input type="checkbox" className="h-4 w-4 accent-navy" checked={on} disabled={!editable} onChange={() => toggle(key)} />
                      {ACTION_PERM_LABEL[p.action] ?? p.action}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
