import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Ban, Download, FileDown, Loader2, Mail, Plus, Wand2, X } from 'lucide-react';
import { Modal, PageHeader, toast } from '@/admin/ui';
import { errMsg, rpc, sb, unwrap } from '../lib/db';
import { loadPaymentMethods, loadSettings, useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { loadCustomers } from '../lib/data';
import { csvDownload, fmtDate, money, toNum, today } from '../lib/format';
import { INVOICE_STATUS, PAYMENT_STATUS } from '../lib/status';
import { generateAndDownload, pdfFileName, receiptDoc, renderPdf, storeDocument } from '../lib/documents';
import type { Customer, Invoice, Payment, PaymentMethod, Receipt } from '../lib/types';
import { Check, ConfirmModal, DataTable, ErrorBox, Field, FilterChips, KeyValues, NumberInput, Pill, SearchBar, SearchSelect, SelectInput, StatusBadge, TextArea, TextInput } from '../components/ui';
import { EmailDialog } from '../components/EmailDialog';

type Row = Payment & { customer: Pick<Customer, 'name' | 'code'> | null };

export default function PaymentsPage() {
  const { can } = useAccess();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'valid' | 'cancelled' | 'unallocated'>('valid');
  const methods = useAsync(loadPaymentMethods, []);
  const { data, error, loading, reload } = useAsync(async () =>
    unwrap(await sb().from('payments').select('*, customer:customers(name,code)').order('payment_date', { ascending: false }).order('created_at', { ascending: false }).limit(3000)) as Row[], []);
  const methodLabel = (id: string) => methods.data?.find((m) => m.id === id)?.label ?? '—';
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((r) => (status === '' || (status === 'unallocated' ? r.status === 'valid' && toNum(r.amount) - toNum(r.allocated_amount) > 0.0005 : r.status === status))
      && (!n || [r.number, r.customer?.name, r.reference, r.bank_name].join(' ').toLowerCase().includes(n)));
  }, [data, q, status]);
  const total = rows.filter((r) => r.status === 'valid').reduce((s, r) => s + toNum(r.amount), 0);
  const newOpen = params.get('new') === '1';
  const openId = params.get('open');

  const close = () => setParams({});

  return (
    <>
      <PageHeader title="Paiements" subtitle="Encaissements clients, affectation sur une ou plusieurs factures, acomptes et reçus."
        actions={<>
          <button className="btn btn-ghost !min-h-[42px]" disabled={!rows.length} onClick={() => csvDownload(`paiements-${today()}.csv`, ['N°', 'Date', 'Client', 'Mode', 'Référence', 'Banque', 'Échéance', 'Montant', 'Affecté', 'Statut'],
            rows.map((r) => [r.number, r.payment_date, r.customer?.name ?? '', methodLabel(r.method_id), r.reference, r.bank_name, r.due_date ?? '', toNum(r.amount), toNum(r.allocated_amount), PAYMENT_STATUS[r.status].label]))}><Download className="h-4 w-4" /> CSV</button>
          {can('payments.create') && <button className="btn btn-red !min-h-[42px]" onClick={() => setParams({ new: '1' })}><Plus className="h-4 w-4" /> Enregistrer un paiement</button>}
        </>} />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4 xl:flex-row">
          <SearchBar value={q} onChange={setQ} placeholder="N°, client, n° de chèque / virement…" />
          <FilterChips value={status} onChange={setStatus} options={[{ value: 'valid', label: 'Encaissés' }, { value: 'unallocated', label: 'Non affectés' }, { value: 'cancelled', label: 'Annulés' }, { value: '', label: 'Tous' }]} />
        </div>
        <DataTable loading={loading} rows={rows} onRowClick={(r) => setParams({ open: r.id })}
          footer={<tr><td colSpan={5} className="px-4 py-3 text-right">Total encaissé (sélection)</td><td className="px-4 py-3 text-right tabular-nums">{money(total)}</td><td colSpan={2} /></tr>}
          columns={[
            { key: 'n', header: 'N°', render: (r) => <span className="font-semibold text-navy">{r.number}</span> },
            { key: 'd', header: 'Date', render: (r) => fmtDate(r.payment_date) },
            { key: 'c', header: 'Client', render: (r) => r.customer?.name },
            { key: 'm', header: 'Mode', render: (r) => <span>{methodLabel(r.method_id)}{r.is_deposit && <span className="ml-2"><Pill tone="blue">Acompte</Pill></span>}</span> },
            { key: 'r', header: 'Référence', render: (r) => <span className="text-navy/70">{r.reference || '—'}{r.due_date ? ` · éch. ${fmtDate(r.due_date)}` : ''}</span> },
            { key: 'a', header: 'Montant', align: 'right', render: (r) => <span className={`font-semibold tabular-nums ${r.status === 'cancelled' ? 'text-navy/40 line-through' : ''}`}>{money(r.amount)}</span> },
            { key: 'u', header: 'Non affecté', align: 'right', render: (r) => { const u = toNum(r.amount) - toNum(r.allocated_amount); return <span className={`tabular-nums ${r.status === 'valid' && u > 0.0005 ? 'font-semibold text-amber-700' : 'text-navy/40'}`}>{r.status === 'valid' ? money(u) : '—'}</span>; } },
            { key: 's', header: 'Statut', render: (r) => <StatusBadge map={PAYMENT_STATUS} value={r.status} /> },
          ]} />
      </div>
      {newOpen && methods.data && (
        <NewPaymentModal methods={methods.data} customerId={params.get('customer')} invoiceId={params.get('invoice')} onClose={close}
          onSaved={(pid) => { void reload(); setParams({ open: pid }); }} />
      )}
      {openId && methods.data && <PaymentDetailModal id={openId} methods={methods.data} onClose={close} onChanged={() => void reload()} />}
    </>
  );
}

type OpenInvoice = Pick<Invoice, 'id' | 'number' | 'issue_date' | 'due_date' | 'total_ttc' | 'balance_due' | 'status'>;

async function loadOpenInvoices(customerId: string): Promise<OpenInvoice[]> {
  return unwrap(await sb().from('invoices').select('id,number,issue_date,due_date,total_ttc,balance_due,status')
    .eq('customer_id', customerId).eq('kind', 'invoice').in('status', ['validated', 'sent', 'partially_paid', 'overdue']).gt('balance_due', 0)
    .order('due_date', { ascending: true })) as OpenInvoice[];
}

/** Spreads an amount over invoices, oldest due first. */
function autoAllocate(amount: number, invoices: OpenInvoice[]): Record<string, number> {
  let left = Math.round(amount * 1000);
  const out: Record<string, number> = {};
  for (const i of invoices) {
    if (left <= 0) break;
    const due = Math.round(toNum(i.balance_due) * 1000);
    const take = Math.min(left, due);
    if (take > 0) { out[i.id] = take / 1000; left -= take; }
  }
  return out;
}

function NewPaymentModal({ methods, customerId, invoiceId, onClose, onSaved }: {
  methods: PaymentMethod[]; customerId: string | null; invoiceId: string | null; onClose: () => void; onSaved: (id: string) => void;
}) {
  const active = methods.filter((m) => m.is_active);
  const [customer, setCustomer] = useState<string | null>(customerId);
  const [amount, setAmount] = useState(0);
  const [methodId, setMethodId] = useState(active[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState('');
  const [bank, setBank] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [deposit, setDeposit] = useState(false);
  const [notes, setNotes] = useState('');
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customers = useAsync(() => loadCustomers(true), []);
  const invoices = useAsync(async () => (customer ? loadOpenInvoices(customer) : []), [customer]);
  const method = active.find((m) => m.id === methodId);

  useEffect(() => {
    if (!invoices.data) return;
    if (invoiceId) {
      const inv = invoices.data.find((i) => i.id === invoiceId);
      if (inv) { setAmount(toNum(inv.balance_due)); setAlloc({ [inv.id]: toNum(inv.balance_due) }); return; }
    }
    setAlloc({});
  }, [invoices.data, invoiceId]);

  const allocated = Object.values(alloc).reduce((s, v) => s + toNum(v), 0);
  const remaining = Math.round((amount - allocated) * 1000) / 1000;
  const totalDue = (invoices.data ?? []).reduce((s, i) => s + toNum(i.balance_due), 0);

  const submit = async () => {
    if (!customer) return setError('Sélectionnez le client.');
    if (!(amount > 0)) return setError('Saisissez un montant positif.');
    if (remaining < -0.0005) return setError('Le total affecté dépasse le montant du paiement.');
    if (method?.requires_reference && !reference.trim()) return setError(`Le mode « ${method.label} » exige une référence.`);
    for (const i of invoices.data ?? []) if (toNum(alloc[i.id]) > toNum(i.balance_due) + 0.0005) return setError(`Facture ${i.number} : montant supérieur au reste à payer.`);
    setBusy(true); setError(null);
    try {
      const id = await rpc<string>('record_payment', {
        p_customer_id: customer, p_amount: Math.round(amount * 1000) / 1000, p_method_id: methodId, p_payment_date: date, p_reference: reference, p_bank_name: bank,
        p_due_date: method?.has_due_date && dueDate ? dueDate : null, p_notes: notes, p_is_deposit: deposit,
        p_allocations: Object.entries(alloc).filter(([, v]) => toNum(v) > 0).map(([invoice_id, v]) => ({ invoice_id, amount: Math.round(toNum(v) * 1000) / 1000 })),
      });
      toast('Paiement enregistré');
      onSaved(id);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open wide title="Enregistrer un paiement" onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[42px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={submit}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer</button>
      </>}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Client" required className="md:col-span-2">
          <SearchSelect value={customer} onChange={(v) => { setCustomer(v); setAlloc({}); }} placeholder="Choisir le client…"
            options={(customers.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.code})`, hint: c.city }))} />
        </Field>
        <Field label="Montant reçu (DT)" required><NumberInput value={amount} onChange={setAmount} min={0} /></Field>
        <Field label="Date du paiement"><input type="date" className="field !min-h-[42px] !py-2" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Mode de paiement">
          <SelectInput value={methodId} onChange={setMethodId}>{active.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</SelectInput>
        </Field>
        <Field label={`Référence${method?.requires_reference ? '' : ' (optionnel)'}`} required={method?.requires_reference} hint="N° de chèque, de virement, de traite…"><TextInput value={reference} onChange={setReference} /></Field>
        <Field label="Banque"><TextInput value={bank} onChange={setBank} /></Field>
        {method?.has_due_date && <Field label="Date d’échéance (encaissement)"><input type="date" className="field !min-h-[42px] !py-2" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
        <div className="md:col-span-2"><Check checked={deposit} onChange={setDeposit} label="Acompte (avance client, peut rester non affecté)" /></div>

        <div className="md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="field-label !mb-0">Affectation aux factures</span>
            {(invoices.data?.length ?? 0) > 0 && <button type="button" className="btn btn-ghost !min-h-[34px] !px-3 !text-[11px]" onClick={() => setAlloc(autoAllocate(amount, invoices.data ?? []))}><Wand2 className="h-3.5 w-3.5" /> Répartir automatiquement</button>}
          </div>
          <div className="mt-2 border border-navy/10">
            {!customer && <p className="px-4 py-6 text-center text-sm text-navy/50">Choisissez d’abord le client.</p>}
            {customer && invoices.loading && <p className="px-4 py-6 text-center text-sm text-navy/50">Chargement…</p>}
            {customer && invoices.data && !invoices.data.length && <p className="px-4 py-6 text-center text-sm text-navy/50">Aucune facture ouverte : le paiement sera enregistré comme avoir / acompte disponible.</p>}
            {(invoices.data ?? []).map((i) => (
              <div key={i.id} className="grid grid-cols-12 items-center gap-2 border-b border-navy/10 px-3 py-2 text-sm last:border-0">
                <div className="col-span-5"><p className="font-semibold text-navy">{i.number}</p><p className="text-xs text-navy/50">éch. {fmtDate(i.due_date)} · <StatusBadge map={INVOICE_STATUS} value={i.status} /></p></div>
                <div className="col-span-3 text-right text-xs text-navy/60">Reste<br /><span className="tabular-nums text-navy">{money(i.balance_due)}</span></div>
                <div className="col-span-4"><NumberInput value={alloc[i.id] ?? 0} onChange={(v) => setAlloc({ ...alloc, [i.id]: Math.max(0, v) })} min={0} /></div>
              </div>
            ))}
          </div>
          {customer && (
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
              <span className="text-navy/60">Total dû : {money(totalDue)}</span>
              <span className={remaining < -0.0005 ? 'font-semibold text-brand-red' : remaining > 0.0005 ? 'font-semibold text-amber-700' : 'text-emerald-700'}>
                Affecté : {money(allocated)} · {remaining >= 0 ? `Non affecté : ${money(remaining)}` : `Dépassement : ${money(-remaining)}`}
              </span>
            </div>
          )}
        </div>
        <Field label="Notes" className="md:col-span-2"><TextArea value={notes} onChange={setNotes} rows={2} /></Field>
      </div>
    </Modal>
  );
}

function PaymentDetailModal({ id, methods, onClose, onChanged }: { id: string; methods: PaymentMethod[]; onClose: () => void; onChanged: () => void }) {
  const { can } = useAccess();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [extra, setExtra] = useState<Record<string, number>>({});
  const { data, reload, error: loadError } = useAsync(async () => {
    const p = unwrap(await sb().from('payments').select('*').eq('id', id).single()) as Payment;
    const [customer, receipt, allocations, open] = await Promise.all([
      sb().from('customers').select('*').eq('id', p.customer_id).single().then(unwrap) as Promise<Customer>,
      sb().from('receipts').select('*').eq('payment_id', id).maybeSingle().then(unwrap) as Promise<Receipt | null>,
      sb().from('payment_allocations').select('id,amount,invoice:invoices(id,number,issue_date)').eq('payment_id', id).then(unwrap) as Promise<{ id: string; amount: number; invoice: { id: string; number: string; issue_date: string } | null }[]>,
      p.status === 'valid' ? loadOpenInvoices(p.customer_id) : Promise.resolve([] as OpenInvoice[]),
    ]);
    return { p, customer, receipt, allocations, open };
  }, [id]);

  if (loadError) return <Modal open title="Paiement" onClose={onClose}><ErrorBox message={loadError} /></Modal>;
  if (!data) return <Modal open title="Paiement" onClose={onClose}><div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div></Modal>;
  const { p, customer, receipt, allocations, open } = data;
  const method = methods.find((m) => m.id === p.method_id);
  const unallocated = toNum(p.amount) - toNum(p.allocated_amount);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setError(null);
    try { await fn(); toast(ok); await reload(); onChanged(); } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };
  const doc = () => receiptDoc(p, receipt?.number ?? p.number, customer, method, allocations.map((a) => ({ number: a.invoice?.number ?? '', date: a.invoice?.issue_date ?? '', amount: toNum(a.amount) })));

  return (
    <Modal open wide title={`Paiement ${p.number}`} onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        {can('payments.delete') && p.status === 'valid' && <button className="btn btn-ghost !min-h-[40px] hover:!border-brand-red hover:!bg-brand-red" onClick={() => setCancelOpen(true)}><Ban className="h-4 w-4" /> Annuler le paiement</button>}
        <button className="btn btn-ghost !min-h-[40px]" disabled={!!busy} onClick={() => run('pdf', async () => generateAndDownload({ doc: doc(), settings: await loadSettings(), docType: 'receipt', entityType: 'payments', entityId: p.id, archive: can('documents.create') }), 'Reçu généré')}>
          {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Reçu PDF
        </button>
        {customer.email && p.status === 'valid' && <button className="btn btn-navy !min-h-[40px]" onClick={() => setEmailOpen(true)}><Mail className="h-4 w-4" /> Envoyer le reçu</button>}
      </>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="border border-navy/10">
          <KeyValues items={[
            ['Client', <Link className="underline" to={`/admin/customers/${customer.id}`} onClick={onClose}>{customer.name}</Link>],
            ['Statut', <StatusBadge map={PAYMENT_STATUS} value={p.status} />],
            ['Montant', <strong>{money(p.amount)}</strong>],
            ['Date', fmtDate(p.payment_date)],
            ['Mode', `${method?.label ?? '—'}${p.is_deposit ? ' (acompte)' : ''}`],
            ['Référence', p.reference], ['Banque', p.bank_name], ['Échéance', p.due_date ? fmtDate(p.due_date) : ''],
            ['Reçu', receipt?.number ?? ''], ['Notes', p.notes],
            ...(p.status === 'cancelled' ? [['Annulé', `${fmtDate(p.cancelled_at)} — ${p.cancel_reason}`] as [string, string]] : []),
          ]} />
        </div>
        <div>
          <p className="field-label">Affectations</p>
          <ul className="divide-y divide-navy/10 border border-navy/10">
            {allocations.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <button className="font-semibold text-navy underline" onClick={() => navigate(`/admin/invoices/${a.invoice?.id}`)}>{a.invoice?.number}</button>
                <span className="flex items-center gap-2"><span className="tabular-nums">{money(a.amount)}</span>
                  {can('payments.edit') && p.status === 'valid' && <button className="p-1 text-navy/40 hover:text-brand-red" title="Retirer l’affectation" disabled={!!busy} onClick={() => run('rm', () => rpc('remove_allocation', { p_allocation_id: a.id }), 'Affectation retirée')}><X className="h-4 w-4" /></button>}
                </span>
              </li>
            ))}
            {!allocations.length && <li className="px-4 py-4 text-center text-sm text-navy/50">Aucune affectation.</li>}
          </ul>
          {p.status === 'valid' && unallocated > 0.0005 && (
            <div className="mt-4 border-l-[3px] border-amber-500 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-navy">Montant non affecté : {money(unallocated)}</p>
              {can('payments.edit') && open.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {open.map((i) => (
                    <div key={i.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1">{i.number} <span className="text-navy/50">(reste {money(i.balance_due)})</span></span>
                      <span className="w-32"><NumberInput value={extra[i.id] ?? 0} onChange={(v) => setExtra({ ...extra, [i.id]: Math.max(0, v) })} /></span>
                      <button className="btn btn-navy !min-h-[38px] !px-3 !text-[11px]" disabled={!!busy || !(toNum(extra[i.id]) > 0)}
                        onClick={() => run('alloc', () => rpc('allocate_payment', { p_payment_id: p.id, p_invoice_id: i.id, p_amount: extra[i.id] }), 'Paiement affecté').then(() => setExtra({}))}>Affecter</button>
                    </div>
                  ))}
                </div>
              ) : <p className="mt-1 text-xs text-navy/60">Disponible comme acompte / avoir client pour de futures factures.</p>}
            </div>
          )}
        </div>
      </div>
      <ConfirmModal open={cancelOpen} danger title="Annuler le paiement" confirmLabel="Annuler le paiement" reasonLabel="Motif (chèque impayé, erreur de saisie…)"
        onClose={() => setCancelOpen(false)}
        message={<>Les affectations de {p.number} seront retirées et les factures concernées redeviendront dues. L’opération est tracée dans le journal.</>}
        onConfirm={async (reason) => { await rpc('cancel_payment', { p_payment_id: p.id, p_reason: reason }); toast('Paiement annulé'); await reload(); onChanged(); }} />
      {emailOpen && (
        <EmailDialog open onClose={() => setEmailOpen(false)} entityType="payments" entityId={p.id} permission="payments.view"
          draft={{ to: customer.email, subject: `Reçu de paiement ${receipt?.number ?? p.number} — ULTRA SUPPLY`, message: `Bonjour,\n\nNous accusons réception de votre paiement de ${money(p.amount)} du ${fmtDate(p.payment_date)}. Vous trouverez ci-joint le reçu correspondant.\n\nMerci de votre confiance.\n\nCordialement,\nL’équipe ULTRA SUPPLY` }}
          prepare={async () => {
            const d = doc();
            const bytes = await renderPdf(d, await loadSettings());
            if (can('documents.create')) void storeDocument({ docType: 'receipt', entityType: 'payments', entityId: p.id, title: `${d.title} ${d.number}`, fileName: pdfFileName(d), data: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }) }).catch(() => undefined);
            return { bytes, fileName: pdfFileName(d) };
          }} />
      )}
    </Modal>
  );
}
