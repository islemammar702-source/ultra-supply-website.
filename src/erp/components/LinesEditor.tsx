import { ArrowDown, ArrowUp, PackagePlus, Plus, Trash2 } from 'lucide-react';
import { newId } from '../lib/db';
import { amount, lineTotals, money, qty as fmtQty, docTotals, toNum } from '../lib/format';
import { UNITS } from '../lib/status';
import type { DocLine, ErpProduct, VatRate } from '../lib/types';
import { NumberInput, SearchSelect, inputCls } from './ui';

export const blankLine = (position: number, vat = 19): DocLine => ({
  id: newId(), position, product_id: null, reference: '', description: '', unit: 'pièce', quantity: 1, unit_price: 0, discount_percent: 0, vat_rate: vat,
});

interface Props {
  lines: DocLine[];
  onChange: (lines: DocLine[]) => void;
  products: ErpProduct[];
  vatRates: VatRate[];
  readOnly?: boolean;
  /** 'sale' prices for customer documents, 'purchase' for supplier orders, 'none' for delivery notes. */
  price: 'sale' | 'purchase' | 'none';
  currency?: string;
  defaultVat?: number;
  /** Forces 0 % VAT on new lines (VAT-exempt customer). */
  vatExempt?: boolean;
  showReceived?: boolean;
  /** Purchase orders in a foreign currency: catalogue cost (TND) is divided by this exchange rate. */
  priceDivisor?: number;
}

export function LinesEditor({ lines, onChange, products, vatRates, readOnly, price, currency = 'TND', defaultVat = 19, vatExempt, showReceived, priceDivisor = 1 }: Props) {
  const priced = price !== 'none';
  const set = (id: string, patch: Partial<DocLine>) => onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const remove = (id: string) => onChange(lines.filter((l) => l.id !== id).map((l, i) => ({ ...l, position: i + 1 })));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= lines.length) return;
    const next = [...lines];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next.map((l, k) => ({ ...l, position: k + 1 })));
  };
  const add = () => onChange([...lines, blankLine(lines.length + 1, vatExempt ? 0 : defaultVat)]);
  const pickProduct = (id: string, productId: string | null) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return set(id, { product_id: null });
    set(id, {
      product_id: p.id, reference: p.reference, description: p.name.fr || p.name.en, unit: p.unit || 'pièce',
      unit_price: Math.round(((price === 'purchase' ? toNum(p.purchase_price) : toNum(p.sale_price)) / (priceDivisor > 0 ? priceDivisor : 1)) * 1000) / 1000,
      vat_rate: vatExempt ? 0 : toNum(p.vat_rate),
    });
  };
  const productOptions = products.filter((p) => p.is_active).map((p) => ({
    value: p.id, label: `${p.reference} — ${p.name.fr || p.name.en}`,
    hint: priced ? `${price === 'purchase' ? 'Coût' : 'Prix'} ${money(price === 'purchase' ? p.purchase_price : p.sale_price)} · Stock ${fmtQty(p.stock_quantity)} ${p.unit}` : `Stock ${fmtQty(p.stock_quantity)} ${p.unit}`,
  }));
  const vatOptions = Array.from(new Set([...vatRates.filter((v) => v.is_active).map((v) => toNum(v.rate)), ...lines.map((l) => toNum(l.vat_rate))])).sort((a, b) => b - a);

  if (readOnly) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-mist text-[11px] uppercase tracking-wider text-navy/60">
            <tr>
              <th className="px-3 py-2.5 text-left">Réf.</th><th className="px-3 py-2.5 text-left">Désignation</th>
              <th className="px-3 py-2.5 text-right">Qté</th>
              {showReceived && <th className="px-3 py-2.5 text-right">Reçu</th>}
              {priced && <><th className="px-3 py-2.5 text-right">P.U. HT</th><th className="px-3 py-2.5 text-right">Rem.</th><th className="px-3 py-2.5 text-right">TVA</th><th className="px-3 py-2.5 text-right">Total HT</th></>}
            </tr>
          </thead>
          <tbody className="divide-y divide-navy/10">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2.5 font-mono text-xs text-navy/70">{l.reference || '—'}</td>
                <td className="whitespace-pre-wrap px-3 py-2.5 text-navy">{l.description}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fmtQty(l.quantity)} <span className="text-navy/45">{l.unit}</span></td>
                {showReceived && <td className={`px-3 py-2.5 text-right tabular-nums ${toNum(l.received_quantity) >= toNum(l.quantity) ? 'text-emerald-700' : 'text-amber-700'}`}>{fmtQty(l.received_quantity)}</td>}
                {priced && <>
                  <td className="px-3 py-2.5 text-right tabular-nums">{amount(l.unit_price, currency === 'TND' ? 3 : 2)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-navy/60">{toNum(l.discount_percent) ? `${toNum(l.discount_percent)} %` : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-navy/60">{toNum(l.vat_rate)} %</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{amount(l.total_ht ?? lineTotals(l).ht, currency === 'TND' ? 3 : 2)}</td>
                </>}
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-navy/50">Aucune ligne.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-3">
        {lines.map((l, i) => {
          const t = lineTotals(l);
          return (
            <div key={l.id} className="relative border border-navy/10 bg-white p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-navy/40">Ligne {i + 1}</span>
                <div className="flex items-center">
                  <button type="button" className="p-1.5 text-navy/40 hover:text-navy disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" className="p-1.5 text-navy/40 hover:text-navy disabled:opacity-30" disabled={i === lines.length - 1} onClick={() => move(i, 1)} aria-label="Descendre"><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" className="p-1.5 text-navy/40 hover:text-brand-red" onClick={() => remove(l.id)} aria-label="Supprimer la ligne"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="mt-2 grid gap-3 lg:grid-cols-12">
                <div className="lg:col-span-5">
                  <SearchSelect value={l.product_id} onChange={(v) => pickProduct(l.id, v)} options={productOptions} placeholder="Produit du catalogue (optionnel)" allowClear />
                </div>
                <input className={`${inputCls} font-mono lg:col-span-2`} placeholder="Référence" value={l.reference} onChange={(e) => set(l.id, { reference: e.target.value })} aria-label="Référence" />
                <textarea rows={1} className={`field !min-h-[42px] !py-2 text-[14px] lg:col-span-5`} placeholder="Désignation *" value={l.description}
                  onChange={(e) => set(l.id, { description: e.target.value })} aria-label="Désignation" />
              </div>
              <div className={`mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 ${priced ? 'lg:grid-cols-7' : 'lg:grid-cols-4'}`}>
                <label className="block"><span className="text-[11px] text-navy/50">Quantité</span><NumberInput value={l.quantity} onChange={(v) => set(l.id, { quantity: v })} min={0} /></label>
                <label className="block"><span className="text-[11px] text-navy/50">Unité</span>
                  <select className={inputCls} value={l.unit} onChange={(e) => set(l.id, { unit: e.target.value })}>
                    {Array.from(new Set([l.unit, ...UNITS])).map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
                {priced && <>
                  <label className="block"><span className="text-[11px] text-navy/50">P.U. HT ({currency})</span><NumberInput value={l.unit_price} onChange={(v) => set(l.id, { unit_price: v })} min={0} /></label>
                  <label className="block"><span className="text-[11px] text-navy/50">Remise %</span><NumberInput value={l.discount_percent} onChange={(v) => set(l.id, { discount_percent: Math.min(100, Math.max(0, v)) })} min={0} /></label>
                  <label className="block"><span className="text-[11px] text-navy/50">TVA</span>
                    <select className={inputCls} value={String(toNum(l.vat_rate))} onChange={(e) => set(l.id, { vat_rate: Number(e.target.value) })}>
                      {vatOptions.map((r) => <option key={r} value={r}>{r} %</option>)}
                    </select>
                  </label>
                  <div className="col-span-2 flex flex-col justify-end text-right sm:col-span-1 lg:col-span-2">
                    <span className="text-[11px] text-navy/50">Total HT · TTC</span>
                    <span className="font-semibold tabular-nums text-navy">{amount(t.ht, currency === 'TND' ? 3 : 2)} <span className="font-normal text-navy/45">· {amount(t.ttc, currency === 'TND' ? 3 : 2)}</span></span>
                  </div>
                </>}
              </div>
            </div>
          );
        })}
        {!lines.length && <p className="border border-dashed border-navy/20 px-4 py-8 text-center text-sm text-navy/50">Aucune ligne : ajoutez un produit ou une ligne libre.</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-navy !min-h-[40px] !px-4 !text-[11px]" onClick={add}><PackagePlus className="h-4 w-4" /> Ajouter une ligne</button>
        {lines.length > 0 && <button type="button" className="btn btn-ghost !min-h-[40px] !px-4 !text-[11px]" onClick={() => onChange([...lines, { ...lines[lines.length - 1], id: newId(), position: lines.length + 1 }])}><Plus className="h-4 w-4" /> Dupliquer la dernière</button>}
      </div>
    </div>
  );
}

export function TotalsPanel({ lines, discountPercent, onDiscount, stamp = 0, currency = 'TND', readOnly, server, extra }: {
  lines: DocLine[]; discountPercent: number; onDiscount?: (v: number) => void; stamp?: number; currency?: string; readOnly?: boolean;
  /** Authoritative totals from the database (shown when the document is saved and unchanged). */
  server?: { subtotal: number; discount_amount: number; total_ht: number; total_vat: number; total_ttc: number } | null;
  extra?: React.ReactNode;
}) {
  const t = docTotals(lines, discountPercent, stamp);
  const show = server ? { subtotal: server.subtotal, discount: server.discount_amount, ht: server.total_ht, vat: server.total_vat, ttc: server.total_ttc } : t;
  const row = (label: React.ReactNode, value: React.ReactNode, strong = false) => (
    <div className={`flex items-center justify-between gap-4 py-1.5 ${strong ? 'border-t-2 border-navy pt-3 text-base font-bold text-navy' : 'text-sm text-navy/75'}`}>
      <span>{label}</span><span className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="border border-navy/10 bg-white p-5">
      {row('Total brut HT', money(show.subtotal, currency))}
      <div className="flex items-center justify-between gap-4 py-1.5 text-sm text-navy/75">
        <span className="flex items-center gap-2">Remise globale
          {!readOnly && onDiscount
            ? <span className="w-20"><NumberInput value={discountPercent} onChange={(v) => onDiscount(Math.min(100, Math.max(0, v)))} /></span>
            : <span>({toNum(discountPercent)} %)</span>}
          {!readOnly && onDiscount && '%'}
        </span>
        <span className="tabular-nums">− {money(show.discount, currency)}</span>
      </div>
      {row('Total HT', <strong className="text-navy">{money(show.ht, currency)}</strong>)}
      {t.byRate.filter(([, v]) => v.base !== 0).map(([rate, v]) => row(`TVA ${rate} % (base ${amount(v.base, currency === 'TND' ? 3 : 2)})`, money(v.vat, currency)))}
      {row('Total TVA', money(show.vat, currency))}
      {toNum(stamp) > 0 && row('Timbre fiscal', money(stamp, currency))}
      {row('Total TTC', money(show.ttc, currency), true)}
      {extra}
    </div>
  );
}

/** Lines must have a description and a positive quantity. Returns an error message or null. */
export function validateLines(lines: DocLine[], priced = true): string | null {
  if (!lines.length) return null;
  for (const [i, l] of lines.entries()) {
    if (!l.description.trim()) return `Ligne ${i + 1} : la désignation est obligatoire.`;
    if (!(toNum(l.quantity) > 0)) return `Ligne ${i + 1} : la quantité doit être positive.`;
    if (priced && toNum(l.unit_price) < 0) return `Ligne ${i + 1} : prix invalide.`;
  }
  return null;
}
