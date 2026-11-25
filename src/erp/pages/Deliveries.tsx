import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, CheckCircle2, FileDown, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { PageHeader, toast } from '@/admin/ui';
import { errMsg, rpc, sb, unwrap } from '../lib/db';
import { loadSettings, useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { loadCustomers, loadErpProducts, loadLines, saveLines } from '../lib/data';
import { fmtDate, today } from '../lib/format';
import { DELIVERY_STATUS } from '../lib/status';
import { deliveryNoteDoc, generateAndDownload } from '../lib/documents';
import type { Customer, DeliveryNote, DocLine } from '../lib/types';
import { ConfirmModal, DataTable, ErrorBox, Field, FilterChips, LoadingBlock, SearchBar, SearchSelect, Section, StatusBadge, TextArea, TextInput } from '../components/ui';
import { LinesEditor, validateLines } from '../components/LinesEditor';
import { DocumentsPanel } from '../components/DocumentsPanel';

type Row = DeliveryNote & { customer: Pick<Customer, 'name'> | null };

export default function DeliveriesPage() {
  const { can } = useAccess();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | DeliveryNote['status']>('');
  const { data, error, loading, reload } = useAsync(async () =>
    unwrap(await sb().from('delivery_notes').select('*, customer:customers(name)').order('created_at', { ascending: false }).limit(2000)) as Row[], []);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((r) => (!status || r.status === status) && (!n || [r.number, r.customer?.name, r.carrier].join(' ').toLowerCase().includes(n)));
  }, [data, q, status]);
  return (
    <>
      <PageHeader title="Bons de livraison" subtitle="Créés depuis une commande ou une facture, ou saisis librement."
        actions={can('deliveries.create') && <button className="btn btn-red !min-h-[42px]" onClick={() => navigate('/admin/deliveries/new')}><Plus className="h-4 w-4" /> Nouveau bon</button>} />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4 lg:flex-row">
          <SearchBar value={q} onChange={setQ} placeholder="N°, client, transporteur…" />
          <FilterChips value={status} onChange={setStatus} options={[{ value: '', label: 'Tous' }, ...(['draft', 'validated', 'cancelled'] as const).map((s) => ({ value: s, label: DELIVERY_STATUS[s].label }))]} />
        </div>
        <DataTable loading={loading} rows={rows} onRowClick={(r) => navigate(`/admin/deliveries/${r.id}`)} columns={[
          { key: 'n', header: 'N°', render: (r) => <span className="font-semibold text-navy">{r.number}</span> },
          { key: 'd', header: 'Date', render: (r) => fmtDate(r.delivery_date) },
          { key: 'c', header: 'Client', render: (r) => r.customer?.name },
          { key: 't', header: 'Transporteur', render: (r) => r.carrier || '—' },
          { key: 's', header: 'Statut', render: (r) => <StatusBadge map={DELIVERY_STATUS} value={r.status} /> },
        ]} />
      </div>
    </>
  );
}

interface Form { customer_id: string | null; delivery_date: string; delivery_address: string; carrier: string; vehicle: string; notes: string }

export function DeliveryEditor() {
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
  const [modal, setModal] = useState<null | 'validate' | 'cancel' | 'delete'>(null);

  const ref = useAsync(async () => {
    const [settings, customers, products] = await Promise.all([loadSettings(), loadCustomers(), loadErpProducts()]);
    return { settings, customers, products };
  }, []);
  const doc = useAsync(async () => {
    if (isNew) return null;
    const d = unwrap(await sb().from('delivery_notes').select('*').eq('id', id).single()) as DeliveryNote;
    const [items, order, invoice] = await Promise.all([
      loadLines('delivery_note_items', 'delivery_note_id', id),
      d.order_id ? sb().from('orders').select('id,number').eq('id', d.order_id).maybeSingle().then(unwrap) as Promise<{ id: string; number: string } | null> : Promise.resolve(null),
      d.invoice_id ? sb().from('invoices').select('id,number').eq('id', d.invoice_id).maybeSingle().then(unwrap) as Promise<{ id: string; number: string | null } | null> : Promise.resolve(null),
    ]);
    return { d, items, order, invoice };
  }, [id]);

  useEffect(() => {
    if (!ref.data) return;
    if (isNew) {
      const c = ref.data.customers.find((x) => x.id === params.get('customer'));
      setForm({ customer_id: c?.id ?? null, delivery_date: today(), delivery_address: c ? [c.address, c.city].filter(Boolean).join(', ') : '', carrier: '', vehicle: '', notes: '' });
      setLines([]);
      setDirty(false);
    } else if (doc.data) {
      const d = doc.data.d;
      setForm({ customer_id: d.customer_id, delivery_date: d.delivery_date, delivery_address: d.delivery_address, carrier: d.carrier, vehicle: d.vehicle, notes: d.notes });
      setLines(doc.data.items);
      setDirty(false);
    }
  }, [ref.data, doc.data, isNew, params]);

  if (ref.error || doc.error) return <ErrorBox message={ref.error ?? doc.error ?? ''} />;
  if (!ref.data || !form || (!isNew && !doc.data)) return <LoadingBlock />;
  const { settings, customers, products } = ref.data;
  const d = doc.data?.d ?? null;
  const customer = customers.find((c) => c.id === form.customer_id) ?? null;
  const editable = isNew ? can('deliveries.create') : d!.status === 'draft' && can('deliveries.edit|deliveries.create');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm({ ...form, [k]: v }); setDirty(true); };

  const save = async () => {
    if (!form.customer_id) return setError('Sélectionnez le client.');
    const le = validateLines(lines, false);
    if (le) return setError(le);
    setBusy('save'); setError(null);
    try {
      if (isNew) {
        const created = unwrap(await sb().from('delivery_notes').insert(form).select('id').single()) as { id: string };
        await saveLines('delivery_note_items', 'delivery_note_id', created.id, lines, []);
        toast('Bon de livraison créé');
        navigate(`/admin/deliveries/${created.id}`, { replace: true });
      } else {
        unwrap(await sb().from('delivery_notes').update(form).eq('id', id));
        await saveLines('delivery_note_items', 'delivery_note_id', id, lines, doc.data!.items.map((l) => l.id));
        toast('Bon de livraison enregistré');
        await doc.reload();
      }
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };

  const pdf = async () => {
    setBusy('pdf'); setError(null);
    try {
      await generateAndDownload({ doc: deliveryNoteDoc(d!, doc.data!.items, customer!, { invoice: doc.data!.invoice?.number, order: doc.data!.order?.number }), settings, docType: 'delivery_note', entityType: 'delivery_notes', entityId: d!.id, archive: can('documents.create') });
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };

  return (
    <>
      <Link to="/admin/deliveries" className="btn-link mb-4 !text-[11px]"><ArrowLeft className="h-3.5 w-3.5" /> Livraisons</Link>
      <PageHeader title={isNew ? 'Nouveau bon de livraison' : `Bon de livraison ${d!.number}`}
        subtitle={settings.stock_exit_on === 'delivery_note' ? 'La validation sort les articles du stock.' : 'Document de livraison (le stock est géré à la validation des factures).'}
        actions={d && <StatusBadge map={DELIVERY_STATUS} value={d.status} />} />
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      {d && !dirty && (
        <div className="mb-6 flex flex-wrap gap-2 border border-navy/10 bg-white p-3">
          <button className="btn btn-ghost !min-h-[40px] !px-4 !text-[11px]" disabled={!!busy} onClick={pdf}>{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} PDF</button>
          {d.status === 'draft' && can('deliveries.validate') && <button className="btn btn-red !min-h-[40px] !px-4 !text-[11px]" disabled={!!busy || !lines.length} onClick={() => setModal('validate')}><CheckCircle2 className="h-4 w-4" /> Valider la livraison</button>}
          {d.status === 'validated' && can('deliveries.validate') && <button className="btn btn-ghost !min-h-[40px] !px-4 !text-[11px]" onClick={() => setModal('cancel')}><Ban className="h-4 w-4" /> Annuler</button>}
          {d.status === 'draft' && can('deliveries.delete') && <button className="btn btn-ghost ml-auto !min-h-[40px] !px-4 !text-[11px] hover:!border-brand-red hover:!bg-brand-red" onClick={() => setModal('delete')}><Trash2 className="h-4 w-4" /> Supprimer</button>}
          {doc.data!.order && <Link className="self-center text-sm underline" to={`/admin/orders/${doc.data!.order.id}`}>Commande {doc.data!.order.number}</Link>}
          {doc.data!.invoice && <Link className="self-center text-sm underline" to={`/admin/invoices/${doc.data!.invoice.id}`}>Facture {doc.data!.invoice.number}</Link>}
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Section title={`Articles livrés (${lines.length})`}>
            <div className="p-4"><LinesEditor lines={lines} onChange={(l) => { setLines(l); setDirty(true); }} products={products} vatRates={[]} readOnly={!editable} price="none" /></div>
          </Section>
          {!isNew && can('documents.view') && <Section title="Documents (bon signé, photos…)"><div className="p-4"><DocumentsPanel compact entityType="delivery_notes" entityId={id} docType="delivery_note" /></div></Section>}
        </div>
        <Section title="Livraison" className="xl:self-start">
          <div className="space-y-4 p-5">
            <Field label="Client" required>
              <SearchSelect value={form.customer_id} disabled={!editable || Boolean(d?.order_id || d?.invoice_id)} placeholder="Choisir…"
                onChange={(v) => { const c = customers.find((x) => x.id === v); setForm({ ...form, customer_id: v, delivery_address: c ? [c.address, c.city].filter(Boolean).join(', ') : form.delivery_address }); setDirty(true); }}
                options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
            </Field>
            <Field label="Date de livraison"><input type="date" className="field !min-h-[42px] !py-2" disabled={!editable} value={form.delivery_date} onChange={(e) => set('delivery_date', e.target.value)} /></Field>
            <Field label="Adresse de livraison"><TextArea value={form.delivery_address} disabled={!editable} onChange={(v) => set('delivery_address', v)} rows={2} /></Field>
            <Field label="Transporteur / chauffeur"><TextInput value={form.carrier} disabled={!editable} onChange={(v) => set('carrier', v)} /></Field>
            <Field label="Véhicule (immatriculation)"><TextInput value={form.vehicle} disabled={!editable} onChange={(v) => set('vehicle', v)} /></Field>
            <Field label="Observations"><TextArea value={form.notes} disabled={!editable} onChange={(v) => set('notes', v)} rows={2} /></Field>
            {editable && <button className="btn btn-red w-full" disabled={busy === 'save' || (!dirty && !isNew)} onClick={save}>{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer</button>}
          </div>
        </Section>
      </div>
      <ConfirmModal open={modal === 'validate'} title="Valider la livraison" confirmLabel="Valider" onClose={() => setModal(null)}
        message={settings.stock_exit_on === 'delivery_note' ? 'Les quantités livrées seront sorties du stock. Le bon ne sera plus modifiable.' : 'Le bon ne sera plus modifiable.'}
        onConfirm={async () => { await rpc('validate_delivery_note', { p_id: id }); toast('Livraison validée'); await doc.reload(); }} />
      <ConfirmModal open={modal === 'cancel'} danger title="Annuler la livraison" confirmLabel="Annuler le bon" reasonLabel="Motif" onClose={() => setModal(null)}
        message="Si la livraison avait sorti du stock, les quantités y seront réintégrées."
        onConfirm={async (reason) => { await rpc('cancel_delivery_note', { p_id: id, p_reason: reason }); toast('Bon annulé'); await doc.reload(); }} />
      <ConfirmModal open={modal === 'delete'} danger title="Supprimer le brouillon" confirmLabel="Supprimer" onClose={() => setModal(null)} message="Supprimer ce bon de livraison brouillon ?"
        onConfirm={async () => { unwrap(await sb().from('delivery_notes').delete().eq('id', id)); toast('Supprimé'); navigate('/admin/deliveries'); }} />
    </>
  );
}
