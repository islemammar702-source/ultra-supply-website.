import { useMemo, useState } from 'react';
import { Loader2, Pencil, Plus } from 'lucide-react';
import { ImageUpload, Modal, PageHeader, toast } from '@/admin/ui';
import { errMsg, sb, unwrap } from '../lib/db';
import { useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import type { Brand } from '../lib/types';
import { Check, ConfirmModal, DataTable, ErrorBox, Field, Pill, SearchBar, TextArea, TextInput } from '../components/ui';

export default function BrandsPage() {
  const { can } = useAccess();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<Brand> | null>(null);
  const [removing, setRemoving] = useState<Brand | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const [brands, counts] = await Promise.all([
      sb().from('brands').select('*').order('name').then(unwrap) as Promise<Brand[]>,
      sb().from('products').select('brand_id').not('brand_id', 'is', null).then(unwrap) as Promise<{ brand_id: string }[]>,
    ]);
    const n = new Map<string, number>();
    counts.forEach((c) => n.set(c.brand_id, (n.get(c.brand_id) ?? 0) + 1));
    return brands.map((b) => ({ ...b, products: n.get(b.id) ?? 0 }));
  }, []);
  const rows = useMemo(() => (data ?? []).filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase())), [data, q]);

  return (
    <>
      <PageHeader title="Marques" subtitle="Marques commercialisées (fiches produits, rapports, catalogue)."
        actions={can('products.create') && <button className="btn btn-red !min-h-[42px]" onClick={() => setEditing({ name: '', website: '', description: '', logo_url: null, is_active: true })}><Plus className="h-4 w-4" /> Nouvelle marque</button>} />
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={reload} /></div>}
      <div className="border border-navy/10 bg-white">
        <div className="border-b border-navy/10 p-4"><SearchBar value={q} onChange={setQ} placeholder="Rechercher une marque…" /></div>
        <DataTable loading={loading} rows={rows} minWidth={560} columns={[
          { key: 'logo', header: '', render: (b) => <div className="flex h-10 w-16 items-center justify-center bg-mist">{b.logo_url && <img src={b.logo_url} alt="" className="max-h-9 max-w-14 object-contain" />}</div> },
          { key: 'name', header: 'Marque', render: (b) => <div><p className="font-semibold text-navy">{b.name}</p>{b.website && <p className="text-xs text-navy/50">{b.website}</p>}</div> },
          { key: 'p', header: 'Produits', align: 'right', render: (b) => b.products },
          { key: 's', header: '', render: (b) => !b.is_active && <Pill tone="gray">Inactive</Pill> },
          { key: 'a', header: '', align: 'right', render: (b) => can('products.edit') && (
            <div className="flex justify-end">
              <button className="p-2 text-navy/50 hover:text-navy" title="Modifier" onClick={() => setEditing(b)}><Pencil className="h-4 w-4" /></button>
              {can('products.delete') && <button className="p-2 text-xs text-navy/50 hover:text-brand-red" onClick={() => setRemoving(b)}>Supprimer</button>}
            </div>
          ) },
        ]} />
      </div>
      {editing && <BrandForm brand={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      <ConfirmModal open={Boolean(removing)} danger title="Supprimer la marque" confirmLabel="Supprimer" onClose={() => setRemoving(null)}
        message={<>Supprimer « {removing?.name} » ? Les produits liés resteront, sans marque.</>}
        onConfirm={async () => { unwrap(await sb().from('brands').delete().eq('id', removing!.id)); toast('Marque supprimée'); await reload(); }} />
    </>
  );
}

function BrandForm({ brand, onClose, onSaved }: { brand: Partial<Brand>; onClose: () => void; onSaved: () => void }) {
  const [b, setB] = useState(brand);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!b.name?.trim()) return setError('Le nom est obligatoire.');
    setBusy(true); setError(null);
    const row = { name: b.name.trim(), website: b.website?.trim() ?? '', description: b.description ?? '', logo_url: b.logo_url ?? null, is_active: b.is_active !== false };
    try {
      if (brand.id) unwrap(await sb().from('brands').update(row).eq('id', brand.id));
      else unwrap(await sb().from('brands').insert(row));
      toast('Marque enregistrée');
      onSaved();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open title={brand.id ? 'Modifier la marque' : 'Nouvelle marque'} onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[42px]" onClick={onClose}>Annuler</button>
        <button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer</button>
      </>}>
      <div className="space-y-5">
        <Field label="Nom" required><TextInput value={b.name ?? ''} onChange={(v) => setB({ ...b, name: v })} /></Field>
        <Field label="Site web"><TextInput value={b.website ?? ''} onChange={(v) => setB({ ...b, website: v })} placeholder="https://" /></Field>
        <ImageUpload value={b.logo_url ?? null} onChange={(v) => setB({ ...b, logo_url: v })} folder="brands" label="Logo" />
        <Field label="Description"><TextArea value={b.description ?? ''} onChange={(v) => setB({ ...b, description: v })} /></Field>
        <Check checked={b.is_active !== false} onChange={(v) => setB({ ...b, is_active: v })} label="Marque active" />
      </div>
    </Modal>
  );
}
