import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/admin/auth';
import { erpEnabled, rpc } from './db';
import type { Access } from './types';

interface AccessValue {
  access: Access | null;
  loading: boolean;
  /** can('invoices.validate') — or several alternatives: can('invoices.view|reports.view'). */
  can: (perm: string) => boolean;
  reload: () => Promise<void>;
}

const AccessContext = createContext<AccessValue | null>(null);

/** Demo mode (no Supabase): only the original website administration is available. */
const DEMO_ACCESS: Access = {
  user_id: 'demo', email: 'admin@demo.local', full_name: 'Démo', role_id: 'super_admin', role_label: 'Mode démo', is_active: true,
  permissions: ['website.manage'],
};

export function AccessProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!erpEnabled) {
      setAccess(DEMO_ACCESS);
      setLoading(false);
      return;
    }
    try {
      setAccess(await rpc<Access | null>('get_my_access'));
    } catch {
      setAccess(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload, session?.email]);

  const can = useCallback((perm: string) => {
    if (!access?.is_active) return false;
    if (access.role_id === 'super_admin' && erpEnabled) return true;
    return perm.split('|').some((p) => access.permissions.includes(p.trim()));
  }, [access]);

  return <AccessContext.Provider value={{ access, loading, can, reload }}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error('useAccess must be used inside AccessProvider');
  return ctx;
}

export function Can({ perm, children, fallback = null }: { perm: string; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useAccess();
  return <>{can(perm) ? children : fallback}</>;
}

/** Page-level guard ('*' = any active staff member). The database enforces the same rules (RLS + checked RPCs). */
export function RequirePerm({ perm, children, erp = true }: { perm: string; children: ReactNode; erp?: boolean }) {
  const { can, loading } = useAccess();
  if (loading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-navy" /></div>;
  if (erp && !erpEnabled) {
    return (
      <Denied title="Base de données non connectée"
        text="Les modules de gestion (clients, devis, factures, stock…) fonctionnent uniquement avec la base Supabase. Ajoutez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY, puis exécutez les migrations SQL." />
    );
  }
  if (perm !== '*' && !can(perm)) return <Denied title="Accès refusé" text="Votre rôle ne donne pas accès à cette page. Contactez un administrateur si nécessaire." />;
  return <>{children}</>;
}

function Denied({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto mt-16 max-w-lg border border-navy/10 bg-white p-10 text-center">
      <ShieldAlert className="mx-auto h-8 w-8 text-brand-red" />
      <h1 className="mt-4 font-display text-xl font-bold text-navy">{title}</h1>
      <p className="mt-2 text-sm text-navy/60">{text}</p>
    </div>
  );
}
