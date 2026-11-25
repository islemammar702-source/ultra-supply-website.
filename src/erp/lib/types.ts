import type { Translated } from '@/lib/types';

export type UUID = string;

export interface Access {
  user_id: UUID;
  email: string;
  full_name: string;
  role_id: string;
  role_label: string;
  is_active: boolean;
  permissions: string[];
}

export interface StaffUser {
  id: UUID;
  email: string;
  full_name: string;
  phone: string | null;
  role_id: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface Role { id: string; label: string; description: string; sort_order: number }
export interface Permission { id: UUID; module: string; action: string; label: string }

export interface CompanySettings {
  id: 1;
  company_name: string; legal_name: string; activity: string; tax_id: string; trade_register: string; customs_code: string;
  address: string; city: string; postal_code: string; country: string; phone: string; phone2: string; email: string; website: string;
  bank_name: string; bank_account: string; bank_swift: string; logo_url: string | null;
  currency: string; default_vat_rate: number; apply_fiscal_stamp: boolean; fiscal_stamp: number;
  quotation_validity_days: number; invoice_due_days: number; quotation_terms: string; invoice_terms: string; pdf_footer: string;
  stock_exit_on: 'invoice' | 'delivery_note'; allow_negative_stock: boolean;
}

export interface VatRate { id: UUID; rate: number; label: string; is_default: boolean; is_active: boolean }
export interface PaymentMethod { id: UUID; code: string; label: string; requires_reference: boolean; has_due_date: boolean; is_active: boolean; sort_order: number }
export interface NumberingRule { doc_type: string; label: string; prefix: string; padding: number; yearly: boolean }
export interface ExchangeRate { id: UUID; currency: string; rate: number; rate_date: string; source: string; created_at: string }

export interface Customer {
  id: UUID; code: string; customer_type: 'company' | 'individual'; name: string; contact_name: string; contact_position: string;
  tax_id: string; trade_register: string; vat_exempt: boolean; email: string; phone: string; mobile: string;
  address: string; city: string; governorate: string; postal_code: string; country: string;
  payment_terms_days: number; credit_limit: number | null; notes: string; source: 'manual' | 'website' | 'import';
  is_active: boolean; created_at: string; updated_at: string;
}

export interface CustomerBalance {
  customer_id: UUID; invoiced: number; credited: number; outstanding: number; overdue: number; paid: number;
  unallocated: number; net_balance: number; last_invoice_date: string | null;
}

export interface Supplier {
  id: UUID; code: string; name: string; contact_name: string; tax_id: string; email: string; phone: string; website: string;
  address: string; city: string; country: string; currency: string; payment_terms_days: number; bank_details: string;
  notes: string; is_active: boolean; created_at: string;
}

export interface Brand { id: UUID; name: string; logo_url: string | null; website: string; description: string; is_active: boolean }

export interface ErpProduct {
  id: UUID; slug: string; reference: string; name: Translated; category_id: UUID | null; brand_id: UUID | null; image_url: string | null;
  unit: string; purchase_price: number; sale_price: number; vat_rate: number; stock_quantity: number; min_stock: number;
  track_stock: boolean; barcode: string; is_active: boolean; published: boolean;
}

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
export type InvoiceStatus = 'draft' | 'validated' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
export type OrderStatus = 'confirmed' | 'in_progress' | 'delivered' | 'invoiced' | 'cancelled';
export type PurchaseStatus = 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';
export type DeliveryStatus = 'draft' | 'validated' | 'cancelled';
export type RequestStatus = 'new' | 'assigned' | 'in_progress' | 'converted' | 'closed' | 'spam';
export type RequestType = 'quote' | 'product_inquiry' | 'availability' | 'partnership' | 'contact';

/** One line of a quotation, invoice, purchase order or delivery note. */
export interface DocLine {
  id: UUID;
  position: number;
  product_id: UUID | null;
  reference: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  total_ht?: number;
  total_vat?: number;
  total_ttc?: number;
  received_quantity?: number;
  unit_cost?: number | null;
}

interface DocTotals { discount_percent: number; subtotal: number; discount_amount: number; total_ht: number; total_vat: number; total_ttc: number }

export interface Quotation extends DocTotals {
  id: UUID; number: string; customer_id: UUID; request_id: UUID | null; status: QuotationStatus; issue_date: string; valid_until: string;
  currency: string; customer_reference: string; terms: string; notes: string; internal_notes: string; salesperson_id: UUID | null;
  sent_at: string | null; accepted_at: string | null; rejected_at: string | null; created_at: string; updated_at: string;
}

export interface Order {
  id: UUID; number: string; quotation_id: UUID; customer_id: UUID; status: OrderStatus; order_date: string;
  expected_delivery: string | null; customer_reference: string; notes: string; created_at: string;
}

export interface Invoice extends DocTotals {
  id: UUID; number: string | null; kind: 'invoice' | 'credit_note'; original_invoice_id: UUID | null; customer_id: UUID;
  quotation_id: UUID | null; order_id: UUID | null; status: InvoiceStatus; issue_date: string; due_date: string | null; currency: string;
  fiscal_stamp: number | null; amount_paid: number; amount_credited: number; balance_due: number; restock: boolean;
  customer_snapshot: Partial<Customer> | null; customer_reference: string; terms: string; notes: string; reason: string;
  validated_at: string | null; sent_at: string | null; cancelled_at: string | null; created_at: string; updated_at: string;
}

export interface Payment {
  id: UUID; number: string; customer_id: UUID; payment_date: string; amount: number; allocated_amount: number; method_id: UUID;
  reference: string; bank_name: string; due_date: string | null; is_deposit: boolean; status: 'valid' | 'cancelled';
  notes: string; cancel_reason: string; cancelled_at: string | null; created_at: string;
}
export interface PaymentAllocation { id: UUID; payment_id: UUID; invoice_id: UUID; amount: number; created_at: string }
export interface Receipt { id: UUID; number: string; payment_id: UUID; issued_at: string; document_id: UUID | null }

export interface PurchaseOrder extends DocTotals {
  id: UUID; number: string; supplier_id: UUID; status: PurchaseStatus; order_date: string; expected_date: string | null;
  currency: string; exchange_rate: number; supplier_reference: string; terms: string; notes: string; sent_at: string | null; created_at: string;
}

export interface GoodsReceipt { id: UUID; number: string; purchase_order_id: UUID; received_date: string; notes: string; created_at: string }

export interface SupplierInvoice {
  id: UUID; supplier_id: UUID; purchase_order_id: UUID | null; supplier_reference: string; invoice_date: string; due_date: string | null;
  currency: string; exchange_rate: number; total_ht: number; total_vat: number; total_ttc: number; amount_paid: number;
  status: 'unpaid' | 'partially_paid' | 'paid' | 'cancelled'; document_id: UUID | null; notes: string; created_at: string;
}
export interface SupplierPayment {
  id: UUID; supplier_invoice_id: UUID; supplier_id: UUID; payment_date: string; amount: number; exchange_rate: number; amount_tnd: number;
  method_id: UUID; reference: string; notes: string; created_at: string;
}

export interface StockMovement {
  id: UUID; product_id: UUID; movement_type: 'in' | 'out' | 'adjustment'; reason: string; quantity: number; stock_before: number;
  stock_after: number; unit_cost: number | null; source_type: string | null; source_id: UUID | null; source_label: string; notes: string;
  created_by: UUID | null; created_at: string;
}

export interface DeliveryNote {
  id: UUID; number: string; customer_id: UUID; order_id: UUID | null; invoice_id: UUID | null; status: DeliveryStatus; delivery_date: string;
  delivery_address: string; carrier: string; vehicle: string; notes: string; validated_at: string | null; created_at: string;
}

export interface ContactRequest {
  id: UUID; request_type: RequestType; status: RequestStatus; full_name: string; company: string; email: string; phone: string;
  subject: string; message: string; product_id: UUID | null; product: string; reference: string; quantity: number | null;
  attachment_path: string | null; locale: string; source: string; assigned_to: UUID | null; customer_id: UUID | null;
  quotation_id: UUID | null; internal_notes: string; handled_at: string | null; created_at: string; updated_at: string;
}

export interface DocumentRow {
  id: UUID; doc_type: string; entity_type: string; entity_id: UUID | null; title: string; file_path: string; file_name: string;
  mime_type: string; size_bytes: number; notes: string; uploaded_by: UUID | null; created_at: string;
}

export interface ActivityLog {
  id: number; user_id: UUID | null; user_email: string; action: string; entity_type: string; entity_id: UUID | null;
  entity_label: string; details: Record<string, unknown>; created_at: string;
}
