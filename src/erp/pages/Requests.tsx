import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, FileText, Loader2, Mail, Paperclip, Phone, Save, Trash2, UserPlus } from 'lucide-react';
import { Modal, PageHeader, toast } from '@/admin/ui';
import { errMsg, logEvent, rpc, sb, unwrap } from '../lib/db';
import { loadStaff, useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { csvDownload, fmtDateTime, today } from '../lib/format';
import { REQUEST_STATUS, REQUEST_TYPE } from '../lib/status';
import type { ContactRequest, RequestStatus } from '../lib/types';
import { ConfirmModal, DataTable, ErrorBox, Field, FilterChips, KeyValues, Pill, SearchBar, SelectInput, StatusBadge, TextArea } from '../components/ui';

export default function RequestsPage() {
  const { can, access } = useAccess();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'open' | RequestStatus>('open');
  const [type, setType] = useState('');
  const [mine, setMine] = useState(false);
  const staff = useAsync(() => (can('requests.assign|users.view') ? loadStaff() : Promise.resolve([])), []);
  const { data, error, loading, reload } = useAsync(async () =>
    unwrap(await sb().from('contact_requests').select('*').order('created_at', { ascending: false }).limit(3000)) as ContactRequest[], []);
  const staffName = (id: string | null) => (id ? staff.data?.find((u) => u.id === id)?.full_name || staff.data?.find((u) => u.id === id)?.email || 'Affectée' : '');
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((r) => (status === '' || (status === 'open' ? ['new', 'assigned', 'in_progress'].includes(r.status) : r.status === status))
      && (!type || r.request_type === type) && (!mine || r.assigned_to === access?.user_id)
      && (!n || [r.full_name, r.company, r.email, r.phone, r.subject, r.product, r.reference, r.message].join(' ').toLowerCase().includes(n)));
  }, [data, q, status, type, mine, access?.user_id]);
  const openId = params.get('open');

  return (
    <>
      <PageHeader title="Demandes du site" subtitle="Devis, informations produit, disponibilité, partenariats et messages reçus depuis le site public."
        actions={<button className="btn btn-ghost !min-h-[42px]" disabled={!rows.length} onClick={() => {
          csvDownload(`demandes-${today()}.csv`, ['Reçue le', 'Type', 'Statut', 'Nom', 'Société', 'E-mail', 'Téléphone', 'Objet', 'Produit', 'Référence', 'Quantité', 'Message', 'Affectée à'],
            rows.map((r) => [r.created_at, REQUEST_TYPE[r.request_type], REQUEST_STATUS[r.status].label, r.full_name, r.company, r.email, r.phone, r.subject, r.product, r.reference, r.quantity ?? '', r.message, staffName(r.assigned_to)]));
          void logEvent('export.csv', 'contact_requests', null, `${rows.length} demandes`);
        }}><Download className="h-4 w-4" /> CSV</button>} />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4">
          <div className="flex flex-col gap-3 lg:flex-row">
            <SearchBar value={q} onChange={setQ} placeholder="Nom, société, e-mail, produit, message…" />
            <select className="field !min-h-[42px] !py-2 lg:!w-56" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
              <option value="">Tous les types</option>{Object.entries(REQUEST_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-navy"><input type="checkbox" className="h-4 w-4 accent-navy" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mes demandes</label>
          </div>
          <FilterChips value={status} onChange={setStatus} options={[
            { value: 'open', label: 'À traiter', count: (data ?? []).filter((r) => ['new', 'assigned', 'in_progress'].includes(r.status)).length },
            ...(['new', 'assigned', 'in_progress', 'converted', 'closed', 'spam'] as const).map((s) => ({ value: s, label: REQUEST_STATUS[s].label, count: (data ?? []).filter((r) => r.status === s).length })),
            { value: '', label: 'Toutes' },
          ]} />
        </div>
        <DataTable loading={loading} rows={rows} onRowClick={(r) => setParams({ open: r.id })} columns={[
          { key: 'd', header: 'Reçue le', render: (r) => <span className={`whitespace-nowrap ${r.status === 'new' ? 'font-semibold text-navy' : 'text-navy/60'}`}>{fmtDateTime(r.created_at)}</span> },
          { key: 't', header: 'Type', render: (r) => <Pill tone={r.request_type === 'quote' ? 'red' : r.request_type === 'partnership' ? 'blue' : 'navy'}>{REQUEST_TYPE[r.request_type]}</Pill> },
          { key: 'c', header: 'Contact', render: (r) => <div><p className="font-semibold text-navy">{r.full_name}</p><p className="text-xs text-navy/50">{r.company || r.email}</p></div> },
          { key: 'o', header: 'Objet', render: (r) => <div className="max-w-xs"><p className="truncate text-navy">{r.product ? `${r.product}${r.quantity ? ` × ${r.quantity}` : ''}` : r.subject}</p>{r.attachment_path && <Paperclip className="inline h-3 w-3 text-navy/40" />}</div> },
          { key: 'a', header: 'Affectée à', render: (r) => <span className="text-navy/70">{staffName(r.assigned_to) || '—'}</span> },
          { key: 's', header: 'Statut', render: (r) => <StatusBadge map={REQUEST_STATUS} value={r.status} /> },
        ]} />
      </div>
      {openId && <RequestDetail id={openId} staff={staff.data ?? []} onClose={() => setParams({})} onChanged={() => void reload()} />}
    </>
  );
}

function RequestDetail({ id, staff, onClose, onChanged }: { id: string; staff: { id: string; full_name: string; email: string; is_active: boolean }[]; onClose: () => void; onChanged: () => void }) {
  const { can, access } = useAccess();
  const navigate = useNavigate();
  const [status, setStatus] = useState<RequestStatus>('new');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const { data: r, reload } = useAsync(async () => unwrap(await sb().from('contact_requests').select('*').eq('id', id).single()) as ContactRequest, [id]);

  useEffect(() => {
    if (!r) return;
    setStatus(r.status);
    setNotes(r.internal_notes);
    if (r.attachment_path) {
      void sb().storage.from('quote-attachments').createSignedUrl(r.attachment_path, 600).then(({ data }: { data: { signedUrl: string } | null }) => setAttachment(data?.signedUrl ?? null));
    }
  }, [r]);

  if (!r) return <Modal open title="Demande" onClose={onClose}><div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div></Modal>;
  const canEdit = can('requests.edit') || r.assigned_to === access?.user_id;

  const run = async (key: string, fn: () => Promise<unknown>, ok: string, after?: (v: unknown) => void) => {
    setBusy(key); setError(null);
    try { const v = await fn(); toast(ok); onChanged(); if (after) after(v); else await reload(); } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };

  return (
    <Modal open wide title={`${REQUEST_TYPE[r.request_type]} — ${r.full_name}`} onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        {can('requests.delete') && <button className="btn btn-ghost !min-h-[40px] hover:!border-brand-red hover:!bg-brand-red" onClick={() => setRemoving(true)}><Trash2 className="h-4 w-4" /></button>}
        <a href={`mailto:${r.email}?subject=${encodeURIComponent(`Votre demande — ULTRA SUPPLY${r.product ? ` (${r.product})` : ''}`)}`} className="btn btn-ghost !min-h-[40px]"><Mail className="h-4 w-4" /> Répondre</a>
        {r.phone && <a href={`tel:${r.phone}`} className="btn btn-ghost !min-h-[40px]"><Phone className="h-4 w-4" /> Appeler</a>}
        {canEdit && !r.customer_id && can('customers.create') && <button className="btn btn-navy !min-h-[40px]" disabled={!!busy} onClick={() => run('cust', () => rpc<string>('convert_request_to_customer', { p_request_id: r.id }), 'Client créé / rattaché')}><UserPlus className="h-4 w-4" /> Créer le client</button>}
        {!r.quotation_id && can('quotations.create') && <button className="btn btn-red !min-h-[40px]" disabled={!!busy} onClick={() => run('quote', () => rpc<string>('convert_request_to_quotation', { p_request_id: r.id }), 'Devis brouillon créé', (qid) => navigate(`/admin/quotations/${qid as string}`))}>{busy === 'quote' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Créer un devis</button>}
      </>}>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="border border-navy/10">
            <KeyValues items={[
              ['Reçue le', fmtDateTime(r.created_at)],
              ['Nom', r.full_name], ['Société', r.company], ['E-mail', <a className="underline" href={`mailto:${r.email}`}>{r.email}</a>], ['Téléphone', r.phone],
              ['Objet', r.subject],
              ...(r.product ? [['Produit', `${r.product}${r.reference ? ` (${r.reference})` : ''}`] as [string, string]] : []),
              ...(r.quantity ? [['Quantité', String(r.quantity)] as [string, string]] : []),
              ['Message', <span className="whitespace-pre-wrap">{r.message}</span>],
              ...(r.attachment_path ? [['Pièce jointe', attachment ? <a href={attachment} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline"><Paperclip className="h-3.5 w-3.5" /> Ouvrir</a> : 'Chargement…'] as [string, React.ReactNode]] : []),
              ['Langue', r.locale.toUpperCase()],
              ...(r.customer_id ? [['Client', <Link className="underline" to={`/admin/customers/${r.customer_id}`} onClick={onClose}>Voir la fiche client</Link>] as [string, React.ReactNode]] : []),
              ...(r.quotation_id ? [['Devis', <Link className="underline" to={`/admin/quotations/${r.quotation_id}`} onClick={onClose}>Voir le devis</Link>] as [string, React.ReactNode]] : []),
            ]} />
          </div>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Field label="Statut">
            <SelectInput value={status} disabled={!canEdit} onChange={(v) => setStatus(v as RequestStatus)}>
              {Object.entries(REQUEST_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </SelectInput>
          </Field>
          {can('requests.assign') && (
            <Field label="Affectée à">
              <SelectInput value={r.assigned_to ?? ''} disabled={!!busy} onChange={(v) => void run('assign', () => rpc('assign_request', { p_request_id: r.id, p_user_id: v || null }), v ? 'Demande affectée' : 'Affectation retirée')}>
                <option value="">— Non affectée —</option>
                {staff.filter((u) => u.is_active || u.id === r.assigned_to).map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
              </SelectInput>
            </Field>
          )}
          <Field label="Notes internes (suivi, appels…)"><TextArea value={notes} disabled={!canEdit} onChange={setNotes} rows={6} /></Field>
          {canEdit && (
            <button className="btn btn-navy w-full !min-h-[42px]" disabled={!!busy || (status === r.status && notes === r.internal_notes)}
              onClick={() => run('save', async () => unwrap(await sb().from('contact_requests').update({ status, internal_notes: notes }).eq('id', r.id)), 'Demande mise à jour')}>
              <Save className="h-4 w-4" /> Enregistrer
            </button>
          )}
        </div>
      </div>
      <ConfirmModal open={removing} danger title="Supprimer la demande" confirmLabel="Supprimer" onClose={() => setRemoving(false)} message="Supprimer définitivement cette demande ?"
        onConfirm={async () => {
          unwrap(await sb().from('contact_requests').delete().eq('id', r.id));
          if (r.attachment_path) await sb().storage.from('quote-attachments').remove([r.attachment_path]);
          toast('Demande supprimée'); onChanged(); onClose();
        }} />
    </Modal>
  );
}
