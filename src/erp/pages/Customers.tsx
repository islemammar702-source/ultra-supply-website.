import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Loader2, Pencil, Plus, Receipt, Wallet } from 'lucide-react';
import { Modal, PageHeader, toast } from '@/admin/ui';
import { errMsg, logEvent, sb, unwrap } from '../lib/db';
import { useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { csvDownload, fmtDate, money, today } from '../lib/format';
import { INVOICE_STATUS, CREDIT_NOTE_STATUS, PAYMENT_STATUS, QUOTATION_STATUS, REQUEST_STATUS, REQUEST_TYPE } from '../lib/status';
import type { ContactRequest, Customer, CustomerBalance, Invoice, Payment, Quotation } from '../lib/types';
import {
  Check, DataTable, ErrorBox, Field, FilterChips, KeyValues, LoadingBlock, NumberInput, Pill, SearchBar, SelectInput, StatCard,
  StatusBadge, Tabs, TextArea, TextInput,
} from '../components/ui';
import { DocumentsPanel } from '../components/DocumentsPanel';

export const emptyCustomer = (): Partial<Customer> => ({
  customer_type: 'company', name: '', contact_name: '', contact_position: '', tax_id: '', trade_register: '', vat_exempt: false, email: '',
  phone: '', mobile: '', address: '', city: '', governorate: '', postal_code: '', country: 'Tunisie', payment_terms_days: 30, credit_limit: null,
  notes: '', is_active: true,
});

const GOVERNORATES = ['Ariana', 'Béja', 'Ben Arous', 'Bizerte', 'Gabès', 'Gafsa', 'Jendouba', 'Kairouan', 'Kasserine', 'Kébili', 'Le Kef', 'Mahdia', 'La Manouba', 'Médenine', 'Monastir', 'Nabeul', 'Sfax', 'Sidi Bouzid', 'Siliana', 'Sousse', 'Tataouine', 'Tozeur', 'Tunis', 'Zaghouan'];

export default function CustomersPage() {
  const { can } = useAccess();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'' | 'active' | 'inactive' | 'debt'>('active');
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Partial<Customer> | null>(() => (params.get('new') === '1' ? emptyCustomer() : null));
  const { data, error, loading, reload } = useAsync(async () => {
    const [customers, balances] = await Promise.all([
      sb().from('customers').select('*').order('name').then(unwrap) as Promise<Customer[]>,
      sb().from('customer_balances').select('*').then(unwrap) as Promise<CustomerBalance[]>,
    ]);
    const map = new Map(balances.map((b) => [b.customer_id, b]));
    return customers.map((c) => ({ ...c, balance: map.get(c.id) }));
  }, []);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((c) =>
      (filter === '' || (filter === 'active' && c.is_active) || (filter === 'inactive' && !c.is_active) || (filter === 'debt' && Number(c.balance?.outstanding ?? 0) > 0))
      && (!n || [c.code, c.name, c.contact_name, c.email, c.phone, c.mobile, c.city, c.tax_id].join(' ').toLowerCase().includes(n)));
  }, [data, q, filter]);

  const exportCsv = () => {
    csvDownload(`clients-ultra-supply-${today()}.csv`,
      ['Code', 'Nom', 'Type', 'Contact', 'Matricule fiscal', 'E-mail', 'Téléphone', 'Mobile', 'Adresse', 'Ville', 'Gouvernorat', 'Pays', 'Délai paiement (j)', 'Facturé TTC', 'Encours', 'Actif'],
      rows.map((c) => [c.code, c.name, c.customer_type === 'company' ? 'Société' : 'Particulier', c.contact_name, c.tax_id, c.email, c.phone, c.mobile, c.address, c.city,
        c.governorate, c.country, c.payment_terms_days, Number(c.balance?.invoiced ?? 0), Number(c.balance?.outstanding ?? 0), c.is_active ? 'oui' : 'non']));
    void logEvent('export.csv', 'customers', null, `${rows.length} clients`);
  };

  return (
    <>
      <PageHeader title="Clients" subtitle={`${(data ?? []).filter((c) => c.is_active).length} client(s) actif(s)`}
        actions={<>
          {can('customers.export') && <button className="btn btn-ghost !min-h-[42px]" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> Export CSV</button>}
          {can('customers.create') && <button className="btn btn-red !min-h-[42px]" onClick={() => setEditing(emptyCustomer())}><Plus className="h-4 w-4" /> Nouveau client</button>}
        </>} />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4 lg:flex-row">
          <SearchBar value={q} onChange={setQ} placeholder="Nom, code, contact, téléphone, matricule fiscal…" />
          <FilterChips value={filter} onChange={setFilter} options={[
            { value: 'active', label: 'Actifs' }, { value: 'debt', label: 'Avec encours' }, { value: 'inactive', label: 'Archivés' }, { value: '', label: 'Tous' },
          ]} />
        </div>
        <DataTable loading={loading} rows={rows} onRowClick={(c) => navigate(`/admin/customers/${c.id}`)} columns={[
          { key: 'code', header: 'Code', render: (c) => <span className="font-mono text-xs text-navy/60">{c.code}</span> },
          { key: 'name', header: 'Client', render: (c) => <div><p className="font-semibold text-navy">{c.name}</p><p className="text-xs text-navy/50">{c.contact_name || (c.customer_type === 'individual' ? 'Particulier' : '')}</p></div> },
          { key: 'contact', header: 'Coordonnées', render: (c) => <div className="text-xs text-navy/70"><p>{c.phone || c.mobile || '—'}</p><p>{c.email}</p></div> },
          { key: 'city', header: 'Ville', render: (c) => c.city || '—' },
          { key: 'invoiced', header: 'Facturé TTC', align: 'right', render: (c) => <span className="tabular-nums">{money(c.balance?.invoiced ?? 0)}</span> },
          { key: 'outstanding', header: 'Encours', align: 'right', render: (c) => {
            const v = Number(c.balance?.outstanding ?? 0);
            return <span className={`tabular-nums ${Number(c.balance?.overdue ?? 0) > 0 ? 'font-semibold text-brand-red' : v > 0 ? 'font-semibold text-navy' : 'text-navy/40'}`}>{money(v)}</span>;
          } },
          { key: 'status', header: '', render: (c) => <div className="flex gap-1">{!c.is_active && <Pill tone="gray">Archivé</Pill>}{c.source === 'website' && <Pill tone="blue">Site</Pill>}</div> },
        ]} />
      </div>
      {editing && <CustomerForm customer={editing} onClose={() => { setEditing(null); if (params.get('new')) setParams({}); }} onSaved={(id) => { setEditing(null); void reload(); navigate(`/admin/customers/${id}`); }} />}
    </>
  );
}

export function CustomerForm({ customer, onClose, onSaved }: { customer: Partial<Customer>; onClose: () => void; onSaved: (id: string) => void }) {
  const [c, setC] = useState<Partial<Customer>>(customer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !customer.id;
  const set = <K extends keyof Customer>(k: K, v: Customer[K]) => setC((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!c.name?.trim() || c.name.trim().length < 2) return setError('Le nom est obligatoire.');
    if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) return setError('E-mail invalide.');
    setBusy(true); setError(null);
    const row = {
      customer_type: c.customer_type, name: c.name.trim(), contact_name: c.contact_name?.trim() ?? '', contact_position: c.contact_position?.trim() ?? '',
      tax_id: c.tax_id?.trim().toUpperCase() ?? '', trade_register: c.trade_register?.trim() ?? '', vat_exempt: Boolean(c.vat_exempt),
      email: c.email?.trim().toLowerCase() ?? '', phone: c.phone?.trim() ?? '', mobile: c.mobile?.trim() ?? '', address: c.address?.trim() ?? '',
      city: c.city?.trim() ?? '', governorate: c.governorate ?? '', postal_code: c.postal_code?.trim() ?? '', country: c.country?.trim() || 'Tunisie',
      payment_terms_days: Math.round(Number(c.payment_terms_days ?? 30)), credit_limit: c.credit_limit ? Number(c.credit_limit) : null,
      notes: c.notes ?? '', is_active: c.is_active !== false,
    };
    try {
      const saved = isNew
        ? unwrap(await sb().from('customers').insert(row).select('id').single()) as { id: string }
        : unwrap(await sb().from('customers').update(row).eq('id', customer.id!).select('id').single()) as { id: string };
      toast(isNew ? 'Client créé' : 'Client mis à jour');
      onSaved(saved.id);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open wide title={isNew ? 'Nouveau client' : `Modifier — ${customer.name}`} onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[42px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer</button>
      </>}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Type">
          <SelectInput value={c.customer_type ?? 'company'} onChange={(v) => set('customer_type', v as Customer['customer_type'])}>
            <option value="company">Société / professionnel</option><option value="individual">Particulier</option>
          </SelectInput>
        </Field>
        <Field label={c.customer_type === 'individual' ? 'Nom complet' : 'Raison sociale'} required><TextInput value={c.name ?? ''} onChange={(v) => set('name', v)} maxLength={200} /></Field>
        <Field label="Contact"><TextInput value={c.contact_name ?? ''} onChange={(v) => set('contact_name', v)} /></Field>
        <Field label="Fonction du contact"><TextInput value={c.contact_position ?? ''} onChange={(v) => set('contact_position', v)} /></Field>
        <Field label="Matricule fiscal" hint="Ex. 1234567/A/M/000"><TextInput value={c.tax_id ?? ''} onChange={(v) => set('tax_id', v)} className="font-mono" /></Field>
        <Field label="Registre du commerce"><TextInput value={c.trade_register ?? ''} onChange={(v) => set('trade_register', v)} /></Field>
        <Field label="E-mail"><TextInput type="email" value={c.email ?? ''} onChange={(v) => set('email', v)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Téléphone"><TextInput value={c.phone ?? ''} onChange={(v) => set('phone', v)} /></Field>
          <Field label="Mobile"><TextInput value={c.mobile ?? ''} onChange={(v) => set('mobile', v)} /></Field>
        </div>
        <Field label="Adresse" className="md:col-span-2"><TextInput value={c.address ?? ''} onChange={(v) => set('address', v)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code postal"><TextInput value={c.postal_code ?? ''} onChange={(v) => set('postal_code', v)} /></Field>
          <Field label="Ville"><TextInput value={c.city ?? ''} onChange={(v) => set('city', v)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Gouvernorat">
            <SelectInput value={c.governorate ?? ''} onChange={(v) => set('governorate', v)}>
              <option value="">—</option>{GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
            </SelectInput>
          </Field>
          <Field label="Pays"><TextInput value={c.country ?? ''} onChange={(v) => set('country', v)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Délai de paiement (jours)"><NumberInput value={c.payment_terms_days ?? 30} onChange={(v) => set('payment_terms_days', Math.max(0, Math.round(v)))} /></Field>
          <Field label="Plafond de crédit (DT)"><NumberInput value={c.credit_limit ?? null} onChange={(v) => set('credit_limit', v || null)} /></Field>
        </div>
        <div className="flex flex-col justify-end gap-3 pb-1">
          <Check checked={Boolean(c.vat_exempt)} onChange={(v) => set('vat_exempt', v)} label="Client exonéré de TVA (lignes à 0 % par défaut)" />
          <Check checked={c.is_active !== false} onChange={(v) => set('is_active', v)} label="Client actif" />
        </div>
        <Field label="Notes internes" className="md:col-span-2"><TextArea value={c.notes ?? ''} onChange={(v) => set('notes', v)} /></Field>
      </div>
    </Modal>
  );
}

type Tab = 'info' | 'quotations' | 'invoices' | 'payments' | 'requests' | 'documents';

export function CustomerDetail() {
  const { id = '' } = useParams();
  const { can } = useAccess();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('info');
  const [editing, setEditing] = useState(false);
  const { data, error, loading, reload } = useAsync(async () => {
    const c = unwrap(await sb().from('customers').select('*').eq('id', id).single()) as Customer;
    const [balance, quotations, invoices, payments, requests] = await Promise.all([
      sb().from('customer_balances').select('*').eq('customer_id', id).maybeSingle().then(unwrap) as Promise<CustomerBalance | null>,
      can('quotations.view') ? sb().from('quotations').select('*').eq('customer_id', id).order('created_at', { ascending: false }).then(unwrap) as Promise<Quotation[]> : Promise.resolve([] as Quotation[]),
      can('invoices.view') ? sb().from('invoices').select('*').eq('customer_id', id).order('created_at', { ascending: false }).then(unwrap) as Promise<Invoice[]> : Promise.resolve([] as Invoice[]),
      can('payments.view') ? sb().from('payments').select('*').eq('customer_id', id).order('payment_date', { ascending: false }).then(unwrap) as Promise<Payment[]> : Promise.resolve([] as Payment[]),
      sb().from('contact_requests').select('*').eq('customer_id', id).order('created_at', { ascending: false }).then(unwrap) as Promise<ContactRequest[]>,
    ]);
    return { c, balance, quotations, invoices, payments, requests };
  }, [id]);

  if (loading && !data) return <LoadingBlock />;
  if (error || !data) return <ErrorBox message={error ?? 'Client introuvable.'} onRetry={reload} />;
  const { c, balance, quotations, invoices, payments, requests } = data;

  return (
    <>
      <Link to="/admin/customers" className="btn-link mb-4 !text-[11px]"><ArrowLeft className="h-3.5 w-3.5" /> Clients</Link>
      <PageHeader title={c.name} subtitle={`${c.code} · ${c.customer_type === 'company' ? 'Société' : 'Particulier'}${c.city ? ` · ${c.city}` : ''}${c.is_active ? '' : ' · ARCHIVÉ'}`}
        actions={<>
          {can('quotations.create') && <button className="btn btn-ghost !min-h-[42px]" onClick={() => navigate(`/admin/quotations/new?customer=${c.id}`)}><FileText className="h-4 w-4" /> Nouveau devis</button>}
          {can('invoices.create') && <button className="btn btn-ghost !min-h-[42px]" onClick={() => navigate(`/admin/invoices/new?customer=${c.id}`)}><Receipt className="h-4 w-4" /> Nouvelle facture</button>}
          {can('payments.create') && <button className="btn btn-navy !min-h-[42px]" onClick={() => navigate(`/admin/payments?new=1&customer=${c.id}`)}><Wallet className="h-4 w-4" /> Encaisser</button>}
          {can('customers.edit') && <button className="btn btn-red !min-h-[42px]" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Modifier</button>}
        </>} />

      {can('invoices.view') && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard accent label="Encours (reste à payer)" value={money(balance?.outstanding ?? 0)} hint={Number(balance?.overdue ?? 0) > 0 ? `Dont en retard : ${money(balance?.overdue)}` : 'Aucun retard'} />
          <StatCard label="Total facturé TTC" value={money(balance?.invoiced ?? 0)} hint={Number(balance?.credited ?? 0) ? `Avoirs : ${money(balance?.credited)}` : `Dernière facture : ${fmtDate(balance?.last_invoice_date)}`} />
          <StatCard label="Total encaissé" value={money(balance?.paid ?? 0)} hint={`${payments.filter((p) => p.status === 'valid').length} paiement(s)`} />
          <StatCard label="Avoir / acompte disponible" value={money(balance?.unallocated ?? 0)} hint="Paiements non affectés à une facture" />
        </div>
      )}

      <div className="border border-navy/10 bg-white">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'info', label: 'Informations' },
          ...(can('quotations.view') ? [{ value: 'quotations' as Tab, label: 'Devis', count: quotations.length }] : []),
          ...(can('invoices.view') ? [{ value: 'invoices' as Tab, label: 'Factures & avoirs', count: invoices.length }] : []),
          ...(can('payments.view') ? [{ value: 'payments' as Tab, label: 'Paiements', count: payments.length }] : []),
          { value: 'requests', label: 'Demandes', count: requests.length },
          ...(can('documents.view') ? [{ value: 'documents' as Tab, label: 'Documents' }] : []),
        ]} />
        {tab === 'info' && (
          <div className="grid lg:grid-cols-2">
            <KeyValues items={[
              ['Contact', [c.contact_name, c.contact_position].filter(Boolean).join(' — ')],
              ['E-mail', c.email ? <a className="underline" href={`mailto:${c.email}`}>{c.email}</a> : ''],
              ['Téléphone', [c.phone, c.mobile].filter(Boolean).join(' / ')],
              ['Adresse', [c.address, [c.postal_code, c.city].filter(Boolean).join(' '), c.governorate, c.country].filter(Boolean).join(', ')],
            ]} />
            <KeyValues items={[
              ['Matricule fiscal', <span className="font-mono">{c.tax_id}</span>],
              ['Registre du commerce', c.trade_register],
              ['TVA', c.vat_exempt ? 'Exonéré' : 'Assujetti'],
              ['Conditions', `Paiement à ${c.payment_terms_days} jours${c.credit_limit ? ` · Plafond ${money(c.credit_limit)}` : ''}`],
              ['Origine', c.source === 'website' ? 'Site web' : 'Saisie manuelle'],
              ['Notes', <span className="whitespace-pre-wrap">{c.notes}</span>],
            ]} />
          </div>
        )}
        {tab === 'quotations' && (
          <DataTable rows={quotations} onRowClick={(r) => navigate(`/admin/quotations/${r.id}`)} columns={[
            { key: 'n', header: 'N°', render: (r) => <span className="font-semibold text-navy">{r.number}</span> },
            { key: 'd', header: 'Date', render: (r) => fmtDate(r.issue_date) },
            { key: 'v', header: 'Validité', render: (r) => fmtDate(r.valid_until) },
            { key: 's', header: 'Statut', render: (r) => <StatusBadge map={QUOTATION_STATUS} value={r.status} /> },
            { key: 't', header: 'Total TTC', align: 'right', render: (r) => <span className="tabular-nums">{money(r.total_ttc, r.currency)}</span> },
          ]} />
        )}
        {tab === 'invoices' && (
          <DataTable rows={invoices} onRowClick={(r) => navigate(`/admin/invoices/${r.id}`)} columns={[
            { key: 'n', header: 'N°', render: (r) => <span className="font-semibold text-navy">{r.number ?? 'Brouillon'}{r.kind === 'credit_note' && <span className="ml-2"><Pill tone="amber">Avoir</Pill></span>}</span> },
            { key: 'd', header: 'Date', render: (r) => fmtDate(r.issue_date) },
            { key: 'e', header: 'Échéance', render: (r) => fmtDate(r.due_date) },
            { key: 's', header: 'Statut', render: (r) => <StatusBadge map={r.kind === 'credit_note' ? CREDIT_NOTE_STATUS : INVOICE_STATUS} value={r.status} /> },
            { key: 't', header: 'Total TTC', align: 'right', render: (r) => <span className="tabular-nums">{money(r.total_ttc)}</span> },
            { key: 'b', header: 'Reste', align: 'right', render: (r) => <span className="tabular-nums">{r.kind === 'invoice' && r.status !== 'draft' ? money(r.balance_due) : '—'}</span> },
          ]} />
        )}
        {tab === 'payments' && (
          <DataTable rows={payments} onRowClick={(r) => navigate(`/admin/payments?open=${r.id}`)} columns={[
            { key: 'n', header: 'N°', render: (r) => <span className="font-semibold text-navy">{r.number}</span> },
            { key: 'd', header: 'Date', render: (r) => fmtDate(r.payment_date) },
            { key: 'r', header: 'Référence', render: (r) => r.reference || '—' },
            { key: 's', header: 'Statut', render: (r) => <StatusBadge map={PAYMENT_STATUS} value={r.status} /> },
            { key: 'a', header: 'Montant', align: 'right', render: (r) => <span className="tabular-nums">{money(r.amount)}</span> },
            { key: 'u', header: 'Non affecté', align: 'right', render: (r) => <span className="tabular-nums">{r.status === 'valid' ? money(Number(r.amount) - Number(r.allocated_amount)) : '—'}</span> },
          ]} />
        )}
        {tab === 'requests' && (
          <DataTable rows={requests} onRowClick={(r) => navigate(`/admin/requests?open=${r.id}`)} columns={[
            { key: 'd', header: 'Reçue le', render: (r) => fmtDate(r.created_at) },
            { key: 't', header: 'Type', render: (r) => REQUEST_TYPE[r.request_type] },
            { key: 'o', header: 'Objet', render: (r) => r.subject || r.product || '—' },
            { key: 's', header: 'Statut', render: (r) => <StatusBadge map={REQUEST_STATUS} value={r.status} /> },
          ]} />
        )}
        {tab === 'documents' && <div className="p-5"><DocumentsPanel entityType="customers" entityId={c.id} docType="customer_document" /></div>}
      </div>
      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); }} />}
    </>
  );
}
