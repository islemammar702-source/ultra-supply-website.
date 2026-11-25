import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, CheckCircle2, Download, FileDown, FileMinus2, Loader2, Mail, Plus, Printer, Save, Trash2, Truck, Wallet } from 'lucide-react';
import { Modal, PageHeader, toast } from '@/admin/ui';
import { errMsg, rpc, sb, unwrap } from '../lib/db';
import { loadSettings, loadVatRates, useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { loadCustomers, loadErpProducts, loadLines, saveLines } from '../lib/data';
import { addDays, csvDownload, fmtDate, money, today } from '../lib/format';
import { CREDIT_NOTE_STATUS, INVOICE_STATUS } from '../lib/status';
import { generateAndDownload, invoiceDoc, pdfFileName, renderPdf, storeDocument } from '../lib/documents';
import type { Customer, DocLine, Invoice } from '../lib/types';
import {
  Check, ConfirmModal, DataTable, ErrorBox, Field, FilterChips, KeyValues, LoadingBlock, Pill, SearchBar, SearchSelect, Section, StatusBadge, TextArea, TextInput,
} from '../components/ui';
import { LinesEditor, TotalsPanel, validateLines } from '../components/LinesEditor';
import { EmailDialog } from '../components/EmailDialog';
import { DocumentsPanel } from '../components/DocumentsPanel';

type Row = Invoice & { customer: Pick<Customer, 'name' | 'code'> | null };
type Filter = '' | 'draft' | 'unpaid' | 'overdue' | 'paid' | 'cancelled' | 'credit';

const UNPAID = ['validated', 'sent', 'partially_paid', 'overdue'];

export default function InvoicesPage() {
  const { can } = useAccess();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const filter = (params.get('status') ?? '') as Filter;
  const { data, error, loading, reload } = useAsync(async () => {
    await rpc('refresh_overdue_invoices').catch(() => 0);
    return unwrap(await sb().from('invoices').select('*, customer:customers(name,code)').order('created_at', { ascending: false }).limit(3000)) as Row[];
  }, []);
  const match = (r: Row, f: Filter) => f === '' ? true
    : f === 'credit' ? r.kind === 'credit_note'
    : f === 'unpaid' ? r.kind === 'invoice' && UNPAID.includes(r.status)
    : r.kind === 'invoice' && r.status === f;
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((r) => match(r, filter) && (!n || [r.number, r.customer?.name, r.customer?.code, r.customer_reference].join(' ').toLowerCase().includes(n)));
  }, [data, q, filter]);
  const sum = rows.filter((r) => r.kind === 'invoice' && r.status !== 'draft' && r.status !== 'cancelled').reduce((s, r) => s + Number(r.balance_due), 0);

  return (
    <>
      <PageHeader title="Factures & avoirs" subtitle="Les factures validées sont numérotées et ne peuvent plus être modifiées : utilisez un avoir."
        actions={<>
          <button className="btn btn-ghost !min-h-[42px]" disabled={!rows.length} onClick={() => csvDownload(`factures-${today()}.csv`,
            ['N°', 'Type', 'Date', 'Échéance', 'Client', 'Statut', 'Total HT', 'TVA', 'Timbre', 'Total TTC', 'Payé', 'Reste'],
            rows.map((r) => [r.number ?? 'brouillon', r.kind === 'invoice' ? 'Facture' : 'Avoir', r.issue_date, r.due_date ?? '', r.customer?.name ?? '', (r.kind === 'invoice' ? INVOICE_STATUS : CREDIT_NOTE_STATUS)[r.status]?.label ?? r.status,
              Number(r.total_ht), Number(r.total_vat), Number(r.fiscal_stamp ?? 0), Number(r.total_ttc), Number(r.amount_paid), Number(r.balance_due)]))}><Download className="h-4 w-4" /> CSV</button>
          {can('invoices.create') && <button className="btn btn-red !min-h-[42px]" onClick={() => navigate('/admin/invoices/new')}><Plus className="h-4 w-4" /> Nouvelle facture</button>}
        </>} />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4 xl:flex-row">
          <SearchBar value={q} onChange={setQ} placeholder="N°, client, référence…" />
          <FilterChips value={filter} onChange={(v) => setParams(v ? { status: v } : {})} options={[
            { value: '', label: 'Toutes' }, { value: 'draft', label: 'Brouillons' }, { value: 'unpaid', label: 'À encaisser' }, { value: 'overdue', label: 'En retard' },
            { value: 'paid', label: 'Payées' }, { value: 'cancelled', label: 'Annulées' }, { value: 'credit', label: 'Avoirs' },
          ].map((o) => ({ ...o, value: o.value as Filter, count: (data ?? []).filter((r) => match(r, o.value as Filter)).length }))} />
        </div>
        <DataTable loading={loading} rows={rows} onRowClick={(r) => navigate(`/admin/invoices/${r.id}`)}
          footer={filter === 'unpaid' || filter === 'overdue' ? <tr><td colSpan={6} className="px-4 py-3 text-right">Reste à encaisser</td><td className="px-4 py-3 text-right tabular-nums" colSpan={2}>{money(sum)}</td></tr> : undefined}
          columns={[
            { key: 'n', header: 'N°', render: (r) => <span className="font-semibold text-navy">{r.number ?? <span className="italic text-navy/50">Brouillon</span>}{r.kind === 'credit_note' && <span className="ml-2"><Pill tone="amber">Avoir</Pill></span>}</span> },
            { key: 'd', header: 'Date', render: (r) => fmtDate(r.issue_date) },
            { key: 'c', header: 'Client', render: (r) => r.customer?.name },
            { key: 'e', header: 'Échéance', render: (r) => <span className={r.status === 'overdue' ? 'font-semibold text-brand-red' : ''}>{r.kind === 'invoice' ? fmtDate(r.due_date) : '—'}</span> },
            { key: 's', header: 'Statut', render: (r) => <StatusBadge map={r.kind === 'invoice' ? INVOICE_STATUS : CREDIT_NOTE_STATUS} value={r.status} /> },
            { key: 'ttc', header: 'Total TTC', align: 'right', render: (r) => <span className="tabular-nums">{r.kind === 'credit_note' ? '− ' : ''}{money(r.total_ttc)}</span> },
            { key: 'b', header: 'Reste', align: 'right', render: (r) => <span className="font-semibold tabular-nums">{r.kind === 'invoice' && r.status !== 'draft' ? money(r.balance_due) : '—'}</span> },
            { key: 'x', header: '', render: () => null },
          ]} />
      </div>
    </>
  );
}

interface Form {
  customer_id: string | null; issue_date: string; due_date: string; customer_reference: string; discount_percent: number;
  terms: string; notes: string; restock: boolean;
}

export function InvoiceEditor() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAccess();
  const [form, setForm] = useState<Form | null>(null);
  const [lines, setLines] = useState<DocLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'validate' | 'delete' | 'cancel' | 'credit' | 'email'>(null);

  const ref = useAsync(async () => {
    const [settings, vatRates, customers, products] = await Promise.all([loadSettings(), loadVatRates(), loadCustomers(), loadErpProducts()]);
    return { settings, vatRates, customers, products };
  }, []);
  const doc = useAsync(async () => {
    if (isNew) return null;
    const inv = unwrap(await sb().from('invoices').select('*').eq('id', id).single()) as Invoice;
    const [items, allocations, credits, original] = await Promise.all([
      loadLines('invoice_items', 'invoice_id', id),
      can('payments.view') ? sb().from('payment_allocations').select('id,amount,created_at,payment:payments(id,number,payment_date,status,reference)').eq('invoice_id', id).then(unwrap) as Promise<{ id: string; amount: number; created_at: string; payment: { id: string; number: string; payment_date: string; status: string; reference: string } | null }[]> : Promise.resolve([]),
      sb().from('invoices').select('id,number,status,total_ttc,issue_date').eq('original_invoice_id', id).then(unwrap) as Promise<Pick<Invoice, 'id' | 'number' | 'status' | 'total_ttc' | 'issue_date'>[]>,
      inv.original_invoice_id ? sb().from('invoices').select('*').eq('id', inv.original_invoice_id).single().then(unwrap) as Promise<Invoice> : Promise.resolve(null),
    ]);
    return { inv, items, allocations, credits, original };
  }, [id]);

  useEffect(() => {
    if (!ref.data) return;
    const s = ref.data.settings;
    if (isNew) {
      const cid = params.get('customer');
      const c = ref.data.customers.find((x) => x.id === cid);
      setForm({ customer_id: cid, issue_date: today(), due_date: addDays(today(), c?.payment_terms_days ?? s.invoice_due_days), customer_reference: '', discount_percent: 0, terms: s.invoice_terms, notes: '', restock: true });
      setLines([]);
      setDirty(false);
    } else if (doc.data) {
      const i = doc.data.inv;
      setForm({ customer_id: i.customer_id, issue_date: i.issue_date, due_date: i.due_date ?? '', customer_reference: i.customer_reference, discount_percent: Number(i.discount_percent), terms: i.terms, notes: i.notes, restock: i.restock });
      setLines(doc.data.items);
      setDirty(false);
    }
  }, [ref.data, doc.data, isNew, params]);

  if (ref.error || doc.error) return <ErrorBox message={ref.error ?? doc.error ?? ''} onRetry={() => { void ref.reload(); void doc.reload(); }} />;
  if (!ref.data || !form || (!isNew && !doc.data)) return <LoadingBlock />;

  const { settings, vatRates, customers, products } = ref.data;
  const inv = doc.data?.inv ?? null;
  const credit = inv?.kind === 'credit_note';
  const customer = customers.find((c) => c.id === form.customer_id) ?? null;
  const editable = isNew ? can('invoices.create') : inv!.status === 'draft' && can('invoices.edit|invoices.create');
  const saved = !isNew && !dirty;
  const stamp = isNew ? (settings.apply_fiscal_stamp ? Number(settings.fiscal_stamp) : 0) : Number(inv!.fiscal_stamp ?? 0);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm({ ...form, [k]: v }); setDirty(true); };
  const map = credit ? CREDIT_NOTE_STATUS : INVOICE_STATUS;

  const save = async () => {
    if (!form.customer_id) return setError('Sélectionnez un client.');
    if (!credit && form.due_date && form.due_date < form.issue_date) return setError('L’échéance doit être postérieure à la date de facture.');
    const le = validateLines(lines);
    if (le) return setError(le);
    setBusy('save'); setError(null);
    const header = {
      customer_id: form.customer_id, issue_date: form.issue_date, due_date: credit ? null : form.due_date || null, customer_reference: form.customer_reference.trim(),
      discount_percent: form.discount_percent, terms: form.terms, notes: form.notes, restock: form.restock,
    };
    try {
      if (isNew) {
        const created = unwrap(await sb().from('invoices').insert(header).select('id').single()) as { id: string };
        await saveLines('invoice_items', 'invoice_id', created.id, lines, []);
        toast('Facture brouillon créée');
        navigate(`/admin/invoices/${created.id}`, { replace: true });
      } else {
        unwrap(await sb().from('invoices').update(header).eq('id', id));
        await saveLines('invoice_items', 'invoice_id', id, lines, doc.data!.items.map((l) => l.id));
        toast('Brouillon enregistré');
        await doc.reload();
      }
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };

  /** Runs a workflow action; errors are shown on the page (or re-thrown for dialogs that display them). */
  const run = async (key: string, fn: () => Promise<unknown>, ok: string, after?: (r: unknown) => void, rethrow = false) => {
    setBusy(key); setError(null);
    try { const r = await fn(); toast(ok); if (after) after(r); else await doc.reload(); }
    catch (e) { if (rethrow) throw e; setError(errMsg(e)); }
    finally { setBusy(null); }
  };

  const pdf = () => invoiceDoc(inv!, doc.data!.items, customer!, doc.data!.original);
  const btn = 'btn !min-h-[40px] !px-4 !text-[11px]';
  const title = credit ? 'Avoir' : 'Facture';

  return (
    <>
      <Link to="/admin/invoices" className="btn-link mb-4 !text-[11px]"><ArrowLeft className="h-3.5 w-3.5" /> Factures</Link>
      <PageHeader title={isNew ? 'Nouvelle facture' : `${title} ${inv!.number ?? '(brouillon)'}`}
        subtitle={isNew ? 'Brouillon modifiable ; le numéro légal est attribué à la validation.' : inv!.status === 'draft' ? 'Brouillon : modifiable jusqu’à la validation.' : `Validée le ${fmtDate(inv!.validated_at)}${inv!.sent_at ? ` · envoyée le ${fmtDate(inv!.sent_at)}` : ''} · document non modifiable`}
        actions={inv && <StatusBadge map={map} value={inv.status} />} />
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}

      {credit && doc.data!.original && (
        <p className="mb-4 border-l-[3px] border-amber-500 bg-amber-50 px-4 py-3 text-sm text-navy">
          Avoir sur la facture <Link className="font-semibold underline" to={`/admin/invoices/${doc.data!.original.id}`}>{doc.data!.original.number}</Link>{inv!.reason && <> — motif : {inv!.reason}</>}
        </p>
      )}

      {saved && inv && (
        <div className="mb-6 flex flex-wrap gap-2 border border-navy/10 bg-white p-3">
          {inv.status === 'draft' ? <>
            {can('invoices.validate') && <button className={`${btn} btn-red`} disabled={!!busy || !lines.length} onClick={() => setModal('validate')}><CheckCircle2 className="h-4 w-4" /> Valider {credit ? 'l’avoir' : 'la facture'}</button>}
            <button className={`${btn} btn-ghost`} disabled={!!busy} onClick={() => run('pdf', () => generateAndDownload({ doc: pdf(), settings, docType: credit ? 'credit_note' : 'invoice', entityType: 'invoices', entityId: inv.id, archive: false }), 'Aperçu généré', () => undefined)}><FileDown className="h-4 w-4" /> Aperçu PDF</button>
            {can('invoices.delete') && <button className={`${btn} btn-ghost ml-auto hover:!border-brand-red hover:!bg-brand-red`} disabled={!!busy} onClick={() => setModal('delete')}><Trash2 className="h-4 w-4" /> Supprimer le brouillon</button>}
          </> : <>
            <button className={`${btn} btn-ghost`} disabled={!!busy} onClick={() => run('pdf', () => generateAndDownload({ doc: pdf(), settings, docType: credit ? 'credit_note' : 'invoice', entityType: 'invoices', entityId: inv.id, archive: can('documents.create') }), 'PDF généré', () => undefined)}>{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} PDF</button>
            <button className={`${btn} btn-ghost`} disabled={!!busy} onClick={() => run('print', async () => {
              const bytes = await renderPdf(pdf(), settings);
              const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
              const w = window.open(url, '_blank');
              if (w) setTimeout(() => { try { w.print(); } catch { /* user prints from the viewer */ } }, 800);
            }, 'Document ouvert pour impression', () => undefined)}><Printer className="h-4 w-4" /> Imprimer</button>
            {can('invoices.send') && <button className={`${btn} btn-navy`} disabled={!!busy} onClick={() => setModal('email')}><Mail className="h-4 w-4" /> Envoyer par e-mail</button>}
            {!credit && can('payments.create') && Number(inv.balance_due) > 0 && <button className={`${btn} btn-red`} onClick={() => navigate(`/admin/payments?new=1&customer=${inv.customer_id}&invoice=${inv.id}`)}><Wallet className="h-4 w-4" /> Enregistrer un paiement</button>}
            {!credit && can('deliveries.create') && inv.status !== 'cancelled' && <button className={`${btn} btn-ghost`} disabled={!!busy} onClick={() => run('bl', () => rpc<string>('create_delivery_note', { p_source_type: 'invoice', p_source_id: inv.id }), 'Bon de livraison créé', (bid) => navigate(`/admin/deliveries/${bid as string}`))}><Truck className="h-4 w-4" /> Bon de livraison</button>}
            {!credit && can('invoices.cancel') && inv.status !== 'cancelled' && <>
              <button className={`${btn} btn-ghost`} disabled={!!busy} onClick={() => setModal('credit')}><FileMinus2 className="h-4 w-4" /> Créer un avoir</button>
              {Number(inv.amount_paid) === 0 && Number(inv.amount_credited) === 0 && <button className={`${btn} btn-ghost ml-auto hover:!border-brand-red hover:!bg-brand-red`} disabled={!!busy} onClick={() => setModal('cancel')}><Ban className="h-4 w-4" /> Annuler la facture</button>}
            </>}
          </>}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Section title="Client & dates">
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label="Client" required className="md:col-span-2">
                <SearchSelect value={form.customer_id} disabled={!editable || credit} placeholder="Choisir un client…"
                  onChange={(v) => {
                    const c = customers.find((x) => x.id === v);
                    setForm({ ...form, customer_id: v, due_date: c ? addDays(form.issue_date, c.payment_terms_days) : form.due_date });
                    setDirty(true);
                  }}
                  options={customers.filter((c) => c.is_active || c.id === form.customer_id).map((c) => ({ value: c.id, label: `${c.name} (${c.code})`, hint: [c.city, c.tax_id].filter(Boolean).join(' · ') }))} />
              </Field>
              <Field label={credit ? 'Date de l’avoir' : 'Date de facture'}><input type="date" className="field !min-h-[42px] !py-2" disabled={!editable} value={form.issue_date} onChange={(e) => set('issue_date', e.target.value)} /></Field>
              {!credit && <Field label="Échéance"><input type="date" className="field !min-h-[42px] !py-2" disabled={!editable} value={form.due_date} onChange={(e) => set('due_date', e.target.value)} /></Field>}
              <Field label="Référence / bon de commande client" className={credit ? '' : 'md:col-span-2'}><TextInput value={form.customer_reference} disabled={!editable} onChange={(v) => set('customer_reference', v)} /></Field>
              {credit && settings.stock_exit_on === 'invoice' && <div className="flex items-end pb-2"><Check checked={form.restock} onChange={(v) => editable && set('restock', v)} label="Remettre les articles en stock" /></div>}
              {customer?.vat_exempt && <p className="md:col-span-2"><Pill tone="amber">Client exonéré de TVA</Pill></p>}
            </div>
          </Section>

          <Section title={`Lignes (${lines.length})`}>
            <div className="p-4">
              <LinesEditor lines={lines} onChange={(l) => { setLines(l); setDirty(true); }} products={products} vatRates={vatRates} readOnly={!editable}
                price="sale" defaultVat={Number(settings.default_vat_rate)} vatExempt={customer?.vat_exempt} />
            </div>
          </Section>

          <Section title="Conditions & observations">
            <div className="grid gap-4 p-5">
              <Field label="Conditions (imprimées)"><TextArea value={form.terms} disabled={!editable} onChange={(v) => set('terms', v)} /></Field>
              <Field label="Observations (imprimées)"><TextArea value={form.notes} disabled={!editable} onChange={(v) => set('notes', v)} rows={2} /></Field>
            </div>
          </Section>

          {inv && inv.status !== 'draft' && !credit && (
            <Section title="Règlements & avoirs">
              <DataTable minWidth={520} rows={[
                ...doc.data!.allocations.map((a) => ({ id: a.id, label: `Paiement ${a.payment?.number ?? ''}${a.payment?.reference ? ` (${a.payment.reference})` : ''}`, date: a.payment?.payment_date ?? a.created_at, amount: Number(a.amount), cancelled: a.payment?.status === 'cancelled', to: `/admin/payments?open=${a.payment?.id ?? ''}` })),
                ...doc.data!.credits.map((c) => ({ id: c.id, label: `Avoir ${c.number ?? '(brouillon)'}`, date: c.issue_date, amount: Number(c.total_ttc), cancelled: c.status === 'draft', to: `/admin/invoices/${c.id}` })),
              ]} onRowClick={(r) => navigate(r.to)} empty={<p className="px-4 py-6 text-center text-sm text-navy/50">Aucun règlement pour le moment.</p>} columns={[
                { key: 'l', header: 'Opération', render: (r) => <span className={r.cancelled ? 'text-navy/40 line-through' : 'text-navy'}>{r.label}</span> },
                { key: 'd', header: 'Date', render: (r) => fmtDate(r.date) },
                { key: 'a', header: 'Montant', align: 'right', render: (r) => <span className="tabular-nums">{money(r.amount)}</span> },
              ]} />
            </Section>
          )}
        </div>

        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <TotalsPanel lines={lines} discountPercent={form.discount_percent} onDiscount={(v) => set('discount_percent', v)} readOnly={!editable}
            stamp={stamp} server={saved && inv ? inv : null}
            extra={inv && !credit && inv.status !== 'draft' ? (
              <div className="mt-3 space-y-1 border-t border-navy/10 pt-3 text-sm">
                <div className="flex justify-between text-navy/70"><span>Payé</span><span className="tabular-nums">{money(inv.amount_paid)}</span></div>
                {Number(inv.amount_credited) > 0 && <div className="flex justify-between text-navy/70"><span>Avoirs</span><span className="tabular-nums">{money(inv.amount_credited)}</span></div>}
                <div className="flex justify-between font-bold text-brand-red"><span>Reste à payer</span><span className="tabular-nums">{money(inv.balance_due)}</span></div>
              </div>
            ) : undefined} />
          {editable && (
            <button className="btn btn-red w-full" disabled={busy === 'save' || (!dirty && !isNew)} onClick={save}>
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {isNew ? 'Créer le brouillon' : dirty ? 'Enregistrer le brouillon' : 'Enregistré'}
            </button>
          )}
          {dirty && !isNew && <p className="text-center text-xs text-amber-700">Modifications non enregistrées.</p>}
          {customer && <Section title="Client"><KeyValues items={[['Client', <Link className="underline" to={`/admin/customers/${customer.id}`}>{customer.name}</Link>], ['Matricule fiscal', (inv?.customer_snapshot?.tax_id as string | undefined) ?? customer.tax_id], ['E-mail', customer.email]]} /></Section>}
          {!isNew && can('documents.view') && <Section title="Documents"><div className="p-4"><DocumentsPanel compact entityType="invoices" entityId={id} docType={credit ? 'credit_note' : 'invoice'} /></div></Section>}
        </div>
      </div>

      <ConfirmModal open={modal === 'validate'} title={`Valider ${credit ? 'l’avoir' : 'la facture'}`} confirmLabel="Valider définitivement" onClose={() => setModal(null)}
        message={<div className="space-y-2">
          <p>Un numéro légal sera attribué ({credit ? 'AV' : 'FAC'}-…) et le document ne pourra plus être modifié.</p>
          {settings.stock_exit_on === 'invoice' && (!credit || form.restock) && <p>Le stock des articles suivis sera {credit ? 'réincrémenté' : 'décrémenté'}.</p>}
          <p className="font-semibold">Total TTC : {money(inv?.total_ttc ?? 0)}</p>
        </div>}
        onConfirm={() => run('validate', () => rpc<string>('validate_invoice', { p_id: id }), 'Document validé', undefined, true)} />
      <ConfirmModal open={modal === 'delete'} danger title="Supprimer le brouillon" confirmLabel="Supprimer" onClose={() => setModal(null)}
        message="Ce brouillon n’a pas de numéro légal : il peut être supprimé."
        onConfirm={async () => { unwrap(await sb().from('invoices').delete().eq('id', id)); toast('Brouillon supprimé'); navigate('/admin/invoices'); }} />
      <ConfirmModal open={modal === 'cancel'} danger title="Annuler la facture" confirmLabel="Annuler par avoir" reasonLabel="Motif d’annulation" onClose={() => setModal(null)}
        message={<>La facture {inv?.number} sera annulée par un avoir total, validé automatiquement (traçabilité conservée).</>}
        onConfirm={(reason) => run('cancel', () => rpc<string>('cancel_invoice', { p_invoice_id: id, p_reason: reason }), 'Facture annulée par avoir', undefined, true)} />
      <CreditNoteModal open={modal === 'credit'} onClose={() => setModal(null)}
        onCreate={(reason, full) => run('credit', () => rpc<string>('create_credit_note', { p_invoice_id: id, p_reason: reason, p_full: full }), 'Avoir brouillon créé', (cid) => navigate(`/admin/invoices/${cid as string}`), true)} />

      {inv && customer && (
        <EmailDialog open={modal === 'email'} onClose={() => setModal(null)} entityType="invoices" entityId={inv.id} permission="invoices.send"
          draft={{ to: customer.email, subject: `${title} ${inv.number} — ULTRA SUPPLY`,
            message: credit
              ? `Bonjour,\n\nVeuillez trouver ci-joint notre avoir ${inv.number} d’un montant de ${money(inv.total_ttc)}.\n\nCordialement,\nL’équipe ULTRA SUPPLY`
              : `Bonjour${customer.contact_name ? ` ${customer.contact_name}` : ''},\n\nVeuillez trouver ci-joint notre facture ${inv.number} d’un montant de ${money(inv.total_ttc)} TTC${inv.due_date ? `, payable avant le ${fmtDate(inv.due_date)}` : ''}.\n\nNous vous remercions de votre confiance.\n\nCordialement,\nL’équipe ULTRA SUPPLY` }}
          prepare={async () => {
            const d = pdf();
            const bytes = await renderPdf(d, settings);
            if (can('documents.create')) void storeDocument({ docType: credit ? 'credit_note' : 'invoice', entityType: 'invoices', entityId: inv.id, title: `${d.title} ${d.number}`, fileName: pdfFileName(d), data: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }) }).catch(() => undefined);
            return { bytes, fileName: pdfFileName(d) };
          }}
          onSent={async () => { await rpc('mark_invoice_sent', { p_id: inv.id }).catch(() => undefined); await doc.reload(); }} />
      )}
    </>
  );
}

function CreditNoteModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (reason: string, full: boolean) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [full, setFull] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason(''); setFull(true); setError(null); } }, [open]);
  return (
    <Modal open={open} title="Créer un avoir" onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[40px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-navy !min-h-[40px]" disabled={busy || !reason.trim()} onClick={async () => { setBusy(true); setError(null); try { await onCreate(reason.trim(), full); onClose(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); } }}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Créer l’avoir brouillon
        </button>
      </>}>
      <div className="space-y-4 text-sm">
        <Field label="Motif" required><TextArea value={reason} onChange={setReason} rows={2} /></Field>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-2"><input type="radio" className="mt-1 accent-navy" checked={full} onChange={() => setFull(true)} /> <span><strong>Avoir total</strong> — reprend toutes les lignes (et le timbre).</span></label>
          <label className="flex cursor-pointer items-start gap-2"><input type="radio" className="mt-1 accent-navy" checked={!full} onChange={() => setFull(false)} /> <span><strong>Avoir partiel</strong> — vous saisissez les lignes à créditer (remise, retour partiel…).</span></label>
        </div>
        <p className="text-navy/60">L’avoir est créé en brouillon : vérifiez-le puis validez-le pour qu’il soit numéroté et imputé sur la facture.</p>
      </div>
    </Modal>
  );
}
