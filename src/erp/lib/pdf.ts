/**
 * Branded PDF documents for ULTRA SUPPLY (quotations, invoices, credit notes, receipts,
 * purchase orders, delivery notes). Pure pdf-lib: runs in the browser, no server needed.
 */
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';

const NAVY = rgb(0x12 / 255, 0x3b / 255, 0x70 / 255);
const NAVY_950 = rgb(0x0a / 255, 0x24 / 255, 0x45 / 255);
const RED = rgb(0xd9 / 255, 0x23 / 255, 0x32 / 255);
const INK = rgb(0.1, 0.13, 0.2);
const MUTED = rgb(0.42, 0.47, 0.55);
const LINE = rgb(0.86, 0.89, 0.93);
const MIST = rgb(0.953, 0.961, 0.969);
const WHITE = rgb(1, 1, 1);

const A4: [number, number] = [595.28, 841.89];
const M = 40;                       // page margin
const W = A4[0] - 2 * M;            // content width
const FOOTER_H = 58;

export interface PdfCompany {
  legal_name: string; activity: string; address: string; city: string; postal_code: string; country: string;
  phone: string; phone2: string; email: string; website: string; tax_id: string; trade_register: string;
  bank_name: string; bank_account: string; bank_swift: string; pdf_footer: string;
}

export interface PdfParty {
  heading: string; name: string; lines: string[];
}

export interface PdfLine {
  reference: string; description: string; quantity: number; unit: string;
  unit_price?: number; discount_percent?: number; vat_rate?: number; total_ht?: number;
}

export interface PdfTotals {
  subtotal: number; discount_percent: number; discount: number; total_ht: number;
  vat: [rate: number, base: number, vat: number][]; total_vat: number; stamp: number; total_ttc: number;
}

export interface PdfDoc {
  title: string;                       // DEVIS, FACTURE…
  number: string;
  meta: [string, string][];            // Date, Validité, Échéance…
  party: PdfParty;
  lines?: PdfLine[];
  priced: boolean;
  currency: string;
  totals?: PdfTotals;
  words?: string;                      // amount in words sentence
  summary?: [string, string][];        // paid / balance…
  table?: { headers: string[]; widths: number[]; align: ('l' | 'r')[]; rows: string[][]; title?: string };
  notes?: string;
  terms?: string;
  signatures?: string[];
  watermark?: string;
}

// ---------------------------------------------------------------------------
const fmt = (v: number, d: number) => {
  const neg = v < 0;
  const [i, f] = Math.abs(v).toFixed(d).split('.');
  return `${neg ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${f ? ',' + f : ''}`;
};
const dec = (c: string) => (c === 'TND' ? 3 : 2);
const cur = (c: string) => (c === 'TND' ? 'DT' : c);
const fq = (v: number) => fmt(v, Number.isInteger(v) ? 0 : 3).replace(/,?0+$/, (m) => (m.startsWith(',') ? '' : m));

class Writer {
  pdf!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  logo: PDFImage | null = null;
  page!: PDFPage;
  y = 0;
  chars!: Set<number>;
  pages: PDFPage[] = [];

  constructor(public doc: PdfDoc, public company: PdfCompany) {}

  async init(logoBytes?: Uint8Array | null) {
    this.pdf = await PDFDocument.create();
    this.pdf.setTitle(`${this.doc.title} ${this.doc.number}`);
    this.pdf.setAuthor(this.company.legal_name || 'ULTRA SUPPLY');
    this.pdf.setCreator('ULTRA SUPPLY — Gestion');
    this.pdf.setProducer('ULTRA SUPPLY');
    this.font = await this.pdf.embedFont(StandardFonts.Helvetica);
    this.bold = await this.pdf.embedFont(StandardFonts.HelveticaBold);
    this.chars = new Set(this.font.getCharacterSet());
    if (logoBytes?.length) {
      try { this.logo = await this.pdf.embedPng(logoBytes); } catch { try { this.logo = await this.pdf.embedJpg(logoBytes); } catch { this.logo = null; } }
    }
  }

  /** Keeps only characters the standard PDF font can encode. */
  s(text: unknown): string {
    return String(text ?? '')
      .replace(/[\u202f\u2009\u2007]/g, ' ')
      .replace(/[\u2010-\u2012]/g, '-')
      .replace(/\u2265/g, '>=').replace(/\u2264/g, '<=').replace(/\u2192/g, '->')
      .replace(/\t/g, ' ')
      .split('')
      .map((ch) => (ch === '\n' || this.chars.has(ch.codePointAt(0) ?? 0) ? ch : '?'))
      .join('');
  }

  width(text: string, size: number, bold = false) { return (bold ? this.bold : this.font).widthOfTextAtSize(this.s(text), size); }

  text(text: string, x: number, y: number, size = 9, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; align?: 'l' | 'r' | 'c'; maxWidth?: number } = {}) {
    let t = this.s(text);
    const f = opts.bold ? this.bold : this.font;
    if (opts.maxWidth) while (t.length > 1 && f.widthOfTextAtSize(t, size) > opts.maxWidth) t = t.slice(0, -2) + '…';
    const w = f.widthOfTextAtSize(t, size);
    const dx = opts.align === 'r' ? -w : opts.align === 'c' ? -w / 2 : 0;
    this.page.drawText(t, { x: x + dx, y, size, font: f, color: opts.color ?? INK });
  }

  wrap(text: string, size: number, maxWidth: number, bold = false): string[] {
    const f = bold ? this.bold : this.font;
    const out: string[] = [];
    for (const para of this.s(text).split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); continue; }
      let line = '';
      for (const w of words) {
        const tryLine = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(tryLine, size) <= maxWidth) { line = tryLine; continue; }
        if (line) out.push(line);
        // very long word: hard split
        let rest = w;
        while (f.widthOfTextAtSize(rest, size) > maxWidth) {
          let cut = rest.length;
          while (cut > 1 && f.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
          out.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
      if (line) out.push(line);
    }
    return out;
  }

  rect(x: number, y: number, w: number, h: number, color: ReturnType<typeof rgb>, border?: ReturnType<typeof rgb>) {
    this.page.drawRectangle({ x, y, width: w, height: h, color, borderColor: border, borderWidth: border ? 0.6 : 0 });
  }

  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.6) {
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness });
  }

  newPage(first: boolean) {
    this.page = this.pdf.addPage(A4);
    this.pages.push(this.page);
    const top = A4[1] - M;
    // Brand band
    this.rect(0, A4[1] - 6, A4[0], 6, NAVY);
    this.rect(0, A4[1] - 6, 120, 6, RED);
    if (first) {
      const logoH = 46;
      if (this.logo) {
        const w = (this.logo.width / this.logo.height) * logoH;
        this.page.drawImage(this.logo, { x: M, y: top - logoH + 4, width: w, height: logoH });
      } else {
        this.text('ULTRA', M, top - 22, 22, { bold: true, color: NAVY });
        this.text('SUPPLY', M + this.width('ULTRA ', 22, true), top - 22, 22, { bold: true, color: RED });
      }
      const c = this.company;
      const right = M + W;
      let yy = top - 4;
      this.text(c.legal_name || 'ULTRA SUPPLY', right, yy, 11, { bold: true, color: NAVY, align: 'r' });
      yy -= 12;
      const info = [
        c.activity,
        [c.address, [c.postal_code, c.city].filter(Boolean).join(' '), c.country].filter(Boolean).join(', '),
        [c.phone && `Tél. ${c.phone}`, c.phone2].filter(Boolean).join(' / '),
        [c.email, c.website].filter(Boolean).join(' · '),
      ].filter(Boolean);
      for (const l of info) { this.text(l, right, yy, 7.8, { color: MUTED, align: 'r', maxWidth: 300 }); yy -= 10; }
      this.y = Math.min(top - logoH - 14, yy - 6);
    } else {
      const logoH = 26;
      if (this.logo) {
        const w = (this.logo.width / this.logo.height) * logoH;
        this.page.drawImage(this.logo, { x: M, y: top - logoH + 6, width: w, height: logoH });
      }
      this.text(`${this.doc.title} ${this.doc.number}`, M + W, top - 10, 10, { bold: true, color: NAVY, align: 'r' });
      this.y = top - 34;
    }
    if (this.doc.watermark) {
      this.page.drawText(this.s(this.doc.watermark), {
        x: 120, y: 260, size: 86, font: this.bold, color: rgb(0.85, 0.13, 0.2), opacity: 0.08, rotate: degrees(35),
      });
    }
  }

  ensure(h: number) {
    if (this.y - h < M + FOOTER_H) this.newPage(false);
  }

  header() {
    const d = this.doc;
    this.line(M, this.y, M + W, this.y, LINE, 0.8);
    this.y -= 26;
    const top = this.y;
    // Left: title, number, meta
    this.text(d.title, M, top, 22, { bold: true, color: NAVY });
    this.rect(M, top - 9, 36, 2.4, RED);
    this.text(`N° ${d.number}`, M, top - 25, 11, { bold: true, color: RED });
    let ly = top - 44;
    for (const [k, v] of d.meta) {
      this.text(k, M, ly, 8.5, { color: MUTED });
      this.text(v, M + 92, ly, 8.5, { bold: true, maxWidth: 160 });
      ly -= 13;
    }
    // Right: party box
    const bx = M + 285, bw = W - 285;
    const lines = d.party.lines.filter(Boolean).flatMap((l) => this.wrap(l, 8.5, bw - 24));
    const nameLines = this.wrap(d.party.name, 11, bw - 24, true);
    const bh = 30 + nameLines.length * 14 + lines.length * 11.5 + 6;
    const by = top + 14 - bh;
    this.rect(bx, by, bw, bh, MIST);
    this.rect(bx, by, 3, bh, NAVY);
    this.text(d.party.heading.toUpperCase(), bx + 14, top, 7.5, { bold: true, color: RED });
    let py = top - 16;
    for (const n of nameLines) { this.text(n, bx + 14, py, 11, { bold: true, color: NAVY_950 }); py -= 14; }
    for (const l of lines) { this.text(l, bx + 14, py, 8.5, { color: INK }); py -= 11.5; }
    this.y = Math.min(ly, by) - 18;
  }

  linesTable() {
    const d = this.doc;
    if (!d.lines) return;
    const dd = dec(d.currency);
    const cols = d.priced
      ? [{ h: 'Réf.', w: 76, a: 'l' }, { h: 'Désignation', w: 0, a: 'l' }, { h: 'Qté', w: 46, a: 'r' }, { h: `P.U. HT`, w: 64, a: 'r' },
         { h: 'Rem.', w: 34, a: 'r' }, { h: 'TVA', w: 32, a: 'r' }, { h: `Total HT`, w: 72, a: 'r' }]
      : [{ h: 'Réf.', w: 80, a: 'l' }, { h: 'Désignation', w: 0, a: 'l' }, { h: 'Quantité', w: 70, a: 'r' }, { h: 'Unité', w: 60, a: 'l' }];
    const fixed = cols.reduce((s, c) => s + c.w, 0);
    cols[1].w = W - fixed;
    const pad = 5;
    const drawHead = () => {
      this.ensure(40);
      this.rect(M, this.y - 18, W, 20, NAVY);
      let x = M;
      for (const c of cols) {
        this.text(c.h, c.a === 'r' ? x + c.w - pad : x + pad, this.y - 11.5, 7.8, { bold: true, color: WHITE, align: c.a === 'r' ? 'r' : 'l' });
        x += c.w;
      }
      this.y -= 20;
    };
    drawHead();
    d.lines.forEach((l, i) => {
      const desc = this.wrap(l.description, 8.5, cols[1].w - 2 * pad);
      const ref = this.wrap(l.reference || '—', 7.2, cols[0].w - 2 * pad).slice(0, 3);
      const h = Math.max(desc.length * 11, ref.length * 9.5) + 9;
      if (this.y - h < M + FOOTER_H) { this.newPage(false); drawHead(); }
      if (i % 2 === 1) this.rect(M, this.y - h, W, h, MIST);
      const ty = this.y - 12;
      let x = M;
      ref.forEach((r, k) => this.text(r, x + pad, ty - k * 9.5, 7.2, { color: MUTED }));
      x += cols[0].w;
      desc.forEach((t, k) => this.text(t, x + pad, ty - k * 11, 8.5));
      x += cols[1].w;
      if (d.priced) {
        const vals = [
          `${fq(l.quantity)} ${l.unit && l.unit !== 'pièce' ? l.unit : ''}`.trim(),
          fmt(l.unit_price ?? 0, dd),
          l.discount_percent ? `${fq(l.discount_percent)}%` : '-',
          `${fq(l.vat_rate ?? 0)}%`,
          fmt(l.total_ht ?? 0, dd),
        ];
        vals.forEach((v, k) => {
          const c = cols[k + 2];
          this.text(v, x + c.w - pad, ty, 8.5, { bold: k === 4, align: 'r', maxWidth: c.w - 4 });
          x += c.w;
        });
      } else {
        this.text(fq(l.quantity), x + cols[2].w - pad, ty, 9, { bold: true, align: 'r' });
        x += cols[2].w;
        this.text(l.unit || '', x + pad, ty, 8.5, { color: MUTED });
      }
      this.y -= h;
      this.line(M, this.y, M + W, this.y);
    });
    if (!d.lines.length) {
      this.text('Aucune ligne.', M + pad, this.y - 14, 9, { color: MUTED });
      this.y -= 22;
    }
    this.y -= 14;
  }

  genericTable() {
    const t = this.doc.table;
    if (!t) return;
    if (t.title) { this.ensure(40); this.text(t.title.toUpperCase(), M, this.y, 8, { bold: true, color: RED }); this.y -= 10; }
    const total = t.widths.reduce((a, b) => a + b, 0);
    const widths = t.widths.map((w) => (w / total) * W);
    this.ensure(40);
    this.rect(M, this.y - 18, W, 20, NAVY);
    let x = M;
    t.headers.forEach((h, i) => { this.text(h, t.align[i] === 'r' ? x + widths[i] - 5 : x + 5, this.y - 11.5, 7.8, { bold: true, color: WHITE, align: t.align[i] === 'r' ? 'r' : 'l' }); x += widths[i]; });
    this.y -= 20;
    t.rows.forEach((r, ri) => {
      this.ensure(22);
      if (ri % 2 === 1) this.rect(M, this.y - 18, W, 18, MIST);
      let xx = M;
      r.forEach((v, i) => { this.text(v, t.align[i] === 'r' ? xx + widths[i] - 5 : xx + 5, this.y - 12, 8.5, { align: t.align[i] === 'r' ? 'r' : 'l', maxWidth: widths[i] - 8 }); xx += widths[i]; });
      this.y -= 18;
      this.line(M, this.y, M + W, this.y);
    });
    this.y -= 16;
  }

  totalsBlock() {
    const d = this.doc;
    const t = d.totals;
    const dd = dec(d.currency);
    const c = cur(d.currency);
    const leftW = W - 230 - 16;
    // Estimate needed height
    const wordsLines = d.words ? this.wrap(d.words, 8.5, leftW - 20).length : 0;
    const vatRows = t ? t.vat.length : 0;
    const need = Math.max(t ? 26 + 15 * (5 + (t.stamp ? 1 : 0)) : 0, 30 + vatRows * 13 + wordsLines * 11 + (d.summary?.length ?? 0) * 13 + 30);
    this.ensure(need);
    const top = this.y;
    let ly = top;
    if (t && t.vat.length) {
      this.text('DÉTAIL TVA', M, ly, 7.5, { bold: true, color: RED });
      ly -= 13;
      this.text('Taux', M, ly, 7.5, { color: MUTED });
      this.text('Base HT', M + 120, ly, 7.5, { color: MUTED, align: 'r' });
      this.text('Montant TVA', M + 210, ly, 7.5, { color: MUTED, align: 'r' });
      ly -= 4;
      this.line(M, ly, M + 215, ly);
      ly -= 11;
      for (const [rate, base, vat] of t.vat) {
        this.text(`${fq(rate)} %`, M, ly, 8.5);
        this.text(fmt(base, dd), M + 120, ly, 8.5, { align: 'r' });
        this.text(fmt(vat, dd), M + 210, ly, 8.5, { align: 'r' });
        ly -= 13;
      }
      ly -= 8;
    }
    if (d.words) {
      const lines = this.wrap(d.words, 8.5, leftW - 20);
      this.rect(M, ly - lines.length * 11 - 8, leftW, lines.length * 11 + 16, MIST);
      this.rect(M, ly - lines.length * 11 - 8, 3, lines.length * 11 + 16, RED);
      lines.forEach((l, i) => this.text(l, M + 12, ly - 2 - i * 11, 8.5, { bold: i === 0 && false, color: NAVY_950 }));
      ly -= lines.length * 11 + 22;
    }
    if (d.summary?.length) {
      for (const [k, v] of d.summary) {
        this.text(k, M, ly, 8.5, { color: MUTED });
        this.text(v, M + leftW - 10, ly, 8.5, { bold: true, align: 'r' });
        ly -= 13;
      }
    }
    // Right: totals box
    let ry = top + 4;
    if (t) {
      const bx = M + W - 230, bw = 230;
      const rows: [string, string, boolean?][] = [['Total brut HT', fmt(t.subtotal, dd)]];
      if (t.discount) rows.push([`Remise (${fq(t.discount_percent)} %)`, `- ${fmt(t.discount, dd)}`]);
      rows.push(['Total HT', fmt(t.total_ht, dd)], ['Total TVA', fmt(t.total_vat, dd)]);
      if (t.stamp) rows.push(['Timbre fiscal', fmt(t.stamp, dd)]);
      for (const [k, v] of rows) {
        this.text(k, bx + 10, ry - 12, 9, { color: INK });
        this.text(`${v} ${c}`, bx + bw - 10, ry - 12, 9, { align: 'r', bold: k === 'Total HT' });
        ry -= 16;
        this.line(bx, ry + 1, bx + bw, ry + 1);
      }
      this.rect(bx, ry - 26, bw, 26, NAVY);
      this.rect(bx, ry - 26, 4, 26, RED);
      this.text('TOTAL TTC', bx + 14, ry - 17, 10, { bold: true, color: WHITE });
      this.text(`${fmt(t.total_ttc, dd)} ${c}`, bx + bw - 10, ry - 17, 11.5, { bold: true, color: WHITE, align: 'r' });
      ry -= 34;
    }
    this.y = Math.min(ly, ry) - 12;
  }

  paragraphs() {
    const d = this.doc;
    for (const [label, body] of [['Observations', d.notes], ['Conditions', d.terms]] as const) {
      if (!body?.trim()) continue;
      const lines = this.wrap(body, 8, W);
      this.ensure(24 + Math.min(lines.length, 4) * 10);
      this.text(label.toUpperCase(), M, this.y, 7.5, { bold: true, color: RED });
      this.y -= 12;
      for (const l of lines) { this.ensure(12); this.text(l, M, this.y, 8, { color: INK }); this.y -= 10; }
      this.y -= 10;
    }
  }

  signatureBoxes() {
    const sig = this.doc.signatures;
    if (!sig?.length) return;
    this.ensure(90);
    const gap = 16;
    const w = (W - gap * (sig.length - 1)) / sig.length;
    sig.forEach((label, i) => {
      const x = M + i * (w + gap);
      this.page.drawRectangle({ x, y: this.y - 70, width: w, height: 70, borderColor: LINE, borderWidth: 0.8 });
      this.text(label, x + 8, this.y - 12, 7.5, { bold: true, color: MUTED });
    });
    this.y -= 84;
  }

  footers() {
    const c = this.company;
    const total = this.pages.length;
    const l1 = [c.legal_name, [c.address, c.city].filter(Boolean).join(', '), c.phone && `Tél. ${c.phone}`, c.email].filter(Boolean).join('  ·  ');
    const l2 = [c.tax_id && `MF : ${c.tax_id}`, c.trade_register && `RC : ${c.trade_register}`, c.bank_account && `RIB : ${c.bank_account}${c.bank_name ? ` (${c.bank_name})` : ''}`, c.bank_swift && `SWIFT : ${c.bank_swift}`].filter(Boolean).join('  ·  ');
    this.pages.forEach((p, i) => {
      this.page = p;
      const y = M + 26;
      this.line(M, y + 12, M + W, y + 12, NAVY, 0.8);
      this.text(l1, M + W / 2, y, 7, { color: MUTED, align: 'c', maxWidth: W - 60 });
      if (l2) this.text(l2, M + W / 2, y - 10, 7, { color: MUTED, align: 'c', maxWidth: W - 60 });
      if (c.pdf_footer) this.text(c.pdf_footer, M + W / 2, y - 20, 6.8, { color: MUTED, align: 'c', maxWidth: W - 60 });
      this.text(`Page ${i + 1} / ${total}`, M + W, y - 10, 7, { color: MUTED, align: 'r' });
    });
  }
}

export async function buildPdf(doc: PdfDoc, company: PdfCompany, logo?: Uint8Array | null): Promise<Uint8Array> {
  const w = new Writer(doc, company);
  await w.init(logo);
  w.newPage(true);
  w.header();
  w.linesTable();
  w.genericTable();
  w.totalsBlock();
  w.paragraphs();
  w.signatureBoxes();
  w.footers();
  return w.pdf.save();
}

// ---------------------------------------------------------------------------
// Browser helper: fetch the official logo once.
// ---------------------------------------------------------------------------
let logoCache: Promise<Uint8Array | null> | null = null;
export function loadLogo(url = '/brand/logo-pdf.png'): Promise<Uint8Array | null> {
  if (!logoCache) {
    logoCache = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? new Uint8Array(b) : null))
      .catch(() => null);
  }
  return logoCache;
}
