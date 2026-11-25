import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown, Loader2, Receipt, Save, Truck } from 'lucide-react';
import { PageHeader, toast } from '@/admin/ui';
import { errMsg, rpc, sb, unwrap } from '../lib/db';
import { loadSettings, useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { loadLines } from '../lib/data';
import { fmtDate, money } from '../lib/format';
import { DELIVERY_STATUS, INVOICE_STATUS, ORDER_STATUS } from '../lib/status';
import { generateAndDownload, quotationDoc } from '../lib/documents';
import type { Customer, DeliveryNote, Invoice, Order, Quotation } from '../lib/types';
import { DataTable, ErrorBox, Field, FilterChips, KeyValues, LoadingBlock, SearchBar, Section, SelectInput, StatusBadge, TextArea, TextInput } from '../components/ui';
import { LinesEditor, TotalsPanel } from '../components/LinesEditor';

type Row = Order & { customer: Pick<Customer, 'name'> | null; quotation: Pick<Quotation, 'number' | 'total_ttc' | 'currency'> | null };

export default function OrdersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | Order['status']>('');
  const { data, error, loading, reload } = useAsync(async () =>
    unwrap(await sb().from('orders').select('*, customer:customers(name), quotation:quotations(number,total_ttc,currency)').order('created_at', { ascending: false }).limit(2000)) as Row[], []);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((r) => (!status || r.status === status) && (!n || [r.number, r.customer?.name, r.quotation?.number, r.customer_reference].join(' ').toLowerCase().includes(n)));
  }, [data, q, status]);

  return (
    <>
      <PageHeader title="Commandes clients" subtitle="Créées à partir des devis acceptés — mêmes lignes, sans ressaisie." />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4 xl:flex-row">
          <SearchBar value={q} onChange={setQ} placeholder="N°, client, devis, référence client…" />
          <FilterChips value={status} onChange={setStatus} options={[{ value: '', label: 'Toutes' }, ...(['confirmed', 'in_progress', 'delivered', 'invoiced', 'cancelled'] as const).map((s) => ({ value: s, label: ORDER_STATUS[s].label }))]} />
        </div>
        <DataTable loading={loading} rows={rows} onRowClick={(r) => navigate(`/admin/orders/${r.id}`)} columns={[
          { key: 'n', header: 'N°', render: (r) => <span className="font-semibold text-navy">{r.number}</span> },
          { key: 'd', header: 'Date', render: (r) => fmtDate(r.order_date) },
          { key: 'c', header: 'Client', render: (r) => r.customer?.name },
          { key: 'q', header: 'Devis', render: (r) => <span className="text-navy/60">{r.quotation?.number}</span> },
          { key: 'e', header: 'Livraison prévue', render: (r) => fmtDate(r.expected_delivery) },
          { key: 's', header: 'Statut', render: (r) => <StatusBadge map={ORDER_STATUS} value={r.status} /> },
          { key: 't', header: 'Total TTC', align: 'right', render: (r) => <span className="font-semibold tabular-nums">{money(r.quotation?.total_ttc ?? 0, r.quotation?.currency)}</span> },
        ]} />
      </div>
    </>
  );
}

export function OrderDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAccess();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<Pick<Order, 'status' | 'expected_delivery' | 'customer_reference' | 'notes'> | null>(null);
  const { data, error: loadError, reload } = useAsync(async () => {
    const o = unwrap(await sb().from('orders').select('*').eq('id', id).single()) as Order;
    const [quotation, customer, lines, invoices, deliveries] = await Promise.all([
      sb().from('quotations').select('*').eq('id', o.quotation_id).single().then(unwrap) as Promise<Quotation>,
      sb().from('customers').select('*').eq('id', o.customer_id).single().then(unwrap) as Promise<Customer>,
      loadLines('quotation_items', 'quotation_id', o.quotation_id),
      can('invoices.view') ? sb().from('invoices').select('*').eq('order_id', id).order('created_at').then(unwrap) as Promise<Invoice[]> : Promise.resolve([] as Invoice[]),
      can('deliveries.view') ? sb().from('delivery_notes').select('*').eq('order_id', id).order('created_at').then(unwrap) as Promise<DeliveryNote[]> : Promise.resolve([] as DeliveryNote[]),
    ]);
    setEdit({ status: o.status, expected_delivery: o.expected_delivery, customer_reference: o.customer_reference, notes: o.notes });
    return { o, quotation, customer, lines, invoices, deliveries };
  }, [id]);

  if (loadError) return <ErrorBox message={loadError} onRetry={reload} />;
  if (!data || !edit) return <LoadingBlock />;
  const { o, quotation, customer, lines, invoices, deliveries } = data;
  const editable = can('orders.edit') && o.status !== 'cancelled';
  const dirty = edit.status !== o.status || (edit.expected_delivery ?? '') !== (o.expected_delivery ?? '') || edit.customer_reference !== o.customer_reference || edit.notes !== o.notes;

  const run = async (key: string, fn: () => Promise<unknown>, ok: string, after?: (r: unknown) => void) => {
    setBusy(key); setError(null);
    try { const r = await fn(); toast(ok); if (after) after(r); else await reload(); } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };

  return (
    <>
      <Link to="/admin/orders" className="btn-link mb-4 !text-[11px]"><ArrowLeft className="h-3.5 w-3.5" /> Commandes</Link>
      <PageHeader title={`Commande ${o.number}`} subtitle={`${customer.name} · du ${fmtDate(o.order_date)} · devis ${quotation.number}`} actions={<StatusBadge map={ORDER_STATUS} value={o.status} />} />
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      <div className="mb-6 flex flex-wrap gap-2 border border-navy/10 bg-white p-3">
        <button className="btn btn-ghost !min-h-[40px] !px-4 !text-[11px]" disabled={!!busy} onClick={() => run('pdf', async () => {
          const settings = await loadSettings();
          const d = { ...quotationDoc(quotation, lines, customer), title: 'CONFIRMATION DE COMMANDE', number: o.number, watermark: undefined,
            meta: [['Date', fmtDate(o.order_date)] as [string, string], ['Devis', quotation.number] as [string, string], ...(o.customer_reference ? [['Votre commande', o.customer_reference] as [string, string]] : []), ...(o.expected_delivery ? [['Livraison prévue', fmtDate(o.expected_delivery)] as [string, string]] : [])],
            words: undefined, signatures: ['Cachet et signature du client'] };
          return generateAndDownload({ doc: d, settings, docType: 'other', entityType: 'orders', entityId: o.id, archive: can('documents.create') });
        }, 'PDF généré', () => undefined)}>{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Confirmation PDF</button>
        {can('deliveries.create') && o.status !== 'cancelled' && (
          <button className="btn btn-navy !min-h-[40px] !px-4 !text-[11px]" disabled={!!busy} onClick={() => run('bl', () => rpc<string>('create_delivery_note', { p_source_type: 'order', p_source_id: o.id }), 'Bon de livraison créé', (bid) => navigate(`/admin/deliveries/${bid as string}`))}><Truck className="h-4 w-4" /> Bon de livraison</button>
        )}
        {can('invoices.create') && o.status !== 'cancelled' && !invoices.some((i) => i.kind === 'invoice' && i.status !== 'cancelled') && (
          <button className="btn btn-red !min-h-[40px] !px-4 !text-[11px]" disabled={!!busy} onClick={() => run('inv', () => rpc<string>('create_invoice_from_order', { p_order_id: o.id }), 'Facture brouillon créée', (iid) => navigate(`/admin/invoices/${iid as string}`))}><Receipt className="h-4 w-4" /> Facturer</button>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Section title="Lignes de la commande (issues du devis)">
            <div className="p-4"><LinesEditor readOnly lines={lines} onChange={() => undefined} products={[]} vatRates={[]} price="sale" currency={quotation.currency} /></div>
          </Section>
          {(invoices.length > 0 || deliveries.length > 0) && (
            <Section title="Documents liés">
              <DataTable minWidth={560} rows={[...invoices.map((i) => ({ id: i.id, kind: i.kind === 'credit_note' ? 'Avoir' : 'Facture', number: i.number ?? 'Brouillon', date: i.issue_date, status: <StatusBadge map={INVOICE_STATUS} value={i.status} />, to: `/admin/invoices/${i.id}` })),
                ...deliveries.map((d) => ({ id: d.id, kind: 'Bon de livraison', number: d.number, date: d.delivery_date, status: <StatusBadge map={DELIVERY_STATUS} value={d.status} />, to: `/admin/deliveries/${d.id}` }))]}
                onRowClick={(r) => navigate(r.to)} columns={[
                  { key: 'k', header: 'Type', render: (r) => r.kind }, { key: 'n', header: 'N°', render: (r) => <span className="font-semibold">{r.number}</span> },
                  { key: 'd', header: 'Date', render: (r) => fmtDate(r.date) }, { key: 's', header: 'Statut', render: (r) => r.status },
                ]} />
            </Section>
          )}
        </div>
        <div className="space-y-4">
          <TotalsPanel readOnly lines={lines} discountPercent={Number(quotation.discount_percent)} server={quotation} currency={quotation.currency} />
          <Section title="Suivi">
            <div className="space-y-4 p-5">
              <Field label="Statut">
                <SelectInput value={edit.status} disabled={!editable} onChange={(v) => setEdit({ ...edit, status: v as Order['status'] })}>
                  {(['confirmed', 'in_progress', 'delivered', 'invoiced', 'cancelled'] as const).map((s) => <option key={s} value={s}>{ORDER_STATUS[s].label}</option>)}
                </SelectInput>
              </Field>
              <Field label="Livraison prévue"><input type="date" className="field !min-h-[42px] !py-2" disabled={!editable} value={edit.expected_delivery ?? ''} onChange={(e) => setEdit({ ...edit, expected_delivery: e.target.value || null })} /></Field>
              <Field label="N° de commande du client"><TextInput value={edit.customer_reference} disabled={!editable} onChange={(v) => setEdit({ ...edit, customer_reference: v })} /></Field>
              <Field label="Notes"><TextArea value={edit.notes} disabled={!editable} onChange={(v) => setEdit({ ...edit, notes: v })} /></Field>
              {editable && <button className="btn btn-navy w-full !min-h-[42px]" disabled={!dirty || !!busy} onClick={() => run('save', async () => unwrap(await sb().from('orders').update(edit).eq('id', o.id)), 'Commande mise à jour')}><Save className="h-4 w-4" /> Enregistrer</button>}
            </div>
          </Section>
          <Section title="Client"><KeyValues items={[['Client', <Link className="underline" to={`/admin/customers/${customer.id}`}>{customer.name}</Link>], ['Téléphone', customer.phone || customer.mobile], ['E-mail', customer.email]]} /></Section>
        </div>
      </div>
    </>
  );
}
