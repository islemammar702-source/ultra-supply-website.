import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Pencil, Plus, ShoppingCart } from 'lucide-react';
import { Modal, PageHeader, toast } from '@/admin/ui';
import { errMsg, sb, unwrap } from '../lib/db';
import { useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { fmtDate, money } from '../lib/format';
import { CURRENCIES, PURCHASE_STATUS, SUPPLIER_INVOICE_STATUS } from '../lib/status';
import type { PurchaseOrder, Supplier, SupplierInvoice } from '../lib/types';
import { Check, DataTable, ErrorBox, Field, FilterChips, KeyValues, LoadingBlock, NumberInput, Pill, SearchBar, SelectInput, StatCard, StatusBadge, Tabs, TextArea, TextInput } from '../components/ui';
import { DocumentsPanel } from '../components/DocumentsPanel';

const emptySupplier = (): Partial<Supplier> => ({
  name: '', contact_name: '', tax_id: '', email: '', phone: '', website: '', address: '', city: '', country: '', currency: 'EUR',
  payment_terms_days: 30, bank_details: '', notes: '', is_active: true,
});

export default function SuppliersPage() {
  const { can } = useAccess();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'' | 'active' | 'inactive'>('active');
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const { data, error, loading, reload } = useAsync(async () => unwrap(await sb().from('suppliers').select('*').order('name')) as Supplier[], []);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((s) => (filter === '' || (filter === 'active') === s.is_active)
      && (!n || [s.code, s.name, s.contact_name, s.email, s.phone, s.country, s.city].join(' ').toLowerCase().includes(n)));
  }, [data, q, filter]);

  return (
    <>
      <PageHeader title="Fournisseurs" subtitle={`${(data ?? []).filter((s) => s.is_active).length} fournisseur(s) actif(s)`}
        actions={can('suppliers.create') && <button className="btn btn-red !min-h-[42px]" onClick={() => setEditing(emptySupplier())}><Plus className="h-4 w-4" /> Nouveau fournisseur</button>} />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4 lg:flex-row">
          <SearchBar value={q} onChange={setQ} placeholder="Nom, code, pays, contact…" />
          <FilterChips value={filter} onChange={setFilter} options={[{ value: 'active', label: 'Actifs' }, { value: 'inactive', label: 'Archivés' }, { value: '', label: 'Tous' }]} />
        </div>
        <DataTable loading={loading} rows={rows} onRowClick={(s) => navigate(`/admin/suppliers/${s.id}`)} columns={[
          { key: 'code', header: 'Code', render: (s) => <span className="font-mono text-xs text-navy/60">{s.code}</span> },
          { key: 'name', header: 'Fournisseur', render: (s) => <div><p className="font-semibold text-navy">{s.name}</p><p className="text-xs text-navy/50">{s.contact_name}</p></div> },
          { key: 'country', header: 'Pays', render: (s) => [s.city, s.country].filter(Boolean).join(', ') || '—' },
          { key: 'contact', header: 'Coordonnées', render: (s) => <div className="text-xs text-navy/70"><p>{s.phone || '—'}</p><p>{s.email}</p></div> },
          { key: 'cur', header: 'Devise', render: (s) => <Pill tone="navy">{s.currency}</Pill> },
          { key: 'st', header: '', render: (s) => !s.is_active && <Pill tone="gray">Archivé</Pill> },
        ]} />
      </div>
      {editing && <SupplierForm supplier={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); void reload(); navigate(`/admin/suppliers/${id}`); }} />}
    </>
  );
}

function SupplierForm({ supplier, onClose, onSaved }: { supplier: Partial<Supplier>; onClose: () => void; onSaved: (id: string) => void }) {
  const [s, setS] = useState<Partial<Supplier>>(supplier);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !supplier.id;
  const set = <K extends keyof Supplier>(k: K, v: Supplier[K]) => setS((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!s.name?.trim() || s.name.trim().length < 2) return setError('Le nom est obligatoire.');
    if (s.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email.trim())) return setError('E-mail invalide.');
    setBusy(true); setError(null);
    const row = {
      name: s.name.trim(), contact_name: s.contact_name?.trim() ?? '', tax_id: s.tax_id?.trim() ?? '', email: s.email?.trim().toLowerCase() ?? '',
      phone: s.phone?.trim() ?? '', website: s.website?.trim() ?? '', address: s.address?.trim() ?? '', city: s.city?.trim() ?? '', country: s.country?.trim() ?? '',
      currency: s.currency ?? 'EUR', payment_terms_days: Math.round(Number(s.payment_terms_days ?? 30)), bank_details: s.bank_details ?? '', notes: s.notes ?? '',
      is_active: s.is_active !== false,
    };
    try {
      const saved = isNew
        ? unwrap(await sb().from('suppliers').insert(row).select('id').single()) as { id: string }
        : unwrap(await sb().from('suppliers').update(row).eq('id', supplier.id!).select('id').single()) as { id: string };
      toast(isNew ? 'Fournisseur créé' : 'Fournisseur mis à jour');
      onSaved(saved.id);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open wide title={isNew ? 'Nouveau fournisseur' : `Modifier — ${supplier.name}`} onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[42px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer</button>
      </>}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Raison sociale" required><TextInput value={s.name ?? ''} onChange={(v) => set('name', v)} /></Field>
        <Field label="Contact"><TextInput value={s.contact_name ?? ''} onChange={(v) => set('contact_name', v)} /></Field>
        <Field label="N° fiscal / TVA intracom."><TextInput value={s.tax_id ?? ''} onChange={(v) => set('tax_id', v)} /></Field>
        <Field label="E-mail"><TextInput type="email" value={s.email ?? ''} onChange={(v) => set('email', v)} /></Field>
        <Field label="Téléphone"><TextInput value={s.phone ?? ''} onChange={(v) => set('phone', v)} /></Field>
        <Field label="Site web"><TextInput value={s.website ?? ''} onChange={(v) => set('website', v)} /></Field>
        <Field label="Adresse" className="md:col-span-2"><TextInput value={s.address ?? ''} onChange={(v) => set('address', v)} /></Field>
        <Field label="Ville"><TextInput value={s.city ?? ''} onChange={(v) => set('city', v)} /></Field>
        <Field label="Pays"><TextInput value={s.country ?? ''} onChange={(v) => set('country', v)} /></Field>
        <Field label="Devise d’achat">
          <SelectInput value={s.currency ?? 'EUR'} onChange={(v) => set('currency', v)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</SelectInput>
        </Field>
        <Field label="Délai de paiement (jours)"><NumberInput value={s.payment_terms_days ?? 30} onChange={(v) => set('payment_terms_days', Math.max(0, Math.round(v)))} /></Field>
        <Field label="Coordonnées bancaires" className="md:col-span-2"><TextArea value={s.bank_details ?? ''} onChange={(v) => set('bank_details', v)} rows={2} /></Field>
        <Field label="Notes" className="md:col-span-2"><TextArea value={s.notes ?? ''} onChange={(v) => set('notes', v)} /></Field>
        <Check checked={s.is_active !== false} onChange={(v) => set('is_active', v)} label="Fournisseur actif" />
      </div>
    </Modal>
  );
}

type Tab = 'info' | 'orders' | 'invoices' | 'documents';

export function SupplierDetail() {
  const { id = '' } = useParams();
  const { can } = useAccess();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('info');
  const [editing, setEditing] = useState(false);
  const { data, error, loading, reload } = useAsync(async () => {
    const s = unwrap(await sb().from('suppliers').select('*').eq('id', id).single()) as Supplier;
    const [orders, invoices] = can('purchases.view') ? await Promise.all([
      sb().from('purchase_orders').select('*').eq('supplier_id', id).order('order_date', { ascending: false }).then(unwrap) as Promise<PurchaseOrder[]>,
      sb().from('supplier_invoices').select('*').eq('supplier_id', id).order('invoice_date', { ascending: false }).then(unwrap) as Promise<SupplierInvoice[]>,
    ]) : [[] as PurchaseOrder[], [] as SupplierInvoice[]];
    return { s, orders, invoices };
  }, [id]);

  if (loading && !data) return <LoadingBlock />;
  if (error || !data) return <ErrorBox message={error ?? 'Fournisseur introuvable.'} onRetry={reload} />;
  const { s, orders, invoices } = data;
  const payableTnd = invoices.filter((i) => i.status !== 'cancelled').reduce((sum, i) => sum + (Number(i.total_ttc) - Number(i.amount_paid)) * Number(i.exchange_rate), 0);
  const orderedTnd = orders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + Number(o.total_ht) * Number(o.exchange_rate), 0);

  return (
    <>
      <Link to="/admin/suppliers" className="btn-link mb-4 !text-[11px]"><ArrowLeft className="h-3.5 w-3.5" /> Fournisseurs</Link>
      <PageHeader title={s.name} subtitle={`${s.code} · ${[s.city, s.country].filter(Boolean).join(', ')} · Devise ${s.currency}`}
        actions={<>
          {can('purchases.create') && <button className="btn btn-navy !min-h-[42px]" onClick={() => navigate(`/admin/purchases/new?supplier=${s.id}`)}><ShoppingCart className="h-4 w-4" /> Nouvelle commande</button>}
          {can('suppliers.edit') && <button className="btn btn-red !min-h-[42px]" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Modifier</button>}
        </>} />
      {can('purchases.view') && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard accent label="Reste à payer (≈ TND)" value={money(payableTnd)} hint={`${invoices.filter((i) => ['unpaid', 'partially_paid'].includes(i.status)).length} facture(s) ouverte(s)`} />
          <StatCard label="Commandé HT (≈ TND)" value={money(orderedTnd)} hint={`${orders.length} commande(s)`} />
          <StatCard label="En attente de réception" value={orders.filter((o) => ['sent', 'partially_received'].includes(o.status)).length} hint="Commande(s)" />
        </div>
      )}
      <div className="border border-navy/10 bg-white">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'info', label: 'Informations' },
          ...(can('purchases.view') ? [{ value: 'orders' as Tab, label: 'Commandes', count: orders.length }, { value: 'invoices' as Tab, label: 'Factures', count: invoices.length }] : []),
          ...(can('documents.view') ? [{ value: 'documents' as Tab, label: 'Documents' }] : []),
        ]} />
        {tab === 'info' && (
          <div className="grid lg:grid-cols-2">
            <KeyValues items={[['Contact', s.contact_name], ['E-mail', s.email], ['Téléphone', s.phone], ['Site web', s.website], ['Adresse', [s.address, s.city, s.country].filter(Boolean).join(', ')]]} />
            <KeyValues items={[['N° fiscal', s.tax_id], ['Devise', s.currency], ['Délai de paiement', `${s.payment_terms_days} jours`], ['Banque', <span className="whitespace-pre-wrap">{s.bank_details}</span>], ['Notes', <span className="whitespace-pre-wrap">{s.notes}</span>]]} />
          </div>
        )}
        {tab === 'orders' && (
          <DataTable rows={orders} onRowClick={(r) => navigate(`/admin/purchases/${r.id}`)} columns={[
            { key: 'n', header: 'N°', render: (r) => <span className="font-semibold text-navy">{r.number}</span> },
            { key: 'd', header: 'Date', render: (r) => fmtDate(r.order_date) },
            { key: 's', header: 'Statut', render: (r) => <StatusBadge map={PURCHASE_STATUS} value={r.status} /> },
            { key: 't', header: 'Total HT', align: 'right', render: (r) => <span className="tabular-nums">{money(r.total_ht, r.currency)}</span> },
          ]} />
        )}
        {tab === 'invoices' && (
          <DataTable rows={invoices} onRowClick={() => navigate('/admin/supplier-invoices')} columns={[
            { key: 'n', header: 'Réf. fournisseur', render: (r) => <span className="font-semibold text-navy">{r.supplier_reference}</span> },
            { key: 'd', header: 'Date', render: (r) => fmtDate(r.invoice_date) },
            { key: 'e', header: 'Échéance', render: (r) => fmtDate(r.due_date) },
            { key: 's', header: 'Statut', render: (r) => <StatusBadge map={SUPPLIER_INVOICE_STATUS} value={r.status} /> },
            { key: 't', header: 'Total TTC', align: 'right', render: (r) => <span className="tabular-nums">{money(r.total_ttc, r.currency)}</span> },
            { key: 'p', header: 'Payé', align: 'right', render: (r) => <span className="tabular-nums">{money(r.amount_paid, r.currency)}</span> },
          ]} />
        )}
        {tab === 'documents' && <div className="p-5"><DocumentsPanel entityType="suppliers" entityId={s.id} docType="supplier_document" /></div>}
      </div>
      {editing && <SupplierForm supplier={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); }} />}
    </>
  );
}
