import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, FileDown, FileText, Loader2, Mail, PackageCheck, Plus, Save, Send, Trash2 } from 'lucide-react';
import { Modal, PageHeader, toast } from '@/admin/ui';
import { errMsg, rpc, sb, unwrap } from '../lib/db';
import { loadSettings, loadVatRates, useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { loadErpProducts, loadLines, loadSuppliers, saveLines } from '../lib/data';
import { fmtDate, money, qty, toNum, today } from '../lib/format';
import { CURRENCIES, PURCHASE_STATUS } from '../lib/status';
import { generateAndDownload, pdfFileName, purchaseOrderDoc, renderPdf, storeDocument } from '../lib/documents';
import type { DocLine, ExchangeRate, GoodsReceipt, PurchaseOrder, Supplier } from '../lib/types';
import { ConfirmModal, DataTable, ErrorBox, Field, FilterChips, LoadingBlock, NumberInput, SearchBar, SearchSelect, Section, SelectInput, StatusBadge, TextArea, TextInput } from '../components/ui';
import { LinesEditor, TotalsPanel, validateLines } from '../components/LinesEditor';
import { EmailDialog } from '../components/EmailDialog';
import { DocumentsPanel } from '../components/DocumentsPanel';

type Row = PurchaseOrder & { supplier: Pick<Supplier, 'name'> | null };

export default function PurchasesPage() {
  const { can } = useAccess();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'open' | PurchaseOrder['status']>('open');
  const { data, error, loading, reload } = useAsync(async () =>
    unwrap(await sb().from('purchase_orders').select('*, supplier:suppliers(name)').order('created_at', { ascending: false }).limit(2000)) as Row[], []);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((r) => (status === '' || (status === 'open' ? ['draft', 'sent', 'partially_received'].includes(r.status) : r.status === status))
      && (!n || [r.number, r.supplier?.name, r.supplier_reference].join(' ').toLowerCase().includes(n)));
  }, [data, q, status]);
  return (
    <>
      <PageHeader title="Commandes fournisseurs" subtitle="Achats multi-devises, réceptions partielles et mise à jour du coût moyen."
        actions={can('purchases.create') && <button className="btn btn-red !min-h-[42px]" onClick={() => navigate('/admin/purchases/new')}><Plus className="h-4 w-4" /> Nouveau bon de commande</button>} />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4 xl:flex-row">
          <SearchBar value={q} onChange={setQ} placeholder="N°, fournisseur, référence…" />
          <FilterChips value={status} onChange={setStatus} options={[{ value: 'open', label: 'En cours' }, { value: '', label: 'Tous' },
            ...(['draft', 'sent', 'partially_received', 'received', 'cancelled'] as const).map((s) => ({ value: s, label: PURCHASE_STATUS[s].label }))]} />
        </div>
        <DataTable loading={loading} rows={rows} onRowClick={(r) => navigate(`/admin/purchases/${r.id}`)} columns={[
          { key: 'n', header: 'N°', render: (r) => <span className="font-semibold text-navy">{r.number}</span> },
          { key: 'd', header: 'Date', render: (r) => fmtDate(r.order_date) },
          { key: 's', header: 'Fournisseur', render: (r) => r.supplier?.name },
          { key: 'e', header: 'Livraison prévue', render: (r) => fmtDate(r.expected_date) },
          { key: 'st', header: 'Statut', render: (r) => <StatusBadge map={PURCHASE_STATUS} value={r.status} /> },
          { key: 't', header: 'Total HT', align: 'right', render: (r) => <span className="tabular-nums">{money(r.total_ht, r.currency)}</span> },
          { key: 'tnd', header: '≈ TND', align: 'right', render: (r) => <span className="tabular-nums text-navy/60">{r.currency === 'TND' ? '—' : money(toNum(r.total_ht) * toNum(r.exchange_rate))}</span> },
        ]} />
      </div>
    </>
  );
}

interface Form {
  supplier_id: string | null; order_date: string; expected_date: string; currency: string; exchange_rate: number; discount_percent: number;
  supplier_reference: string; terms: string; notes: string;
}

export function PurchaseOrderEditor() {
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
  const [modal, setModal] = useState<null | 'receive' | 'cancel' | 'delete' | 'email'>(null);

  const ref = useAsync(async () => {
    const [settings, vatRates, suppliers, products, rates] = await Promise.all([
      loadSettings(), loadVatRates(), loadSuppliers(), loadErpProducts(),
      sb().from('exchange_rates').select('*').order('rate_date', { ascending: false }).limit(200).then(unwrap) as Promise<ExchangeRate[]>,
    ]);
    return { settings, vatRates, suppliers, products, rates };
  }, []);
  const doc = useAsync(async () => {
    if (isNew) return null;
    const po = unwrap(await sb().from('purchase_orders').select('*').eq('id', id).single()) as PurchaseOrder;
    const [items, receipts, invoices] = await Promise.all([
      loadLines('purchase_order_items', 'purchase_order_id', id),
      sb().from('goods_receipts').select('*').eq('purchase_order_id', id).order('created_at').then(unwrap) as Promise<GoodsReceipt[]>,
      sb().from('supplier_invoices').select('id,supplier_reference,status,total_ttc,currency').eq('purchase_order_id', id).then(unwrap) as Promise<{ id: string; supplier_reference: string; status: string; total_ttc: number; currency: string }[]>,
    ]);
    return { po, items, receipts, invoices };
  }, [id]);

  const latestRate = (cur: string) => ref.data?.rates.find((r) => r.currency === cur)?.rate ?? null;

  useEffect(() => {
    if (!ref.data) return;
    if (isNew) {
      const sup = ref.data.suppliers.find((s) => s.id === params.get('supplier'));
      const cur = sup?.currency ?? 'TND';
      setForm({ supplier_id: sup?.id ?? null, order_date: today(), expected_date: '', currency: cur, exchange_rate: cur === 'TND' ? 1 : toNum(ref.data.rates.find((r) => r.currency === cur)?.rate ?? 0),
        discount_percent: 0, supplier_reference: '', terms: '', notes: '' });
      setLines([]);
      setDirty(false);
    } else if (doc.data) {
      const p = doc.data.po;
      setForm({ supplier_id: p.supplier_id, order_date: p.order_date, expected_date: p.expected_date ?? '', currency: p.currency, exchange_rate: toNum(p.exchange_rate),
        discount_percent: toNum(p.discount_percent), supplier_reference: p.supplier_reference, terms: p.terms, notes: p.notes });
      setLines(doc.data.items);
      setDirty(false);
    }
  }, [ref.data, doc.data, isNew, params]);

  if (ref.error || doc.error) return <ErrorBox message={ref.error ?? doc.error ?? ''} />;
  if (!ref.data || !form || (!isNew && !doc.data)) return <LoadingBlock />;
  const { settings, vatRates, suppliers, products } = ref.data;
  const po = doc.data?.po ?? null;
  const supplier = suppliers.find((s) => s.id === form.supplier_id) ?? null;
  const editable = isNew ? can('purchases.create') : ['draft', 'sent'].includes(po!.status) && can('purchases.edit') && !doc.data!.items.some((l) => toNum(l.received_quantity) > 0);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm({ ...form, [k]: v }); setDirty(true); };
  const saved = !isNew && !dirty;

  const save = async () => {
    if (!form.supplier_id) return setError('Sélectionnez le fournisseur.');
    if (form.currency !== 'TND' && !(form.exchange_rate > 0)) return setError('Indiquez le taux de change (TND pour 1 ' + form.currency + ').');
    const le = validateLines(lines);
    if (le) return setError(le);
    setBusy('save'); setError(null);
    const header = { supplier_id: form.supplier_id, order_date: form.order_date, expected_date: form.expected_date || null, currency: form.currency,
      exchange_rate: form.currency === 'TND' ? 1 : form.exchange_rate, discount_percent: form.discount_percent, supplier_reference: form.supplier_reference.trim(), terms: form.terms, notes: form.notes };
    try {
      if (isNew) {
        const created = unwrap(await sb().from('purchase_orders').insert(header).select('id').single()) as { id: string };
        await saveLines('purchase_order_items', 'purchase_order_id', created.id, lines, []);
        toast('Bon de commande créé');
        navigate(`/admin/purchases/${created.id}`, { replace: true });
      } else {
        unwrap(await sb().from('purchase_orders').update(header).eq('id', id));
        await saveLines('purchase_order_items', 'purchase_order_id', id, lines, doc.data!.items.map((l) => l.id));
        toast('Bon de commande enregistré');
        await doc.reload();
      }
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setError(null);
    try { await fn(); toast(ok); await doc.reload(); } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };
  const pdf = () => purchaseOrderDoc(po!, doc.data!.items, supplier!);
  const btn = 'btn !min-h-[40px] !px-4 !text-[11px]';

  return (
    <>
      <Link to="/admin/purchases" className="btn-link mb-4 !text-[11px]"><ArrowLeft className="h-3.5 w-3.5" /> Commandes fournisseurs</Link>
      <PageHeader title={isNew ? 'Nouveau bon de commande' : `Bon de commande ${po!.number}`} subtitle={supplier ? `${supplier.name} · ${form.currency}` : undefined}
        actions={po && <StatusBadge map={PURCHASE_STATUS} value={po.status} />} />
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}

      {saved && po && (
        <div className="mb-6 flex flex-wrap gap-2 border border-navy/10 bg-white p-3">
          <button className={`${btn} btn-ghost`} disabled={!!busy} onClick={() => run('pdf', () => generateAndDownload({ doc: pdf(), settings, docType: 'purchase_order', entityType: 'purchase_orders', entityId: po.id, archive: can('documents.create') }), 'PDF généré')}><FileDown className="h-4 w-4" /> PDF</button>
          {po.status === 'draft' && can('purchases.edit') && <button className={`${btn} btn-navy`} disabled={!!busy || !lines.length} onClick={() => run('sent', async () => unwrap(await sb().from('purchase_orders').update({ status: 'sent' }).eq('id', po.id)), 'Commande passée')}><Send className="h-4 w-4" /> Marquer commandé</button>}
          {can('purchases.edit') && supplier?.email && po.status !== 'cancelled' && <button className={`${btn} btn-ghost`} onClick={() => setModal('email')}><Mail className="h-4 w-4" /> Envoyer au fournisseur</button>}
          {['draft', 'sent', 'partially_received'].includes(po.status) && can('purchases.receive') && <button className={`${btn} btn-red`} disabled={!!busy || !lines.length} onClick={() => setModal('receive')}><PackageCheck className="h-4 w-4" /> Réceptionner</button>}
          {can('purchases.create|purchases.edit') && po.status !== 'cancelled' && po.status !== 'draft' && <button className={`${btn} btn-ghost`} onClick={() => navigate(`/admin/supplier-invoices?new=1&po=${po.id}`)}><FileText className="h-4 w-4" /> Saisir la facture fournisseur</button>}
          {['draft', 'sent'].includes(po.status) && can('purchases.edit') && !lines.some((l) => toNum(l.received_quantity) > 0) && <button className={`${btn} btn-ghost`} onClick={() => setModal('cancel')}><Ban className="h-4 w-4" /> Annuler</button>}
          {po.status === 'draft' && can('purchases.delete') && <button className={`${btn} btn-ghost ml-auto hover:!border-brand-red hover:!bg-brand-red`} onClick={() => setModal('delete')}><Trash2 className="h-4 w-4" /> Supprimer</button>}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Section title="Fournisseur & conditions">
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label="Fournisseur" required className="md:col-span-2">
                <SearchSelect value={form.supplier_id} disabled={!editable} placeholder="Choisir…" options={suppliers.filter((s) => s.is_active || s.id === form.supplier_id).map((s) => ({ value: s.id, label: `${s.name} (${s.code})`, hint: `${s.country} · ${s.currency}` }))}
                  onChange={(v) => { const s = suppliers.find((x) => x.id === v); const cur = s?.currency ?? form.currency; setForm({ ...form, supplier_id: v, currency: cur, exchange_rate: cur === 'TND' ? 1 : toNum(latestRate(cur) ?? form.exchange_rate) }); setDirty(true); }} />
              </Field>
              <Field label="Date de commande"><input type="date" className="field !min-h-[42px] !py-2" disabled={!editable} value={form.order_date} onChange={(e) => set('order_date', e.target.value)} /></Field>
              <Field label="Livraison souhaitée"><input type="date" className="field !min-h-[42px] !py-2" disabled={!editable} value={form.expected_date} onChange={(e) => set('expected_date', e.target.value)} /></Field>
              <Field label="Devise">
                <SelectInput value={form.currency} disabled={!editable} onChange={(v) => { setForm({ ...form, currency: v, exchange_rate: v === 'TND' ? 1 : toNum(latestRate(v) ?? 0) }); setDirty(true); }}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </SelectInput>
              </Field>
              <Field label={`Taux : 1 ${form.currency} = … TND`} hint={form.currency !== 'TND' && latestRate(form.currency) ? `Dernier taux enregistré : ${latestRate(form.currency)}` : form.currency !== 'TND' ? 'Aucun taux enregistré (Paramètres → Taux de change).' : undefined}>
                <NumberInput value={form.exchange_rate} disabled={!editable || form.currency === 'TND'} onChange={(v) => set('exchange_rate', v)} />
              </Field>
              <Field label="Référence fournisseur (proforma, offre…)" className="md:col-span-2"><TextInput value={form.supplier_reference} disabled={!editable} onChange={(v) => set('supplier_reference', v)} /></Field>
            </div>
          </Section>
          <Section title={`Lignes (${lines.length})`}>
            <div className="p-4">
              <LinesEditor lines={lines} onChange={(l) => { setLines(l); setDirty(true); }} products={products} vatRates={vatRates} readOnly={!editable}
                price="purchase" currency={form.currency} defaultVat={Number(settings.default_vat_rate)} showReceived={!isNew} priceDivisor={form.currency === 'TND' ? 1 : form.exchange_rate} />
            </div>
          </Section>
          <Section title="Conditions & notes">
            <div className="grid gap-4 p-5">
              <Field label="Conditions (incoterm, paiement, transport…) — imprimées"><TextArea value={form.terms} disabled={!editable} onChange={(v) => set('terms', v)} /></Field>
              <Field label="Notes"><TextArea value={form.notes} disabled={!editable} onChange={(v) => set('notes', v)} rows={2} /></Field>
            </div>
          </Section>
          {!isNew && (doc.data!.receipts.length > 0 || doc.data!.invoices.length > 0) && (
            <Section title="Réceptions & factures">
              <ul className="divide-y divide-navy/10 text-sm">
                {doc.data!.receipts.map((r) => <li key={r.id} className="flex justify-between px-5 py-2.5"><span>Réception <strong>{r.number}</strong>{r.notes && <span className="text-navy/50"> — {r.notes}</span>}</span><span className="text-navy/60">{fmtDate(r.received_date)}</span></li>)}
                {doc.data!.invoices.map((i) => <li key={i.id} className="flex justify-between px-5 py-2.5"><Link className="underline" to="/admin/supplier-invoices">Facture fournisseur {i.supplier_reference}</Link><span className="tabular-nums">{money(i.total_ttc, i.currency)}</span></li>)}
              </ul>
            </Section>
          )}
        </div>
        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <TotalsPanel lines={lines} discountPercent={form.discount_percent} onDiscount={(v) => set('discount_percent', v)} readOnly={!editable} currency={form.currency} server={saved && po ? po : null}
            extra={form.currency !== 'TND' ? <p className="mt-3 border-t border-navy/10 pt-3 text-sm text-navy/60">≈ {money((saved && po ? toNum(po.total_ht) : 0) * form.exchange_rate)} HT au taux {form.exchange_rate}</p> : undefined} />
          {(editable || (isNew && can('purchases.create'))) && (
            <button className="btn btn-red w-full" disabled={busy === 'save' || (!dirty && !isNew)} onClick={save}>{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer</button>
          )}
          {!isNew && can('documents.view') && <Section title="Documents"><div className="p-4"><DocumentsPanel compact entityType="purchase_orders" entityId={id} docType="purchase_order" /></div></Section>}
        </div>
      </div>

      {modal === 'receive' && po && <ReceiveModal po={po} lines={doc.data!.items} onClose={() => setModal(null)} onDone={async () => { setModal(null); await doc.reload(); }} />}
      <ConfirmModal open={modal === 'cancel'} danger title="Annuler la commande" confirmLabel="Annuler la commande" onClose={() => setModal(null)} message="La commande sera marquée annulée (aucune réception enregistrée)."
        onConfirm={async () => { unwrap(await sb().from('purchase_orders').update({ status: 'cancelled' }).eq('id', id)); toast('Commande annulée'); await doc.reload(); }} />
      <ConfirmModal open={modal === 'delete'} danger title="Supprimer le brouillon" confirmLabel="Supprimer" onClose={() => setModal(null)} message="Supprimer ce bon de commande brouillon ?"
        onConfirm={async () => { unwrap(await sb().from('purchase_orders').delete().eq('id', id)); toast('Supprimé'); navigate('/admin/purchases'); }} />
      {po && supplier && (
        <EmailDialog open={modal === 'email'} onClose={() => setModal(null)} entityType="purchase_orders" entityId={po.id} permission="purchases.edit"
          draft={{ to: supplier.email, subject: `Purchase order / Bon de commande ${po.number} — ULTRA SUPPLY`,
            message: `Bonjour${supplier.contact_name ? ` ${supplier.contact_name}` : ''},\n\nVeuillez trouver ci-joint notre bon de commande ${po.number}. Merci de nous confirmer la disponibilité et le délai de livraison.\n\nCordialement,\nULTRA SUPPLY` }}
          prepare={async () => {
            const d = pdf();
            const bytes = await renderPdf(d, settings);
            if (can('documents.create')) void storeDocument({ docType: 'purchase_order', entityType: 'purchase_orders', entityId: po.id, title: `${d.title} ${d.number}`, fileName: pdfFileName(d), data: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }) }).catch(() => undefined);
            return { bytes, fileName: pdfFileName(d) };
          }}
          onSent={async () => { if (po.status === 'draft') await sb().from('purchase_orders').update({ status: 'sent' }).eq('id', po.id); await doc.reload(); }} />
      )}
    </>
  );
}

function ReceiveModal({ po, lines, onClose, onDone }: { po: PurchaseOrder; lines: DocLine[]; onClose: () => void; onDone: () => Promise<void> }) {
  const open = lines.filter((l) => toNum(l.quantity) - toNum(l.received_quantity) > 0);
  const [q, setQ] = useState<Record<string, number>>(() => Object.fromEntries(open.map((l) => [l.id, toNum(l.quantity) - toNum(l.received_quantity)])));
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const payload = open.filter((l) => toNum(q[l.id]) > 0).map((l) => ({ item_id: l.id, quantity: toNum(q[l.id]) }));
    if (!payload.length) return setError('Saisissez au moins une quantité reçue.');
    setBusy(true); setError(null);
    try {
      await rpc('receive_purchase_order', { p_po_id: po.id, p_lines: payload, p_date: date, p_notes: notes });
      toast('Réception enregistrée — stock et coût moyen mis à jour');
      await onDone();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open wide title={`Réception — ${po.number}`} onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[42px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={submit}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Valider la réception</button>
      </>}>
      <div className="space-y-4">
        <p className="text-sm text-navy/65">Le stock des articles suivis est augmenté et leur coût moyen pondéré recalculé (prix d’achat × taux {po.exchange_rate}).</p>
        <div className="border border-navy/10">
          {open.map((l) => (
            <div key={l.id} className="grid grid-cols-12 items-center gap-3 border-b border-navy/10 px-4 py-2.5 text-sm last:border-0">
              <div className="col-span-6"><p className="text-navy">{l.description}</p><p className="font-mono text-xs text-navy/50">{l.reference}</p></div>
              <div className="col-span-3 text-right text-xs text-navy/60">Commandé {qty(l.quantity)} · reçu {qty(l.received_quantity)}</div>
              <div className="col-span-3"><NumberInput value={q[l.id] ?? 0} onChange={(v) => setQ({ ...q, [l.id]: Math.max(0, Math.min(v, toNum(l.quantity) - toNum(l.received_quantity))) })} /></div>
            </div>
          ))}
          {!open.length && <p className="px-4 py-6 text-center text-sm text-navy/50">Tout a déjà été reçu.</p>}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Date de réception"><input type="date" className="field !min-h-[42px] !py-2" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Notes (BL fournisseur, réserves…)"><TextInput value={notes} onChange={setNotes} /></Field>
        </div>
      </div>
    </Modal>
  );
}
