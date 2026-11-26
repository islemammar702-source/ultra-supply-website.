import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Modal, PageHeader } from '@/admin/ui';
import { sb, unwrap } from '../lib/db';
import { useAsync } from '../lib/hooks';
import { addDays, csvDownload, fmtDateTime, today } from '../lib/format';
import { ACTION_LABEL, ENTITY_LABEL } from '../lib/status';
import type { ActivityLog } from '../lib/types';
import { DataTable, DateRange, ErrorBox, SearchBar } from '../components/ui';

export default function LogsPage() {
  const [from, setFrom] = useState(addDays(today(), -6));
  const [to, setTo] = useState(today());
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [open, setOpen] = useState<ActivityLog | null>(null);
  const { data, error, loading, reload } = useAsync(async () =>
    unwrap(await sb().from('activity_logs').select('*').gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`).order('created_at', { ascending: false }).limit(5000)) as ActivityLog[], [from, to]);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((l) => (!entity || l.entity_type === entity) && (!n || [l.user_email, l.action, l.entity_label, ENTITY_LABEL[l.entity_type], ACTION_LABEL[l.action]].join(' ').toLowerCase().includes(n)));
  }, [data, q, entity]);
  const entities = Array.from(new Set((data ?? []).map((l) => l.entity_type).filter(Boolean)));

  return (
    <>
      <PageHeader title="Journal d’activité" subtitle="Trace non modifiable : qui a fait quoi, quand, avec le détail des valeurs avant / après."
        actions={<button className="btn btn-ghost !min-h-[42px]" disabled={!rows.length} onClick={() => csvDownload(`journal-${from}-${to}.csv`, ['Date', 'Utilisateur', 'Action', 'Élément', 'Libellé', 'Détails'],
          rows.map((l) => [l.created_at, l.user_email, ACTION_LABEL[l.action] ?? l.action, ENTITY_LABEL[l.entity_type] ?? l.entity_type, l.entity_label, JSON.stringify(l.details)]))}><Download className="h-4 w-4" /> CSV</button>} />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4 xl:flex-row xl:items-end">
          <SearchBar value={q} onChange={setQ} placeholder="Utilisateur, action, n° de document…" />
          <select className="field !min-h-[42px] !py-2 xl:!w-56" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Élément">
            <option value="">Tous les éléments</option>{entities.map((e) => <option key={e} value={e}>{ENTITY_LABEL[e] ?? e}</option>)}
          </select>
          <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </div>
        <DataTable loading={loading} rows={rows} onRowClick={setOpen} columns={[
          { key: 'd', header: 'Date', render: (l) => <span className="whitespace-nowrap text-navy/60">{fmtDateTime(l.created_at)}</span> },
          { key: 'u', header: 'Utilisateur', render: (l) => l.user_email || <span className="text-navy/40">Système</span> },
          { key: 'a', header: 'Action', render: (l) => <span className="font-semibold text-navy">{ACTION_LABEL[l.action] ?? l.action}</span> },
          { key: 'e', header: 'Élément', render: (l) => <span>{ENTITY_LABEL[l.entity_type] ?? l.entity_type} {l.entity_label && <span className="text-navy/60">« {l.entity_label} »</span>}</span> },
          { key: 'k', header: 'Champs', render: (l) => <span className="text-xs text-navy/50">{l.action === 'update' ? Object.keys(l.details).slice(0, 4).join(', ') : ''}</span> },
        ]} />
      </div>
      {open && (
        <Modal open wide title={`${ACTION_LABEL[open.action] ?? open.action} — ${ENTITY_LABEL[open.entity_type] ?? open.entity_type}`} onClose={() => setOpen(null)}>
          <p className="mb-3 text-sm text-navy/60">{fmtDateTime(open.created_at)} · {open.user_email || 'Système'} {open.entity_label && `· ${open.entity_label}`}</p>
          {open.action === 'update' ? (
            <table className="w-full text-sm">
              <thead className="bg-mist text-[12px] text-navy/60"><tr><th className="px-3 py-2 text-left">Champ</th><th className="px-3 py-2 text-left">Avant</th><th className="px-3 py-2 text-left">Après</th></tr></thead>
              <tbody className="divide-y divide-navy/10">
                {Object.entries(open.details).map(([k, v]) => {
                  const d = v as { from?: unknown; to?: unknown };
                  return <tr key={k}><td className="px-3 py-2 font-mono text-xs">{k}</td><td className="break-all px-3 py-2 text-navy/60">{JSON.stringify(d?.from)}</td><td className="break-all px-3 py-2">{JSON.stringify(d?.to)}</td></tr>;
                })}
              </tbody>
            </table>
          ) : <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap bg-mist p-4 text-xs">{JSON.stringify(open.details, null, 2)}</pre>}
        </Modal>
      )}
    </>
  );
}
