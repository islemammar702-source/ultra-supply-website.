import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { PageHeader, toast } from '@/admin/ui';
import { errMsg, sb, unwrap } from '../lib/db';
import { useAsync } from '../lib/hooks';
import { openDocument } from '../lib/documents';
import { fmtDateTime } from '../lib/format';
import type { DocumentRow } from '../lib/types';
import { DataTable, ErrorBox, FilterChips, Pill, SearchBar } from '../components/ui';
import { DocumentsPanel } from '../components/DocumentsPanel';

const TYPE_LABEL: Record<string, string> = {
  quotation: 'Devis', invoice: 'Facture', credit_note: 'Avoir', receipt: 'Reçu', purchase_order: 'Bon de commande', delivery_note: 'Bon de livraison',
  supplier_invoice: 'Facture fournisseur', supplier_document: 'Doc. fournisseur', customer_document: 'Doc. client', other: 'Autre',
};

const LINK: Record<string, string> = {
  quotations: '/admin/quotations/', invoices: '/admin/invoices/', purchase_orders: '/admin/purchases/', delivery_notes: '/admin/deliveries/',
  customers: '/admin/customers/', suppliers: '/admin/suppliers/', orders: '/admin/orders/',
};

export default function DocumentsPage() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const { data, error, loading, reload } = useAsync(async () => unwrap(await sb().from('documents').select('*').order('created_at', { ascending: false }).limit(3000)) as DocumentRow[], []);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((d) => (!type || d.doc_type === type) && (!n || [d.title, d.file_name, d.notes].join(' ').toLowerCase().includes(n)));
  }, [data, q, type]);
  const types = Array.from(new Set((data ?? []).map((d) => d.doc_type)));

  return (
    <>
      <PageHeader title="Documents" subtitle="PDF générés (devis, factures, reçus, bons…) et pièces jointes — stockage privé, accès par lien temporaire." />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4 xl:flex-row">
          <SearchBar value={q} onChange={setQ} placeholder="Titre, nom de fichier…" />
          <FilterChips value={type} onChange={setType} options={[{ value: '', label: 'Tous' }, ...types.map((t) => ({ value: t, label: TYPE_LABEL[t] ?? t }))]} />
        </div>
        <DataTable loading={loading} rows={rows} columns={[
          { key: 'd', header: 'Date', render: (d) => <span className="whitespace-nowrap text-navy/60">{fmtDateTime(d.created_at)}</span> },
          { key: 't', header: 'Type', render: (d) => <Pill tone="navy">{TYPE_LABEL[d.doc_type] ?? d.doc_type}</Pill> },
          { key: 'n', header: 'Document', render: (d) => <button className="text-left font-semibold text-navy hover:underline" onClick={() => openDocument(d.file_path).catch((e) => toast(errMsg(e), 'err'))}>{d.title}</button> },
          { key: 'l', header: 'Lié à', render: (d) => d.entity_id && LINK[d.entity_type] ? <Link className="text-sm underline" to={`${LINK[d.entity_type]}${d.entity_id}`}>Ouvrir la fiche</Link> : '—' },
          { key: 's', header: 'Taille', align: 'right', render: (d) => <span className="tabular-nums text-navy/60">{Math.max(1, Math.round(d.size_bytes / 1024))} Ko</span> },
          { key: 'o', header: '', align: 'right', render: (d) => <button className="p-2 text-navy/50 hover:text-navy" title="Ouvrir" onClick={() => openDocument(d.file_path).catch((e) => toast(errMsg(e), 'err'))}><ExternalLink className="h-4 w-4" /></button> },
        ]} />
      </div>
      <div className="mt-6 border border-navy/10 bg-white p-5">
        <h2 className="mb-3 font-display text-[15px] font-bold text-navy">Documents généraux</h2>
        <DocumentsPanel entityType="company" entityId="00000000-0000-4000-8000-000000000000" docType="other" />
      </div>
    </>
  );
}
