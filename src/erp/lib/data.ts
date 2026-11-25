import { sb, unwrap } from './db';
import type { Brand, Customer, DocLine, ErpProduct, Supplier } from './types';
import { toNum } from './format';

export const PRODUCT_ERP_COLS =
  'id,slug,reference,name,category_id,brand_id,image_url,unit,purchase_price,sale_price,vat_rate,stock_quantity,min_stock,track_stock,barcode,is_active,published';

export async function loadCustomers(activeOnly = false): Promise<Customer[]> {
  let q = sb().from('customers').select('*').order('name');
  if (activeOnly) q = q.eq('is_active', true);
  return unwrap(await q) as Customer[];
}

export async function loadSuppliers(activeOnly = false): Promise<Supplier[]> {
  let q = sb().from('suppliers').select('*').order('name');
  if (activeOnly) q = q.eq('is_active', true);
  return unwrap(await q) as Supplier[];
}

export async function loadErpProducts(): Promise<ErpProduct[]> {
  return unwrap(await sb().from('products').select(PRODUCT_ERP_COLS).order('reference')) as ErpProduct[];
}

export async function loadBrands(): Promise<Brand[]> {
  return unwrap(await sb().from('brands').select('*').order('name')) as Brand[];
}

type ItemsTable = 'quotation_items' | 'invoice_items' | 'purchase_order_items' | 'delivery_note_items';

export async function loadLines(table: ItemsTable, fk: string, docId: string): Promise<DocLine[]> {
  const rows = unwrap(await sb().from(table).select('*').eq(fk, docId).order('position')) as DocLine[];
  return rows.map((r) => ({
    ...r,
    quantity: toNum(r.quantity),
    unit_price: toNum(r.unit_price ?? 0),
    discount_percent: toNum(r.discount_percent ?? 0),
    vat_rate: toNum(r.vat_rate ?? 0),
  }));
}

/**
 * Synchronises the lines of a document: deletes removed lines, then upserts the others in order.
 * Totals are recomputed by the database triggers.
 */
export async function saveLines(table: ItemsTable, fk: string, docId: string, lines: DocLine[], previousIds: string[]) {
  const keep = new Set(lines.map((l) => l.id));
  const removed = previousIds.filter((id) => !keep.has(id));
  if (removed.length) unwrap(await sb().from(table).delete().in('id', removed));
  if (!lines.length) return;
  const priced = table !== 'delivery_note_items';
  const rows = lines.map((l, i) => ({
    id: l.id,
    [fk]: docId,
    position: i + 1,
    product_id: l.product_id,
    reference: l.reference.trim(),
    description: l.description.trim(),
    unit: l.unit || 'pièce',
    quantity: toNum(l.quantity),
    ...(priced ? { unit_price: toNum(l.unit_price), discount_percent: toNum(l.discount_percent), vat_rate: toNum(l.vat_rate) } : {}),
  }));
  unwrap(await sb().from(table).upsert(rows));
}

export const customerLabel = (c: Pick<Customer, 'code' | 'name'>) => `${c.name} (${c.code})`;
