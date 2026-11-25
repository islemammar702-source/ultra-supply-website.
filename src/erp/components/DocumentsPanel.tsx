import { useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from '@/admin/ui';
import { errMsg, logEvent, sb, unwrap } from '../lib/db';
import { useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { listDocuments, MAX_UPLOAD, openDocument, storeDocument } from '../lib/documents';
import { fmtDateTime } from '../lib/format';
import { ConfirmModal, ErrorBox, Spinner } from './ui';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

/** Files attached to a business record (stored in the private "documents" bucket). */
export function DocumentsPanel({ entityType, entityId, docType, compact }: { entityType: string; entityId: string; docType: string; compact?: boolean }) {
  const { can } = useAccess();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; path: string; title: string } | null>(null);
  const { data, error, loading, reload } = useAsync(() => listDocuments(entityType, entityId), [entityType, entityId]);

  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD) return toast('Fichier trop volumineux (15 Mo maximum).', 'err');
    setBusy(true);
    try {
      await storeDocument({ docType, entityType, entityId, title: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, data: file });
      void logEvent('document.uploaded', entityType, entityId, file.name);
      toast('Document ajouté');
      await reload();
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  if (!can('documents.view')) return null;
  return (
    <div>
      {!compact && <p className="mb-3 text-sm text-navy/60">PDF générés et pièces jointes (PDF, JPG, PNG, WebP — 15 Mo max). Stockage privé, liens temporaires.</p>}
      {error && <ErrorBox message={error} onRetry={reload} />}
      <ul className="divide-y divide-navy/10 border border-navy/10">
        {(data ?? []).map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-navy/40" />
            <button className="min-w-0 flex-1 truncate text-left text-navy hover:underline" onClick={() => openDocument(d.file_path).catch((e) => toast(errMsg(e), 'err'))}>{d.title}</button>
            <span className="hidden shrink-0 text-xs text-navy/45 sm:inline">{fmtDateTime(d.created_at)} · {Math.max(1, Math.round(d.size_bytes / 1024))} Ko</span>
            <button className="p-1.5 text-navy/50 hover:text-navy" title="Ouvrir" onClick={() => openDocument(d.file_path).catch((e) => toast(errMsg(e), 'err'))}><ExternalLink className="h-4 w-4" /></button>
            {can('documents.delete') && <button className="p-1.5 text-navy/50 hover:text-brand-red" title="Supprimer" onClick={() => setRemoving({ id: d.id, path: d.file_path, title: d.title })}><Trash2 className="h-4 w-4" /></button>}
          </li>
        ))}
        {loading && !data && <li className="flex justify-center py-6"><Spinner /></li>}
        {data && !data.length && <li className="px-4 py-6 text-center text-sm text-navy/50">Aucun document.</li>}
      </ul>
      {can('documents.create') && (
        <div className="mt-3">
          <input ref={input} type="file" accept={ACCEPT} className="sr-only" id={`doc-${entityId}`} onChange={(e) => upload(e.target.files?.[0])} />
          <label htmlFor={`doc-${entityId}`} className="btn btn-ghost !min-h-[38px] cursor-pointer !px-4 !text-[11px]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Ajouter un fichier
          </label>
        </div>
      )}
      <ConfirmModal open={Boolean(removing)} danger title="Supprimer le document" confirmLabel="Supprimer"
        message={<>Supprimer définitivement « {removing?.title} » ? Cette action est irréversible.</>}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          unwrap(await sb().from('documents').delete().eq('id', removing.id));
          await sb().storage.from('documents').remove([removing.path]);
          toast('Document supprimé');
          await reload();
        }} />
    </div>
  );
}
