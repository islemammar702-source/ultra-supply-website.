import type { ContactInput, QuoteInput } from './types';

/**
 * Sends each form submission by e-mail via FormSubmit (https://formsubmit.co),
 * a free service that needs no backend. The first submission triggers a one-time
 * activation e-mail to the address below; click "Activate Form" in it.
 */
export const NOTIFY_EMAIL = import.meta.env.VITE_NOTIFY_EMAIL || 'ultrasupply.tn@gmail.com';

async function send(fields: Record<string, string>, file?: File | null): Promise<void> {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  body.append('_template', 'table');
  body.append('_captcha', 'false');
  if (file) body.append('attachment', file, file.name);
  const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(NOTIFY_EMAIL)}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`E-mail notification failed (${res.status})`);
}

export function notifyContact(c: ContactInput) {
  return send({
    _subject: `Nouveau message — ${c.subject || c.full_name} (site ULTRA SUPPLY)`,
    _replyto: c.email,
    'Nom complet': c.full_name,
    'E-mail': c.email,
    'Téléphone': c.phone || '—',
    'Sujet': c.subject || '—',
    'Message': c.message,
  });
}

export function notifyQuote(q: QuoteInput, file?: File | null) {
  return send({
    _subject: `Demande de devis — ${q.product || 'produit'} (${q.full_name})`,
    _replyto: q.email,
    'Nom complet': q.full_name,
    'Société': q.company || '—',
    'E-mail': q.email,
    'Téléphone': q.phone,
    'Produit': q.product,
    'Référence': q.reference || '—',
    'Quantité': String(q.quantity),
    'Message': q.message || '—',
    'Langue': q.locale,
  }, file);
}
