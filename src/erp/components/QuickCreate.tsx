import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Package, Plus, Receipt, ShoppingCart, Truck, UserPlus, Wallet, type LucideIcon } from 'lucide-react';
import { useAccess } from '../lib/access';
import { erpEnabled } from '../lib/db';

export interface QuickAction { label: string; to: string; perm: string; Icon: LucideIcon }

/** Everyday "create" shortcuts, filtered by the user's permissions. */
export const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Devis', to: '/admin/quotations/new', perm: 'quotations.create', Icon: FileText },
  { label: 'Facture', to: '/admin/invoices/new', perm: 'invoices.create', Icon: Receipt },
  { label: 'Encaissement', to: '/admin/payments?new=1', perm: 'payments.create', Icon: Wallet },
  { label: 'Client', to: '/admin/customers?new=1', perm: 'customers.create', Icon: UserPlus },
  { label: 'Produit', to: '/admin/products?new=1', perm: 'products.create', Icon: Package },
  { label: 'Commande fournisseur', to: '/admin/purchases/new', perm: 'purchases.create', Icon: ShoppingCart },
  { label: 'Bon de livraison', to: '/admin/deliveries/new', perm: 'deliveries.create', Icon: Truck },
];

export function useQuickActions(limit?: number) {
  const { can } = useAccess();
  const list = erpEnabled ? QUICK_ACTIONS.filter((a) => can(a.perm)) : [];
  return limit ? list.slice(0, limit) : list;
}

/** "+ Nouveau" button with a small menu. */
export function QuickCreate({ compact = false }: { compact?: boolean }) {
  const actions = useQuickActions();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!actions.length) return null;
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={`btn btn-red ${compact ? '!min-h-[40px] !px-3' : '!min-h-[42px] !px-4'}`}>
        <Plus className="h-4 w-4" /> {!compact && 'Nouveau'}
        {compact && <span className="sr-only">Nouveau</span>}
      </button>
      {open && (
        <div role="menu" className="absolute end-0 z-50 mt-2 w-64 border border-navy/10 bg-white py-1.5 shadow-[0_20px_50px_-20px_rgba(10,36,69,0.45)]">
          {actions.map(({ label, to, Icon }) => (
            <button key={to} role="menuitem" type="button" onClick={() => { setOpen(false); navigate(to); }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-start text-[14px] text-navy hover:bg-mist">
              <Icon className="h-4 w-4 text-brand-red" strokeWidth={1.75} /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
