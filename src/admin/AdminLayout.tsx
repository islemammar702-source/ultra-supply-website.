import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Activity, BarChart3, Boxes, Building2, ClipboardList, ExternalLink, FileCheck2, FileText, FolderArchive, FolderTree, Handshake, Inbox,
  KeyRound, Languages, LayoutDashboard, LogOut, Mail, Menu, Package, Receipt, Settings, ShoppingCart, Tag, Truck, UserCog, Users, Wallet, X,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useAuth } from './auth';
import { Toaster } from './ui';
import { api } from '@/lib/api';
import { AccessProvider, useAccess } from '@/erp/lib/access';
import { erpEnabled, logEvent } from '@/erp/lib/db';

interface NavItem { to: string; label: string; Icon: typeof Package; perm?: string; end?: boolean }
interface NavGroup { title: string; items: NavItem[] }

const ERP_NAV: NavGroup[] = [
  { title: 'Pilotage', items: [{ to: '/admin', label: 'Tableau de bord', Icon: LayoutDashboard, end: true }] },
  {
    title: 'Ventes',
    items: [
      { to: '/admin/requests', label: 'Demandes du site', Icon: Inbox },
      { to: '/admin/customers', label: 'Clients', Icon: Users, perm: 'customers.view' },
      { to: '/admin/quotations', label: 'Devis', Icon: FileText, perm: 'quotations.view' },
      { to: '/admin/orders', label: 'Commandes', Icon: ClipboardList, perm: 'orders.view' },
      { to: '/admin/invoices', label: 'Factures & avoirs', Icon: Receipt, perm: 'invoices.view' },
      { to: '/admin/payments', label: 'Paiements', Icon: Wallet, perm: 'payments.view' },
      { to: '/admin/deliveries', label: 'Livraisons', Icon: Truck, perm: 'deliveries.view' },
    ],
  },
  {
    title: 'Achats & stock',
    items: [
      { to: '/admin/suppliers', label: 'Fournisseurs', Icon: Building2, perm: 'suppliers.view' },
      { to: '/admin/purchases', label: 'Commandes fournisseurs', Icon: ShoppingCart, perm: 'purchases.view' },
      { to: '/admin/supplier-invoices', label: 'Factures fournisseurs', Icon: FileCheck2, perm: 'purchases.view' },
      { to: '/admin/inventory', label: 'Stock', Icon: Boxes, perm: 'inventory.view' },
    ],
  },
  {
    title: 'Catalogue & site',
    items: [
      { to: '/admin/products', label: 'Produits', Icon: Package, perm: 'products.view|website.manage' },
      { to: '/admin/categories', label: 'Catégories', Icon: FolderTree, perm: 'products.edit|website.manage' },
      { to: '/admin/brands', label: 'Marques', Icon: Tag, perm: 'products.view' },
      { to: '/admin/partners', label: 'Partenaires (site)', Icon: Handshake, perm: 'website.manage' },
      { to: '/admin/content', label: 'Contenu & traductions', Icon: Languages, perm: 'website.manage' },
    ],
  },
  {
    title: 'Analyse',
    items: [
      { to: '/admin/reports', label: 'Rapports', Icon: BarChart3, perm: 'reports.view' },
      { to: '/admin/documents', label: 'Documents', Icon: FolderArchive, perm: 'documents.view' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/admin/users', label: 'Utilisateurs', Icon: UserCog, perm: 'users.view' },
      { to: '/admin/roles', label: 'Rôles & droits', Icon: KeyRound, perm: 'users.view' },
      { to: '/admin/logs', label: 'Journal d’activité', Icon: Activity, perm: 'logs.view' },
      { to: '/admin/settings', label: 'Paramètres', Icon: Settings, perm: 'settings.view' },
    ],
  },
];

/** Original website administration (demo mode, no database). */
const DEMO_NAV: NavGroup[] = [{
  title: 'Site',
  items: [
    { to: '/admin', label: 'Tableau de bord', Icon: LayoutDashboard, end: true },
    { to: '/admin/products', label: 'Produits', Icon: Package },
    { to: '/admin/categories', label: 'Catégories', Icon: FolderTree },
    { to: '/admin/partners', label: 'Marques & partenaires', Icon: Handshake },
    { to: '/admin/quotes', label: 'Demandes de devis', Icon: FileText },
    { to: '/admin/messages', label: 'Messages', Icon: Mail },
    { to: '/admin/content', label: 'Contenu & traductions', Icon: Languages },
  ],
}];

export default function AdminLayout() {
  return (
    <AccessProvider>
      <Shell />
    </AccessProvider>
  );
}

function Shell() {
  const { session, signOut } = useAuth();
  const { access, can } = useAccess();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  const groups = (erpEnabled ? ERP_NAV : DEMO_NAV)
    .map((g) => ({ ...g, items: g.items.filter((i) => !erpEnabled || !i.perm || can(i.perm)) }))
    .filter((g) => g.items.length);

  const logout = async () => {
    if (erpEnabled) await logEvent('auth.logout', 'users', access?.user_id ?? null, access?.email ?? '');
    await signOut();
  };

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto p-4" aria-label="Administration">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">{g.title}</p>
          {g.items.map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 text-[13.5px] font-medium transition-colors ${isActive ? 'bg-white/10 text-white shadow-[inset_3px_0_0_#D92332]' : 'text-white/65 hover:bg-white/5 hover:text-white'}`}>
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.6} /> {label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div dir="ltr" lang="fr" className="min-h-screen bg-mist font-sans text-navy-950">
      <Helmet>
        <html lang="fr" dir="ltr" />
        <title>Gestion | ULTRA SUPPLY</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-navy-950 text-white transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-20 shrink-0 items-center justify-between border-b border-white/10 px-6">
          <Link to="/admin"><Logo variant="light" className="!h-10" /></Link>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Fermer le menu"><X className="h-5 w-5" /></button>
        </div>
        {nav}
        <div className="shrink-0 border-t border-white/10 p-4 text-sm">
          {api.mode === 'demo' && <p className="mb-3 bg-brand-red/20 px-3 py-2 text-[12px] text-white/80">Mode démo : données stockées dans ce navigateur. Configurez Supabase pour activer la gestion commerciale.</p>}
          <p className="truncate px-2 font-medium text-white/80">{access?.full_name || session?.email}</p>
          <p className="truncate px-2 text-[12px] text-white/45">{access?.role_label}{access?.full_name ? ` · ${session?.email}` : ''}</p>
          <div className="mt-3 flex gap-2">
            <Link to="/" target="_blank" className="flex flex-1 items-center justify-center gap-2 border border-white/15 py-2.5 text-white/70 hover:text-white"><ExternalLink className="h-4 w-4" /> Site</Link>
            {erpEnabled && <Link to="/admin/account" className="flex flex-1 items-center justify-center gap-2 border border-white/15 py-2.5 text-white/70 hover:text-white" title="Mon compte"><KeyRound className="h-4 w-4" /> Compte</Link>}
            <button onClick={() => void logout()} className="flex flex-1 items-center justify-center gap-2 border border-white/15 py-2.5 text-white/70 hover:border-brand-red hover:text-white"><LogOut className="h-4 w-4" /> Sortir</button>
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-navy-950/50 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-navy/10 bg-white px-4 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Ouvrir le menu" className="flex h-10 w-10 items-center justify-center"><Menu className="h-5 w-5" /></button>
          <Logo className="!h-9" />
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-8 sm:py-10">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
