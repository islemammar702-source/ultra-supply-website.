-- =============================================================================
-- ULTRA SUPPLY — ERP / CRM  ·  Migration 003 : business logic
-- Access helpers, numbering, totals, document guards (immutability), stock,
-- payments, conversions, workflows (RPC), audit trail, views and reports.
-- Every RPC checks permissions server-side (require_permission) before acting.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Small internal helpers
-- -----------------------------------------------------------------------------
create or replace function public._bypass_on() returns void language sql as $$ select set_config('app.bypass', 'on', true); $$;
create or replace function public._bypass_off() returns void language sql as $$ select set_config('app.bypass', 'off', true); $$;
create or replace function public._bypassing() returns boolean language sql stable as $$
  select coalesce(current_setting('app.bypass', true), 'off') = 'on';
$$;

-- -----------------------------------------------------------------------------
-- 1. ACCESS CONTROL
-- -----------------------------------------------------------------------------
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and is_active);
$$;

create or replace function public.current_role_id() returns text
language sql stable security definer set search_path = public as $$
  select role_id from public.users where id = auth.uid() and is_active;
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role_id = 'super_admin' from public.users where id = auth.uid() and is_active), false);
$$;

create or replace function public.has_permission(p_module text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select u.role_id = 'super_admin'
        or exists (select 1 from public.role_permissions rp
                   join public.permissions p on p.id = rp.permission_id
                   where rp.role_id = u.role_id and p.module = p_module and p.action = p_action)
    from public.users u where u.id = auth.uid() and u.is_active), false);
$$;

create or replace function public.require_permission(p_module text, p_action text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission(p_module, p_action) then
    raise exception 'Permission refusée (%.%)', p_module, p_action using errcode = '42501';
  end if;
end $$;

-- Website administration (catalogue, content, legacy requests) now follows the permission matrix.
-- Legacy rows in public.admins are migrated to super administrators below.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_permission('website', 'manage');
$$;

-- Everything the front-end needs to build menus and guards.
create or replace function public.get_my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', u.id, 'email', u.email, 'full_name', u.full_name, 'role_id', u.role_id, 'role_label', r.label,
    'is_active', u.is_active,
    'permissions', coalesce((
      select jsonb_agg(p.module || '.' || p.action order by p.module, p.action)
      from public.permissions p
      where u.role_id = 'super_admin'
         or exists (select 1 from public.role_permissions rp where rp.role_id = u.role_id and rp.permission_id = p.id)
    ), '[]'::jsonb))
  from public.users u join public.roles r on r.id = u.role_id
  where u.id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- 2. ACTIVITY LOG + AUDIT TRAIL
-- -----------------------------------------------------------------------------
create or replace function public.write_log(p_action text, p_entity_type text, p_entity_id uuid, p_label text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.activity_logs (user_id, user_email, action, entity_type, entity_id, entity_label, details)
  values (auth.uid(), coalesce((select email from public.users where id = auth.uid()), ''), p_action,
          coalesce(p_entity_type, ''), p_entity_id, coalesce(p_label, ''), coalesce(p_details, '{}'::jsonb));
$$;

-- Client-side events (login, PDF generated, e-mail sent, export…). Restricted prefixes only.
create or replace function public.log_event(p_action text, p_entity_type text default '', p_entity_id uuid default null, p_label text default '', p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Non autorisé' using errcode = '42501'; end if;
  if p_action !~ '^(auth|document|email|export|print)\.[a-z_]{2,40}$' then raise exception 'Action de journal invalide'; end if;
  perform public.write_log(p_action, p_entity_type, p_entity_id, left(p_label, 200), coalesce(p_details, '{}'::jsonb));
end $$;

create or replace function public.touch_last_login() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.users set last_login_at = now() where id = auth.uid();
  perform public.write_log('auth.login', 'users', auth.uid(), coalesce((select email from public.users where id = auth.uid()), ''), '{}'::jsonb);
end $$;

-- Generic row audit: inserts, deletes, and the exact before/after of every changed column.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb; v_diff jsonb := '{}'::jsonb; k text; v_id text; v_label text;
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at') and not (tg_table_name = 'products' and k = 'stock_quantity')
         and (v_new -> k) is distinct from (v_old -> k) then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
      end if;
    end loop;
    if v_diff = '{}'::jsonb then return null; end if;
  else
    v_diff := v_row;
  end if;
  if length(v_diff::text) > 16000 then v_diff := jsonb_build_object('truncated', true, 'keys', (select jsonb_agg(x) from jsonb_object_keys(v_diff) x)); end if;
  v_id := v_row ->> 'id';
  v_label := coalesce(v_row ->> 'number', v_row ->> 'code', v_row ->> 'reference', v_row ->> 'supplier_reference', v_row ->> 'email', v_row ->> 'full_name',
                      case when jsonb_typeof(v_row -> 'name') = 'string' then v_row ->> 'name' else v_row -> 'name' ->> 'fr' end, '');
  insert into public.activity_logs (user_id, user_email, action, entity_type, entity_id, entity_label, details)
  values (auth.uid(), coalesce((select email from public.users where id = auth.uid()), ''), lower(tg_op), tg_table_name,
          case when v_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_id::uuid end, left(v_label, 200), v_diff);
  return null;
end $$;

-- -----------------------------------------------------------------------------
-- 3. NUMBERING
-- -----------------------------------------------------------------------------
create or replace function public.next_number(p_doc_type text) returns text
language plpgsql security definer set search_path = public as $$
declare r public.numbering_rules; v_period int; v_val int;
begin
  select * into r from public.numbering_rules where doc_type = p_doc_type;
  if not found then raise exception 'Type de numérotation inconnu : %', p_doc_type; end if;
  v_period := case when r.yearly then extract(year from current_date)::int else 0 end;
  insert into public.document_sequences (doc_type, period, last_value) values (p_doc_type, v_period, 1)
  on conflict (doc_type, period) do update set last_value = public.document_sequences.last_value + 1
  returning last_value into v_val;
  return r.prefix || '-' || case when r.yearly then v_period::text || '-' else '' end || lpad(v_val::text, r.padding, '0');
end $$;

-- assign_number(doc_type, column, 'force'|'keep')
create or replace function public.assign_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_col text := coalesce(tg_argv[1], 'number'); v_mode text := coalesce(tg_argv[2], 'force');
begin
  if v_mode = 'force' or coalesce(to_jsonb(new) ->> v_col, '') = '' then
    new := jsonb_populate_record(new, jsonb_build_object(v_col, public.next_number(tg_argv[0])));
  end if;
  return new;
end $$;

drop trigger if exists customers_number on public.customers;
create trigger customers_number before insert on public.customers for each row execute function public.assign_number('customer', 'code', 'keep');
drop trigger if exists suppliers_number on public.suppliers;
create trigger suppliers_number before insert on public.suppliers for each row execute function public.assign_number('supplier', 'code', 'keep');
drop trigger if exists quotations_number on public.quotations;
create trigger quotations_number before insert on public.quotations for each row execute function public.assign_number('quotation', 'number', 'force');
drop trigger if exists orders_number on public.orders;
create trigger orders_number before insert on public.orders for each row execute function public.assign_number('order', 'number', 'force');
drop trigger if exists payments_number on public.payments;
create trigger payments_number before insert on public.payments for each row execute function public.assign_number('payment', 'number', 'force');
drop trigger if exists receipts_number on public.receipts;
create trigger receipts_number before insert on public.receipts for each row execute function public.assign_number('receipt', 'number', 'force');
drop trigger if exists purchase_orders_number on public.purchase_orders;
create trigger purchase_orders_number before insert on public.purchase_orders for each row execute function public.assign_number('purchase_order', 'number', 'force');
drop trigger if exists goods_receipts_number on public.goods_receipts;
create trigger goods_receipts_number before insert on public.goods_receipts for each row execute function public.assign_number('goods_receipt', 'number', 'force');
drop trigger if exists delivery_notes_number on public.delivery_notes;
create trigger delivery_notes_number before insert on public.delivery_notes for each row execute function public.assign_number('delivery_note', 'number', 'force');

-- -----------------------------------------------------------------------------
-- 4. updated_at
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['users','customers','suppliers','contact_requests','orders','supplier_invoices','delivery_notes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 5. LINE & DOCUMENT TOTALS (computed in the database, never trusted from the client)
-- -----------------------------------------------------------------------------
create or replace function public.compute_line_totals() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.total_ht  := round(new.quantity * new.unit_price * (1 - new.discount_percent / 100), 3);
  new.total_vat := round(new.total_ht * new.vat_rate / 100, 3);
  new.total_ttc := new.total_ht + new.total_vat;
  if tg_table_name = 'purchase_order_items' and not public._bypassing() then
    new.received_quantity := case when tg_op = 'INSERT' then 0 else old.received_quantity end;
  end if;
  if tg_table_name = 'invoice_items' and not public._bypassing() then
    new.unit_cost := case when tg_op = 'INSERT' then null else old.unit_cost end;
  end if;
  return new;
end $$;

create or replace function public.compute_doc_totals(p_items text, p_fk text, p_id uuid, p_discount numeric,
  out subtotal numeric, out discount_amount numeric, out total_ht numeric, out total_vat numeric)
language plpgsql stable security definer set search_path = public as $$
declare s numeric; v numeric;
begin
  execute format('select coalesce(sum(total_ht), 0), coalesce(sum(total_vat), 0) from public.%I where %I = $1', p_items, p_fk)
    into s, v using p_id;
  subtotal := s;
  discount_amount := round(s * coalesce(p_discount, 0) / 100, 3);
  total_ht := s - discount_amount;
  total_vat := round(v * (1 - coalesce(p_discount, 0) / 100), 3);
end $$;

-- Lines of a locked document cannot be inserted, changed or deleted.
-- items_guard(parent_table, fk_column, editable_statuses_csv)
create or replace function public.items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text;
begin
  if public._bypassing() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) ->> tg_argv[1]) is distinct from (to_jsonb(old) ->> tg_argv[1]) then
    raise exception 'Une ligne ne peut pas être déplacée vers un autre document.';
  end if;
  v_id := (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> tg_argv[1])::uuid;
  execute format('select status from public.%I where id = $1', tg_argv[0]) into v_status using v_id;
  if v_status is not null and not (v_status = any (string_to_array(tg_argv[2], ','))) then
    raise exception 'Document verrouillé (statut « % ») : les lignes ne peuvent plus être modifiées.', v_status using errcode = 'P0001';
  end if;
  if tg_table_name = 'purchase_order_items' and tg_op = 'DELETE' then
    if (to_jsonb(old) ->> 'received_quantity')::numeric > 0 then
      raise exception 'Ligne déjà partiellement réceptionnée : suppression impossible.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- After any line change, touch the parent so its BEFORE UPDATE trigger recomputes totals.
create or replace function public.items_touch_parent() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if tg_op = 'UPDATE' and new.total_ht = old.total_ht and new.total_vat = old.total_vat then return null; end if;
  v_id := (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> tg_argv[1])::uuid;
  execute format('update public.%I set updated_at = now() where id = $1', tg_argv[0]) using v_id;
  return null;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('quotation_items','quotations','quotation_id','draft,sent,expired'),
    ('invoice_items','invoices','invoice_id','draft'),
    ('purchase_order_items','purchase_orders','purchase_order_id','draft,sent')
  ) as x(items, parent, fk, editable) loop
    execute format('drop trigger if exists %I on public.%I', r.items || '_totals', r.items);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.compute_line_totals()', r.items || '_totals', r.items);
    execute format('drop trigger if exists %I on public.%I', r.items || '_guard', r.items);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.items_guard(%L, %L, %L)', r.items || '_guard', r.items, r.parent, r.fk, r.editable);
    execute format('drop trigger if exists %I on public.%I', r.items || '_parent', r.items);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.items_touch_parent(%L, %L)', r.items || '_parent', r.items, r.parent, r.fk);
  end loop;
end $$;

drop trigger if exists delivery_note_items_guard on public.delivery_note_items;
create trigger delivery_note_items_guard before insert or update or delete on public.delivery_note_items
  for each row execute function public.items_guard('delivery_notes', 'delivery_note_id', 'draft');

-- -----------------------------------------------------------------------------
-- 6. QUOTATIONS : status workflow + frozen once accepted/rejected
-- -----------------------------------------------------------------------------
create or replace function public.quotations_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record; v_ok boolean;
begin
  if tg_op = 'INSERT' then
    if not public._bypassing() then
      new.status := 'draft'; new.sent_at := null; new.accepted_at := null; new.rejected_at := null;
    end if;
    new.subtotal := 0; new.discount_amount := 0; new.total_ht := 0; new.total_vat := 0; new.total_ttc := 0;
    return new;
  end if;

  if not public._bypassing() then
    if old.status = 'accepted' and (to_jsonb(new) - array['updated_at','internal_notes']) is distinct from (to_jsonb(old) - array['updated_at','internal_notes']) then
      raise exception 'Devis accepté : il ne peut plus être modifié.' using errcode = 'P0001';
    end if;
    if new.status is distinct from old.status then
      v_ok := case old.status
        when 'draft'    then new.status in ('sent','accepted','rejected')
        when 'sent'     then new.status in ('draft','accepted','rejected','expired')
        when 'expired'  then new.status in ('draft','sent')
        when 'rejected' then new.status in ('draft')
        else false end;
      if not v_ok then
        raise exception 'Changement de statut impossible : % → %', old.status, new.status using errcode = 'P0001';
      end if;
    end if;
    if old.status = 'rejected' and new.status = 'rejected'
       and (to_jsonb(new) - array['updated_at','internal_notes']) is distinct from (to_jsonb(old) - array['updated_at','internal_notes']) then
      raise exception 'Devis refusé : rouvrez-le (brouillon) pour le modifier.' using errcode = 'P0001';
    end if;
  end if;

  if new.status = 'sent' and old.status <> 'sent' then new.sent_at := coalesce(new.sent_at, now()); end if;
  if new.status = 'accepted' and old.status <> 'accepted' then new.accepted_at := now(); end if;
  if new.status = 'rejected' and old.status <> 'rejected' then new.rejected_at := now(); end if;

  if new.status in ('draft','sent','expired') then
    select * into t from public.compute_doc_totals('quotation_items', 'quotation_id', new.id, new.discount_percent);
    new.subtotal := t.subtotal; new.discount_amount := t.discount_amount;
    new.total_ht := t.total_ht; new.total_vat := t.total_vat; new.total_ttc := t.total_ht + t.total_vat;
  end if;
  return new;
end $$;
drop trigger if exists quotations_guard on public.quotations;
create trigger quotations_guard before insert or update on public.quotations for each row execute function public.quotations_guard();

-- -----------------------------------------------------------------------------
-- 7. INVOICES : drafts editable, validated invoices immutable (credit notes only)
-- -----------------------------------------------------------------------------
create or replace function public.invoices_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.company_settings; t record;
  v_mutable text[] := array['status','amount_paid','amount_credited','balance_due','sent_at','cancelled_at','updated_at'];
begin
  if tg_op = 'INSERT' then
    select * into s from public.company_settings where id = 1;
    if not public._bypassing() then
      new.status := 'draft'; new.number := null; new.validated_at := null; new.validated_by := null; new.sent_at := null;
      new.cancelled_at := null; new.customer_snapshot := null;
    end if;
    if new.kind = 'credit_note' then
      if not exists (select 1 from public.invoices o where o.id = new.original_invoice_id and o.kind = 'invoice' and o.status <> 'draft') then
        raise exception 'Un avoir doit se rapporter à une facture validée.';
      end if;
    end if;
    if new.fiscal_stamp is null then
      new.fiscal_stamp := case when new.kind = 'invoice' and s.apply_fiscal_stamp then s.fiscal_stamp else 0 end;
    end if;
    if new.due_date is null and new.kind = 'invoice' then
      new.due_date := new.issue_date + coalesce((select payment_terms_days from public.customers where id = new.customer_id), s.invoice_due_days);
    end if;
    new.amount_paid := 0; new.amount_credited := 0; new.balance_due := 0;
    new.subtotal := 0; new.discount_amount := 0; new.total_ht := 0; new.total_vat := 0; new.total_ttc := new.fiscal_stamp;
    return new;
  end if;

  -- UPDATE
  if old.status <> 'draft' then
    if not public._bypassing() then
      raise exception 'Facture % validée : modification interdite. Émettez un avoir pour la corriger.', old.number using errcode = 'P0001';
    end if;
    if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
      raise exception 'Facture % : seules les informations de règlement peuvent évoluer.', old.number using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- old is a draft
  if not public._bypassing() then
    if new.status <> 'draft' then
      raise exception 'Utilisez l''action « Valider » pour émettre une facture.' using errcode = 'P0001';
    end if;
    new.number := null; new.validated_at := null; new.validated_by := null; new.sent_at := null; new.cancelled_at := null;
    new.customer_snapshot := null; new.kind := old.kind; new.original_invoice_id := old.original_invoice_id;
  end if;
  select * into t from public.compute_doc_totals('invoice_items', 'invoice_id', new.id, new.discount_percent);
  new.subtotal := t.subtotal; new.discount_amount := t.discount_amount; new.total_ht := t.total_ht; new.total_vat := t.total_vat;
  new.total_ttc := t.total_ht + t.total_vat + coalesce(new.fiscal_stamp, 0);
  new.amount_paid := 0; new.amount_credited := 0; new.balance_due := 0;
  return new;
end $$;
drop trigger if exists invoices_guard on public.invoices;
create trigger invoices_guard before insert or update on public.invoices for each row execute function public.invoices_guard();

create or replace function public.invoices_delete_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'draft' then
    raise exception 'Une facture validée ne peut pas être supprimée (émettez un avoir).' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists invoices_delete_guard on public.invoices;
create trigger invoices_delete_guard before delete on public.invoices for each row execute function public.invoices_delete_guard();

-- Recomputes paid / credited / balance and the payment status of an invoice.
create or replace function public.refresh_invoice_status(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_paid numeric; v_credit numeric; v_balance numeric; v_status text;
begin
  select * into inv from public.invoices where id = p_id for update;
  if not found or inv.status = 'draft' then return; end if;
  perform public._bypass_on();
  if inv.kind = 'credit_note' then
    update public.invoices set amount_paid = 0, amount_credited = 0, balance_due = 0,
      status = case when inv.sent_at is not null then 'sent' else 'validated' end
    where id = p_id and (status, balance_due) is distinct from (case when inv.sent_at is not null then 'sent' else 'validated' end, 0::numeric);
    perform public._bypass_off();
    return;
  end if;
  select coalesce(sum(a.amount), 0) into v_paid
    from public.payment_allocations a join public.payments p on p.id = a.payment_id
   where a.invoice_id = p_id and p.status = 'valid';
  select coalesce(sum(c.total_ttc), 0) into v_credit
    from public.invoices c where c.original_invoice_id = p_id and c.kind = 'credit_note' and c.status not in ('draft','cancelled');
  v_balance := greatest(inv.total_ttc - v_paid - v_credit, 0);
  v_status := case
    when v_credit >= inv.total_ttc then 'cancelled'
    when v_balance = 0 then 'paid'
    when inv.due_date is not null and inv.due_date < current_date then 'overdue'
    when v_paid > 0 or v_credit > 0 then 'partially_paid'
    when inv.sent_at is not null then 'sent'
    else 'validated' end;
  update public.invoices
     set amount_paid = v_paid, amount_credited = v_credit, balance_due = v_balance, status = v_status,
         cancelled_at = case when v_status = 'cancelled' then coalesce(cancelled_at, now()) else null end
   where id = p_id
     and (amount_paid, amount_credited, balance_due, status) is distinct from (v_paid, v_credit, v_balance, v_status);
  perform public._bypass_off();
end $$;

-- -----------------------------------------------------------------------------
-- 8. PURCHASE ORDERS guard
-- -----------------------------------------------------------------------------
create or replace function public.purchase_orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record; v_received boolean;
begin
  if new.currency = 'TND' then new.exchange_rate := 1; end if;
  if tg_op = 'INSERT' then
    if not public._bypassing() then new.status := 'draft'; new.sent_at := null; end if;
    new.subtotal := 0; new.discount_amount := 0; new.total_ht := 0; new.total_vat := 0; new.total_ttc := 0;
    return new;
  end if;
  if not public._bypassing() then
    if old.status in ('partially_received','received','cancelled')
       and (to_jsonb(new) - array['updated_at','notes']) is distinct from (to_jsonb(old) - array['updated_at','notes']) then
      raise exception 'Bon de commande % : statut « % », modification impossible.', old.number, old.status using errcode = 'P0001';
    end if;
    if new.status is distinct from old.status then
      select exists (select 1 from public.purchase_order_items where purchase_order_id = old.id and received_quantity > 0) into v_received;
      if not ((old.status = 'draft' and new.status in ('sent','cancelled'))
           or (old.status = 'sent' and new.status in ('draft','cancelled') and not v_received)) then
        raise exception 'Changement de statut impossible : % → %', old.status, new.status using errcode = 'P0001';
      end if;
    end if;
  end if;
  if new.status = 'sent' and old.status <> 'sent' then new.sent_at := coalesce(new.sent_at, now()); end if;
  if new.status in ('draft','sent') then
    select * into t from public.compute_doc_totals('purchase_order_items', 'purchase_order_id', new.id, new.discount_percent);
    new.subtotal := t.subtotal; new.discount_amount := t.discount_amount; new.total_ht := t.total_ht; new.total_vat := t.total_vat;
    new.total_ttc := t.total_ht + t.total_vat;
  end if;
  return new;
end $$;
drop trigger if exists purchase_orders_guard on public.purchase_orders;
create trigger purchase_orders_guard before insert or update on public.purchase_orders for each row execute function public.purchase_orders_guard();

create or replace function public.purchase_orders_delete_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status not in ('draft','cancelled') or exists (select 1 from public.goods_receipts where purchase_order_id = old.id) then
    raise exception 'Seuls les bons de commande brouillons ou annulés sans réception peuvent être supprimés.' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists purchase_orders_delete_guard on public.purchase_orders;
create trigger purchase_orders_delete_guard before delete on public.purchase_orders for each row execute function public.purchase_orders_delete_guard();

-- -----------------------------------------------------------------------------
-- 9. DELIVERY NOTES guard
-- -----------------------------------------------------------------------------
create or replace function public.delivery_notes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public._bypassing() then new.status := 'draft'; new.validated_at := null; new.validated_by := null; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Bon de livraison validé : suppression impossible (annulez-le).' using errcode = 'P0001'; end if;
    return old;
  end if;
  if not public._bypassing() then
    if old.status <> 'draft' then
      raise exception 'Bon de livraison % : statut « % », modification impossible.', old.number, old.status using errcode = 'P0001';
    end if;
    if new.status not in ('draft','cancelled') then
      raise exception 'Utilisez l''action « Valider » pour valider une livraison.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists delivery_notes_guard on public.delivery_notes;
create trigger delivery_notes_guard before insert or update or delete on public.delivery_notes for each row execute function public.delivery_notes_guard();

-- -----------------------------------------------------------------------------
-- 10. STOCK : movements are the only way stock changes
-- -----------------------------------------------------------------------------
create or replace function public.products_stock_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.stock_sync', true), 'off') <> 'on' then new.stock_quantity := 0; end if;
    if not public._bypassing() and auth.uid() is not null and not public.has_permission('products', 'view_costs') then new.purchase_price := 0; end if;
    return new;
  end if;
  if new.stock_quantity is distinct from old.stock_quantity and coalesce(current_setting('app.stock_sync', true), 'off') <> 'on' then
    new.stock_quantity := old.stock_quantity;   -- silently keep the real stock; use a stock movement instead
  end if;
  if new.purchase_price is distinct from old.purchase_price and not public._bypassing()
     and auth.uid() is not null and not public.has_permission('products', 'view_costs') then
    new.purchase_price := old.purchase_price;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists products_stock_guard on public.products;
create trigger products_stock_guard before insert or update on public.products for each row execute function public.products_stock_guard();

create or replace function public.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_stock numeric; v_track boolean; v_ref text; v_allow boolean;
begin
  select stock_quantity, track_stock, reference into v_stock, v_track, v_ref from public.products where id = new.product_id for update;
  if not found then raise exception 'Produit introuvable.'; end if;
  if not v_track then raise exception 'Le produit % n''est pas suivi en stock.', v_ref; end if;
  select allow_negative_stock into v_allow from public.company_settings where id = 1;
  new.stock_before := v_stock;
  new.stock_after := v_stock + new.quantity;
  new.created_by := coalesce(new.created_by, auth.uid());
  if new.stock_after < 0 and not coalesce(v_allow, false) then
    raise exception 'Stock insuffisant pour % : disponible %, demandé %.', v_ref, v_stock, -new.quantity using errcode = 'P0001';
  end if;
  perform set_config('app.stock_sync', 'on', true);
  update public.products set stock_quantity = new.stock_after where id = new.product_id;
  perform set_config('app.stock_sync', 'off', true);
  return new;
end $$;
drop trigger if exists stock_movements_apply on public.stock_movements;
create trigger stock_movements_apply before insert on public.stock_movements for each row execute function public.apply_stock_movement();

create or replace function public.immutable_row() returns trigger language plpgsql as $$
begin
  raise exception 'Historique non modifiable (%).', tg_table_name using errcode = 'P0001';
end $$;
drop trigger if exists stock_movements_immutable on public.stock_movements;
create trigger stock_movements_immutable before update or delete on public.stock_movements for each row execute function public.immutable_row();
drop trigger if exists activity_logs_immutable on public.activity_logs;
create trigger activity_logs_immutable before update or delete on public.activity_logs for each row execute function public.immutable_row();

-- Internal: post one movement for a product (skips untracked products).
create or replace function public._post_movement(p_product uuid, p_type text, p_reason text, p_qty numeric, p_cost numeric,
  p_source_type text, p_source_id uuid, p_label text, p_notes text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_product is null or p_qty = 0 then return; end if;
  if not exists (select 1 from public.products where id = p_product and track_stock) then return; end if;
  insert into public.stock_movements (product_id, movement_type, reason, quantity, unit_cost, source_type, source_id, source_label, notes)
  values (p_product, p_type, p_reason, p_qty, p_cost, p_source_type, p_source_id, coalesce(p_label, ''), coalesce(p_notes, ''));
end $$;

-- -----------------------------------------------------------------------------
-- 11. PAYMENTS & ALLOCATIONS
-- -----------------------------------------------------------------------------
create or replace function public.payment_allocations_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.payments; inv public.invoices; v_other numeric; v_inv_other numeric;
begin
  select * into p from public.payments where id = new.payment_id for update;
  if p.status <> 'valid' then raise exception 'Paiement % annulé : affectation impossible.', p.number; end if;
  select * into inv from public.invoices where id = new.invoice_id for update;
  if inv.kind <> 'invoice' or inv.status in ('draft','cancelled') then
    raise exception 'La facture % ne peut pas recevoir de paiement (statut %).', coalesce(inv.number, 'brouillon'), inv.status;
  end if;
  if inv.customer_id <> p.customer_id then raise exception 'Le paiement et la facture concernent des clients différents.'; end if;
  select coalesce(sum(amount), 0) into v_other from public.payment_allocations where payment_id = new.payment_id and id <> new.id;
  if v_other + new.amount > p.amount then
    raise exception 'Montant affecté (%) supérieur au disponible du paiement (%).', new.amount, p.amount - v_other using errcode = 'P0001';
  end if;
  select coalesce(sum(a.amount), 0) into v_inv_other
    from public.payment_allocations a join public.payments pp on pp.id = a.payment_id
   where a.invoice_id = new.invoice_id and pp.status = 'valid' and a.id <> new.id;
  if new.amount > inv.total_ttc - v_inv_other - inv.amount_credited then
    raise exception 'Montant (%) supérieur au reste à payer de la facture % (%).', new.amount, inv.number,
      inv.total_ttc - v_inv_other - inv.amount_credited using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists payment_allocations_guard on public.payment_allocations;
create trigger payment_allocations_guard before insert or update on public.payment_allocations for each row execute function public.payment_allocations_guard();

create or replace function public.payment_allocations_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_payment uuid := coalesce(new.payment_id, old.payment_id); v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.payments set allocated_amount = (select coalesce(sum(amount), 0) from public.payment_allocations where payment_id = v_payment)
   where id = v_payment;
  perform public.refresh_invoice_status(v_invoice);
  if tg_op = 'UPDATE' and old.invoice_id <> new.invoice_id then perform public.refresh_invoice_status(old.invoice_id); end if;
  return null;
end $$;
drop trigger if exists payment_allocations_sync on public.payment_allocations;
create trigger payment_allocations_sync after insert or update or delete on public.payment_allocations for each row execute function public.payment_allocations_sync();

-- -----------------------------------------------------------------------------
-- 12. SUPPLIER INVOICES & PAYMENTS
-- -----------------------------------------------------------------------------
create or replace function public.supplier_invoices_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.currency = 'TND' then new.exchange_rate := 1; end if;
  if public._bypassing() then return new; end if;
  if tg_op = 'INSERT' then
    new.amount_paid := 0; new.status := 'unpaid';
    return new;
  end if;
  new.amount_paid := old.amount_paid;
  if new.status is distinct from old.status then
    if not (new.status = 'cancelled' and old.amount_paid = 0) and not (old.status = 'cancelled' and new.status = 'unpaid') then
      raise exception 'Le statut d''une facture fournisseur est calculé à partir des paiements.' using errcode = 'P0001';
    end if;
  end if;
  if old.amount_paid > 0 and (new.total_ttc, new.currency) is distinct from (old.total_ttc, old.currency) then
    raise exception 'Facture fournisseur déjà réglée en partie : montant et devise non modifiables.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists supplier_invoices_guard on public.supplier_invoices;
create trigger supplier_invoices_guard before insert or update on public.supplier_invoices for each row execute function public.supplier_invoices_guard();

create or replace function public.supplier_payments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.supplier_invoices;
begin
  select * into inv from public.supplier_invoices where id = new.supplier_invoice_id for update;
  if inv.status = 'cancelled' then raise exception 'Facture fournisseur annulée.'; end if;
  if inv.amount_paid + new.amount > inv.total_ttc then
    raise exception 'Paiement (%) supérieur au reste à payer (%).', new.amount, inv.total_ttc - inv.amount_paid using errcode = 'P0001';
  end if;
  new.supplier_id := inv.supplier_id;
  if inv.currency = 'TND' then new.exchange_rate := 1; end if;
  return new;
end $$;
drop trigger if exists supplier_payments_guard on public.supplier_payments;
create trigger supplier_payments_guard before insert on public.supplier_payments for each row execute function public.supplier_payments_guard();
drop trigger if exists supplier_payments_immutable on public.supplier_payments;
create trigger supplier_payments_immutable before update on public.supplier_payments for each row execute function public.immutable_row();

create or replace function public.supplier_payments_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.supplier_invoice_id, old.supplier_invoice_id); v_paid numeric; v_total numeric;
begin
  select coalesce(sum(amount), 0) into v_paid from public.supplier_payments where supplier_invoice_id = v_id;
  select total_ttc into v_total from public.supplier_invoices where id = v_id;
  perform public._bypass_on();
  update public.supplier_invoices
     set amount_paid = v_paid,
         status = case when status = 'cancelled' then 'cancelled' when v_paid >= v_total then 'paid' when v_paid > 0 then 'partially_paid' else 'unpaid' end
   where id = v_id;
  perform public._bypass_off();
  return null;
end $$;
drop trigger if exists supplier_payments_sync on public.supplier_payments;
create trigger supplier_payments_sync after insert or delete on public.supplier_payments for each row execute function public.supplier_payments_sync();

-- -----------------------------------------------------------------------------
-- 13. STAFF USERS : sync with auth, protect super admins
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name, role_id, is_active)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'employee', false)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

create or replace function public.users_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Trusted contexts: SQL editor / service-role server functions.
  if current_user in ('postgres','service_role','supabase_admin') then
    return new;
  end if;
  if new.email is distinct from old.email then raise exception 'L''e-mail se modifie depuis le serveur d''authentification.'; end if;
  if new.id = auth.uid() and (new.role_id is distinct from old.role_id or new.is_active is distinct from old.is_active) then
    raise exception 'Vous ne pouvez pas modifier votre propre rôle ou désactiver votre propre compte.' using errcode = '42501';
  end if;
  if (old.role_id = 'super_admin' or new.role_id = 'super_admin') and not public.is_super_admin()
     and (new.role_id is distinct from old.role_id or new.is_active is distinct from old.is_active) then
    raise exception 'Seul un super administrateur peut gérer les super administrateurs.' using errcode = '42501';
  end if;
  new.last_login_at := old.last_login_at;
  return new;
end $$;
drop trigger if exists users_guard on public.users;
create trigger users_guard before update on public.users for each row execute function public.users_guard();

create or replace function public.users_keep_super_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users where role_id = 'super_admin' and is_active)
     and exists (select 1 from public.users) then
    raise exception 'Il doit rester au moins un super administrateur actif.' using errcode = 'P0001';
  end if;
  return null;
end $$;
drop trigger if exists users_keep_super_admin on public.users;
create constraint trigger users_keep_super_admin after update or delete on public.users
  deferrable initially deferred for each row execute function public.users_keep_super_admin();

-- Run once from the SQL editor:  select public.bootstrap_super_admin('you@example.com');
create or replace function public.bootstrap_super_admin(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if v_id is null then raise exception 'Aucun utilisateur Supabase Auth avec l''e-mail %. Créez-le d''abord (Authentication → Users).', p_email; end if;
  insert into public.users (id, email, full_name, role_id, is_active) values (v_id, lower(trim(p_email)), '', 'super_admin', true)
  on conflict (id) do update set role_id = 'super_admin', is_active = true;
  return 'Super administrateur activé : ' || p_email;
end $$;

-- Only role_permissions of non-super roles may be edited, and only by a super admin (enforced by RLS too).
create or replace function public.set_role_permissions(p_role_id text, p_permissions text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'Réservé au super administrateur.' using errcode = '42501'; end if;
  if p_role_id = 'super_admin' then raise exception 'Le super administrateur a toujours tous les droits.'; end if;
  if not exists (select 1 from public.roles where id = p_role_id) then raise exception 'Rôle inconnu.'; end if;
  delete from public.role_permissions where role_id = p_role_id;
  insert into public.role_permissions (role_id, permission_id)
  select p_role_id, p.id from public.permissions p where (p.module || '.' || p.action) = any (coalesce(p_permissions, '{}'));
  perform public.write_log('role.permissions_updated', 'roles', null, p_role_id, jsonb_build_object('permissions', to_jsonb(p_permissions)));
end $$;

-- -----------------------------------------------------------------------------
-- 14. WEBSITE REQUESTS
-- -----------------------------------------------------------------------------
create or replace function public.contact_requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and not public.is_staff() then
    new.status := 'new'; new.assigned_to := null; new.customer_id := null; new.quotation_id := null;
    new.internal_notes := ''; new.handled_at := null;
    if new.source <> 'legacy' then new.source := 'website'; new.legacy_id := null; end if;
  end if;
  if tg_op = 'INSERT' and new.product_id is null and new.reference <> '' then
    select id into new.product_id from public.products where upper(trim(reference)) = upper(trim(new.reference)) limit 1;
  end if;
  if tg_op = 'UPDATE' and new.status in ('converted','closed','spam') and old.status not in ('converted','closed','spam') then
    new.handled_at := now();
  end if;
  return new;
end $$;
drop trigger if exists contact_requests_guard on public.contact_requests;
create trigger contact_requests_guard before insert or update on public.contact_requests for each row execute function public.contact_requests_guard();

-- Legacy tables keep working (the current public site writes to them): mirror into the unified inbox.
create or replace function public.mirror_legacy_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'quote_requests' then
    insert into public.contact_requests (request_type, full_name, company, email, phone, subject, message, product, reference, quantity, attachment_path, locale, source, legacy_id, created_at)
    values ('quote', new.full_name, coalesce(new.company, ''), new.email, coalesce(new.phone, ''), left('Demande de devis : ' || new.product, 200),
            coalesce(new.message, ''), new.product, coalesce(new.reference, ''), new.quantity,
            case when new.attachment_path ~ '^incoming/[A-Za-z0-9._-]+$' then new.attachment_path end, new.locale, 'legacy', new.id, new.created_at)
    on conflict (legacy_id) do nothing;
  else
    insert into public.contact_requests (request_type, full_name, email, phone, subject, message, source, legacy_id, created_at)
    values ('contact', new.full_name, new.email, coalesce(new.phone, ''), new.subject, new.message, 'legacy', new.id, new.created_at)
    on conflict (legacy_id) do nothing;
  end if;
  return null;
end $$;
drop trigger if exists quote_requests_mirror on public.quote_requests;
create trigger quote_requests_mirror after insert on public.quote_requests for each row execute function public.mirror_legacy_request();
drop trigger if exists contact_messages_mirror on public.contact_messages;
create trigger contact_messages_mirror after insert on public.contact_messages for each row execute function public.mirror_legacy_request();

create or replace function public.assign_request(p_request_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('requests', 'assign');
  if p_user_id is not null and not exists (select 1 from public.users where id = p_user_id and is_active) then
    raise exception 'Utilisateur inactif ou introuvable.';
  end if;
  update public.contact_requests
     set assigned_to = p_user_id,
         status = case when p_user_id is not null and status = 'new' then 'assigned' when p_user_id is null and status = 'assigned' then 'new' else status end
   where id = p_request_id;
  if not found then raise exception 'Demande introuvable.'; end if;
end $$;

create or replace function public.convert_request_to_customer(p_request_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.contact_requests; v_id uuid;
begin
  select * into r from public.contact_requests where id = p_request_id for update;
  if not found then raise exception 'Demande introuvable.'; end if;
  if not (public.has_permission('requests', 'edit') or r.assigned_to = auth.uid()) then
    raise exception 'Permission refusée (requests.edit)' using errcode = '42501';
  end if;
  if r.customer_id is not null then return r.customer_id; end if;
  select id into v_id from public.customers where lower(email) = lower(r.email) and email <> '' order by created_at limit 1;
  if v_id is null then
    perform public.require_permission('customers', 'create');
    insert into public.customers (customer_type, name, contact_name, email, phone, source, notes)
    values (case when r.company <> '' then 'company' else 'individual' end,
            coalesce(nullif(trim(r.company), ''), r.full_name), r.full_name, r.email, r.phone, 'website',
            'Créé depuis une demande du site du ' || to_char(r.created_at, 'DD/MM/YYYY') || '.')
    returning id into v_id;
  end if;
  update public.contact_requests set customer_id = v_id, status = case when status in ('new','assigned') then 'in_progress' else status end
   where id = p_request_id;
  return v_id;
end $$;

create or replace function public.convert_request_to_quotation(p_request_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.contact_requests; v_customer uuid; v_q uuid; s public.company_settings; pr public.products;
begin
  perform public.require_permission('quotations', 'create');
  select * into r from public.contact_requests where id = p_request_id for update;
  if not found then raise exception 'Demande introuvable.'; end if;
  if r.quotation_id is not null then return r.quotation_id; end if;
  v_customer := public.convert_request_to_customer(p_request_id);
  select * into s from public.company_settings where id = 1;
  insert into public.quotations (customer_id, request_id, issue_date, valid_until, terms, notes, customer_reference)
  values (v_customer, p_request_id, current_date, current_date + s.quotation_validity_days, s.quotation_terms, '', '')
  returning id into v_q;
  if r.product_id is not null then
    select * into pr from public.products where id = r.product_id;
    insert into public.quotation_items (quotation_id, position, product_id, reference, description, unit, quantity, unit_price, vat_rate)
    values (v_q, 1, pr.id, pr.reference, coalesce(nullif(pr.name ->> 'fr', ''), r.product), pr.unit, coalesce(r.quantity, 1), pr.sale_price, pr.vat_rate);
  elsif r.product <> '' then
    insert into public.quotation_items (quotation_id, position, reference, description, quantity, unit_price, vat_rate)
    values (v_q, 1, r.reference, r.product, coalesce(r.quantity, 1), 0, s.default_vat_rate);
  end if;
  update public.contact_requests set quotation_id = v_q, status = 'converted' where id = p_request_id;
  perform public.write_log('request.converted', 'contact_requests', p_request_id, r.full_name, jsonb_build_object('quotation_id', v_q));
  return v_q;
end $$;

-- -----------------------------------------------------------------------------
-- 15. QUOTATIONS : workflow RPCs
-- -----------------------------------------------------------------------------
create or replace function public.set_quotation_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare q public.quotations;
begin
  perform public.require_permission('quotations', case when p_status = 'sent' then 'send' else 'edit' end);
  select * into q from public.quotations where id = p_id for update;
  if not found then raise exception 'Devis introuvable.'; end if;
  if p_status = 'sent' and not exists (select 1 from public.quotation_items where quotation_id = p_id) then
    raise exception 'Ajoutez au moins une ligne au devis.';
  end if;
  update public.quotations set status = p_status where id = p_id;  -- transitions validated by quotations_guard
  perform public.write_log('quotation.' || p_status, 'quotations', p_id, q.number, '{}'::jsonb);
end $$;

create or replace function public.expire_quotations() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.has_permission('quotations', 'view') then return 0; end if;
  update public.quotations set status = 'expired' where status = 'sent' and valid_until < current_date;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.duplicate_quotation(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare q public.quotations; v_new uuid; s public.company_settings;
begin
  perform public.require_permission('quotations', 'create');
  select * into q from public.quotations where id = p_id;
  if not found then raise exception 'Devis introuvable.'; end if;
  select * into s from public.company_settings where id = 1;
  insert into public.quotations (customer_id, issue_date, valid_until, currency, discount_percent, terms, notes, customer_reference)
  values (q.customer_id, current_date, current_date + s.quotation_validity_days, q.currency, q.discount_percent, q.terms, q.notes, q.customer_reference)
  returning id into v_new;
  insert into public.quotation_items (quotation_id, position, product_id, reference, description, unit, quantity, unit_price, discount_percent, vat_rate)
  select v_new, position, product_id, reference, description, unit, quantity, unit_price, discount_percent, vat_rate
    from public.quotation_items where quotation_id = p_id;
  return v_new;
end $$;

create or replace function public.convert_quotation_to_order(p_id uuid, p_customer_reference text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare q public.quotations; v_id uuid;
begin
  perform public.require_permission('orders', 'create');
  select * into q from public.quotations where id = p_id for update;
  if not found then raise exception 'Devis introuvable.'; end if;
  if q.status <> 'accepted' then raise exception 'Seul un devis accepté peut être transformé en commande.' using errcode = 'P0001'; end if;
  select id into v_id from public.orders where quotation_id = p_id;
  if v_id is not null then return v_id; end if;
  insert into public.orders (quotation_id, customer_id, customer_reference)
  values (p_id, q.customer_id, coalesce(nullif(p_customer_reference, ''), q.customer_reference))
  returning id into v_id;
  perform public.write_log('quotation.converted_to_order', 'quotations', p_id, q.number, jsonb_build_object('order_id', v_id));
  return v_id;
end $$;

create or replace function public.convert_quotation_to_invoice(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare q public.quotations; v_id uuid; v_existing text; v_order uuid; s public.company_settings;
begin
  perform public.require_permission('invoices', 'create');
  select * into q from public.quotations where id = p_id for update;
  if not found then raise exception 'Devis introuvable.'; end if;
  if q.status <> 'accepted' then raise exception 'Seul un devis accepté peut être facturé.' using errcode = 'P0001'; end if;
  select coalesce(number, 'brouillon') into v_existing from public.invoices
   where quotation_id = p_id and kind = 'invoice' and status <> 'cancelled' limit 1;
  if v_existing is not null then raise exception 'Ce devis est déjà facturé (%).', v_existing using errcode = 'P0001'; end if;
  select id into v_order from public.orders where quotation_id = p_id and status <> 'cancelled';
  select * into s from public.company_settings where id = 1;
  insert into public.invoices (customer_id, quotation_id, order_id, currency, discount_percent, terms, customer_reference, notes)
  values (q.customer_id, p_id, v_order, q.currency, q.discount_percent, s.invoice_terms, q.customer_reference, q.notes)
  returning id into v_id;
  insert into public.invoice_items (invoice_id, position, product_id, reference, description, unit, quantity, unit_price, discount_percent, vat_rate)
  select v_id, position, product_id, reference, description, unit, quantity, unit_price, discount_percent, vat_rate
    from public.quotation_items where quotation_id = p_id order by position;
  perform public.write_log('quotation.converted_to_invoice', 'quotations', p_id, q.number, jsonb_build_object('invoice_id', v_id));
  return v_id;
end $$;

create or replace function public.create_invoice_from_order(p_order_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then raise exception 'Commande introuvable.'; end if;
  if o.status = 'cancelled' then raise exception 'Commande annulée.'; end if;
  return public.convert_quotation_to_invoice(o.quotation_id);
end $$;

-- -----------------------------------------------------------------------------
-- 16. INVOICES : validation, sending, credit notes, cancellation
-- -----------------------------------------------------------------------------
create or replace function public.validate_invoice(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  inv public.invoices; s public.company_settings; c public.customers; o public.invoices;
  v_number text; v_credited numeric; it record;
begin
  perform public.require_permission('invoices', 'validate');
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'Facture introuvable.'; end if;
  if inv.status <> 'draft' then raise exception 'Cette facture est déjà validée (%).', inv.number using errcode = 'P0001'; end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_id) then
    raise exception 'Ajoutez au moins une ligne avant de valider.' using errcode = 'P0001';
  end if;
  if inv.total_ttc <= 0 then raise exception 'Le montant total doit être positif.' using errcode = 'P0001'; end if;
  select * into s from public.company_settings where id = 1;
  select * into c from public.customers where id = inv.customer_id;

  if inv.kind = 'credit_note' then
    select * into o from public.invoices where id = inv.original_invoice_id for update;
    if o.kind <> 'invoice' or o.status in ('draft','cancelled') then
      raise exception 'La facture d''origine ne peut plus recevoir d''avoir.' using errcode = 'P0001';
    end if;
    if o.customer_id <> inv.customer_id then raise exception 'L''avoir doit concerner le client de la facture d''origine.'; end if;
    select coalesce(sum(total_ttc), 0) into v_credited from public.invoices
     where original_invoice_id = o.id and kind = 'credit_note' and status not in ('draft','cancelled');
    if v_credited + inv.total_ttc > o.total_ttc then
      raise exception 'Le total des avoirs (%) dépasserait le montant de la facture % (%).', v_credited + inv.total_ttc, o.number, o.total_ttc using errcode = 'P0001';
    end if;
  end if;

  perform public._bypass_on();
  update public.invoice_items ii set unit_cost = p.purchase_price
    from public.products p where ii.invoice_id = p_id and p.id = ii.product_id;
  v_number := public.next_number(case inv.kind when 'invoice' then 'invoice' else 'credit_note' end);
  update public.invoices set
    number = v_number, status = 'validated', validated_at = now(), validated_by = auth.uid(),
    due_date = case when kind = 'invoice' then coalesce(due_date, issue_date + c.payment_terms_days) else due_date end,
    customer_snapshot = jsonb_build_object(
      'code', c.code, 'name', c.name, 'contact_name', c.contact_name, 'tax_id', c.tax_id, 'trade_register', c.trade_register,
      'vat_exempt', c.vat_exempt, 'address', c.address, 'city', c.city, 'postal_code', c.postal_code, 'governorate', c.governorate,
      'country', c.country, 'email', c.email, 'phone', coalesce(nullif(c.phone, ''), c.mobile))
  where id = p_id;
  perform public._bypass_off();

  if s.stock_exit_on = 'invoice' and (inv.kind = 'invoice' or inv.restock) then
    for it in select ii.* from public.invoice_items ii where ii.invoice_id = p_id and ii.product_id is not null order by position loop
      perform public._post_movement(it.product_id,
        case when inv.kind = 'invoice' then 'out' else 'in' end,
        case when inv.kind = 'invoice' then 'sale_invoice' else 'credit_note' end,
        case when inv.kind = 'invoice' then -it.quantity else it.quantity end,
        it.unit_cost, 'invoice', p_id, v_number);
    end loop;
  end if;

  perform public.refresh_invoice_status(p_id);
  if inv.kind = 'credit_note' then perform public.refresh_invoice_status(inv.original_invoice_id); end if;
  if inv.order_id is not null and inv.kind = 'invoice' then
    update public.orders set status = 'invoiced' where id = inv.order_id and status <> 'cancelled';
  end if;
  perform public.write_log(case inv.kind when 'invoice' then 'invoice.validated' else 'credit_note.validated' end,
    'invoices', p_id, v_number, jsonb_build_object('total_ttc', inv.total_ttc, 'customer', c.name));
  return v_number;
end $$;

create or replace function public.mark_invoice_sent(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.invoices;
begin
  perform public.require_permission('invoices', 'send');
  select * into inv from public.invoices where id = p_id for update;
  if not found or inv.status = 'draft' then raise exception 'Validez la facture avant de l''envoyer.' using errcode = 'P0001'; end if;
  if inv.sent_at is null then
    perform public._bypass_on();
    update public.invoices set sent_at = now() where id = p_id;
    perform public._bypass_off();
    perform public.refresh_invoice_status(p_id);
  end if;
  perform public.write_log('invoice.sent', 'invoices', p_id, inv.number, '{}'::jsonb);
end $$;

create or replace function public.create_credit_note(p_invoice_id uuid, p_reason text, p_full boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.invoices; v_id uuid;
begin
  perform public.require_permission('invoices', 'cancel');
  select * into o from public.invoices where id = p_invoice_id;
  if not found or o.kind <> 'invoice' or o.status in ('draft','cancelled') then
    raise exception 'Un avoir ne peut être émis que sur une facture validée non annulée.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indiquez le motif de l''avoir.'; end if;
  insert into public.invoices (kind, original_invoice_id, customer_id, quotation_id, order_id, currency, discount_percent, fiscal_stamp, reason, notes, terms)
  values ('credit_note', o.id, o.customer_id, o.quotation_id, o.order_id, o.currency, o.discount_percent,
          case when p_full then o.fiscal_stamp else 0 end, trim(p_reason), '', '')
  returning id into v_id;
  if p_full then
    insert into public.invoice_items (invoice_id, position, product_id, reference, description, unit, quantity, unit_price, discount_percent, vat_rate)
    select v_id, position, product_id, reference, description, unit, quantity, unit_price, discount_percent, vat_rate
      from public.invoice_items where invoice_id = o.id order by position;
  end if;
  perform public.write_log('credit_note.created', 'invoices', p_invoice_id, o.number, jsonb_build_object('credit_note_id', v_id, 'full', p_full, 'reason', p_reason));
  return v_id;
end $$;

-- Cancels a validated invoice by issuing and validating a full credit note (legal audit trail kept).
create or replace function public.cancel_invoice(p_invoice_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.invoices; v_cn uuid;
begin
  perform public.require_permission('invoices', 'cancel');
  select * into o from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Facture introuvable.'; end if;
  if o.status = 'draft' then raise exception 'Une facture brouillon se supprime simplement.' using errcode = 'P0001'; end if;
  if o.amount_paid > 0 then
    raise exception 'Cette facture a des paiements affectés (%). Retirez les affectations avant de l''annuler.', o.amount_paid using errcode = 'P0001';
  end if;
  if o.amount_credited > 0 then raise exception 'Des avoirs existent déjà : émettez un avoir pour le solde restant.' using errcode = 'P0001'; end if;
  v_cn := public.create_credit_note(p_invoice_id, p_reason, true);
  perform public.validate_invoice(v_cn);
  perform public.write_log('invoice.cancelled', 'invoices', p_invoice_id, o.number, jsonb_build_object('credit_note_id', v_cn, 'reason', p_reason));
  return v_cn;
end $$;

create or replace function public.refresh_overdue_invoices() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not public.has_permission('invoices', 'view') then return 0; end if;
  for r in select id from public.invoices
            where kind = 'invoice' and status in ('validated','sent','partially_paid') and due_date < current_date and balance_due > 0 loop
    perform public.refresh_invoice_status(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- 17. PAYMENTS : record (atomic), allocate, unallocate, cancel
-- -----------------------------------------------------------------------------
create or replace function public.record_payment(
  p_customer_id uuid, p_amount numeric, p_method_id uuid, p_payment_date date default current_date,
  p_reference text default '', p_bank_name text default '', p_due_date date default null,
  p_notes text default '', p_is_deposit boolean default false, p_allocations jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare m public.payment_methods; v_id uuid; a jsonb; v_number text;
begin
  perform public.require_permission('payments', 'create');
  if p_amount is null or p_amount <= 0 then raise exception 'Montant invalide.'; end if;
  if round(p_amount, 3) <> p_amount then raise exception 'Montant : 3 décimales maximum.'; end if;
  select * into m from public.payment_methods where id = p_method_id and is_active;
  if not found then raise exception 'Mode de paiement invalide.'; end if;
  if m.requires_reference and coalesce(trim(p_reference), '') = '' then
    raise exception 'Le mode « % » exige une référence (n° de chèque, de virement…).', m.label using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then raise exception 'Client introuvable.'; end if;
  insert into public.payments (customer_id, payment_date, amount, method_id, reference, bank_name, due_date, notes, is_deposit)
  values (p_customer_id, coalesce(p_payment_date, current_date), p_amount, p_method_id, coalesce(trim(p_reference), ''),
          coalesce(trim(p_bank_name), ''), case when m.has_due_date then p_due_date end, coalesce(p_notes, ''), coalesce(p_is_deposit, false))
  returning id, number into v_id, v_number;
  insert into public.receipts (payment_id) values (v_id);
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if coalesce((a ->> 'amount')::numeric, 0) > 0 then
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (v_id, (a ->> 'invoice_id')::uuid, round((a ->> 'amount')::numeric, 3));
    end if;
  end loop;
  perform public.write_log('payment.recorded', 'payments', v_id, v_number, jsonb_build_object('amount', p_amount, 'method', m.code));
  return v_id;
end $$;

create or replace function public.allocate_payment(p_payment_id uuid, p_invoice_id uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('payments', 'edit');
  if p_amount is null or p_amount <= 0 then raise exception 'Montant invalide.'; end if;
  insert into public.payment_allocations (payment_id, invoice_id, amount) values (p_payment_id, p_invoice_id, round(p_amount, 3))
  on conflict (payment_id, invoice_id) do update set amount = public.payment_allocations.amount + excluded.amount;
  perform public.write_log('payment.allocated', 'payments', p_payment_id, '', jsonb_build_object('invoice_id', p_invoice_id, 'amount', p_amount));
end $$;

create or replace function public.remove_allocation(p_allocation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.payment_allocations;
begin
  perform public.require_permission('payments', 'edit');
  delete from public.payment_allocations where id = p_allocation_id returning * into a;
  if a.id is null then raise exception 'Affectation introuvable.'; end if;
  perform public.write_log('payment.unallocated', 'payments', a.payment_id, '', jsonb_build_object('invoice_id', a.invoice_id, 'amount', a.amount));
end $$;

create or replace function public.cancel_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.payments; v_allocs jsonb;
begin
  perform public.require_permission('payments', 'delete');
  select * into p from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Paiement introuvable.'; end if;
  if p.status = 'cancelled' then raise exception 'Paiement déjà annulé.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indiquez le motif de l''annulation.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('invoice_id', invoice_id, 'amount', amount)), '[]'::jsonb) into v_allocs
    from public.payment_allocations where payment_id = p_payment_id;
  delete from public.payment_allocations where payment_id = p_payment_id;
  update public.payments set status = 'cancelled', cancel_reason = trim(p_reason), cancelled_at = now() where id = p_payment_id;
  perform public.write_log('payment.cancelled', 'payments', p_payment_id, p.number, jsonb_build_object('reason', p_reason, 'allocations', v_allocs));
end $$;

-- -----------------------------------------------------------------------------
-- 18. PURCHASING : receive goods (stock in + weighted average cost)
-- -----------------------------------------------------------------------------
create or replace function public.receive_purchase_order(p_po_id uuid, p_lines jsonb, p_date date default current_date, p_notes text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  po public.purchase_orders; it public.purchase_order_items; l jsonb; v_qty numeric; v_cost numeric;
  v_receipt uuid; v_number text; v_stock numeric; v_avg numeric; v_count int := 0;
begin
  perform public.require_permission('purchases', 'receive');
  select * into po from public.purchase_orders where id = p_po_id for update;
  if not found then raise exception 'Bon de commande introuvable.'; end if;
  if po.status not in ('draft','sent','partially_received') then
    raise exception 'Bon de commande % : statut « % », réception impossible.', po.number, po.status using errcode = 'P0001';
  end if;
  insert into public.goods_receipts (purchase_order_id, received_date, notes) values (p_po_id, coalesce(p_date, current_date), coalesce(p_notes, ''))
  returning id, number into v_receipt, v_number;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce((l ->> 'quantity')::numeric, 0);
    continue when v_qty <= 0;
    select * into it from public.purchase_order_items where id = (l ->> 'item_id')::uuid and purchase_order_id = p_po_id for update;
    if not found then raise exception 'Ligne de commande introuvable.'; end if;
    if it.received_quantity + v_qty > it.quantity then
      raise exception 'Ligne « % » : % reçus sur % commandés.', it.description, it.received_quantity + v_qty, it.quantity using errcode = 'P0001';
    end if;
    v_cost := round(it.unit_price * (1 - it.discount_percent / 100) * (1 - po.discount_percent / 100) * po.exchange_rate, 3);
    perform public._bypass_on();
    update public.purchase_order_items set received_quantity = received_quantity + v_qty where id = it.id;
    if it.product_id is not null and exists (select 1 from public.products where id = it.product_id and track_stock) then
      select stock_quantity, purchase_price into v_stock, v_avg from public.products where id = it.product_id for update;
      update public.products
         set purchase_price = case when v_stock <= 0 then v_cost else round((v_stock * v_avg + v_qty * v_cost) / (v_stock + v_qty), 3) end
       where id = it.product_id;
    end if;
    perform public._bypass_off();
    insert into public.goods_receipt_items (goods_receipt_id, purchase_order_item_id, product_id, quantity, unit_cost_tnd)
    values (v_receipt, it.id, it.product_id, v_qty, v_cost);
    perform public._post_movement(it.product_id, 'in', 'purchase_receipt', v_qty, v_cost, 'goods_receipt', v_receipt, v_number || ' / ' || po.number);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'Aucune quantité à réceptionner.' using errcode = 'P0001'; end if;
  perform public._bypass_on();
  update public.purchase_orders
     set status = case when exists (select 1 from public.purchase_order_items where purchase_order_id = p_po_id and received_quantity < quantity)
                       then 'partially_received' else 'received' end
   where id = p_po_id;
  perform public._bypass_off();
  perform public.write_log('purchase_order.received', 'purchase_orders', p_po_id, po.number, jsonb_build_object('goods_receipt', v_number, 'lines', v_count));
  return v_receipt;
end $$;

-- -----------------------------------------------------------------------------
-- 19. INVENTORY : manual entries, exits and physical-count adjustments
-- -----------------------------------------------------------------------------
create or replace function public.record_stock_movement(p_product_id uuid, p_kind text, p_quantity numeric, p_unit_cost numeric default null, p_notes text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare pr public.products; v_delta numeric; v_id uuid; v_type text; v_reason text;
begin
  perform public.require_permission('inventory', 'adjust');
  select * into pr from public.products where id = p_product_id for update;
  if not found then raise exception 'Produit introuvable.'; end if;
  if not pr.track_stock then raise exception 'Ce produit n''est pas suivi en stock.'; end if;
  if p_quantity is null or p_quantity < 0 or (p_kind <> 'adjustment' and p_quantity = 0) then raise exception 'Quantité invalide.'; end if;
  if p_kind in ('exit','adjustment') and coalesce(trim(p_notes), '') = '' then
    raise exception 'Indiquez le motif de la sortie ou de l''ajustement.' using errcode = 'P0001';
  end if;
  case p_kind
    when 'entry'      then v_delta := p_quantity;  v_type := 'in';  v_reason := 'manual_entry';
    when 'exit'       then v_delta := -p_quantity; v_type := 'out'; v_reason := 'manual_exit';
    when 'opening'    then v_delta := p_quantity;  v_type := 'in';  v_reason := 'opening';
    when 'adjustment' then v_delta := p_quantity - pr.stock_quantity; v_type := 'adjustment'; v_reason := 'inventory_adjustment';
    else raise exception 'Type de mouvement inconnu.';
  end case;
  if v_delta = 0 then raise exception 'Aucun écart avec le stock actuel (%).', pr.stock_quantity using errcode = 'P0001'; end if;
  if p_kind in ('entry','opening') and p_unit_cost is not null and p_unit_cost >= 0 and public.has_permission('products', 'view_costs') then
    perform public._bypass_on();
    update public.products
       set purchase_price = case when pr.stock_quantity <= 0 then round(p_unit_cost, 3)
                                 else round((pr.stock_quantity * pr.purchase_price + p_quantity * p_unit_cost) / (pr.stock_quantity + p_quantity), 3) end
     where id = p_product_id;
    perform public._bypass_off();
  end if;
  insert into public.stock_movements (product_id, movement_type, reason, quantity, unit_cost, source_type, source_label, notes)
  values (p_product_id, v_type, v_reason, v_delta, coalesce(p_unit_cost, pr.purchase_price), 'manual', '', coalesce(trim(p_notes), ''))
  returning id into v_id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 20. DELIVERY NOTES
-- -----------------------------------------------------------------------------
create or replace function public.create_delivery_note(p_source_type text, p_source_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_customer uuid; v_order uuid; v_invoice uuid; c public.customers; inv public.invoices; o public.orders;
begin
  perform public.require_permission('deliveries', 'create');
  if p_source_type = 'order' then
    select * into o from public.orders where id = p_source_id;
    if not found or o.status = 'cancelled' then raise exception 'Commande introuvable ou annulée.'; end if;
    v_customer := o.customer_id; v_order := o.id;
  elsif p_source_type = 'invoice' then
    select * into inv from public.invoices where id = p_source_id;
    if not found or inv.kind <> 'invoice' or inv.status in ('draft','cancelled') then raise exception 'Facture non valide pour une livraison.'; end if;
    v_customer := inv.customer_id; v_invoice := inv.id; v_order := inv.order_id;
  else
    raise exception 'Source inconnue.';
  end if;
  select * into c from public.customers where id = v_customer;
  insert into public.delivery_notes (customer_id, order_id, invoice_id, delivery_address)
  values (v_customer, v_order, v_invoice, concat_ws(', ', nullif(c.address, ''), nullif(trim(c.postal_code || ' ' || c.city), ''), nullif(c.country, '')))
  returning id into v_id;
  if p_source_type = 'order' then
    insert into public.delivery_note_items (delivery_note_id, position, product_id, reference, description, unit, quantity)
    select v_id, position, product_id, reference, description, unit, quantity from public.quotation_items where quotation_id = o.quotation_id order by position;
  else
    insert into public.delivery_note_items (delivery_note_id, position, product_id, reference, description, unit, quantity)
    select v_id, position, product_id, reference, description, unit, quantity from public.invoice_items where invoice_id = inv.id order by position;
  end if;
  return v_id;
end $$;

create or replace function public.validate_delivery_note(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.delivery_notes; s public.company_settings; it record;
begin
  perform public.require_permission('deliveries', 'validate');
  select * into d from public.delivery_notes where id = p_id for update;
  if not found then raise exception 'Bon de livraison introuvable.'; end if;
  if d.status <> 'draft' then raise exception 'Bon de livraison déjà % .', d.status using errcode = 'P0001'; end if;
  if not exists (select 1 from public.delivery_note_items where delivery_note_id = p_id) then raise exception 'Aucune ligne à livrer.'; end if;
  select * into s from public.company_settings where id = 1;
  perform public._bypass_on();
  update public.delivery_notes set status = 'validated', validated_at = now(), validated_by = auth.uid() where id = p_id;
  perform public._bypass_off();
  if s.stock_exit_on = 'delivery_note' then
    for it in select * from public.delivery_note_items where delivery_note_id = p_id and product_id is not null order by position loop
      perform public._post_movement(it.product_id, 'out', 'delivery_note', -it.quantity,
        (select purchase_price from public.products where id = it.product_id), 'delivery_note', p_id, d.number);
    end loop;
  end if;
  if d.order_id is not null then
    update public.orders set status = 'delivered' where id = d.order_id and status in ('confirmed','in_progress');
  end if;
  perform public.write_log('delivery_note.validated', 'delivery_notes', p_id, d.number, '{}'::jsonb);
end $$;

create or replace function public.cancel_delivery_note(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.delivery_notes; m record;
begin
  perform public.require_permission('deliveries', 'validate');
  select * into d from public.delivery_notes where id = p_id for update;
  if not found then raise exception 'Bon de livraison introuvable.'; end if;
  if d.status = 'cancelled' then raise exception 'Déjà annulé.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indiquez le motif.'; end if;
  -- Reverse the stock exits this note produced (if any).
  for m in select * from public.stock_movements where source_type = 'delivery_note' and source_id = p_id and reason = 'delivery_note' loop
    perform public._post_movement(m.product_id, 'in', 'return', -m.quantity, m.unit_cost, 'delivery_note', p_id, d.number, 'Annulation : ' || p_reason);
  end loop;
  perform public._bypass_on();
  update public.delivery_notes set status = 'cancelled', notes = trim(both from notes || E'\nAnnulé : ' || p_reason) where id = p_id;
  perform public._bypass_off();
  perform public.write_log('delivery_note.cancelled', 'delivery_notes', p_id, d.number, jsonb_build_object('reason', p_reason));
end $$;

-- -----------------------------------------------------------------------------
-- 21. VIEWS (security_invoker: the caller's RLS applies)
-- -----------------------------------------------------------------------------
create or replace view public.customer_balances with (security_invoker = true) as
select c.id as customer_id,
       coalesce(i.invoiced, 0)    as invoiced,
       coalesce(i.credited, 0)    as credited,
       coalesce(i.outstanding, 0) as outstanding,
       coalesce(i.overdue, 0)     as overdue,
       coalesce(p.paid, 0)        as paid,
       coalesce(p.unallocated, 0) as unallocated,
       coalesce(i.outstanding, 0) - coalesce(p.unallocated, 0) as net_balance,
       i.last_invoice_date
from public.customers c
left join (
  select customer_id,
         sum(total_ttc) filter (where kind = 'invoice')         as invoiced,
         sum(total_ttc) filter (where kind = 'credit_note')     as credited,
         sum(balance_due) filter (where kind = 'invoice')       as outstanding,
         sum(balance_due) filter (where kind = 'invoice' and status = 'overdue') as overdue,
         max(issue_date) as last_invoice_date
  from public.invoices where status <> 'draft' group by customer_id
) i on i.customer_id = c.id
left join (
  select customer_id, sum(amount) as paid, sum(amount - allocated_amount) as unallocated
  from public.payments where status = 'valid' group by customer_id
) p on p.customer_id = c.id;

-- -----------------------------------------------------------------------------
-- 22. DASHBOARD & REPORTS (server-side aggregation on real data)
-- -----------------------------------------------------------------------------
create or replace function public._net_sales(p_from date, p_to date)
returns table (invoice_id uuid, kind text, issue_date date, customer_id uuid, sign int, total_ht numeric, total_vat numeric, total_ttc numeric)
language sql stable security definer set search_path = public as $$
  select id, kind, issue_date, customer_id, case kind when 'invoice' then 1 else -1 end,
         total_ht, total_vat, total_ttc - coalesce(fiscal_stamp, 0)
  from public.invoices
  where status <> 'draft' and issue_date between p_from and p_to;
$$;

create or replace function public.dashboard_stats() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := '{}'::jsonb; v_year_start date := date_trunc('year', current_date)::date;
  v_month_start date := date_trunc('month', current_date)::date; v_costs boolean := public.has_permission('products', 'view_costs');
begin
  perform public.require_permission('dashboard', 'view');
  perform public.refresh_overdue_invoices();
  perform public.expire_quotations();

  if public.has_permission('invoices', 'view') or public.has_permission('reports', 'view') then
    v := v || jsonb_build_object(
      'revenue_total_ht', (select coalesce(sum(sign * total_ht), 0) from public._net_sales('1900-01-01', current_date)),
      'revenue_year_ht',  (select coalesce(sum(sign * total_ht), 0) from public._net_sales(v_year_start, current_date)),
      'revenue_month_ht', (select coalesce(sum(sign * total_ht), 0) from public._net_sales(v_month_start, current_date)),
      'outstanding_amount', (select coalesce(sum(balance_due), 0) from public.invoices where kind = 'invoice' and status in ('validated','sent','partially_paid','overdue')),
      'outstanding_count',  (select count(*) from public.invoices where kind = 'invoice' and status in ('validated','sent','partially_paid','overdue')),
      'overdue_amount',     (select coalesce(sum(balance_due), 0) from public.invoices where kind = 'invoice' and status = 'overdue'),
      'overdue_count',      (select count(*) from public.invoices where kind = 'invoice' and status = 'overdue'),
      'draft_invoices',     (select count(*) from public.invoices where status = 'draft'),
      'monthly_sales', (
        select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'total_ht', coalesce(s.ht, 0), 'total_ttc', coalesce(s.ttc, 0), 'invoices', coalesce(s.n, 0)) order by m), '[]'::jsonb)
        from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m
        left join (
          select date_trunc('month', issue_date) as mm, sum(sign * total_ht) ht, sum(sign * total_ttc) ttc, count(*) filter (where kind = 'invoice') n
          from public._net_sales((date_trunc('month', current_date) - interval '11 months')::date, current_date) group by 1
        ) s on s.mm = m),
      'recent_invoices', (
        select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
          select i.id, i.number, i.kind, i.status, i.issue_date, i.total_ttc, i.balance_due, c.name as customer, i.created_at
          from public.invoices i join public.customers c on c.id = i.customer_id order by i.created_at desc limit 6) x)
    );
  end if;

  if public.has_permission('payments', 'view') then
    v := v || jsonb_build_object(
      'payments_month', (select coalesce(sum(amount), 0) from public.payments where status = 'valid' and payment_date >= v_month_start),
      'payments_year',  (select coalesce(sum(amount), 0) from public.payments where status = 'valid' and payment_date >= v_year_start),
      'unallocated_payments', (select coalesce(sum(amount - allocated_amount), 0) from public.payments where status = 'valid'));
  end if;

  if public.has_permission('quotations', 'view') then
    v := v || jsonb_build_object(
      'pending_quotations', (select count(*) from public.quotations where status in ('draft','sent')),
      'pending_quotations_amount', (select coalesce(sum(total_ht), 0) from public.quotations where status in ('draft','sent')),
      'quotations_sent_month', (select count(*) from public.quotations where sent_at >= v_month_start));
  end if;

  if public.has_permission('customers', 'view') then
    v := v || jsonb_build_object(
      'customers_total', (select count(*) from public.customers where is_active),
      'customers_active', (select count(distinct customer_id) from public.invoices where status <> 'draft' and issue_date >= current_date - 365));
  end if;

  if public.has_permission('inventory', 'view') or public.has_permission('products', 'view') then
    v := v || jsonb_build_object(
      'products_total', (select count(*) from public.products where is_active),
      'products_in_stock', (select count(*) from public.products where is_active and track_stock and stock_quantity > 0),
      'units_in_stock', (select coalesce(sum(stock_quantity), 0) from public.products where is_active and track_stock and stock_quantity > 0),
      'low_stock_count', (select count(*) from public.products where is_active and track_stock and stock_quantity <= min_stock),
      'low_stock', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select id, reference, name ->> 'fr' as name, stock_quantity, min_stock, unit
          from public.products where is_active and track_stock and stock_quantity <= min_stock
          order by (stock_quantity - min_stock), reference limit 8) x),
      'stock_value', case when v_costs then (select coalesce(sum(stock_quantity * purchase_price), 0) from public.products where track_stock and stock_quantity > 0) end);
  end if;

  if public.has_permission('requests', 'view') then
    v := v || jsonb_build_object('new_requests', (select count(*) from public.contact_requests where status = 'new'));
  else
    v := v || jsonb_build_object('new_requests', (select count(*) from public.contact_requests where assigned_to = auth.uid() and status in ('new','assigned')));
  end if;

  v := v || jsonb_build_object('recent_activity', (
    select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
      select id, user_email, action, entity_type, entity_id, entity_label, created_at
      from public.activity_logs
      where public.has_permission('logs', 'view') or user_id = auth.uid()
      order by created_at desc limit 10) x));
  return v;
end $$;

create or replace function public.report_sales(p_from date, p_to date, p_group text default 'month') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('reports', 'view');
  if p_group not in ('day','week','month','year') then raise exception 'Regroupement invalide.'; end if;
  return (select coalesce(jsonb_agg(x order by x.period), '[]'::jsonb) from (
    select to_char(date_trunc(p_group, issue_date), case p_group when 'year' then 'YYYY' when 'month' then 'YYYY-MM' else 'YYYY-MM-DD' end) as period,
           count(*) filter (where kind = 'invoice') as invoices,
           count(*) filter (where kind = 'credit_note') as credit_notes,
           sum(total_ht) filter (where kind = 'invoice') as gross_ht,
           coalesce(sum(total_ht) filter (where kind = 'credit_note'), 0) as credited_ht,
           sum(sign * total_ht) as net_ht, sum(sign * total_vat) as net_vat, sum(sign * total_ttc) as net_ttc
    from public._net_sales(p_from, p_to) group by date_trunc(p_group, issue_date)) x);
end $$;

create or replace function public.report_customers(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('reports', 'view');
  return (select coalesce(jsonb_agg(x order by x.net_ht desc), '[]'::jsonb) from (
    select c.id, c.code, c.name, c.city,
           count(s.invoice_id) filter (where s.kind = 'invoice') as invoices,
           coalesce(sum(s.sign * s.total_ht), 0) as net_ht,
           coalesce(sum(s.sign * s.total_ttc), 0) as net_ttc,
           (select coalesce(sum(amount), 0) from public.payments p where p.customer_id = c.id and p.status = 'valid' and p.payment_date between p_from and p_to) as paid,
           (select coalesce(sum(balance_due), 0) from public.invoices i where i.customer_id = c.id and i.kind = 'invoice' and i.status <> 'draft') as outstanding
    from public.customers c left join public._net_sales(p_from, p_to) s on s.customer_id = c.id
    group by c.id having count(s.invoice_id) > 0
       or exists (select 1 from public.payments p where p.customer_id = c.id and p.payment_date between p_from and p_to)) x);
end $$;

create or replace function public.report_products(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_costs boolean := public.has_permission('products', 'view_costs');
begin
  perform public.require_permission('reports', 'view');
  return (select coalesce(jsonb_agg(x order by x.revenue_ht desc), '[]'::jsonb) from (
    select coalesce(p.id::text, '') as product_id, coalesce(p.reference, max(ii.reference)) as reference,
           coalesce(p.name ->> 'fr', max(ii.description)) as name,
           coalesce(cat.name ->> 'fr', '') as category, coalesce(b.name, '') as brand,
           sum(case when i.kind = 'invoice' then ii.quantity else -ii.quantity end) as quantity,
           round(sum((case when i.kind = 'invoice' then 1 else -1 end) * ii.total_ht * (1 - i.discount_percent / 100)), 3) as revenue_ht,
           case when v_costs then round(sum((case when i.kind = 'invoice' then 1 else -1 end) * ii.quantity * coalesce(ii.unit_cost, p.purchase_price, 0)), 3) end as cost,
           case when v_costs then round(sum((case when i.kind = 'invoice' then 1 else -1 end) * (ii.total_ht * (1 - i.discount_percent / 100) - ii.quantity * coalesce(ii.unit_cost, p.purchase_price, 0))), 3) end as margin
    from public.invoice_items ii
    join public.invoices i on i.id = ii.invoice_id and i.status <> 'draft' and i.issue_date between p_from and p_to
    left join public.products p on p.id = ii.product_id
    left join public.categories cat on cat.id = p.category_id
    left join public.brands b on b.id = p.brand_id
    group by p.id, p.reference, p.name, cat.name, b.name, case when p.id is null then ii.description end) x);
end $$;

create or replace function public.report_margins(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('reports', 'view');
  perform public.require_permission('products', 'view_costs');
  return (select coalesce(jsonb_agg(x order by x.revenue_ht desc), '[]'::jsonb) from (
    select coalesce(cat.name ->> 'fr', 'Sans catégorie') as category,
           round(sum(sg * ii.total_ht * (1 - i.discount_percent / 100)), 3) as revenue_ht,
           round(sum(sg * ii.quantity * coalesce(ii.unit_cost, p.purchase_price, 0)), 3) as cost,
           round(sum(sg * (ii.total_ht * (1 - i.discount_percent / 100) - ii.quantity * coalesce(ii.unit_cost, p.purchase_price, 0))), 3) as margin
    from public.invoice_items ii
    join public.invoices i on i.id = ii.invoice_id and i.status <> 'draft' and i.issue_date between p_from and p_to
    cross join lateral (select case when i.kind = 'invoice' then 1 else -1 end as sg) k
    left join public.products p on p.id = ii.product_id
    left join public.categories cat on cat.id = p.category_id
    group by 1) x);
end $$;

create or replace function public.report_quotations(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('reports', 'view');
  return jsonb_build_object(
    'by_status', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select status, count(*) as count, coalesce(sum(total_ht), 0) as total_ht
        from public.quotations where issue_date between p_from and p_to group by status) x),
    'by_salesperson', (select coalesce(jsonb_agg(x order by x.accepted_ht desc), '[]'::jsonb) from (
        select coalesce(u.full_name, u.email, 'Non attribué') as salesperson,
               count(*) as quotations,
               count(*) filter (where q.status = 'accepted') as accepted,
               coalesce(sum(q.total_ht) filter (where q.status = 'accepted'), 0) as accepted_ht
        from public.quotations q left join public.users u on u.id = q.salesperson_id
        where q.issue_date between p_from and p_to group by 1) x),
    'conversion_rate', (
        select case when count(*) filter (where status in ('sent','accepted','rejected','expired')) = 0 then 0
               else round(100.0 * count(*) filter (where status = 'accepted') / count(*) filter (where status in ('sent','accepted','rejected','expired')), 1) end
        from public.quotations where issue_date between p_from and p_to),
    'invoiced_rate', (
        select case when count(*) filter (where status = 'accepted') = 0 then 0
               else round(100.0 * count(*) filter (where status = 'accepted' and exists (select 1 from public.invoices i where i.quotation_id = q.id and i.kind = 'invoice' and i.status <> 'draft')) / count(*) filter (where status = 'accepted'), 1) end
        from public.quotations q where issue_date between p_from and p_to));
end $$;

create or replace function public.report_outstanding() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('reports', 'view');
  perform public.refresh_overdue_invoices();
  return (select coalesce(jsonb_agg(x order by x.days_overdue desc, x.number), '[]'::jsonb) from (
    select i.id, i.number, i.issue_date, i.due_date, i.status, i.total_ttc, i.amount_paid, i.amount_credited, i.balance_due,
           c.id as customer_id, c.name as customer, c.phone,
           greatest(current_date - coalesce(i.due_date, i.issue_date), 0) as days_overdue,
           case when i.due_date is null or i.due_date >= current_date then 'not_due'
                when current_date - i.due_date <= 30 then '1_30'
                when current_date - i.due_date <= 60 then '31_60'
                when current_date - i.due_date <= 90 then '61_90'
                else '90_plus' end as bucket
    from public.invoices i join public.customers c on c.id = i.customer_id
    where i.kind = 'invoice' and i.status in ('validated','sent','partially_paid','overdue') and i.balance_due > 0) x);
end $$;

create or replace function public.report_payments(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('reports', 'view');
  return jsonb_build_object(
    'by_method', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
        select m.label as method, count(*) as count, sum(p.amount) as total
        from public.payments p join public.payment_methods m on m.id = p.method_id
        where p.status = 'valid' and p.payment_date between p_from and p_to group by m.label) x),
    'by_month', (select coalesce(jsonb_agg(x order by x.month), '[]'::jsonb) from (
        select to_char(date_trunc('month', payment_date), 'YYYY-MM') as month, count(*) as count, sum(amount) as total
        from public.payments where status = 'valid' and payment_date between p_from and p_to group by 1) x),
    'payments', (select coalesce(jsonb_agg(x order by x.payment_date desc, x.number desc), '[]'::jsonb) from (
        select p.id, p.number, p.payment_date, p.amount, p.allocated_amount, p.reference, m.label as method, c.name as customer, p.status
        from public.payments p join public.payment_methods m on m.id = p.method_id join public.customers c on c.id = p.customer_id
        where p.payment_date between p_from and p_to) x));
end $$;

create or replace function public.report_purchases(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('reports', 'view');
  perform public.require_permission('purchases', 'view');
  return (select coalesce(jsonb_agg(x order by x.ordered_tnd desc), '[]'::jsonb) from (
    select s.id, s.code, s.name, s.country,
           (select count(*) from public.purchase_orders po where po.supplier_id = s.id and po.status <> 'cancelled' and po.order_date between p_from and p_to) as orders,
           (select coalesce(round(sum(po.total_ht * po.exchange_rate), 3), 0) from public.purchase_orders po where po.supplier_id = s.id and po.status <> 'cancelled' and po.order_date between p_from and p_to) as ordered_tnd,
           (select coalesce(round(sum(si.total_ttc * si.exchange_rate), 3), 0) from public.supplier_invoices si where si.supplier_id = s.id and si.status <> 'cancelled' and si.invoice_date between p_from and p_to) as invoiced_tnd,
           (select coalesce(sum(sp.amount_tnd), 0) from public.supplier_payments sp where sp.supplier_id = s.id and sp.payment_date between p_from and p_to) as paid_tnd,
           (select coalesce(round(sum((si.total_ttc - si.amount_paid) * si.exchange_rate), 3), 0) from public.supplier_invoices si where si.supplier_id = s.id and si.status in ('unpaid','partially_paid')) as payable_tnd
    from public.suppliers s) x where x.orders > 0 or x.invoiced_tnd > 0 or x.paid_tnd > 0 or x.payable_tnd > 0);
end $$;

create or replace function public.report_stock() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_costs boolean := public.has_permission('products', 'view_costs');
begin
  if not (public.has_permission('reports', 'view') or public.has_permission('inventory', 'view')) then
    raise exception 'Permission refusée (reports.view)' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(x order by x.reference), '[]'::jsonb) from (
    select p.id, p.reference, p.name ->> 'fr' as name, coalesce(c.name ->> 'fr', '') as category, coalesce(b.name, '') as brand,
           p.unit, p.stock_quantity, p.min_stock, p.sale_price,
           case when v_costs then p.purchase_price end as unit_cost,
           case when v_costs then round(p.stock_quantity * p.purchase_price, 3) end as stock_value,
           round(p.stock_quantity * p.sale_price, 3) as sale_value,
           case when p.stock_quantity <= 0 then 'out' when p.stock_quantity <= p.min_stock then 'low' else 'ok' end as stock_status,
           (select max(created_at) from public.stock_movements m where m.product_id = p.id) as last_movement
    from public.products p left join public.categories c on c.id = p.category_id left join public.brands b on b.id = p.brand_id
    where p.track_stock and p.is_active) x);
end $$;
