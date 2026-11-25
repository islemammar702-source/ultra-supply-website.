import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Check as CheckIcon, ClipboardList, Copy, Download, FileDown, Loader2, Mail, Plus, Receipt, RotateCcw, Save, Send, Trash2, X,
} from 'lucide-react';
import { PageHeader, toast } from '@/admin/ui';
import { errMsg, rpc, sb, unwrap } from '../lib/db';
import { loadSettings, loadVatRates, useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { loadCustomers, loadErpProducts, loadLines, saveLines } from '../lib/data';
import { addDays, csvDownload, fmtDate, money, today } from '../lib/format';
import { INVOICE_STATUS, ORDER_STATUS, QUOTATION_STATUS } from '../lib/status';
import { generateAndDownload, quotationDoc, renderPdf, pdfFileName, storeDocument } from '../lib/documents';
import type { Customer, DocLine, Quotation } from '../lib/types';
import { ConfirmModal, DataTable, ErrorBox, Field, FilterChips, LoadingBlock, Pill, SearchBar, SearchSelect, Section, StatusBadge, TextArea, TextInput } from '../components/ui';
import { LinesEditor, TotalsPanel, validateLines } from '../components/LinesEditor';
import { EmailDialog } from '../components/EmailDialog';
import { DocumentsPanel } from '../components/DocumentsPanel';

type Row = Quotation & { customer: Pick<Customer, 'name' | 'code'> | null };

export default function QuotationsPage() {
  const { can } = useAccess();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const status = (params.get('status') ?? '') as '' | 'pending' | Quotation['status'];
  const { data, error, loading, reload } = useAsync(async () => {
    await rpc('expire_quotations').catch(() => 0);
    return unwrap(await sb().from('quotations').select('*, customer:customers(name,code)').order('created_at', { ascending: false }).limit(2000)) as Row[];
  }, []);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((r) => (status === '' || (status === 'pending' ? ['draft', 'sent'].includes(r.status) : r.status === status))
      && (!n || [r.number, r.customer?.name, r.customer?.code, r.customer_reference].join(' ').toLowerCase().includes(n)));
  }, [data, q, status]);
  const count = (s: string) => (data ?? []).filter((r) => (s === 'pending' ? ['draft', 'sent'].includes(r.status) : r.status === s)).length;

  return (
    <>
      <PageHeader title="Devis" subtitle="Création, envoi, suivi et transformation en commande ou facture."
        actions={<>
          <button className="btn btn-ghost !min-h-[42px]" disabled={!rows.length} onClick={() => csvDownload(`devis-${today()}.csv`, ['N°', 'Date', 'Client', 'Validité', 'Statut', 'Total HT', 'Total TTC'],
            rows.map((r) => [r.number, r.issue_date, r.customer?.name ?? '', r.valid_until, QUOTATION_STATUS[r.status].label, Number(r.total_ht), Number(r.total_ttc)]))}><Download className="h-4 w-4" /> CSV</button>
          {can('quotations.create') && <button className="btn btn-red !min-h-[42px]" onClick={() => navigate('/admin/quotations/new')}><Plus className="h-4 w-4" /> Nouveau devis</button>}
        </>} />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4 xl:flex-row">
          <SearchBar value={q} onChange={setQ} placeholder="N°, client, référence client…" />
          <FilterChips value={status} onChange={(v) => setParams(v ? { status: v } : {})} options={[
            { value: '', label: 'Tous', count: data?.length }, { value: 'pending', label: 'En attente', count: count('pending') },
            ...(['draft', 'sent', 'accepted', 'rejected', 'expired'] as const).map((s) => ({ value: s, label: QUOTATION_STATUS[s].label, count: count(s) })),
          ]} />
        </div>
        <DataTable loading={loading} rows={rows} onRowClick={(r) => navigate(`/admin/quotations/${r.id}`)} columns={[
          { key: 'n', header: 'N°', render: (r) => <span className="font-semibold text-navy">{r.number}</span> },
          { key: 'd', header: 'Date', render: (r) => fmtDate(r.issue_date) },
          { key: 'c', header: 'Client', render: (r) => <span className="text-navy">{r.customer?.name}</span> },
          { key: 'v', header: 'Validité', render: (r) => <span className={r.status === 'sent' && r.valid_until < today() ? 'text-brand-red' : ''}>{fmtDate(r.valid_until)}</span> },
          { key: 's', header: 'Statut', render: (r) => <StatusBadge map={QUOTATION_STATUS} value={r.status} /> },
          { key: 'ht', header: 'Total HT', align: 'right', render: (r) => <span className="tabular-nums">{money(r.total_ht, r.currency)}</span> },
          { key: 'ttc', header: 'Total TTC', align: 'right', render: (r) => <span className="font-semibold tabular-nums">{money(r.total_ttc, r.currency)}</span> },
        ]} />
      </div>
    </>
  );
}

interface Form {
  customer_id: string | null; issue_date: string; valid_until: string; customer_reference: string; discount_percent: number;
  terms: string; notes: string; internal_notes: string;
}

export function QuotationEditor() {
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
  const [confirm, setConfirm] = useState<null | 'delete' | 'reject'>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  const ref = useAsync(async () => {
    const [settings, vatRates, customers, products] = await Promise.all([loadSettings(), loadVatRates(), loadCustomers(), loadErpProducts()]);
    return { settings, vatRates, customers, products };
  }, []);
  const doc = useAsync(async () => {
    if (isNew) return null;
    const q = unwrap(await sb().from('quotations').select('*').eq('id', id).single()) as Quotation;
    const [items, order, invoices] = await Promise.all([
      loadLines('quotation_items', 'quotation_id', id),
      sb().from('orders').select('id,number,status').eq('quotation_id', id).maybeSingle().then(unwrap) as Promise<{ id: string; number: string; status: string } | null>,
      can('invoices.view') ? sb().from('invoices').select('id,number,status,kind').eq('quotation_id', id).then(unwrap) as Promise<{ id: string; number: string | null; status: string; kind: string }[]> : Promise.resolve([]),
    ]);
    return { q, items, order, invoices };
  }, [id]);

  useEffect(() => {
    if (!ref.data) return;
    if (isNew) {
      const s = ref.data.settings;
      setForm({ customer_id: params.get('customer'), issue_date: today(), valid_until: addDays(today(), s.quotation_validity_days), customer_reference: '',
        discount_percent: 0, terms: s.quotation_terms, notes: '', internal_notes: '' });
      setLines([]);
      setDirty(false);
    } else if (doc.data) {
      const q = doc.data.q;
      setForm({ customer_id: q.customer_id, issue_date: q.issue_date, valid_until: q.valid_until, customer_reference: q.customer_reference,
        discount_percent: Number(q.discount_percent), terms: q.terms, notes: q.notes, internal_notes: q.internal_notes });
      setLines(doc.data.items);
      setDirty(false);
    }
  }, [ref.data, doc.data, isNew, params]);

  if (ref.error || doc.error) return <ErrorBox message={ref.error ?? doc.error ?? ''} onRetry={() => { void ref.reload(); void doc.reload(); }} />;
  if (!ref.data || !form || (!isNew && !doc.data)) return <LoadingBlock />;

  const { settings, vatRates, customers, products } = ref.data;
  const q = doc.data?.q ?? null;
  const customer = customers.find((c) => c.id === form.customer_id) ?? null;
  const editable = isNew ? can('quotations.create') : can('quotations.edit') && ['draft', 'sent', 'expired'].includes(q!.status);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm({ ...form, [k]: v }); setDirty(true); };

  const save = async () => {
    if (!form.customer_id) return setError('Sélectionnez un client.');
    if (form.valid_until < form.issue_date) return setError('La date de validité doit être postérieure à la date du devis.');
    const le = validateLines(lines);
    if (le) return setError(le);
    setBusy('save'); setError(null);
    const header = {
      customer_id: form.customer_id, issue_date: form.issue_date, valid_until: form.valid_until, customer_reference: form.customer_reference.trim(),
      discount_percent: form.discount_percent, terms: form.terms, notes: form.notes, internal_notes: form.internal_notes,
    };
    try {
      if (isNew) {
        const created = unwrap(await sb().from('quotations').insert(header).select('id').single()) as { id: string };
        await saveLines('quotation_items', 'quotation_id', created.id, lines, []);
        toast('Devis créé');
        navigate(`/admin/quotations/${created.id}`, { replace: true });
      } else {
        unwrap(await sb().from('quotations').update(header).eq('id', id));
        await saveLines('quotation_items', 'quotation_id', id, lines, doc.data!.items.map((l) => l.id));
        toast('Devis enregistré');
        await doc.reload();
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const act = async (key: string, fn: () => Promise<unknown>, success: string, after?: (r: unknown) => void) => {
    setBusy(key); setError(null);
    try {
      const r = await fn();
      toast(success);
      if (after) after(r); else await doc.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const pdf = () => quotationDoc(q!, doc.data!.items, customer!);
  const downloadPdf = () => act('pdf', () => generateAndDownload({ doc: pdf(), settings, docType: 'quotation', entityType: 'quotations', entityId: q!.id, archive: can('documents.create') }), 'PDF généré', () => undefined);

  const saved = !isNew && !dirty;
  const btn = 'btn !min-h-[40px] !px-4 !text-[11px]';

  return (
    <>
      <Link to="/admin/quotations" className="btn-link mb-4 !text-[11px]"><ArrowLeft className="h-3.5 w-3.5" /> Devis</Link>
      <PageHeader title={isNew ? 'Nouveau devis' : `Devis ${q!.number}`}
        subtitle={isNew ? 'Le numéro est attribué automatiquement à l’enregistrement.' : `Créé le ${fmtDate(q!.created_at)}${q!.sent_at ? ` · envoyé le ${fmtDate(q!.sent_at)}` : ''}${q!.accepted_at ? ` · accepté le ${fmtDate(q!.accepted_at)}` : ''}`}
        actions={q && <StatusBadge map={QUOTATION_STATUS} value={q.status} />} />

      {error && <div className="mb-4"><ErrorBox message={error} /></div>}

      {saved && q && (
        <div className="mb-6 flex flex-wrap gap-2 border border-navy/10 bg-white p-3">
          <button className={`${btn} btn-ghost`} disabled={!!busy} onClick={downloadPdf}>{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} PDF</button>
          {can('quotations.send') && ['draft', 'sent', 'expired'].includes(q.status) && <>
            <button className={`${btn} btn-navy`} disabled={!!busy || !lines.length} onClick={() => setEmailOpen(true)}><Mail className="h-4 w-4" /> Envoyer par e-mail</button>
            {q.status !== 'sent' && <button className={`${btn} btn-ghost`} disabled={!!busy || !lines.length} onClick={() => act('sent', () => rpc('set_quotation_status', { p_id: q.id, p_status: 'sent' }), 'Devis marqué comme envoyé')}><Send className="h-4 w-4" /> Marquer envoyé</button>}
          </>}
          {can('quotations.edit') && ['draft', 'sent'].includes(q.status) && <>
            <button className={`${btn} btn-ghost !border-emerald-600 !text-emerald-700 hover:!bg-emerald-600 hover:!text-white`} disabled={!!busy || !lines.length} onClick={() => act('acc', () => rpc('set_quotation_status', { p_id: q.id, p_status: 'accepted' }), 'Devis accepté')}><CheckIcon className="h-4 w-4" /> Accepté</button>
            <button className={`${btn} btn-ghost`} disabled={!!busy} onClick={() => setConfirm('reject')}><X className="h-4 w-4" /> Refusé</button>
          </>}
          {can('quotations.edit') && ['rejected', 'expired'].includes(q.status) && (
            <button className={`${btn} btn-ghost`} disabled={!!busy} onClick={() => act('reopen', () => rpc('set_quotation_status', { p_id: q.id, p_status: 'draft' }), 'Devis rouvert')}><RotateCcw className="h-4 w-4" /> Rouvrir</button>
          )}
          {q.status === 'accepted' && <>
            {can('orders.create') && !doc.data!.order && <button className={`${btn} btn-navy`} disabled={!!busy} onClick={() => act('order', () => rpc<string>('convert_quotation_to_order', { p_id: q.id, p_customer_reference: q.customer_reference }), 'Commande créée', (oid) => navigate(`/admin/orders/${oid as string}`))}><ClipboardList className="h-4 w-4" /> Créer la commande</button>}
            {can('invoices.create') && !doc.data!.invoices.some((i) => i.kind === 'invoice' && i.status !== 'cancelled') && <button className={`${btn} btn-red`} disabled={!!busy} onClick={() => act('inv', () => rpc<string>('convert_quotation_to_invoice', { p_id: q.id }), 'Facture brouillon créée', (iid) => navigate(`/admin/invoices/${iid as string}`))}><Receipt className="h-4 w-4" /> Facturer</button>}
          </>}
          {can('quotations.create') && <button className={`${btn} btn-ghost`} disabled={!!busy} onClick={() => act('dup', () => rpc<string>('duplicate_quotation', { p_id: q.id }), 'Devis dupliqué', (nid) => navigate(`/admin/quotations/${nid as string}`))}><Copy className="h-4 w-4" /> Dupliquer</button>}
          {can('quotations.delete') && q.status === 'draft' && <button className={`${btn} btn-ghost ml-auto hover:!border-brand-red hover:!bg-brand-red`} disabled={!!busy} onClick={() => setConfirm('delete')}><Trash2 className="h-4 w-4" /> Supprimer</button>}
        </div>
      )}

      {!isNew && (doc.data!.order || doc.data!.invoices.length > 0) && (
        <div className="mb-6 flex flex-wrap gap-3 text-sm">
          {doc.data!.order && <Link to={`/admin/orders/${doc.data!.order.id}`} className="flex items-center gap-2 border border-navy/10 bg-white px-3 py-2 hover:border-navy">Commande <strong>{doc.data!.order.number}</strong> <StatusBadge map={ORDER_STATUS} value={doc.data!.order.status} /></Link>}
          {doc.data!.invoices.map((i) => <Link key={i.id} to={`/admin/invoices/${i.id}`} className="flex items-center gap-2 border border-navy/10 bg-white px-3 py-2 hover:border-navy">{i.kind === 'credit_note' ? 'Avoir' : 'Facture'} <strong>{i.number ?? 'brouillon'}</strong> <StatusBadge map={INVOICE_STATUS} value={i.status} /></Link>)}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Section title="Client & dates">
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label="Client" required className="md:col-span-2">
                <SearchSelect value={form.customer_id} disabled={!editable} onChange={(v) => set('customer_id', v)} placeholder="Choisir un client…"
                  options={customers.filter((c) => c.is_active || c.id === form.customer_id).map((c) => ({ value: c.id, label: `${c.name} (${c.code})`, hint: [c.city, c.phone, c.tax_id].filter(Boolean).join(' · ') }))} />
                {can('customers.create') && editable && <Link to="/admin/customers" className="mt-1 inline-block text-xs text-navy/60 underline">Créer un client</Link>}
              </Field>
              <Field label="Date du devis"><input type="date" className="field !min-h-[42px] !py-2" disabled={!editable} value={form.issue_date} onChange={(e) => set('issue_date', e.target.value)} /></Field>
              <Field label="Valable jusqu’au"><input type="date" className="field !min-h-[42px] !py-2" disabled={!editable} value={form.valid_until} onChange={(e) => set('valid_until', e.target.value)} /></Field>
              <Field label="Référence client (demande, appel d’offres…)" className="md:col-span-2"><TextInput value={form.customer_reference} disabled={!editable} onChange={(v) => set('customer_reference', v)} /></Field>
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
              <Field label="Conditions commerciales (imprimées)"><TextArea value={form.terms} disabled={!editable} onChange={(v) => set('terms', v)} rows={3} /></Field>
              <Field label="Observations (imprimées)"><TextArea value={form.notes} disabled={!editable} onChange={(v) => set('notes', v)} rows={2} /></Field>
              <Field label="Notes internes (non imprimées)"><TextArea value={form.internal_notes} disabled={!editable} onChange={(v) => set('internal_notes', v)} rows={2} /></Field>
            </div>
          </Section>
        </div>

        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <TotalsPanel lines={lines} discountPercent={form.discount_percent} onDiscount={(v) => set('discount_percent', v)} readOnly={!editable}
            server={saved && q ? q : null} currency={q?.currency ?? 'TND'} />
          {editable && (
            <button className="btn btn-red w-full" disabled={busy === 'save' || (!dirty && !isNew)} onClick={save}>
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {isNew ? 'Créer le devis' : dirty ? 'Enregistrer les modifications' : 'Enregistré'}
            </button>
          )}
          {dirty && !isNew && <p className="text-center text-xs text-amber-700">Modifications non enregistrées.</p>}
          {!isNew && can('documents.view') && <Section title="Documents"><div className="p-4"><DocumentsPanel compact entityType="quotations" entityId={id} docType="quotation" /></div></Section>}
        </div>
      </div>

      {q && customer && (
        <EmailDialog open={emailOpen} onClose={() => setEmailOpen(false)} entityType="quotations" entityId={q.id} permission="quotations.send"
          draft={{ to: customer.email, subject: `Devis ${q.number} — ULTRA SUPPLY`,
            message: `Bonjour${customer.contact_name ? ` ${customer.contact_name}` : ''},\n\nVeuillez trouver ci-joint notre devis ${q.number} d’un montant de ${money(q.total_ttc, q.currency)} TTC, valable jusqu’au ${fmtDate(q.valid_until)}.\n\nNous restons à votre disposition pour tout complément d’information.\n\nCordialement,\nL’équipe ULTRA SUPPLY` }}
          prepare={async () => {
            const d = pdf();
            const bytes = await renderPdf(d, settings);
            if (can('documents.create')) {
              void storeDocument({ docType: 'quotation', entityType: 'quotations', entityId: q.id, title: `${d.title} ${d.number}`, fileName: pdfFileName(d), data: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }) }).catch(() => undefined);
            }
            return { bytes, fileName: pdfFileName(d) };
          }}
          onSent={async () => { if (q.status !== 'sent') await rpc('set_quotation_status', { p_id: q.id, p_status: 'sent' }).catch(() => undefined); await doc.reload(); }} />
      )}

      <ConfirmModal open={confirm === 'delete'} danger title="Supprimer le devis" confirmLabel="Supprimer" onClose={() => setConfirm(null)}
        message={<>Supprimer définitivement le devis brouillon {q?.number} ?</>}
        onConfirm={async () => { unwrap(await sb().from('quotations').delete().eq('id', id)); toast('Devis supprimé'); navigate('/admin/quotations'); }} />
      <ConfirmModal open={confirm === 'reject'} title="Devis refusé" confirmLabel="Marquer refusé" onClose={() => setConfirm(null)}
        message={<>Le client a refusé le devis {q?.number} ? Vous pourrez le rouvrir plus tard si besoin.</>}
        onConfirm={async () => { await rpc('set_quotation_status', { p_id: id, p_status: 'rejected' }); toast('Devis marqué refusé'); await doc.reload(); }} />
    </>
  );
}
