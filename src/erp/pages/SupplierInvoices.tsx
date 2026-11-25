import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, Loader2, Plus, Trash2, Wallet } from 'lucide-react';
import { Modal, PageHeader, toast } from '@/admin/ui';
import { errMsg, sb, unwrap } from '../lib/db';
import { loadPaymentMethods, useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { loadSuppliers } from '../lib/data';
import { addDays, fmtDate, money, toNum, today } from '../lib/format';
import { CURRENCIES, SUPPLIER_INVOICE_STATUS } from '../lib/status';
import type { ExchangeRate, PurchaseOrder, Supplier, SupplierInvoice, SupplierPayment } from '../lib/types';
import { ConfirmModal, DataTable, ErrorBox, Field, FilterChips, KeyValues, NumberInput, SearchBar, SearchSelect, SelectInput, StatusBadge, TextArea, TextInput } from '../components/ui';
import { DocumentsPanel } from '../components/DocumentsPanel';

type Row = SupplierInvoice & { supplier: Pick<Supplier, 'name'> | null };

export default function SupplierInvoicesPage() {
  const { can } = useAccess();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'open' | SupplierInvoice['status']>('open');
  const { data, error, loading, reload } = useAsync(async () =>
    unwrap(await sb().from('supplier_invoices').select('*, supplier:suppliers(name)').order('invoice_date', { ascending: false }).limit(2000)) as Row[], []);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((r) => (status === '' || (status === 'open' ? ['unpaid', 'partially_paid'].includes(r.status) : r.status === status))
      && (!n || [r.supplier_reference, r.supplier?.name].join(' ').toLowerCase().includes(n)));
  }, [data, q, status]);
  const payable = rows.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + (toNum(r.total_ttc) - toNum(r.amount_paid)) * toNum(r.exchange_rate), 0);
  const openId = params.get('open');

  return (
    <>
      <PageHeader title="Factures fournisseurs" subtitle="Suivi des dettes fournisseurs et des règlements (multi-devises)."
        actions={can('purchases.create|purchases.edit') && <button className="btn btn-red !min-h-[42px]" onClick={() => setParams({ new: '1' })}><Plus className="h-4 w-4" /> Saisir une facture</button>} />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4 xl:flex-row">
          <SearchBar value={q} onChange={setQ} placeholder="Référence, fournisseur…" />
          <FilterChips value={status} onChange={setStatus} options={[{ value: 'open', label: 'À payer' }, { value: '', label: 'Toutes' },
            ...(['unpaid', 'partially_paid', 'paid', 'cancelled'] as const).map((s) => ({ value: s, label: SUPPLIER_INVOICE_STATUS[s].label }))]} />
        </div>
        <DataTable loading={loading} rows={rows} onRowClick={(r) => setParams({ open: r.id })}
          footer={<tr><td colSpan={5} className="px-4 py-3 text-right">Reste à payer (≈ TND)</td><td className="px-4 py-3 text-right tabular-nums" colSpan={2}>{money(payable)}</td></tr>}
          columns={[
            { key: 'r', header: 'Réf. fournisseur', render: (r) => <span className="font-semibold text-navy">{r.supplier_reference}</span> },
            { key: 's', header: 'Fournisseur', render: (r) => r.supplier?.name },
            { key: 'd', header: 'Date', render: (r) => fmtDate(r.invoice_date) },
            { key: 'e', header: 'Échéance', render: (r) => <span className={r.due_date && r.due_date < today() && ['unpaid', 'partially_paid'].includes(r.status) ? 'font-semibold text-brand-red' : ''}>{fmtDate(r.due_date)}</span> },
            { key: 'st', header: 'Statut', render: (r) => <StatusBadge map={SUPPLIER_INVOICE_STATUS} value={r.status} /> },
            { key: 't', header: 'Total TTC', align: 'right', render: (r) => <span className="tabular-nums">{money(r.total_ttc, r.currency)}</span> },
            { key: 'p', header: 'Reste', align: 'right', render: (r) => <span className="font-semibold tabular-nums">{money(toNum(r.total_ttc) - toNum(r.amount_paid), r.currency)}</span> },
          ]} />
      </div>
      {params.get('new') === '1' && <SupplierInvoiceForm poId={params.get('po')} onClose={() => setParams({})} onSaved={(id) => { void reload(); setParams({ open: id }); }} />}
      {openId && <SupplierInvoiceDetail id={openId} onClose={() => setParams({})} onChanged={() => void reload()} />}
    </>
  );
}

function SupplierInvoiceForm({ poId, onClose, onSaved }: { poId: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({ supplier_id: null as string | null, purchase_order_id: poId, supplier_reference: '', invoice_date: today(), due_date: '', currency: 'TND', exchange_rate: 1, total_ht: 0, total_vat: 0, total_ttc: 0, notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useAsync(async () => {
    const [suppliers, rates, po] = await Promise.all([
      loadSuppliers(true),
      sb().from('exchange_rates').select('*').order('rate_date', { ascending: false }).limit(100).then(unwrap) as Promise<ExchangeRate[]>,
      poId ? sb().from('purchase_orders').select('*').eq('id', poId).single().then(unwrap) as Promise<PurchaseOrder> : Promise.resolve(null),
    ]);
    if (po) setF((x) => ({ ...x, supplier_id: po.supplier_id, currency: po.currency, exchange_rate: toNum(po.exchange_rate), total_ht: toNum(po.total_ht), total_vat: toNum(po.total_vat), total_ttc: toNum(po.total_ttc) }));
    return { suppliers, rates, po };
  }, [poId]);
  const rateFor = (c: string) => toNum(ref.data?.rates.find((r) => r.currency === c)?.rate ?? 0);
  const submit = async () => {
    if (!f.supplier_id) return setError('Sélectionnez le fournisseur.');
    if (!f.supplier_reference.trim()) return setError('Indiquez le numéro de la facture fournisseur.');
    if (!(f.total_ttc > 0)) return setError('Le montant TTC doit être positif.');
    if (f.currency !== 'TND' && !(f.exchange_rate > 0)) return setError('Indiquez le taux de change.');
    setBusy(true); setError(null);
    try {
      const row = { ...f, supplier_reference: f.supplier_reference.trim(), due_date: f.due_date || null, exchange_rate: f.currency === 'TND' ? 1 : f.exchange_rate };
      const created = unwrap(await sb().from('supplier_invoices').insert(row).select('id').single()) as { id: string };
      toast('Facture fournisseur enregistrée');
      onSaved(created.id);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open wide title="Saisir une facture fournisseur" onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[42px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={submit}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer</button>
      </>}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Fournisseur" required className="md:col-span-2">
          <SearchSelect value={f.supplier_id} disabled={Boolean(ref.data?.po)} placeholder="Choisir…" options={(ref.data?.suppliers ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
            onChange={(v) => { const s = ref.data?.suppliers.find((x) => x.id === v); const c = s?.currency ?? f.currency; setF({ ...f, supplier_id: v, currency: c, exchange_rate: c === 'TND' ? 1 : rateFor(c), due_date: s ? addDays(f.invoice_date, s.payment_terms_days) : f.due_date }); }} />
          {ref.data?.po && <p className="mt-1 text-xs text-navy/60">Liée à la commande {ref.data.po.number}</p>}
        </Field>
        <Field label="N° de facture du fournisseur" required><TextInput value={f.supplier_reference} onChange={(v) => setF({ ...f, supplier_reference: v })} /></Field>
        <Field label="Date de facture"><input type="date" className="field !min-h-[42px] !py-2" value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} /></Field>
        <Field label="Échéance"><input type="date" className="field !min-h-[42px] !py-2" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Devise"><SelectInput value={f.currency} onChange={(v) => setF({ ...f, currency: v, exchange_rate: v === 'TND' ? 1 : rateFor(v) })}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</SelectInput></Field>
          <Field label="Taux (TND)"><NumberInput value={f.exchange_rate} disabled={f.currency === 'TND'} onChange={(v) => setF({ ...f, exchange_rate: v })} /></Field>
        </div>
        <Field label={`Total HT (${f.currency})`}><NumberInput value={f.total_ht} onChange={(v) => setF({ ...f, total_ht: v, total_ttc: Math.round((v + f.total_vat) * 1000) / 1000 })} /></Field>
        <Field label={`TVA (${f.currency})`}><NumberInput value={f.total_vat} onChange={(v) => setF({ ...f, total_vat: v, total_ttc: Math.round((f.total_ht + v) * 1000) / 1000 })} /></Field>
        <Field label={`Total TTC (${f.currency})`} required hint={f.currency !== 'TND' ? `≈ ${money(f.total_ttc * f.exchange_rate)}` : undefined}><NumberInput value={f.total_ttc} onChange={(v) => setF({ ...f, total_ttc: v })} /></Field>
        <Field label="Notes" className="md:col-span-2"><TextArea value={f.notes} onChange={(v) => setF({ ...f, notes: v })} rows={2} /></Field>
      </div>
    </Modal>
  );
}

function SupplierInvoiceDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useAccess();
  const [pay, setPay] = useState<{ amount: number; date: string; method: string; reference: string; rate: number; notes: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'cancel' | { paymentId: string }>(null);
  const methods = useAsync(loadPaymentMethods, []);
  const { data, reload } = useAsync(async () => {
    const inv = unwrap(await sb().from('supplier_invoices').select('*, supplier:suppliers(name,code)').eq('id', id).single()) as SupplierInvoice & { supplier: { name: string; code: string } };
    const payments = unwrap(await sb().from('supplier_payments').select('*').eq('supplier_invoice_id', id).order('payment_date')) as SupplierPayment[];
    return { inv, payments };
  }, [id]);
  if (!data) return <Modal open title="Facture fournisseur" onClose={onClose}><div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div></Modal>;
  const { inv, payments } = data;
  const remaining = toNum(inv.total_ttc) - toNum(inv.amount_paid);

  const savePayment = async () => {
    if (!pay) return;
    if (!(pay.amount > 0) || pay.amount > remaining + 0.0005) return setError(`Montant invalide (reste ${money(remaining, inv.currency)}).`);
    setBusy(true); setError(null);
    try {
      unwrap(await sb().from('supplier_payments').insert({ supplier_invoice_id: inv.id, supplier_id: inv.supplier_id, amount: pay.amount, payment_date: pay.date, method_id: pay.method,
        reference: pay.reference, exchange_rate: inv.currency === 'TND' ? 1 : pay.rate, notes: pay.notes }));
      toast('Paiement fournisseur enregistré');
      setPay(null);
      await reload(); onChanged();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open wide title={`Facture ${inv.supplier_reference} — ${inv.supplier.name}`} onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        {can('purchases.edit') && inv.status === 'unpaid' && <button className="btn btn-ghost !min-h-[40px]" onClick={() => setConfirm('cancel')}><Ban className="h-4 w-4" /> Annuler la facture</button>}
        {can('purchases.edit') && ['unpaid', 'partially_paid'].includes(inv.status) && !pay && (
          <button className="btn btn-red !min-h-[40px]" onClick={() => setPay({ amount: remaining, date: today(), method: methods.data?.find((m) => m.code === 'bank_transfer')?.id ?? methods.data?.[0]?.id ?? '', reference: '', rate: toNum(inv.exchange_rate), notes: '' })}><Wallet className="h-4 w-4" /> Enregistrer un paiement</button>
        )}
      </>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="border border-navy/10">
          <KeyValues items={[
            ['Statut', <StatusBadge map={SUPPLIER_INVOICE_STATUS} value={inv.status} />], ['Date', fmtDate(inv.invoice_date)], ['Échéance', fmtDate(inv.due_date)],
            ['Total HT', money(inv.total_ht, inv.currency)], ['TVA', money(inv.total_vat, inv.currency)], ['Total TTC', <strong>{money(inv.total_ttc, inv.currency)}</strong>],
            ['Taux', inv.currency === 'TND' ? '—' : `1 ${inv.currency} = ${inv.exchange_rate} TND (≈ ${money(toNum(inv.total_ttc) * toNum(inv.exchange_rate))})`],
            ['Payé', money(inv.amount_paid, inv.currency)], ['Reste', <strong className="text-brand-red">{money(remaining, inv.currency)}</strong>], ['Notes', inv.notes],
          ]} />
        </div>
        <div className="space-y-4">
          <div>
            <p className="field-label">Règlements</p>
            <DataTable minWidth={360} rows={payments} empty={<p className="px-4 py-4 text-center text-sm text-navy/50">Aucun règlement.</p>} columns={[
              { key: 'd', header: 'Date', render: (p) => fmtDate(p.payment_date) },
              { key: 'r', header: 'Réf.', render: (p) => p.reference || '—' },
              { key: 'a', header: 'Montant', align: 'right', render: (p) => <span className="tabular-nums">{money(p.amount, inv.currency)}{inv.currency !== 'TND' && <span className="block text-xs text-navy/50">{money(p.amount_tnd)}</span>}</span> },
              { key: 'x', header: '', align: 'right', render: (p) => can('purchases.delete') && <button className="p-1 text-navy/40 hover:text-brand-red" title="Supprimer (erreur de saisie)" onClick={() => setConfirm({ paymentId: p.id })}><Trash2 className="h-4 w-4" /></button> },
            ]} />
          </div>
          {pay && (
            <div className="space-y-3 border border-navy/15 bg-mist p-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Montant (${inv.currency})`}><NumberInput value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} /></Field>
                <Field label="Date"><input type="date" className="field !min-h-[42px] !py-2" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
                <Field label="Mode"><SelectInput value={pay.method} onChange={(v) => setPay({ ...pay, method: v })}>{(methods.data ?? []).filter((m) => m.is_active).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</SelectInput></Field>
                <Field label="Référence"><TextInput value={pay.reference} onChange={(v) => setPay({ ...pay, reference: v })} /></Field>
                {inv.currency !== 'TND' && <Field label="Taux du jour (TND)" className="col-span-2"><NumberInput value={pay.rate} onChange={(v) => setPay({ ...pay, rate: v })} /></Field>}
              </div>
              <div className="flex justify-end gap-2">
                <button className="btn btn-ghost !min-h-[38px] !px-4 !text-[11px]" onClick={() => setPay(null)}>Annuler</button>
                <button className="btn btn-navy !min-h-[38px] !px-4 !text-[11px]" disabled={busy} onClick={savePayment}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Valider le paiement</button>
              </div>
            </div>
          )}
          {can('documents.view') && <div><p className="field-label">Facture scannée / justificatifs</p><DocumentsPanel compact entityType="supplier_invoices" entityId={inv.id} docType="supplier_invoice" /></div>}
        </div>
      </div>
      <ConfirmModal open={confirm === 'cancel'} danger title="Annuler la facture fournisseur" confirmLabel="Annuler" onClose={() => setConfirm(null)} message="La facture sera marquée annulée (aucun règlement enregistré)."
        onConfirm={async () => { unwrap(await sb().from('supplier_invoices').update({ status: 'cancelled' }).eq('id', inv.id)); toast('Facture annulée'); await reload(); onChanged(); }} />
      <ConfirmModal open={typeof confirm === 'object' && confirm !== null} danger title="Supprimer le règlement" confirmLabel="Supprimer" onClose={() => setConfirm(null)} message="Supprimer ce règlement saisi par erreur ? La facture redeviendra due."
        onConfirm={async () => { if (confirm && typeof confirm === 'object') { unwrap(await sb().from('supplier_payments').delete().eq('id', confirm.paymentId)); toast('Règlement supprimé'); await reload(); onChanged(); } }} />
    </Modal>
  );
}
