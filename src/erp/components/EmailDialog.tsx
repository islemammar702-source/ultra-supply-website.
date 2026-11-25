import { useEffect, useState } from 'react';
import { Loader2, Paperclip, Send } from 'lucide-react';
import { Modal, toast } from '@/admin/ui';
import { emailDocument } from '../lib/documents';
import { errMsg } from '../lib/db';
import { Field, TextArea, TextInput } from './ui';

export interface EmailDraft { to: string; subject: string; message: string }

/** Sends a PDF by e-mail. `prepare` builds the PDF only when the user confirms. */
export function EmailDialog({ open, onClose, draft, prepare, entityType, entityId, permission, onSent }: {
  open: boolean; onClose: () => void; draft: EmailDraft;
  prepare: () => Promise<{ bytes: Uint8Array; fileName: string }>;
  entityType: string; entityId: string; permission: string; onSent?: () => Promise<void> | void;
}) {
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(draft.subject);
  const [message, setMessage] = useState(draft.message);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setTo(draft.to); setCc(''); setSubject(draft.subject); setMessage(draft.message); setError(null); }
  }, [open, draft.to, draft.subject, draft.message]);

  const send = async () => {
    const list = to.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!list.length || !list.every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) return setError('Adresse e-mail du destinataire invalide.');
    setBusy(true); setError(null);
    try {
      const { bytes, fileName } = await prepare();
      if (bytes.length > 3 * 1024 * 1024) throw new Error('Le PDF dépasse 3 Mo : téléchargez-le et envoyez-le depuis votre messagerie.');
      const r = await emailDocument({ to, cc, subject, message, bytes, fileName, entityType, entityId, permission });
      if (r.sent) toast('E-mail envoyé');
      else toast(r.reason ?? 'Messagerie ouverte', 'ok');
      await onSent?.();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Envoyer par e-mail" onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[42px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={send}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Envoyer</button>
      </>}>
      <div className="space-y-4">
        <Field label="Destinataire(s)" required hint="Plusieurs adresses : séparez-les par une virgule."><TextInput value={to} onChange={setTo} type="email" multiple /></Field>
        <Field label="Copie (cc)"><TextInput value={cc} onChange={setCc} /></Field>
        <Field label="Objet" required><TextInput value={subject} onChange={setSubject} maxLength={200} /></Field>
        <Field label="Message"><TextArea value={message} onChange={setMessage} rows={7} /></Field>
        <p className="flex items-center gap-2 text-xs text-navy/55"><Paperclip className="h-3.5 w-3.5" /> Le document PDF aux couleurs ULTRA SUPPLY est joint automatiquement.</p>
      </div>
    </Modal>
  );
}
