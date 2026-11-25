import { supabase } from '@/lib/supabase';

/** The ERP only works against the real Supabase database (no demo/simulated data). */
export const erpEnabled = Boolean(supabase);

export function sb() {
  if (!supabase) throw new Error('Supabase n’est pas configuré : les modules de gestion sont indisponibles.');
  return supabase;
}

interface PgError { message: string; code?: string; details?: string | null; hint?: string | null }

/** Turns PostgREST / Postgres errors into messages a user can act on. */
export function friendlyError(e: PgError): string {
  const msg = e.message || 'Erreur inattendue';
  if (/row-level security|permission denied/i.test(msg) || (e.code === '42501' && !/^Permission refusée/.test(msg))) {
    return 'Action non autorisée pour votre rôle.';
  }
  if (e.code === '23505') {
    if (/reference/i.test(msg + (e.details ?? ''))) return 'Cette référence existe déjà.';
    if (/tax_id/i.test(msg + (e.details ?? ''))) return 'Ce matricule fiscal est déjà utilisé par un autre client.';
    if (/supplier_reference/i.test(msg)) return 'Cette facture fournisseur est déjà enregistrée.';
    if (/email/i.test(msg)) return 'Cette adresse e-mail est déjà utilisée.';
    return 'Doublon : cette valeur existe déjà.';
  }
  if (e.code === '23503') return 'Élément utilisé par d’autres enregistrements : action impossible (archivez-le plutôt).';
  if (e.code === '23514') return `Valeur invalide (${(msg.match(/constraint "([^"]+)"/) ?? [])[1] ?? 'contrôle'}).`;
  if (e.code === '23502') return 'Un champ obligatoire est manquant.';
  if (e.code === 'PGRST116') return 'Élément introuvable.';
  return msg;
}

export function unwrap<T>(res: { data: T; error: PgError | null }): T {
  if (res.error) throw new Error(friendlyError(res.error));
  return res.data;
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const res = await sb().rpc(fn, args ?? {});
  return unwrap(res as { data: T; error: PgError | null });
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Erreur inattendue');

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));

/** Access token of the signed-in user, for calls to our own server functions (/api/*). */
export async function accessToken(): Promise<string> {
  const { data } = await sb().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Session expirée : reconnectez-vous.');
  return token;
}

export async function logEvent(action: string, entityType = '', entityId: string | null = null, label = '', details: Record<string, unknown> = {}) {
  try {
    await sb().rpc('log_event', { p_action: action, p_entity_type: entityType, p_entity_id: entityId, p_label: label, p_details: details });
  } catch {
    /* logging must never block the user */
  }
}
