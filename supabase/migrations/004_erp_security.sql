-- =============================================================================
-- ULTRA SUPPLY — ERP / CRM  ·  Migration 004 : security
-- Row Level Security on every table, least-privilege grants, column-level
-- protection of business data on the public catalogue, private document
-- storage, audit triggers, and migration of legacy admins / website requests.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Legacy data migration
-- -----------------------------------------------------------------------------
-- Existing auth users become (inactive) staff profiles; legacy admins become super administrators.
insert into public.users (id, email, role_id, is_active)
select u.id, coalesce(u.email, ''), 'employee', false from auth.users u
on conflict (id) do nothing;

insert into public.users (id, email, role_id, is_active)
select a.user_id, coalesce(u.email, ''), 'super_admin', true
from public.admins a join auth.users u on u.id = a.user_id
on conflict (id) do update set role_id = 'super_admin', is_active = true;

-- Existing website requests are copied once into the unified inbox.
insert into public.contact_requests (request_type, status, full_name, company, email, phone, subject, message, product, reference, quantity, attachment_path, locale, source, legacy_id, created_at)
select 'quote',
       case q.status when 'new' then 'new' when 'in_progress' then 'in_progress' when 'answered' then 'closed' else 'closed' end,
       q.full_name, coalesce(q.company, ''), q.email, coalesce(q.phone, ''), left('Demande de devis : ' || q.product, 200), coalesce(q.message, ''),
       q.product, coalesce(q.reference, ''), q.quantity,
       case when q.attachment_path ~ '^incoming/[A-Za-z0-9._-]+$' then q.attachment_path end, q.locale, 'legacy', q.id, q.created_at
from public.quote_requests q
on conflict (legacy_id) do nothing;

insert into public.contact_requests (request_type, status, full_name, email, phone, subject, message, source, legacy_id, created_at)
select 'contact', case when m.is_read then 'closed' else 'new' end, m.full_name, m.email, coalesce(m.phone, ''), m.subject, m.message, 'legacy', m.id, m.created_at
from public.contact_messages m
on conflict (legacy_id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Enable RLS everywhere
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'roles','permissions','role_permissions','users','company_settings','vat_rates','payment_methods','numbering_rules',
    'document_sequences','exchange_rates','customers','suppliers','brands','contact_requests','quotations','quotation_items',
    'orders','invoices','invoice_items','payments','payment_allocations','receipts','purchase_orders','purchase_order_items',
    'goods_receipts','goods_receipt_items','supplier_invoices','supplier_payments','stock_movements','delivery_notes',
    'delivery_note_items','documents','activity_logs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Drop every policy we (re)create so the migration can be replayed.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and policyname like 'erp:%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Standard module policies : view / create / edit / delete
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('customers','customers'), ('suppliers','suppliers'), ('brands','products'),
    ('quotations','quotations'), ('orders','orders'), ('invoices','invoices'),
    ('purchase_orders','purchases'), ('delivery_notes','deliveries')
  ) as x(tbl, module) loop
    execute format('create policy %I on public.%I for select to authenticated using (public.has_permission(%L, ''view''))', 'erp:' || r.tbl || ':select', r.tbl, r.module);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_permission(%L, ''create''))', 'erp:' || r.tbl || ':insert', r.tbl, r.module);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_permission(%L, ''edit'')) with check (public.has_permission(%L, ''edit''))', 'erp:' || r.tbl || ':update', r.tbl, r.module, r.module);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_permission(%L, ''delete''))', 'erp:' || r.tbl || ':delete', r.tbl, r.module);
  end loop;

  -- Line tables follow their document's module (create OR edit may write lines).
  for r in select * from (values
    ('quotation_items','quotations'), ('invoice_items','invoices'), ('purchase_order_items','purchases'), ('delivery_note_items','deliveries')
  ) as x(tbl, module) loop
    execute format('create policy %I on public.%I for select to authenticated using (public.has_permission(%L, ''view''))', 'erp:' || r.tbl || ':select', r.tbl, r.module);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_permission(%L, ''create'') or public.has_permission(%L, ''edit''))', 'erp:' || r.tbl || ':insert', r.tbl, r.module, r.module);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_permission(%L, ''create'') or public.has_permission(%L, ''edit''))', 'erp:' || r.tbl || ':update', r.tbl, r.module, r.module);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_permission(%L, ''create'') or public.has_permission(%L, ''edit''))', 'erp:' || r.tbl || ':delete', r.tbl, r.module, r.module);
  end loop;
end $$;

-- Read-only (writes only through SECURITY DEFINER workflows).
create policy "erp:payments:select" on public.payments for select to authenticated using (public.has_permission('payments', 'view'));
create policy "erp:payment_allocations:select" on public.payment_allocations for select to authenticated using (public.has_permission('payments', 'view'));
create policy "erp:receipts:select" on public.receipts for select to authenticated using (public.has_permission('payments', 'view'));
create policy "erp:goods_receipts:select" on public.goods_receipts for select to authenticated using (public.has_permission('purchases', 'view'));
create policy "erp:goods_receipt_items:select" on public.goods_receipt_items for select to authenticated using (public.has_permission('purchases', 'view'));
create policy "erp:stock_movements:select" on public.stock_movements for select to authenticated
  using (public.has_permission('inventory', 'view') or public.has_permission('products', 'view'));
create policy "erp:activity_logs:select" on public.activity_logs for select to authenticated
  using (public.has_permission('logs', 'view') or user_id = auth.uid());

-- Supplier invoices: buyers (purchases.create) and accountants (purchases.edit) may record them.
create policy "erp:supplier_invoices:select" on public.supplier_invoices for select to authenticated using (public.has_permission('purchases', 'view'));
create policy "erp:supplier_invoices:insert" on public.supplier_invoices for insert to authenticated
  with check (public.has_permission('purchases', 'create') or public.has_permission('purchases', 'edit'));
create policy "erp:supplier_invoices:update" on public.supplier_invoices for update to authenticated
  using (public.has_permission('purchases', 'edit')) with check (public.has_permission('purchases', 'edit'));
create policy "erp:supplier_invoices:delete" on public.supplier_invoices for delete to authenticated
  using (public.has_permission('purchases', 'delete') and amount_paid = 0);

-- Supplier payments: record (purchases.edit) and delete mistakes (purchases.delete); never update.
create policy "erp:supplier_payments:select" on public.supplier_payments for select to authenticated using (public.has_permission('purchases', 'view'));
create policy "erp:supplier_payments:insert" on public.supplier_payments for insert to authenticated with check (public.has_permission('purchases', 'edit'));
create policy "erp:supplier_payments:delete" on public.supplier_payments for delete to authenticated using (public.has_permission('purchases', 'delete'));

-- Exchange rates: purchasers and settings editors.
create policy "erp:exchange_rates:select" on public.exchange_rates for select to authenticated using (public.is_staff());
create policy "erp:exchange_rates:insert" on public.exchange_rates for insert to authenticated with check (public.has_permission('purchases', 'edit') or public.has_permission('settings', 'edit'));
create policy "erp:exchange_rates:update" on public.exchange_rates for update to authenticated using (public.has_permission('purchases', 'edit') or public.has_permission('settings', 'edit'));
create policy "erp:exchange_rates:delete" on public.exchange_rates for delete to authenticated using (public.has_permission('settings', 'edit'));

-- Reference data readable by all staff, editable with settings.edit.
do $$
declare t text;
begin
  foreach t in array array['company_settings','vat_rates','payment_methods','numbering_rules'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', 'erp:' || t || ':select', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_permission(''settings'', ''edit'')) with check (public.has_permission(''settings'', ''edit''))', 'erp:' || t || ':update', t);
  end loop;
  foreach t in array array['vat_rates','payment_methods'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_permission(''settings'', ''edit''))', 'erp:' || t || ':insert', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_permission(''settings'', ''edit''))', 'erp:' || t || ':delete', t);
  end loop;
end $$;
create policy "erp:document_sequences:select" on public.document_sequences for select to authenticated using (public.has_permission('settings', 'view'));

-- Roles & permissions : readable by staff, matrix editable by super admins only (via set_role_permissions).
create policy "erp:roles:select" on public.roles for select to authenticated using (public.is_staff());
create policy "erp:permissions:select" on public.permissions for select to authenticated using (public.is_staff());
create policy "erp:role_permissions:select" on public.role_permissions for select to authenticated using (public.is_staff());

-- Staff users : everyone sees their own profile; users.view sees all; users.manage edits (users_guard adds rules).
create policy "erp:users:select" on public.users for select to authenticated
  using (id = auth.uid() or public.has_permission('users', 'view') or public.has_permission('requests', 'assign'));
create policy "erp:users:update" on public.users for update to authenticated
  using (public.has_permission('users', 'manage') or id = auth.uid())
  with check (public.has_permission('users', 'manage') or id = auth.uid());

-- Website requests : visitors insert only; staff by permission or by assignment.
create policy "erp:contact_requests:insert_public" on public.contact_requests for insert to anon, authenticated
  with check (status = 'new' and assigned_to is null and customer_id is null and quotation_id is null and source = 'website');
create policy "erp:contact_requests:select" on public.contact_requests for select to authenticated
  using (public.has_permission('requests', 'view') or assigned_to = auth.uid());
create policy "erp:contact_requests:update" on public.contact_requests for update to authenticated
  using (public.has_permission('requests', 'edit') or assigned_to = auth.uid())
  with check (public.has_permission('requests', 'edit') or assigned_to = auth.uid());
create policy "erp:contact_requests:delete" on public.contact_requests for delete to authenticated
  using (public.has_permission('requests', 'delete'));

-- Documents registry.
create policy "erp:documents:select" on public.documents for select to authenticated using (public.has_permission('documents', 'view'));
create policy "erp:documents:insert" on public.documents for insert to authenticated with check (public.has_permission('documents', 'create'));
create policy "erp:documents:delete" on public.documents for delete to authenticated using (public.has_permission('documents', 'delete'));

-- Staff may only delete draft documents (guards also enforce it).
drop policy if exists "erp:quotations:delete" on public.quotations;
create policy "erp:quotations:delete" on public.quotations for delete to authenticated
  using (public.has_permission('quotations', 'delete') and status = 'draft');
drop policy if exists "erp:invoices:delete" on public.invoices;
create policy "erp:invoices:delete" on public.invoices for delete to authenticated
  using (public.has_permission('invoices', 'delete') and status = 'draft');

-- -----------------------------------------------------------------------------
-- 4. Catalogue (existing tables) : granular permissions + hide business data from visitors
-- -----------------------------------------------------------------------------
drop policy if exists "public read products" on public.products;
drop policy if exists "admin write products" on public.products;
create policy "public read products" on public.products for select using (published or public.is_staff());
create policy "erp:products:insert" on public.products for insert to authenticated with check (public.has_permission('products', 'create') or public.is_admin());
create policy "erp:products:update" on public.products for update to authenticated
  using (public.has_permission('products', 'edit') or public.is_admin()) with check (public.has_permission('products', 'edit') or public.is_admin());
create policy "erp:products:delete" on public.products for delete to authenticated using (public.has_permission('products', 'delete') or public.is_admin());

drop policy if exists "admin write categories" on public.categories;
create policy "erp:categories:write" on public.categories for all to authenticated
  using (public.has_permission('products', 'edit') or public.is_admin()) with check (public.has_permission('products', 'edit') or public.is_admin());

-- Visitors (anon) only ever see catalogue columns: no prices, costs, stock or internal notes.
revoke all on public.products from anon;
grant select (id, slug, category_id, reference, name, description, specs, image_url, featured, published, created_at, updated_at, brand_id, unit)
  on public.products to anon;

-- Legacy request tables: readable with the requests permission as well.
drop policy if exists "admin manages quotes" on public.quote_requests;
create policy "admin manages quotes" on public.quote_requests for select using (public.is_admin() or public.has_permission('requests', 'view'));
drop policy if exists "admin reads messages" on public.contact_messages;
create policy "admin reads messages" on public.contact_messages for select using (public.is_admin() or public.has_permission('requests', 'view'));

-- -----------------------------------------------------------------------------
-- 5. Grants : nothing for anon on ERP tables, column-limited insert on requests
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'roles','permissions','role_permissions','users','company_settings','vat_rates','payment_methods','numbering_rules',
    'document_sequences','exchange_rates','customers','suppliers','brands','contact_requests','quotations','quotation_items',
    'orders','invoices','invoice_items','payments','payment_allocations','receipts','purchase_orders','purchase_order_items',
    'goods_receipts','goods_receipt_items','supplier_invoices','supplier_payments','stock_movements','delivery_notes',
    'delivery_note_items','documents','activity_logs'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant insert (request_type, full_name, company, email, phone, subject, message, product, reference, quantity, attachment_path, locale)
  on public.contact_requests to anon;
grant select on public.customer_balances to authenticated;
revoke all on public.customer_balances from anon;

-- Functions : internal helpers are not callable by clients; workflows only by signed-in staff.
do $$
declare f text;
begin
  foreach f in array array[
    '_bypass_on()','_bypass_off()','_bypassing()','write_log(text,text,uuid,text,jsonb)','audit_row()','next_number(text)','assign_number()',
    'compute_line_totals()','compute_doc_totals(text,text,uuid,numeric)','items_guard()','items_touch_parent()','quotations_guard()',
    'invoices_guard()','invoices_delete_guard()','refresh_invoice_status(uuid)','purchase_orders_guard()','purchase_orders_delete_guard()',
    'delivery_notes_guard()','products_stock_guard()','apply_stock_movement()','immutable_row()',
    '_post_movement(uuid,text,text,numeric,numeric,text,uuid,text,text)','payment_allocations_guard()','payment_allocations_sync()',
    'supplier_invoices_guard()','supplier_payments_guard()','supplier_payments_sync()','handle_new_auth_user()','users_guard()',
    'users_keep_super_admin()','bootstrap_super_admin(text)','contact_requests_guard()','mirror_legacy_request()','_net_sales(date,date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;

  foreach f in array array[
    'get_my_access()','log_event(text,text,uuid,text,jsonb)','touch_last_login()','set_role_permissions(text,text[])',
    'assign_request(uuid,uuid)','convert_request_to_customer(uuid)','convert_request_to_quotation(uuid)',
    'set_quotation_status(uuid,text)','expire_quotations()','duplicate_quotation(uuid)','convert_quotation_to_order(uuid,text)',
    'convert_quotation_to_invoice(uuid)','create_invoice_from_order(uuid)','validate_invoice(uuid)','mark_invoice_sent(uuid)',
    'create_credit_note(uuid,text,boolean)','cancel_invoice(uuid,text)','refresh_overdue_invoices()',
    'record_payment(uuid,numeric,uuid,date,text,text,date,text,boolean,jsonb)','allocate_payment(uuid,uuid,numeric)',
    'remove_allocation(uuid)','cancel_payment(uuid,text)','receive_purchase_order(uuid,jsonb,date,text)',
    'record_stock_movement(uuid,text,numeric,numeric,text)','create_delivery_note(text,uuid)','validate_delivery_note(uuid)',
    'cancel_delivery_note(uuid,text)','dashboard_stats()','report_sales(date,date,text)','report_customers(date,date)',
    'report_products(date,date)','report_margins(date,date)','report_quotations(date,date)','report_outstanding()',
    'report_payments(date,date)','report_purchases(date,date)','report_stock()','require_permission(text,text)',
    'current_role_id()','is_super_admin()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- is_staff / has_permission / is_admin stay executable by everyone: RLS policies evaluated for visitors call them (they return false).

-- -----------------------------------------------------------------------------
-- 6. Audit triggers on business tables (who changed what, before → after)
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'users','role_permissions','company_settings','vat_rates','payment_methods','numbering_rules','exchange_rates',
    'customers','suppliers','brands','products','categories','contact_requests','quotations','orders','invoices',
    'payments','payment_allocations','purchase_orders','goods_receipts','supplier_invoices','supplier_payments',
    'delivery_notes','documents'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Storage : private "documents" bucket (PDFs, scans) + request attachments for staff
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 15728640, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "erp: staff read documents" on storage.objects;
drop policy if exists "erp: staff upload documents" on storage.objects;
drop policy if exists "erp: staff delete documents" on storage.objects;
drop policy if exists "erp: staff read request attachments" on storage.objects;

create policy "erp: staff read documents" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.has_permission('documents', 'view'));
create policy "erp: staff upload documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.has_permission('documents', 'create')
              and (storage.foldername(name))[1] in ('quotations','invoices','credit_notes','receipts','purchase_orders','delivery_notes','supplier_invoices','suppliers','customers','other'));
create policy "erp: staff delete documents" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.has_permission('documents', 'delete'));
create policy "erp: staff read request attachments" on storage.objects for select to authenticated
  using (bucket_id = 'quote-attachments' and (public.has_permission('requests', 'view')
         or exists (select 1 from public.contact_requests r where r.attachment_path = name and r.assigned_to = auth.uid())));

-- Product images: catalogue managers (products.create/edit) may upload as well as website admins.
drop policy if exists "admin writes product images" on storage.objects;
drop policy if exists "admin updates product images" on storage.objects;
drop policy if exists "admin deletes product images" on storage.objects;
create policy "admin writes product images" on storage.objects for insert
  with check (bucket_id = 'product-images' and (public.is_admin() or public.has_permission('products', 'edit') or public.has_permission('products', 'create')));
create policy "admin updates product images" on storage.objects for update
  using (bucket_id = 'product-images' and (public.is_admin() or public.has_permission('products', 'edit')));
create policy "admin deletes product images" on storage.objects for delete
  using (bucket_id = 'product-images' and (public.is_admin() or public.has_permission('products', 'edit')));
