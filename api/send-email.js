// POST /api/send-email — sends a generated PDF (quotation, invoice, receipt…) to a customer or supplier.
// The caller must be an active staff member holding the permission of the document (e.g. invoices.send).
// E-mails are delivered through Resend (https://resend.com): set RESEND_API_KEY and MAIL_FROM in Vercel.
import { env, escapeHtml, fail, isEmail, readJson, requireStaff, rpcAsUser, send } from '../server/supabase.js';

const ALLOWED_PERMISSIONS = ['quotations.send', 'invoices.send', 'payments.view', 'purchases.edit', 'deliveries.view', 'orders.view'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée.' });
  try {
    if (!env.resendKey || !env.mailFrom) {
      return send(res, 501, { error: 'Envoi d’e-mails non configuré (RESEND_API_KEY / MAIL_FROM).' });
    }
    const { token, access, can } = await requireStaff(req);
    const body = await readJson(req);
    const { to, cc, subject, message, attachment, entity_type, entity_id, permission } = body || {};

    if (!ALLOWED_PERMISSIONS.includes(permission) || !can(permission)) return send(res, 403, { error: 'Permission refusée.' });
    const recipients = String(to || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const copies = String(cc || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!recipients.length || recipients.length > 5 || !recipients.every(isEmail) || copies.length > 5 || !copies.every(isEmail)) {
      return send(res, 400, { error: 'Adresse(s) e-mail invalide(s).' });
    }
    if (typeof subject !== 'string' || !subject.trim() || subject.length > 200) return send(res, 400, { error: 'Objet invalide.' });
    if (typeof message !== 'string' || message.length > 5000) return send(res, 400, { error: 'Message invalide.' });
    if (!attachment || typeof attachment.content !== 'string' || !/^[\w.-]{1,120}\.pdf$/.test(attachment.filename || '')) {
      return send(res, 400, { error: 'Pièce jointe invalide.' });
    }
    const pdf = Buffer.from(attachment.content, 'base64');
    if (pdf.length < 100 || pdf.length > 3 * 1024 * 1024 || pdf.subarray(0, 5).toString() !== '%PDF-') {
      return send(res, 400, { error: 'Le document doit être un PDF de moins de 3 Mo.' });
    }

    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0A2445;line-height:1.6">
      ${escapeHtml(message).replace(/\n/g, '<br>')}
      <hr style="border:none;border-top:3px solid #123B70;margin:24px 0 12px;width:80px;text-align:left">
      <p style="font-size:12px;color:#5b6b80;margin:0"><strong style="color:#123B70">ULTRA SUPPLY</strong> — Solutions agricoles &amp; industrielles<br>
      Sakiet Ezzit – Sfax, Tunisie</p></div>`;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.mailFrom,
        to: recipients,
        cc: copies.length ? copies : undefined,
        reply_to: env.mailReplyTo || access.email,
        subject: subject.trim(),
        html,
        text: message,
        attachments: [{ filename: attachment.filename, content: attachment.content }],
      }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return send(res, 502, { error: `Le service d’e-mail a refusé l’envoi : ${out.message || r.status}` });

    // Audit trail + business status (e.g. invoice marked as sent) with the caller's own rights.
    await rpcAsUser(token, 'log_event', {
      p_action: 'email.sent', p_entity_type: String(entity_type || '').slice(0, 40), p_entity_id: /^[0-9a-f-]{36}$/.test(entity_id || '') ? entity_id : null,
      p_label: subject.slice(0, 200), p_details: { to: recipients, cc: copies, file: attachment.filename, provider_id: out.id || null },
    }).catch(() => {});

    return send(res, 200, { ok: true, id: out.id || null });
  } catch (e) {
    return fail(res, e);
  }
}
