import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, Download, Loader2, Scale } from 'lucide-react';
import { Modal, PageHeader, toast } from '@/admin/ui';
import { errMsg, logEvent, rpc, sb, unwrap } from '../lib/db';
import { useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { loadErpProducts } from '../lib/data';
import { addDays, csvDownload, fmtDateTime, money, qty, toNum, today } from '../lib/format';
import { MOVEMENT_REASON } from '../lib/status';
import type { ErpProduct, StockMovement } from '../lib/types';
import { DataTable, DateRange, ErrorBox, Field, FilterChips, NumberInput, Pill, SearchBar, SearchSelect, StatCard, Tabs, TextArea } from '../components/ui';

interface StockRow {
  id: string; reference: string; name: string; category: string; brand: string; unit: string; stock_quantity: number; min_stock: number;
  sale_price: number; unit_cost: number | null; stock_value: number | null; sale_value: number; stock_status: 'ok' | 'low' | 'out'; last_movement: string | null;
}

export default function InventoryPage() {
  const { can } = useAccess();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'levels' | 'movements'>(params.get('product') ? 'movements' : 'levels');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'' | 'low' | 'out' | 'ok'>((params.get('filter') as 'low') ?? '');
  const [move, setMove] = useState<null | { kind: 'entry' | 'exit' | 'adjustment'; product?: string }>(null);
  const stock = useAsync(() => rpc<StockRow[]>('report_stock'), []);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (stock.data ?? []).filter((r) => (!filter || (filter === 'low' ? r.stock_status !== 'ok' : r.stock_status === filter))
      && (!n || [r.reference, r.name, r.brand, r.category].join(' ').toLowerCase().includes(n)));
  }, [stock.data, q, filter]);
  const value = (stock.data ?? []).reduce((s, r) => s + toNum(r.stock_value), 0);
  const saleValue = (stock.data ?? []).reduce((s, r) => s + toNum(r.sale_value), 0);
  const seeCosts = can('products.view_costs');

  return (
    <>
      <PageHeader title="Stock" subtitle="Le stock évolue uniquement par des opérations validées : réceptions, factures ou livraisons, avoirs, ajustements tracés."
        actions={can('inventory.adjust') && <>
          <button className="btn btn-ghost !min-h-[42px]" onClick={() => setMove({ kind: 'entry' })}><ArrowDownToLine className="h-4 w-4" /> Entrée</button>
          <button className="btn btn-ghost !min-h-[42px]" onClick={() => setMove({ kind: 'exit' })}><ArrowUpFromLine className="h-4 w-4" /> Sortie</button>
          <button className="btn btn-navy !min-h-[42px]" onClick={() => setMove({ kind: 'adjustment' })}><Scale className="h-4 w-4" /> Inventaire / ajustement</button>
        </>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard accent label="Articles suivis" value={(stock.data ?? []).length} hint={`${(stock.data ?? []).filter((r) => toNum(r.stock_quantity) > 0).length} en stock`} />
        <StatCard label="Ruptures" value={<span className="text-brand-red">{(stock.data ?? []).filter((r) => r.stock_status === 'out').length}</span>} onClick={() => { setTab('levels'); setFilter('out'); }} />
        <StatCard label="Sous le seuil" value={<span className="text-amber-700">{(stock.data ?? []).filter((r) => r.stock_status === 'low').length}</span>} onClick={() => { setTab('levels'); setFilter('low'); }} />
        <StatCard label={seeCosts ? 'Valorisation (coût moyen)' : 'Valeur au prix de vente HT'} value={money(seeCosts ? value : saleValue)} hint={seeCosts ? `Au prix de vente : ${money(saleValue)}` : undefined} />
      </div>
      <div className="border border-navy/10 bg-white">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'levels', label: 'Niveaux de stock' }, { value: 'movements', label: 'Historique des mouvements' }]} />
        {tab === 'levels' && (
          <>
            {stock.error && <div className="p-4"><ErrorBox message={stock.error} onRetry={stock.reload} /></div>}
            <div className="flex flex-col gap-3 border-b border-navy/10 p-4 xl:flex-row">
              <SearchBar value={q} onChange={setQ} placeholder="Référence, désignation, marque…" />
              <FilterChips value={filter} onChange={setFilter} options={[{ value: '', label: 'Tous' }, { value: 'low', label: 'Alertes' }, { value: 'out', label: 'Ruptures' }, { value: 'ok', label: 'OK' }]} />
              <button className="btn btn-ghost !min-h-[42px]" disabled={!rows.length} onClick={() => {
                csvDownload(`stock-${today()}.csv`, ['Référence', 'Désignation', 'Catégorie', 'Marque', 'Unité', 'Stock', 'Minimum', ...(seeCosts ? ['Coût moyen', 'Valeur stock'] : []), 'Prix vente HT', 'Statut'],
                  rows.map((r) => [r.reference, r.name, r.category, r.brand, r.unit, toNum(r.stock_quantity), toNum(r.min_stock), ...(seeCosts ? [toNum(r.unit_cost), toNum(r.stock_value)] : []), toNum(r.sale_price), r.stock_status]));
                void logEvent('export.csv', 'products', null, 'Stock');
              }}><Download className="h-4 w-4" /> CSV</button>
            </div>
            <DataTable loading={stock.loading} rows={rows} columns={[
              { key: 'r', header: 'Référence', render: (r) => <span className="font-mono text-xs">{r.reference}</span> },
              { key: 'n', header: 'Désignation', render: (r) => <div><p className="font-semibold text-navy">{r.name}</p><p className="text-xs text-navy/50">{[r.brand, r.category].filter(Boolean).join(' · ')}</p></div> },
              { key: 'q', header: 'Stock', align: 'right', render: (r) => <span className={`font-semibold tabular-nums ${r.stock_status === 'out' ? 'text-brand-red' : r.stock_status === 'low' ? 'text-amber-700' : 'text-navy'}`}>{qty(r.stock_quantity)} <span className="font-normal text-navy/45">{r.unit}</span></span> },
              { key: 'm', header: 'Min.', align: 'right', render: (r) => <span className="tabular-nums text-navy/60">{qty(r.min_stock)}</span> },
              ...(seeCosts ? [
                { key: 'c', header: 'Coût moyen', align: 'right' as const, render: (r: StockRow) => <span className="tabular-nums">{money(r.unit_cost)}</span> },
                { key: 'v', header: 'Valeur', align: 'right' as const, render: (r: StockRow) => <span className="tabular-nums">{money(r.stock_value)}</span> },
              ] : []),
              { key: 's', header: 'État', render: (r) => r.stock_status === 'out' ? <Pill tone="red">Rupture</Pill> : r.stock_status === 'low' ? <Pill tone="amber">Sous le seuil</Pill> : <Pill tone="green">OK</Pill> },
              { key: 'a', header: '', align: 'right', render: (r) => (
                <div className="flex justify-end gap-1">
                  <button className="btn-link !text-[10px]" onClick={() => { setParams({ product: r.id }); setTab('movements'); }}>Historique</button>
                  {can('inventory.adjust') && <button className="btn-link ml-3 !text-[10px]" onClick={() => setMove({ kind: 'adjustment', product: r.id })}>Ajuster</button>}
                </div>
              ) },
            ]} />
          </>
        )}
        {tab === 'movements' && <Movements productId={params.get('product')} onProduct={(p) => setParams(p ? { product: p } : {})} />}
      </div>
      {move && <MovementModal kind={move.kind} productId={move.product ?? null} onClose={() => setMove(null)} onDone={() => { setMove(null); void stock.reload(); }} />}
    </>
  );
}

function Movements({ productId, onProduct }: { productId: string | null; onProduct: (id: string | null) => void }) {
  const [from, setFrom] = useState(addDays(today(), -89));
  const [to, setTo] = useState(today());
  const products = useAsync(loadErpProducts, []);
  const { data, error, loading, reload } = useAsync(async () => {
    let query = sb().from('stock_movements').select('*').gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`).order('created_at', { ascending: false }).limit(2000);
    if (productId) query = query.eq('product_id', productId);
    return unwrap(await query) as StockMovement[];
  }, [from, to, productId]);
  const byId = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);
  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-navy/10 p-4 xl:flex-row xl:items-end">
        <div className="xl:w-96"><span className="field-label">Produit</span>
          <SearchSelect value={productId} onChange={onProduct} allowClear placeholder="Tous les produits" options={(products.data ?? []).filter((p) => p.track_stock).map((p) => ({ value: p.id, label: `${p.reference} — ${p.name.fr}` }))} />
        </div>
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <button className="btn btn-ghost !min-h-[42px]" disabled={!data?.length} onClick={() => csvDownload(`mouvements-stock-${today()}.csv`, ['Date', 'Référence', 'Produit', 'Motif', 'Document', 'Quantité', 'Avant', 'Après', 'Coût unitaire', 'Notes'],
          (data ?? []).map((m) => [m.created_at, byId.get(m.product_id)?.reference ?? '', byId.get(m.product_id)?.name.fr ?? '', MOVEMENT_REASON[m.reason] ?? m.reason, m.source_label, toNum(m.quantity), toNum(m.stock_before), toNum(m.stock_after), m.unit_cost ?? '', m.notes]))}><Download className="h-4 w-4" /> CSV</button>
      </div>
      {error && <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <DataTable loading={loading} rows={data ?? []} columns={[
        { key: 'd', header: 'Date', render: (m) => <span className="whitespace-nowrap text-navy/70">{fmtDateTime(m.created_at)}</span> },
        { key: 'p', header: 'Produit', render: (m) => { const p = byId.get(m.product_id); return <div><p className="text-navy">{p?.name.fr ?? '—'}</p><p className="font-mono text-xs text-navy/50">{p?.reference}</p></div>; } },
        { key: 'r', header: 'Motif', render: (m) => <div><p>{MOVEMENT_REASON[m.reason] ?? m.reason}</p>{(m.source_label || m.notes) && <p className="text-xs text-navy/50">{[m.source_label, m.notes].filter(Boolean).join(' — ')}</p>}</div> },
        { key: 'q', header: 'Quantité', align: 'right', render: (m) => <span className={`font-semibold tabular-nums ${toNum(m.quantity) > 0 ? 'text-emerald-700' : 'text-brand-red'}`}>{toNum(m.quantity) > 0 ? '+' : ''}{qty(m.quantity)}</span> },
        { key: 's', header: 'Stock', align: 'right', render: (m) => <span className="tabular-nums text-navy/60">{qty(m.stock_before)} → <strong className="text-navy">{qty(m.stock_after)}</strong></span> },
      ]} />
    </div>
  );
}

function MovementModal({ kind, productId, onClose, onDone }: { kind: 'entry' | 'exit' | 'adjustment'; productId: string | null; onClose: () => void; onDone: () => void }) {
  const { can } = useAccess();
  const [product, setProduct] = useState<string | null>(productId);
  const [quantity, setQuantity] = useState(0);
  const [cost, setCost] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const products = useAsync(loadErpProducts, []);
  const p: ErpProduct | undefined = products.data?.find((x) => x.id === product);
  const titles = { entry: 'Entrée de stock', exit: 'Sortie de stock', adjustment: 'Inventaire / ajustement' };

  const submit = async () => {
    if (!product) return setError('Choisissez un produit.');
    if (kind !== 'adjustment' && !(quantity > 0)) return setError('Quantité invalide.');
    if (kind !== 'entry' && !notes.trim()) return setError('Le motif est obligatoire.');
    setBusy(true); setError(null);
    try {
      await rpc('record_stock_movement', { p_product_id: product, p_kind: kind, p_quantity: quantity, p_unit_cost: kind === 'entry' ? cost : null, p_notes: notes });
      toast('Mouvement enregistré');
      onDone();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open title={titles[kind]} onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[42px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={submit}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer</button>
      </>}>
      <div className="space-y-4">
        <Field label="Produit" required>
          <SearchSelect value={product} onChange={setProduct} placeholder="Choisir…" options={(products.data ?? []).filter((x) => x.track_stock).map((x) => ({ value: x.id, label: `${x.reference} — ${x.name.fr}`, hint: `Stock actuel : ${qty(x.stock_quantity)} ${x.unit}` }))} />
        </Field>
        {p && <p className="text-sm text-navy/60">Stock actuel : <strong className="text-navy">{qty(p.stock_quantity)} {p.unit}</strong></p>}
        <Field label={kind === 'adjustment' ? 'Quantité comptée (stock réel)' : 'Quantité'} required
          hint={kind === 'adjustment' && p ? `Écart : ${quantity - toNum(p.stock_quantity) > 0 ? '+' : ''}${qty(quantity - toNum(p.stock_quantity))}` : undefined}>
          <NumberInput value={quantity} onChange={(v) => setQuantity(Math.max(0, v))} min={0} />
        </Field>
        {kind === 'entry' && can('products.view_costs') && <Field label="Coût unitaire (TND, optionnel)" hint="Met à jour le coût moyen pondéré."><NumberInput value={cost} onChange={setCost} /></Field>}
        <Field label={kind === 'entry' ? 'Motif / notes' : 'Motif'} required={kind !== 'entry'}><TextArea value={notes} onChange={setNotes} rows={2} placeholder={kind === 'exit' ? 'Casse, usage interne, échantillon…' : kind === 'adjustment' ? 'Inventaire annuel, erreur de comptage…' : 'Retour, transfert…'} /></Field>
      </div>
    </Modal>
  );
}
