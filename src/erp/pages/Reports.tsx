import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { PageHeader } from '@/admin/ui';
import { logEvent, rpc } from '../lib/db';
import { useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { amount, csvDownload, fmtDate, money, pct, qty, startOfYear, toNum, today } from '../lib/format';
import { INVOICE_STATUS, PAYMENT_STATUS, QUOTATION_STATUS } from '../lib/status';
import { BarChart, DataTable, DateRange, ErrorBox, LoadingBlock, Pill, SelectInput, StatCard, StatusBadge, Tabs } from '../components/ui';

type Tab = 'sales' | 'customers' | 'products' | 'margins' | 'quotations' | 'outstanding' | 'payments' | 'purchases' | 'stock';

export default function ReportsPage() {
  const { can } = useAccess();
  const [tab, setTab] = useState<Tab>('sales');
  const [from, setFrom] = useState(startOfYear());
  const [to, setTo] = useState(today());
  const tabs: { value: Tab; label: string }[] = [
    { value: 'sales', label: 'Chiffre d’affaires' }, { value: 'customers', label: 'Clients' }, { value: 'products', label: 'Produits' },
    ...(can('products.view_costs') ? [{ value: 'margins' as Tab, label: 'Marges' }] : []),
    { value: 'quotations', label: 'Devis' }, { value: 'outstanding', label: 'Impayés' }, { value: 'payments', label: 'Encaissements' },
    ...(can('purchases.view') ? [{ value: 'purchases' as Tab, label: 'Achats' }] : []),
    { value: 'stock', label: 'Stock' },
  ];
  const exportCsv = (name: string, headers: string[], rows: (string | number | null | undefined)[][]) => {
    csvDownload(`rapport-${name}-${from}-${to}.csv`, headers, rows);
    void logEvent('export.csv', 'reports', null, `${name} ${from} → ${to}`);
  };
  const canExport = can('reports.export');

  return (
    <>
      <PageHeader title="Rapports & analyses" subtitle="Calculés en temps réel sur les documents validés (avoirs déduits)." />
      <div className="mb-4 border border-navy/10 bg-white p-4">
        {!['outstanding', 'stock'].includes(tab) ? <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /> : <p className="text-sm text-navy/60">Situation à date ({fmtDate(today())}).</p>}
      </div>
      <div className="border border-navy/10 bg-white">
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
        <div className="p-4 sm:p-5">
          {tab === 'sales' && <SalesReport from={from} to={to} onExport={canExport ? exportCsv : undefined} />}
          {tab === 'customers' && <SimpleReport fn="report_customers" from={from} to={to} name="clients" onExport={canExport ? exportCsv : undefined}
            columns={[['Code', 'code'], ['Client', 'name'], ['Ville', 'city'], ['Factures', 'invoices', 'int'], ['CA net HT', 'net_ht', 'money'], ['CA net TTC', 'net_ttc', 'money'], ['Encaissé (période)', 'paid', 'money'], ['Encours actuel', 'outstanding', 'money']]}
            link={(r) => `/admin/customers/${r.id as string}`} />}
          {tab === 'products' && <SimpleReport fn="report_products" from={from} to={to} name="produits" onExport={canExport ? exportCsv : undefined}
            columns={[['Référence', 'reference'], ['Désignation', 'name'], ['Catégorie', 'category'], ['Marque', 'brand'], ['Qté vendue', 'quantity', 'qty'], ['CA HT', 'revenue_ht', 'money'],
              ...(can('products.view_costs') ? [['Coût', 'cost', 'money'], ['Marge', 'margin', 'money'], ['Taux de marge', '_rate', 'pct']] as [string, string, string][] : [])]}
            transform={(r) => ({ ...r, _rate: toNum(r.revenue_ht) ? (toNum(r.margin) / toNum(r.revenue_ht)) * 100 : 0 })} />}
          {tab === 'margins' && <SimpleReport fn="report_margins" from={from} to={to} name="marges" onExport={canExport ? exportCsv : undefined}
            columns={[['Catégorie', 'category'], ['CA HT', 'revenue_ht', 'money'], ['Coût des ventes', 'cost', 'money'], ['Marge estimée', 'margin', 'money'], ['Taux de marge', '_rate', 'pct']]}
            transform={(r) => ({ ...r, _rate: toNum(r.revenue_ht) ? (toNum(r.margin) / toNum(r.revenue_ht)) * 100 : 0 })}
            note="Marge estimée = CA HT − quantités × coût moyen pondéré au moment de la validation de chaque facture." />}
          {tab === 'quotations' && <QuotationsReport from={from} to={to} onExport={canExport ? exportCsv : undefined} />}
          {tab === 'outstanding' && <OutstandingReport onExport={canExport ? exportCsv : undefined} />}
          {tab === 'payments' && <PaymentsReport from={from} to={to} onExport={canExport ? exportCsv : undefined} />}
          {tab === 'purchases' && <SimpleReport fn="report_purchases" from={from} to={to} name="achats" onExport={canExport ? exportCsv : undefined}
            columns={[['Code', 'code'], ['Fournisseur', 'name'], ['Pays', 'country'], ['Commandes', 'orders', 'int'], ['Commandé HT (TND)', 'ordered_tnd', 'money'], ['Facturé TTC (TND)', 'invoiced_tnd', 'money'], ['Payé (TND)', 'paid_tnd', 'money'], ['Reste dû (TND)', 'payable_tnd', 'money']]}
            link={(r) => `/admin/suppliers/${r.id as string}`} />}
          {tab === 'stock' && <SimpleReport fn="report_stock" name="stock" onExport={canExport ? exportCsv : undefined}
            columns={[['Référence', 'reference'], ['Désignation', 'name'], ['Catégorie', 'category'], ['Stock', 'stock_quantity', 'qty'], ['Minimum', 'min_stock', 'qty'],
              ...(can('products.view_costs') ? [['Coût moyen', 'unit_cost', 'money'], ['Valeur stock', 'stock_value', 'money']] as [string, string, string][] : []), ['Valeur vente HT', 'sale_value', 'money'], ['État', 'stock_status', 'stock']]} />}
        </div>
      </div>
    </>
  );
}

type Rec = Record<string, unknown> & { id?: string | number };
/** A report row with a guaranteed key for the table. */
type Row = Record<string, unknown> & { id: string | number };
const keyed = (r: Rec, id: string | number): Row => ({ ...r, id });
type ExportFn = (name: string, headers: string[], rows: (string | number | null | undefined)[][]) => void;

function cell(v: unknown, kind?: string) {
  if (kind === 'money') return v === null || v === undefined ? '—' : money(v);
  if (kind === 'qty') return qty(v);
  if (kind === 'int') return String(toNum(v));
  if (kind === 'pct') return pct(v);
  if (kind === 'stock') return v === 'out' ? <Pill tone="red">Rupture</Pill> : v === 'low' ? <Pill tone="amber">Bas</Pill> : <Pill tone="green">OK</Pill>;
  return String(v ?? '');
}

function SimpleReport({ fn, from, to, name, columns, onExport, link, transform, note }: {
  fn: string; from?: string; to?: string; name: string; columns: [string, string, string?][]; onExport?: ExportFn;
  link?: (r: Rec) => string; transform?: (r: Rec) => Rec; note?: string;
}) {
  const { data, error, loading, reload } = useAsync(() => rpc<Rec[]>(fn, from && to ? { p_from: from, p_to: to } : {}), [fn, from, to]);
  const rows = useMemo(() => (data ?? []).map((r, i) => keyed(transform ? transform(r) : r, (r.id as string) ?? (r.product_id as string) ?? i)), [data, transform]);
  const totals = columns.filter(([, , k]) => k === 'money' || k === 'int' || k === 'qty').map(([, key]) => key);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {note ? <p className="text-sm text-navy/60">{note}</p> : <span />}
        {onExport && <button className="btn btn-ghost !min-h-[38px] !px-4 !text-[11px]" disabled={!rows.length}
          onClick={() => onExport(name, columns.map(([h]) => h), rows.map((r) => columns.map(([, k, kind]) => (kind && ['money', 'qty', 'int', 'pct'].includes(kind) ? toNum(r[k]) : String(r[k] ?? '')))))}><Download className="h-4 w-4" /> Export CSV</button>}
      </div>
      <DataTable loading={loading} rows={rows} minWidth={720}
        footer={rows.length > 1 && totals.length ? <tr>{columns.map(([, k, kind], i) => <td key={k} className={`px-4 py-3 ${kind ? 'text-right tabular-nums' : ''}`}>{i === 0 ? 'Total' : totals.includes(k) && kind !== 'qty' ? cell(rows.reduce((s, r) => s + toNum(r[k]), 0), kind) : ''}</td>)}</tr> : undefined}
        columns={columns.map(([h, k, kind], i) => ({
          key: k, header: h, align: kind && kind !== 'stock' ? 'right' as const : 'left' as const,
          render: (r: Row) => i === 1 && link ? <Link className="font-semibold text-navy hover:underline" to={link(r)}>{cell(r[k])}</Link> : <span className={kind ? 'tabular-nums' : ''}>{cell(r[k], kind)}</span>,
        }))} />
    </div>
  );
}

function SalesReport({ from, to, onExport }: { from: string; to: string; onExport?: ExportFn }) {
  const [group, setGroup] = useState<'day' | 'week' | 'month' | 'year'>('month');
  const { data, error, loading, reload } = useAsync(() => rpc<Rec[]>('report_sales', { p_from: from, p_to: to, p_group: group }), [from, to, group]);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <LoadingBlock />;
  const rows = (data ?? []).map((r) => keyed(r, String(r.period)));
  const sum = (k: string) => rows.reduce((s, r) => s + toNum(r[k]), 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard accent label="CA net HT" value={money(sum('net_ht'))} hint={`${sum('invoices')} facture(s)`} />
        <StatCard label="TVA collectée" value={money(sum('net_vat'))} />
        <StatCard label="CA net TTC (hors timbre)" value={money(sum('net_ttc'))} />
        <StatCard label="Avoirs HT" value={money(sum('credited_ht'))} hint={`${sum('credit_notes')} avoir(s)`} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">Regrouper par
          <SelectInput value={group} onChange={(v) => setGroup(v as typeof group)} className="!w-40"><option value="day">Jour</option><option value="week">Semaine</option><option value="month">Mois</option><option value="year">Année</option></SelectInput>
        </label>
        {onExport && <button className="btn btn-ghost !min-h-[38px] !px-4 !text-[11px]" disabled={!rows.length} onClick={() => onExport('ventes', ['Période', 'Factures', 'Avoirs', 'CA brut HT', 'Avoirs HT', 'CA net HT', 'TVA', 'CA net TTC'],
          rows.map((r) => [String(r.period), toNum(r.invoices), toNum(r.credit_notes), toNum(r.gross_ht), toNum(r.credited_ht), toNum(r.net_ht), toNum(r.net_vat), toNum(r.net_ttc)]))}><Download className="h-4 w-4" /> Export CSV</button>}
      </div>
      {rows.length > 0 && rows.length <= 60 && <BarChart data={rows.map((r) => ({ label: String(r.period), value: toNum(r.net_ht), hint: `${toNum(r.invoices)} facture(s)` }))} format={(v) => amount(v, 0)} />}
      <DataTable rows={rows} minWidth={640} columns={[
        { key: 'p', header: 'Période', render: (r) => <span className="font-semibold">{String(r.period)}</span> },
        { key: 'i', header: 'Factures', align: 'right', render: (r) => toNum(r.invoices) },
        { key: 'g', header: 'CA brut HT', align: 'right', render: (r) => <span className="tabular-nums">{money(r.gross_ht)}</span> },
        { key: 'c', header: 'Avoirs HT', align: 'right', render: (r) => <span className="tabular-nums">{money(r.credited_ht)}</span> },
        { key: 'n', header: 'CA net HT', align: 'right', render: (r) => <span className="font-semibold tabular-nums">{money(r.net_ht)}</span> },
        { key: 't', header: 'TTC', align: 'right', render: (r) => <span className="tabular-nums">{money(r.net_ttc)}</span> },
      ]} />
    </div>
  );
}

function QuotationsReport({ from, to, onExport }: { from: string; to: string; onExport?: ExportFn }) {
  const { data, error, reload } = useAsync(() => rpc<{ by_status: Rec[]; by_salesperson: Rec[]; conversion_rate: number; invoiced_rate: number }>('report_quotations', { p_from: from, p_to: to }), [from, to]);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <LoadingBlock />;
  const total = data.by_status.reduce((s, r) => s + toNum(r.count), 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard accent label="Taux de conversion" value={pct(data.conversion_rate)} hint="Devis acceptés / devis envoyés (acceptés, refusés, expirés inclus)" />
        <StatCard label="Devis acceptés facturés" value={pct(data.invoiced_rate)} />
        <StatCard label="Devis émis" value={total} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <DataTable rows={data.by_status.map((r) => keyed(r, String(r.status)))} minWidth={360} columns={[
          { key: 's', header: 'Statut', render: (r) => <StatusBadge map={QUOTATION_STATUS} value={String(r.status)} /> },
          { key: 'c', header: 'Nombre', align: 'right', render: (r) => toNum(r.count) },
          { key: 't', header: 'Montant HT', align: 'right', render: (r) => <span className="tabular-nums">{money(r.total_ht)}</span> },
        ]} />
        <div>
          {onExport && <div className="mb-2 flex justify-end"><button className="btn btn-ghost !min-h-[34px] !px-3 !text-[11px]" onClick={() => onExport('devis-commerciaux', ['Commercial', 'Devis', 'Acceptés', 'Montant accepté HT'], data.by_salesperson.map((r) => [String(r.salesperson), toNum(r.quotations), toNum(r.accepted), toNum(r.accepted_ht)]))}><Download className="h-3.5 w-3.5" /> CSV</button></div>}
          <DataTable rows={data.by_salesperson.map((r, i) => keyed(r, i))} minWidth={360} columns={[
            { key: 'p', header: 'Commercial', render: (r) => String(r.salesperson) },
            { key: 'q', header: 'Devis', align: 'right', render: (r) => toNum(r.quotations) },
            { key: 'a', header: 'Acceptés', align: 'right', render: (r) => `${toNum(r.accepted)} (${pct(toNum(r.quotations) ? (toNum(r.accepted) / toNum(r.quotations)) * 100 : 0)})` },
            { key: 'm', header: 'Accepté HT', align: 'right', render: (r) => <span className="tabular-nums">{money(r.accepted_ht)}</span> },
          ]} />
        </div>
      </div>
    </div>
  );
}

const BUCKETS: [string, string][] = [['not_due', 'Non échu'], ['1_30', '1–30 j'], ['31_60', '31–60 j'], ['61_90', '61–90 j'], ['90_plus', '+90 j']];

function OutstandingReport({ onExport }: { onExport?: ExportFn }) {
  const { data, error, reload } = useAsync(() => rpc<Rec[]>('report_outstanding'), []);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <LoadingBlock />;
  const rows = data.map((r) => keyed(r, String(r.id)));
  const bucket = (b: string) => rows.filter((r) => r.bucket === b).reduce((s, r) => s + toNum(r.balance_due), 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard accent label="Total impayé" value={money(rows.reduce((s, r) => s + toNum(r.balance_due), 0))} hint={`${rows.length} facture(s)`} />
        {BUCKETS.map(([k, l]) => <StatCard key={k} label={l} value={<span className={k !== 'not_due' && bucket(k) > 0 ? 'text-brand-red' : ''}>{money(bucket(k))}</span>} />)}
      </div>
      {onExport && <div className="flex justify-end"><button className="btn btn-ghost !min-h-[38px] !px-4 !text-[11px]" disabled={!rows.length} onClick={() => onExport('impayes', ['Facture', 'Date', 'Échéance', 'Client', 'Téléphone', 'Total TTC', 'Payé', 'Avoirs', 'Reste', 'Jours de retard', 'Tranche'],
        rows.map((r) => [String(r.number), String(r.issue_date), String(r.due_date ?? ''), String(r.customer), String(r.phone ?? ''), toNum(r.total_ttc), toNum(r.amount_paid), toNum(r.amount_credited), toNum(r.balance_due), toNum(r.days_overdue), BUCKETS.find(([k]) => k === r.bucket)?.[1] ?? '']))}><Download className="h-4 w-4" /> Export CSV</button></div>}
      <DataTable rows={rows} columns={[
        { key: 'n', header: 'Facture', render: (r) => <Link className="font-semibold text-navy hover:underline" to={`/admin/invoices/${r.id}`}>{String(r.number)}</Link> },
        { key: 'c', header: 'Client', render: (r) => <Link className="hover:underline" to={`/admin/customers/${String(r.customer_id)}`}>{String(r.customer)}</Link> },
        { key: 'e', header: 'Échéance', render: (r) => fmtDate(String(r.due_date ?? '')) },
        { key: 'j', header: 'Retard', align: 'right', render: (r) => toNum(r.days_overdue) > 0 ? <span className="font-semibold text-brand-red">{toNum(r.days_overdue)} j</span> : '—' },
        { key: 's', header: 'Statut', render: (r) => <StatusBadge map={INVOICE_STATUS} value={String(r.status)} /> },
        { key: 'b', header: 'Reste à payer', align: 'right', render: (r) => <span className="font-semibold tabular-nums">{money(r.balance_due)}</span> },
      ]} />
    </div>
  );
}

function PaymentsReport({ from, to, onExport }: { from: string; to: string; onExport?: ExportFn }) {
  const { data, error, reload } = useAsync(() => rpc<{ by_method: Rec[]; by_month: Rec[]; payments: Rec[] }>('report_payments', { p_from: from, p_to: to }), [from, to]);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <LoadingBlock />;
  const total = data.by_method.reduce((s, r) => s + toNum(r.total), 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard accent label="Total encaissé" value={money(total)} hint={`${data.payments.filter((p) => p.status === 'valid').length} paiement(s)`} />
        {data.by_method.slice(0, 3).map((m) => <StatCard key={String(m.method)} label={String(m.method)} value={money(m.total)} hint={`${toNum(m.count)} paiement(s)`} />)}
      </div>
      {data.by_month.length > 0 && <BarChart data={data.by_month.map((r) => ({ label: String(r.month), value: toNum(r.total) }))} format={(v) => amount(v, 0)} height={180} />}
      {onExport && <div className="flex justify-end"><button className="btn btn-ghost !min-h-[38px] !px-4 !text-[11px]" disabled={!data.payments.length} onClick={() => onExport('encaissements', ['N°', 'Date', 'Client', 'Mode', 'Référence', 'Montant', 'Affecté', 'Statut'],
        data.payments.map((p) => [String(p.number), String(p.payment_date), String(p.customer), String(p.method), String(p.reference ?? ''), toNum(p.amount), toNum(p.allocated_amount), PAYMENT_STATUS[String(p.status)]?.label ?? '']))}><Download className="h-4 w-4" /> Export CSV</button></div>}
      <DataTable rows={data.payments.map((p) => keyed(p, String(p.id)))} columns={[
        { key: 'n', header: 'N°', render: (p) => <Link className="font-semibold hover:underline" to={`/admin/payments?open=${p.id}`}>{String(p.number)}</Link> },
        { key: 'd', header: 'Date', render: (p) => fmtDate(String(p.payment_date)) },
        { key: 'c', header: 'Client', render: (p) => String(p.customer) },
        { key: 'm', header: 'Mode', render: (p) => String(p.method) },
        { key: 's', header: 'Statut', render: (p) => <StatusBadge map={PAYMENT_STATUS} value={String(p.status)} /> },
        { key: 'a', header: 'Montant', align: 'right', render: (p) => <span className="tabular-nums">{money(p.amount)}</span> },
      ]} />
    </div>
  );
}
