import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Loader2, Pencil, Plus, Search, Star, X } from 'lucide-react';
import { api, uid } from '@/lib/api';
import { useCatalog } from '@/hooks/useCatalog';
import { emptyTranslated, type Category, type Product } from '@/lib/types';
import { Badge, Card, ConfirmDelete, ImageUpload, Modal, PageHeader, TranslatedInput, slugify, toast } from './ui';
import { erpEnabled, errMsg, rpc, sb, unwrap } from '@/erp/lib/db';
import { useAccess } from '@/erp/lib/access';
import { loadBrands, loadErpProducts } from '@/erp/lib/data';
import { loadSettings, loadVatRates } from '@/erp/lib/hooks';
import { money, qty } from '@/erp/lib/format';
import { UNITS } from '@/erp/lib/status';
import type { Brand, ErpProduct, VatRate } from '@/erp/lib/types';
import { Check, NumberInput } from '@/erp/components/ui';

const blank = (): Product => ({
  id: uid(), slug: '', category_id: null, reference: '', name: emptyTranslated(), description: emptyTranslated(),
  specs: [], image_url: null, featured: false, published: true, created_at: new Date().toISOString(),
});

type Erp = Pick<ErpProduct, 'brand_id' | 'unit' | 'purchase_price' | 'sale_price' | 'vat_rate' | 'min_stock' | 'track_stock' | 'barcode' | 'is_active' | 'stock_quantity'>;
const blankErp = (vat = 19): Erp => ({ brand_id: null, unit: 'pièce', purchase_price: 0, sale_price: 0, vat_rate: vat, min_stock: 0, track_stock: true, barcode: '', is_active: true, stock_quantity: 0 });

export default function ProductsAdmin() {
  const { refresh } = useCatalog();
  const { can } = useAccess();
  const canCreate = !erpEnabled || can('products.create|website.manage');
  const canEdit = !erpEnabled || can('products.edit|website.manage');
  const canDelete = !erpEnabled || can('products.delete|website.manage');
  const [products, setProducts] = useState<Product[]>([]);
  const [erp, setErp] = useState<Map<string, ErpProduct>>(new Map());
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([api.listProducts({ includeUnpublished: true }), api.listCategories()]);
    setProducts(p);
    setCategories(c);
    if (erpEnabled) {
      try {
        const [e, b] = await Promise.all([loadErpProducts(), loadBrands()]);
        setErp(new Map(e.map((x) => [x.id, x])));
        setBrands(b);
      } catch { /* ERP migrations not applied yet: website fields only */ }
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const n = q.toLowerCase();
    return products.filter((p) => (!cat || p.category_id === cat) && (!n || [p.reference, p.slug, ...Object.values(p.name)].join(' ').toLowerCase().includes(n)));
  }, [products, q, cat]);

  const remove = async (id: string) => {
    try {
      await api.deleteProduct(id);
      toast('Produit supprimé');
      await Promise.all([load(), refresh()]);
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Erreur';
      toast(/foreign key|violates/i.test(m) ? 'Produit utilisé dans des documents ou mouvements : désactivez-le plutôt que de le supprimer.' : m, 'err');
    }
  };

  const showErp = erpEnabled && erp.size > 0;

  return (
    <>
      <PageHeader title="Produits" subtitle={`${products.length} produit(s) au catalogue`}
        actions={canCreate && <button className="btn btn-red !min-h-[42px]" onClick={() => setEditing(blank())}><Plus className="h-4 w-4" /> Ajouter un produit</button>} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-navy/10 p-4 sm:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/40" />
            <input className="field !min-h-[42px] !pl-10 !py-2" placeholder="Rechercher par nom, référence…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
          </label>
          <select className="field !min-h-[42px] !py-2 sm:!w-64" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Catégorie">
            <option value="">Toutes les catégories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name.fr}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-mist text-[11px] uppercase tracking-wider text-navy/60">
              <tr>
                <th className="px-4 py-3">Produit</th><th className="px-4 py-3">Référence</th><th className="px-4 py-3">Catégorie</th>
                {showErp && <><th className="px-4 py-3 text-right">Prix HT</th><th className="px-4 py-3 text-right">Stock</th></>}
                <th className="px-4 py-3">Statut</th><th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/10">
              {filtered.map((p) => {
                const e = erp.get(p.id);
                const low = e && e.track_stock && Number(e.stock_quantity) <= Number(e.min_stock);
                return (
                  <tr key={p.id} className="hover:bg-mist/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-16 shrink-0 overflow-hidden bg-mist">{p.image_url && <img src={p.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />}</div>
                        <div className="min-w-0"><p className="truncate font-semibold text-navy">{p.name.fr || p.name.en}</p><p className="truncate text-xs text-navy/45">{brands.find((b) => b.id === e?.brand_id)?.name ?? `/${p.slug}`}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{p.reference}</td>
                    <td className="px-4 py-3 text-navy/70">{categories.find((c) => c.id === p.category_id)?.name.fr ?? '—'}</td>
                    {showErp && <>
                      <td className="px-4 py-3 text-right tabular-nums">{e ? money(e.sale_price) : '—'}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${low ? 'font-semibold text-brand-red' : ''}`}>{e ? (e.track_stock ? `${qty(e.stock_quantity)} ${e.unit}` : 'Non suivi') : '—'}</td>
                    </>}
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">{p.published ? <Badge tone="green">Publié</Badge> : <Badge tone="gray">Brouillon</Badge>}{p.featured && <Badge tone="red">Vedette</Badge>}{e && !e.is_active && <Badge tone="gray">Inactif</Badge>}</div></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <a href={`/products/${p.slug}`} target="_blank" rel="noreferrer" className="flex h-9 w-9 items-center justify-center text-navy/50 hover:text-navy" title="Voir"><Eye className="h-4 w-4" /></a>
                        {canEdit && <button className="flex h-9 w-9 items-center justify-center text-navy/50 hover:text-navy" title="Modifier" aria-label="Modifier" onClick={() => setEditing(structuredClone(p))}><Pencil className="h-4 w-4" /></button>}
                        {canDelete && <ConfirmDelete onConfirm={() => remove(p.id)} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && !filtered.length && <tr><td colSpan={7} className="px-4 py-12 text-center text-navy/50">Aucun produit.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      {editing && (
        <ProductEditor product={editing} erp={erp.get(editing.id) ?? null} brands={brands} categories={categories} existing={products} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await Promise.all([load(), refresh()]); }} />
      )}
    </>
  );
}

function ProductEditor({ product, erp, brands, categories, existing, onClose, onSaved }: {
  product: Product; erp: ErpProduct | null; brands: Brand[]; categories: Category[]; existing: Product[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { can } = useAccess();
  const [p, setP] = useState<Product>(product);
  const [e, setE] = useState<Erp>(erp ?? blankErp());
  const [vatRates, setVatRates] = useState<VatRate[]>([]);
  const [opening, setOpening] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !existing.some((x) => x.id === product.id);
  const withErp = erpEnabled && (Boolean(erp) || isNew) && can('products.view');
  const seeCosts = can('products.view_costs');
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP((s) => ({ ...s, [k]: v }));
  const setErpField = <K extends keyof Erp>(k: K, v: Erp[K]) => setE((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!withErp) return;
    void Promise.all([loadVatRates(), loadSettings()]).then(([v, s]) => {
      setVatRates(v);
      if (isNew && !erp) setE((x) => ({ ...x, vat_rate: Number(s.default_vat_rate) }));
    }).catch(() => {});
  }, [withErp, isNew, erp]);

  const save = async () => {
    const slug = p.slug || slugify(p.name.fr || p.name.en);
    if (!p.name.fr.trim()) return setError('Le nom (FR) est obligatoire.');
    if (!p.reference.trim()) return setError('La référence est obligatoire.');
    if (!slug) return setError("L'identifiant d'URL est invalide.");
    if (existing.some((x) => x.slug === slug && x.id !== p.id)) return setError('Cet identifiant d’URL est déjà utilisé.');
    if (existing.some((x) => x.reference.trim().toUpperCase() === p.reference.trim().toUpperCase() && x.id !== p.id)) return setError('Cette référence existe déjà.');
    if (withErp && (Number(e.sale_price) < 0 || Number(e.purchase_price) < 0)) return setError('Les prix doivent être positifs.');
    setBusy(true);
    setError(null);
    try {
      await api.saveProduct({ ...p, slug, reference: p.reference.trim(), specs: p.specs.filter((s) => s.label.fr.trim() || s.value.fr.trim()) });
      if (withErp) {
        const row: Record<string, unknown> = {
          brand_id: e.brand_id, unit: e.unit, sale_price: Number(e.sale_price), vat_rate: Number(e.vat_rate), min_stock: Number(e.min_stock),
          track_stock: e.track_stock, barcode: e.barcode.trim(), is_active: e.is_active,
        };
        if (seeCosts) row.purchase_price = Number(e.purchase_price);
        unwrap(await sb().from('products').update(row).eq('id', p.id));
        if (isNew && opening > 0 && e.track_stock && can('inventory.adjust')) {
          await rpc('record_stock_movement', { p_product_id: p.id, p_kind: 'opening', p_quantity: opening, p_unit_cost: seeCosts ? Number(e.purchase_price) : null, p_notes: 'Stock initial à la création' });
        }
      }
      toast(isNew ? 'Produit ajouté' : 'Produit mis à jour');
      await onSaved();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const margin = Number(e.sale_price) > 0 ? ((Number(e.sale_price) - Number(e.purchase_price)) / Number(e.sale_price)) * 100 : 0;

  return (
    <Modal open wide title={isNew ? 'Nouveau produit' : 'Modifier le produit'} onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[42px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer</button>
      </>}>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <TranslatedInput label="Nom" required value={p.name} onChange={(v) => setP((s) => ({ ...s, name: v, slug: isNew && !s.slug ? '' : s.slug }))} />
          <TranslatedInput label="Description" multiline value={p.description} onChange={(v) => set('description', v)} />
        </div>
        <div className="space-y-5">
          <ImageUpload value={p.image_url} onChange={(v) => set('image_url', v)} folder="products" label="Image du produit" />
          <div className="grid grid-cols-2 gap-4">
            <div><label className="field-label" htmlFor="p-ref">Référence *</label><input id="p-ref" className="field font-mono" value={p.reference} onChange={(ev) => set('reference', ev.target.value)} /></div>
            <div><label className="field-label" htmlFor="p-slug">URL (slug)</label><input id="p-slug" className="field" placeholder={slugify(p.name.fr) || 'auto'} value={p.slug} onChange={(ev) => set('slug', slugify(ev.target.value))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label" htmlFor="p-cat">Catégorie</label>
              <select id="p-cat" className="field" value={p.category_id ?? ''} onChange={(ev) => set('category_id', ev.target.value || null)}>
                <option value="">— Aucune —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name.fr}</option>)}
              </select>
            </div>
            {withErp && (
              <div>
                <label className="field-label" htmlFor="p-brand">Marque</label>
                <select id="p-brand" className="field" value={e.brand_id ?? ''} onChange={(ev) => setErpField('brand_id', ev.target.value || null)}>
                  <option value="">— Aucune —</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-navy" checked={p.published} onChange={(ev) => set('published', ev.target.checked)} /> Publié sur le site</label>
            <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-red" checked={p.featured} onChange={(ev) => set('featured', ev.target.checked)} /><Star className="h-3.5 w-3.5" /> Mis en avant (accueil)</label>
          </div>
        </div>
      </div>

      {withErp && (
        <div className="mt-8 border-t border-navy/10 pt-6">
          <h3 className="field-label">Gestion commerciale & stock <span className="normal-case tracking-normal text-navy/40">(jamais affiché sur le site public)</span></h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className="field-label">Prix de vente HT (DT)</span><NumberInput value={e.sale_price} onChange={(v) => setErpField('sale_price', v)} min={0} /></label>
            {seeCosts && <label className="block"><span className="field-label">Prix d’achat / coût moyen</span><NumberInput value={e.purchase_price} onChange={(v) => setErpField('purchase_price', v)} min={0} /></label>}
            <label className="block"><span className="field-label">TVA</span>
              <select className="field !min-h-[42px] !py-2" value={String(Number(e.vat_rate))} onChange={(ev) => setErpField('vat_rate', Number(ev.target.value))}>
                {Array.from(new Set([Number(e.vat_rate), ...vatRates.filter((v) => v.is_active).map((v) => Number(v.rate))])).sort((a, b) => b - a).map((r) => <option key={r} value={r}>{r} %</option>)}
              </select>
            </label>
            <label className="block"><span className="field-label">Unité</span>
              <select className="field !min-h-[42px] !py-2" value={e.unit} onChange={(ev) => setErpField('unit', ev.target.value)}>
                {Array.from(new Set([e.unit, ...UNITS])).map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label className="block"><span className="field-label">Stock minimum (alerte)</span><NumberInput value={e.min_stock} onChange={(v) => setErpField('min_stock', Math.max(0, v))} min={0} /></label>
            <label className="block"><span className="field-label">Code-barres</span><input className="field !min-h-[42px] !py-2 font-mono" value={e.barcode} onChange={(ev) => setErpField('barcode', ev.target.value)} /></label>
            {isNew && can('inventory.adjust') && e.track_stock && (
              <label className="block"><span className="field-label">Stock initial</span><NumberInput value={opening} onChange={(v) => setOpening(Math.max(0, v))} min={0} /></label>
            )}
            {!isNew && (
              <div><span className="field-label">Stock actuel</span>
                <p className="flex min-h-[42px] items-center text-sm text-navy">{e.track_stock ? `${qty(erp?.stock_quantity ?? 0)} ${e.unit}` : 'Non suivi'}
                  {can('inventory.view') && <Link to={`/admin/inventory?product=${p.id}`} className="ml-3 text-xs underline">Mouvements</Link>}</p>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-6">
            <Check checked={e.track_stock} onChange={(v) => setErpField('track_stock', v)} label="Suivre le stock de ce produit" />
            <Check checked={e.is_active} onChange={(v) => setErpField('is_active', v)} label="Actif à la vente (devis, factures)" />
            {seeCosts && Number(e.sale_price) > 0 && <span className={`text-sm ${margin < 0 ? 'text-brand-red' : 'text-navy/60'}`}>Marge estimée : {margin.toFixed(1)} %</span>}
          </div>
          {!isNew && <p className="mt-3 text-xs text-navy/45">Le stock ne se modifie pas ici : il évolue uniquement par des opérations validées (réceptions, factures/livraisons, ajustements d’inventaire).</p>}
        </div>
      )}

      <div className="mt-8 border-t border-navy/10 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="field-label !mb-0">Caractéristiques techniques</h3>
          <button className="btn btn-ghost !min-h-[36px] !px-3 !text-[11px]" onClick={() => set('specs', [...p.specs, { label: emptyTranslated(), value: emptyTranslated() }])}><Plus className="h-3.5 w-3.5" /> Ajouter</button>
        </div>
        <div className="mt-4 space-y-4">
          {p.specs.map((s, i) => (
            <div key={i} className="relative grid gap-3 bg-mist p-4 pr-12 md:grid-cols-2">
              <TranslatedInput label={`Libellé ${i + 1}`} value={s.label} onChange={(v) => set('specs', p.specs.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
              <TranslatedInput label={`Valeur ${i + 1}`} value={s.value} onChange={(v) => set('specs', p.specs.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
              <button className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center text-navy/50 hover:text-brand-red" aria-label="Retirer" onClick={() => set('specs', p.specs.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
            </div>
          ))}
          {!p.specs.length && <p className="text-sm text-navy/50">Aucune caractéristique.</p>}
        </div>
      </div>
    </Modal>
  );
}
