import { accessToken, logEvent, sb, unwrap } from './db';
import { amountInWords, docTotals, downloadBytes, fmtDate, money, toNum } from './format';
import type { PdfCompany, PdfDoc, PdfParty } from './pdf';
import type {
  CompanySettings, Customer, DeliveryNote, DocLine, DocumentRow, Invoice, Payment, PaymentMethod, PurchaseOrder, Quotation, Supplier,
} from './types';

export const companyFromSettings = (s: CompanySettings): PdfCompany => ({
  legal_name: s.legal_name || s.company_name, activity: s.activity, address: s.address, city: s.city, postal_code: s.postal_code,
  country: s.country, phone: s.phone, phone2: s.phone2, email: s.email, website: s.website, tax_id: s.tax_id,
  trade_register: s.trade_register, bank_name: s.bank_name, bank_account: s.bank_account, bank_swift: s.bank_swift, pdf_footer: s.pdf_footer,
});

type PartyLike = Partial<Pick<Customer, 'code' | 'name' | 'contact_name' | 'tax_id' | 'address' | 'city' | 'postal_code' | 'country' | 'phone' | 'email'>>;

function party(heading: string, c: PartyLike): PdfParty {
  return {
    heading,
    name: c.name ?? '',
    lines: [
      c.contact_name ? `À l'attention de : ${c.contact_name}` : '',
      c.address ?? '',
      [c.postal_code, c.city].filter(Boolean).join(' ') + (c.country && c.country !== 'Tunisie' ? `, ${c.country}` : ''),
      c.tax_id ? `Matricule fiscal : ${c.tax_id}` : '',
      [c.phone, c.email].filter(Boolean).join(' · '),
      c.code ? `Code client : ${c.code}` : '',
    ].filter((l) => l.trim()),
  };
}

const pdfLines = (lines: DocLine[]) => lines.map((l) => ({
  reference: l.reference, description: l.description, quantity: toNum(l.quantity), unit: l.unit,
  unit_price: toNum(l.unit_price), discount_percent: toNum(l.discount_percent), vat_rate: toNum(l.vat_rate), total_ht: toNum(l.total_ht),
}));

function totals(lines: DocLine[], d: { subtotal: number; discount_percent: number; discount_amount: number; total_ht: number; total_vat: number; total_ttc: number }, stamp = 0) {
  const preview = docTotals(lines, d.discount_percent, stamp);
  return {
    subtotal: toNum(d.subtotal), discount_percent: toNum(d.discount_percent), discount: toNum(d.discount_amount), total_ht: toNum(d.total_ht),
    vat: preview.byRate.map(([rate, v]) => [rate, v.base, v.vat] as [number, number, number]), total_vat: toNum(d.total_vat),
    stamp: toNum(stamp), total_ttc: toNum(d.total_ttc),
  };
}

export function quotationDoc(q: Quotation, lines: DocLine[], c: Customer): PdfDoc {
  return {
    title: 'DEVIS', number: q.number,
    meta: [['Date', fmtDate(q.issue_date)], ['Valable jusqu’au', fmtDate(q.valid_until)], ...(q.customer_reference ? [['Votre référence', q.customer_reference] as [string, string]] : [])],
    party: party('Client', c), lines: pdfLines(lines), priced: true, currency: q.currency,
    totals: totals(lines, q), words: `Arrêté le présent devis à la somme de : ${amountInWords(q.total_ttc, q.currency)} TTC.`,
    notes: q.notes, terms: q.terms, signatures: ['Bon pour accord — cachet et signature du client', 'ULTRA SUPPLY'],
    watermark: q.status === 'draft' ? 'BROUILLON' : q.status === 'rejected' ? 'REFUSÉ' : undefined,
  };
}

export function invoiceDoc(inv: Invoice, lines: DocLine[], c: Customer, original?: Invoice | null): PdfDoc {
  const credit = inv.kind === 'credit_note';
  const snap = (inv.customer_snapshot ?? c) as PartyLike;
  const meta: [string, string][] = [['Date', fmtDate(inv.issue_date)]];
  if (!credit && inv.due_date) meta.push(['Échéance', fmtDate(inv.due_date)]);
  if (credit && original) meta.push(['Facture d’origine', `${original.number ?? ''} du ${fmtDate(original.issue_date)}`]);
  if (inv.customer_reference) meta.push(['Votre référence', inv.customer_reference]);
  const summary: [string, string][] = [];
  if (!credit && inv.status !== 'draft') {
    if (toNum(inv.amount_paid)) summary.push(['Déjà réglé', money(inv.amount_paid, inv.currency)]);
    if (toNum(inv.amount_credited)) summary.push(['Avoirs', money(inv.amount_credited, inv.currency)]);
    summary.push(['Reste à payer', money(inv.balance_due, inv.currency)]);
  }
  return {
    title: credit ? 'AVOIR' : 'FACTURE', number: inv.number ?? 'BROUILLON', meta,
    party: party('Client', { ...c, ...snap }), lines: pdfLines(lines), priced: true, currency: inv.currency,
    totals: totals(lines, inv, toNum(inv.fiscal_stamp)),
    words: `Arrêté${credit ? ' le présent avoir' : 'e la présente facture'} à la somme de : ${amountInWords(inv.total_ttc, inv.currency)}.`,
    summary, notes: [credit && inv.reason ? `Motif : ${inv.reason}` : '', inv.notes].filter(Boolean).join('\n'), terms: inv.terms,
    watermark: inv.status === 'draft' ? 'BROUILLON' : inv.status === 'cancelled' ? 'ANNULÉE' : undefined,
  };
}

export function receiptDoc(p: Payment, receiptNumber: string, c: Customer, method: PaymentMethod | undefined,
  allocations: { number: string; date: string; amount: number }[]): PdfDoc {
  const meta: [string, string][] = [['Date du paiement', fmtDate(p.payment_date)], ['Mode', method?.label ?? '—']];
  if (p.reference) meta.push(['Référence', p.reference]);
  if (p.bank_name) meta.push(['Banque', p.bank_name]);
  if (p.due_date) meta.push(['Échéance', fmtDate(p.due_date)]);
  meta.push(['Encaissement', p.number]);
  const unallocated = toNum(p.amount) - toNum(p.allocated_amount);
  return {
    title: 'REÇU DE PAIEMENT', number: receiptNumber, meta, party: party('Reçu de', c), priced: false, currency: 'TND',
    table: {
      title: 'Affectation du paiement', headers: ['Facture', 'Date', 'Montant affecté'], widths: [3, 2, 2], align: ['l', 'l', 'r'],
      rows: [
        ...allocations.map((a) => [a.number, fmtDate(a.date), money(a.amount)]),
        ...(unallocated > 0.0005 ? [[p.is_deposit ? 'Acompte (non affecté)' : 'Montant non affecté', '', money(unallocated)]] : []),
      ],
    },
    summary: [['Montant reçu', money(p.amount)]],
    words: `Reçu la somme de : ${amountInWords(p.amount)}.`,
    notes: p.notes, signatures: ['Signature et cachet ULTRA SUPPLY'],
    watermark: p.status === 'cancelled' ? 'ANNULÉ' : undefined,
  };
}

export function purchaseOrderDoc(po: PurchaseOrder, lines: DocLine[], s: Supplier): PdfDoc {
  return {
    title: 'BON DE COMMANDE', number: po.number,
    meta: [['Date', fmtDate(po.order_date)], ...(po.expected_date ? [['Livraison souhaitée', fmtDate(po.expected_date)] as [string, string]] : []),
           ['Devise', po.currency], ...(po.supplier_reference ? [['Réf. fournisseur', po.supplier_reference] as [string, string]] : [])],
    party: { heading: 'Fournisseur', name: s.name, lines: [s.contact_name && `Contact : ${s.contact_name}`, s.address, [s.city, s.country].filter(Boolean).join(', '), s.tax_id && `N° fiscal : ${s.tax_id}`, [s.phone, s.email].filter(Boolean).join(' · ')].filter(Boolean) as string[] },
    lines: pdfLines(lines), priced: true, currency: po.currency, totals: totals(lines, po),
    notes: po.notes, terms: po.terms, signatures: ['Visa et cachet ULTRA SUPPLY'],
    watermark: po.status === 'draft' ? 'BROUILLON' : po.status === 'cancelled' ? 'ANNULÉ' : undefined,
  };
}

export function deliveryNoteDoc(d: DeliveryNote, lines: DocLine[], c: Customer, refs: { invoice?: string | null; order?: string | null }): PdfDoc {
  const meta: [string, string][] = [['Date de livraison', fmtDate(d.delivery_date)]];
  if (refs.order) meta.push(['Commande', refs.order]);
  if (refs.invoice) meta.push(['Facture', refs.invoice]);
  if (d.carrier) meta.push(['Transporteur', d.carrier]);
  if (d.vehicle) meta.push(['Véhicule', d.vehicle]);
  return {
    title: 'BON DE LIVRAISON', number: d.number, meta,
    party: { ...party('Livré à', c), lines: [d.delivery_address || '', ...party('', c).lines.filter((l) => !l.startsWith(c.address))].filter(Boolean) },
    lines: pdfLines(lines), priced: false, currency: 'TND', notes: d.notes,
    signatures: ['Remis par (ULTRA SUPPLY)', 'Reçu par le client — nom, date, signature'],
    watermark: d.status === 'draft' ? 'BROUILLON' : d.status === 'cancelled' ? 'ANNULÉ' : undefined,
  };
}

/** Builds the PDF. pdf-lib is loaded on demand so admin pages stay light. */
export async function renderPdf(doc: PdfDoc, settings: CompanySettings): Promise<Uint8Array> {
  const { buildPdf, loadLogo } = await import('./pdf');
  return buildPdf(doc, companyFromSettings(settings), await loadLogo());
}

export const pdfFileName = (doc: PdfDoc) => `${doc.title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/(^-|-$)/g, '')}-${doc.number}.pdf`.replace(/[^\w.-]+/g, '-');

const FOLDERS: Record<string, string> = {
  quotation: 'quotations', invoice: 'invoices', credit_note: 'credit_notes', receipt: 'receipts', purchase_order: 'purchase_orders',
  delivery_note: 'delivery_notes', supplier_invoice: 'supplier_invoices', supplier_document: 'suppliers', customer_document: 'customers', other: 'other',
};

const ALLOWED_UPLOADS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const MAX_UPLOAD = 15 * 1024 * 1024;

/** Validates then stores a file in the private "documents" bucket and registers it. */
export async function storeDocument(input: {
  docType: string; entityType: string; entityId: string | null; title: string; fileName: string; data: Blob; notes?: string;
}): Promise<DocumentRow> {
  if (!ALLOWED_UPLOADS.includes(input.data.type)) throw new Error('Format non autorisé (PDF, JPG, PNG ou WebP uniquement).');
  if (input.data.size > MAX_UPLOAD) throw new Error('Fichier trop volumineux (15 Mo maximum).');
  if (input.data.size === 0) throw new Error('Fichier vide.');
  const folder = FOLDERS[input.docType] ?? 'other';
  const safe = input.fileName.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-80) || 'document';
  const path = `${folder}/${input.entityId ?? 'general'}/${Date.now()}-${safe}`;
  unwrap(await sb().storage.from('documents').upload(path, input.data, { contentType: input.data.type, upsert: false }));
  try {
    return unwrap(await sb().from('documents').insert({
      doc_type: input.docType, entity_type: input.entityType, entity_id: input.entityId, title: input.title.slice(0, 200),
      file_path: path, file_name: safe, mime_type: input.data.type, size_bytes: input.data.size, notes: input.notes ?? '',
    }).select('*').single()) as DocumentRow;
  } catch (e) {
    await sb().storage.from('documents').remove([path]);
    throw e;
  }
}

export async function openDocument(path: string) {
  const { data, error } = await sb().storage.from('documents').createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error('Impossible d’ouvrir le document.');
  window.open(data.signedUrl, '_blank', 'noopener');
}

export async function listDocuments(entityType: string, entityId: string): Promise<DocumentRow[]> {
  return unwrap(await sb().from('documents').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at', { ascending: false })) as DocumentRow[];
}

/**
 * Generates the PDF, downloads it, and archives a copy (when allowed).
 * Returns the bytes for e-mailing.
 */
export async function generateAndDownload(opts: {
  doc: PdfDoc; settings: CompanySettings; docType: string; entityType: string; entityId: string; archive: boolean; download?: boolean;
}): Promise<{ bytes: Uint8Array; fileName: string; archived: boolean }> {
  const bytes = await renderPdf(opts.doc, opts.settings);
  const fileName = pdfFileName(opts.doc);
  if (opts.download !== false) downloadBytes(bytes, fileName);
  let archived = false;
  if (opts.archive && !opts.doc.watermark) {
    try {
      await storeDocument({ docType: opts.docType, entityType: opts.entityType, entityId: opts.entityId, title: `${opts.doc.title} ${opts.doc.number}`, fileName, data: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }) });
      archived = true;
    } catch { /* archiving is best-effort; the user already has the file */ }
  }
  void logEvent('document.generated', opts.entityType, opts.entityId, `${opts.doc.title} ${opts.doc.number}`);
  return { bytes, fileName, archived };
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export interface EmailResult { sent: boolean; reason?: string }

/**
 * Sends a document by e-mail through the server function (/api/send-email).
 * If e-mail sending is not configured on the server, falls back to the user's mail client.
 */
export async function emailDocument(input: {
  to: string; cc?: string; subject: string; message: string; bytes: Uint8Array; fileName: string; entityType: string; entityId: string; permission: string;
}): Promise<EmailResult> {
  const res = await fetch('/api/send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken()}` },
    body: JSON.stringify({
      to: input.to, cc: input.cc || undefined, subject: input.subject, message: input.message,
      attachment: { filename: input.fileName, content: toBase64(input.bytes) },
      entity_type: input.entityType, entity_id: input.entityId, permission: input.permission,
    }),
  }).catch(() => null);
  if (res && res.ok) return { sent: true };
  const body = res ? await res.json().catch(() => ({})) as { error?: string } : {};
  if (!res || res.status === 404 || res.status === 501) {
    downloadBytes(input.bytes, input.fileName);
    const href = `mailto:${encodeURIComponent(input.to)}?subject=${encodeURIComponent(input.subject)}&body=${encodeURIComponent(input.message + '\n\n(Document joint : ' + input.fileName + ')')}`;
    window.location.href = href;
    return { sent: false, reason: 'L’envoi automatique n’est pas configuré : le PDF a été téléchargé et votre messagerie ouverte. Joignez-y le fichier.' };
  }
  throw new Error(body.error || `Échec de l’envoi (${res.status}).`);
}
