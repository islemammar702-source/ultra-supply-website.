import type { DocLine } from './types';

const decimalsFor = (currency: string) => (currency === 'TND' ? 3 : 2);
const symbolFor = (currency: string) => (currency === 'TND' ? 'DT' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency);

export const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** 1 234,567 DT */
export function money(v: unknown, currency = 'TND'): string {
  const d = decimalsFor(currency);
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(toNum(v))} ${symbolFor(currency)}`;
}

/** Number without currency, fixed decimals. */
export const amount = (v: unknown, d = 3) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(toNum(v));

/** Quantity: up to 3 decimals, no trailing zeros. */
export const qty = (v: unknown) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(toNum(v));

export const pct = (v: unknown) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(toNum(v))} %`;

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Local calendar date (YYYY-MM-DD), not UTC. */
export function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfYear(): string { return `${today().slice(0, 4)}-01-01`; }
export function startOfMonth(): string { return `${today().slice(0, 7)}-01`; }

// ---------------------------------------------------------------------------
// Totals preview — exactly the database rules (the database stays authoritative).
// Computed in integer millimes to avoid floating-point drift.
// ---------------------------------------------------------------------------
const r3 = (x: number) => Math.round((x + Math.sign(x) * Number.EPSILON) * 1000) / 1000;

export function lineTotals(l: Pick<DocLine, 'quantity' | 'unit_price' | 'discount_percent' | 'vat_rate'>) {
  const ht = r3(toNum(l.quantity) * toNum(l.unit_price) * (1 - toNum(l.discount_percent) / 100));
  const vat = r3((ht * toNum(l.vat_rate)) / 100);
  return { ht, vat, ttc: r3(ht + vat) };
}

export function docTotals(lines: Pick<DocLine, 'quantity' | 'unit_price' | 'discount_percent' | 'vat_rate'>[], discountPercent: number, stamp = 0) {
  let subtotal = 0;
  let vatSum = 0;
  const byRate = new Map<number, { base: number; vat: number }>();
  const k = 1 - toNum(discountPercent) / 100;
  for (const l of lines) {
    const t = lineTotals(l);
    subtotal = r3(subtotal + t.ht);
    vatSum = r3(vatSum + t.vat);
    const rate = toNum(l.vat_rate);
    const cur = byRate.get(rate) ?? { base: 0, vat: 0 };
    byRate.set(rate, { base: r3(cur.base + t.ht * k), vat: r3(cur.vat + t.vat * k) });
  }
  const discount = r3((subtotal * toNum(discountPercent)) / 100);
  const ht = r3(subtotal - discount);
  const vat = r3(vatSum * k);
  return { subtotal, discount, ht, vat, stamp: toNum(stamp), ttc: r3(ht + vat + toNum(stamp)), byRate: [...byRate.entries()].sort((a, b) => b[0] - a[0]) };
}

// ---------------------------------------------------------------------------
// Amount in French words — "Arrêtée la présente facture à la somme de …"
// ---------------------------------------------------------------------------
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function below100(n: number): string {
  if (n <= 16) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n < 70) {
    const t = Math.floor(n / 10), u = n % 10;
    if (u === 0) return TENS[t];
    return u === 1 ? `${TENS[t]} et un` : `${TENS[t]}-${UNITS[u]}`;
  }
  if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${below100(n - 60)}`;
  if (n === 80) return 'quatre-vingts';
  return `quatre-vingt-${below100(n - 80)}`;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100), rest = n % 100;
  if (h === 0) return below100(rest);
  const head = h === 1 ? 'cent' : `${UNITS[h]} cent${rest === 0 ? 's' : ''}`;
  return rest === 0 ? head : `${head} ${below100(rest)}`;
}

export function numberToFrenchWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zéro';
  const parts: string[] = [];
  const scales: [number, string, string][] = [[1e9, 'milliard', 'milliards'], [1e6, 'million', 'millions'], [1e3, 'mille', 'mille']];
  for (const [value, singular, plural] of scales) {
    const q = Math.floor(n / value);
    if (q > 0) {
      if (value === 1e3) parts.push(q === 1 ? 'mille' : `${below1000(q).replace(/cents$/, 'cent').replace(/vingts$/, 'vingt')} mille`);
      else parts.push(`${below1000(q)} ${q > 1 ? plural : singular}`);
      n %= value;
    }
  }
  if (n > 0) parts.push(below1000(n));
  return parts.join(' ');
}

export function amountInWords(v: number, currency = 'TND'): string {
  const total = Math.round(Math.abs(toNum(v)) * (currency === 'TND' ? 1000 : 100));
  const factor = currency === 'TND' ? 1000 : 100;
  const main = Math.floor(total / factor), cents = total % factor;
  const [unitS, unitP, subS, subP] = currency === 'TND'
    ? ['dinar', 'dinars', 'millime', 'millimes']
    : currency === 'EUR' ? ['euro', 'euros', 'centime', 'centimes'] : [currency, currency, 'centime', 'centimes'];
  let s = `${numberToFrenchWords(main)} ${main > 1 ? unitP : unitS}`;
  if (cents > 0) s += ` et ${numberToFrenchWords(cents)} ${cents > 1 ? subP : subS}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function csvDownload(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(';'), ...rows.map((r) => r.map(esc).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/pdf') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
