-- =============================================================================
-- ULTRA SUPPLY — ERP / CRM  ·  Migration 002 : core schema
-- Users, roles & permissions, settings, numbering, CRM, catalogue extensions,
-- sales (quotations, orders, invoices, credit notes), payments, purchasing,
-- inventory, delivery notes, website requests, documents, activity logs.
--
-- Run AFTER 001_init.sql, then 003_erp_functions.sql and 004_erp_security.sql.
-- Idempotent where practical. All monetary values: numeric(15,3) (TND = 3 decimals).
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. ROLES, PERMISSIONS, STAFF USERS
-- -----------------------------------------------------------------------------
create table if not exists public.roles (
  id          text primary key check (id ~ '^[a-z_]{2,40}$'),
  label       text not null,
  description text not null default '',
  sort_order  int  not null default 0
);

insert into public.roles (id, label, description, sort_order) values
  ('super_admin',   'Super administrateur', 'Accès total, gestion des rôles et des administrateurs.', 1),
  ('administrator', 'Administrateur',       'Gestion complète de l''activité et des utilisateurs.',  2),
  ('commercial',    'Commercial',           'Clients, devis, commandes et demandes du site.',        3),
  ('accountant',    'Comptable',            'Factures, avoirs, paiements, rapports financiers.',     4),
  ('stock_manager', 'Gestionnaire de stock','Produits, achats, réceptions, stock et livraisons.',    5),
  ('employee',      'Employé',              'Consultation et traitement des demandes affectées.',    6)
on conflict (id) do update set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;

create table if not exists public.permissions (
  id          uuid primary key default gen_random_uuid(),
  module      text not null check (module ~ '^[a-z_]+$'),
  action      text not null check (action ~ '^[a-z_]+$'),
  label       text not null default '',
  unique (module, action)
);

insert into public.permissions (module, action, label) values
  ('dashboard','view','Voir le tableau de bord'),
  ('customers','view','Voir les clients'),('customers','create','Créer des clients'),('customers','edit','Modifier les clients'),('customers','delete','Supprimer des clients'),('customers','export','Exporter les clients'),
  ('suppliers','view','Voir les fournisseurs'),('suppliers','create','Créer des fournisseurs'),('suppliers','edit','Modifier les fournisseurs'),('suppliers','delete','Supprimer des fournisseurs'),
  ('products','view','Voir les produits'),('products','create','Créer des produits'),('products','edit','Modifier les produits'),('products','delete','Supprimer des produits'),('products','view_costs','Voir les prix d''achat et marges'),
  ('quotations','view','Voir les devis'),('quotations','create','Créer des devis'),('quotations','edit','Modifier les devis'),('quotations','delete','Supprimer des devis brouillons'),('quotations','send','Envoyer les devis'),
  ('orders','view','Voir les commandes'),('orders','create','Créer des commandes'),('orders','edit','Modifier les commandes'),('orders','delete','Supprimer des commandes'),
  ('invoices','view','Voir les factures'),('invoices','create','Créer des factures'),('invoices','edit','Modifier les factures brouillons'),('invoices','delete','Supprimer des factures brouillons'),('invoices','validate','Valider les factures'),('invoices','send','Envoyer les factures'),('invoices','cancel','Émettre des avoirs / annuler'),
  ('payments','view','Voir les paiements'),('payments','create','Enregistrer des paiements'),('payments','edit','Affecter des paiements'),('payments','delete','Annuler des paiements'),
  ('purchases','view','Voir les achats'),('purchases','create','Créer des bons de commande'),('purchases','edit','Modifier les achats'),('purchases','delete','Supprimer des achats brouillons'),('purchases','receive','Réceptionner la marchandise'),
  ('inventory','view','Voir le stock'),('inventory','adjust','Mouvements et ajustements de stock'),
  ('deliveries','view','Voir les bons de livraison'),('deliveries','create','Créer des bons de livraison'),('deliveries','edit','Modifier les bons de livraison'),('deliveries','validate','Valider les livraisons'),('deliveries','delete','Supprimer des livraisons brouillons'),
  ('requests','view','Voir toutes les demandes du site'),('requests','edit','Traiter les demandes'),('requests','assign','Affecter les demandes'),('requests','delete','Supprimer des demandes'),
  ('documents','view','Voir les documents'),('documents','create','Ajouter des documents'),('documents','delete','Supprimer des documents'),
  ('reports','view','Voir les rapports'),('reports','export','Exporter les rapports'),
  ('users','view','Voir les utilisateurs'),('users','manage','Gérer les utilisateurs'),
  ('settings','view','Voir les paramètres'),('settings','edit','Modifier les paramètres'),
  ('logs','view','Voir le journal d''activité'),
  ('website','manage','Gérer le site public (catalogue, contenu)')
on conflict (module, action) do update set label = excluded.label;

create table if not exists public.role_permissions (
  role_id       text not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- Default permission matrix (super_admin bypasses every check, it needs no rows).
-- Only seeded once: later edits made in the admin are preserved on re-run.
do $$
begin
  if not exists (select 1 from public.role_permissions) then
    insert into public.role_permissions (role_id, permission_id)
    select r.role_id, p.id
    from (values
      ('administrator', '*'),
      ('commercial', 'dashboard.view customers.view customers.create customers.edit customers.export products.view quotations.view quotations.create quotations.edit quotations.delete quotations.send orders.view orders.create orders.edit invoices.view invoices.create invoices.edit invoices.send payments.view inventory.view deliveries.view deliveries.create requests.view requests.edit requests.assign documents.view documents.create reports.view'),
      ('accountant', 'dashboard.view customers.view customers.edit customers.export suppliers.view products.view products.view_costs quotations.view orders.view invoices.view invoices.create invoices.edit invoices.delete invoices.validate invoices.send invoices.cancel payments.view payments.create payments.edit payments.delete purchases.view purchases.edit inventory.view deliveries.view documents.view documents.create reports.view reports.export logs.view'),
      ('stock_manager', 'dashboard.view suppliers.view suppliers.create suppliers.edit products.view products.create products.edit products.view_costs purchases.view purchases.create purchases.edit purchases.receive inventory.view inventory.adjust deliveries.view deliveries.create deliveries.edit deliveries.validate deliveries.delete orders.view documents.view documents.create reports.view'),
      ('employee', 'dashboard.view customers.view products.view inventory.view')
    ) as r(role_id, perms)
    join public.permissions p
      on r.perms = '*' or (p.module || '.' || p.action) = any (string_to_array(r.perms, ' '));
  end if;
end $$;

-- Staff profiles (one row per Supabase auth user allowed into /admin).
create table if not exists public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text not null default '' check (char_length(full_name) <= 120),
  phone         text check (char_length(phone) <= 30),
  role_id       text not null default 'employee' references public.roles(id),
  is_active     boolean not null default false,
  last_login_at timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists users_role_idx on public.users(role_id);
create unique index if not exists users_email_key on public.users(lower(email));

-- -----------------------------------------------------------------------------
-- 2. COMPANY SETTINGS, VAT, PAYMENT METHODS, NUMBERING, EXCHANGE RATES
-- -----------------------------------------------------------------------------
create table if not exists public.company_settings (
  id                      smallint primary key default 1 check (id = 1),
  company_name            text not null default 'ULTRA SUPPLY',
  legal_name              text not null default 'ULTRA SUPPLY',
  activity                text not null default 'Import, distribution et commercialisation d''équipements agricoles et industriels',
  tax_id                  text not null default '',   -- Matricule fiscal
  trade_register          text not null default '',   -- Registre du commerce
  customs_code            text not null default '',
  address                 text not null default 'Sakiet Ezzit',
  city                    text not null default 'Sfax',
  postal_code             text not null default '',
  country                 text not null default 'Tunisie',
  phone                   text not null default '+216 56 633 772',
  phone2                  text not null default '+216 20 545 282',
  email                   text not null default 'ultrasupply.tn@gmail.com',
  website                 text not null default '',
  bank_name               text not null default '',
  bank_account            text not null default '',   -- RIB / IBAN
  bank_swift              text not null default '',
  logo_url                text,
  currency                char(3) not null default 'TND' check (currency ~ '^[A-Z]{3}$'),
  default_vat_rate        numeric(5,2) not null default 19 check (default_vat_rate between 0 and 100),
  apply_fiscal_stamp      boolean not null default true,
  fiscal_stamp            numeric(15,3) not null default 1.000 check (fiscal_stamp >= 0),
  quotation_validity_days int not null default 30 check (quotation_validity_days between 1 and 365),
  invoice_due_days        int not null default 30 check (invoice_due_days between 0 and 365),
  quotation_terms         text not null default 'Prix exprimés en dinars tunisiens (TND). Offre valable jusqu''à la date indiquée. Délai de livraison à confirmer à la commande. Paiement selon conditions convenues.',
  invoice_terms           text not null default 'Paiement à réception de facture sauf accord contraire. Tout retard de paiement pourra donner lieu à des pénalités.',
  pdf_footer              text not null default '',
  stock_exit_on           text not null default 'invoice' check (stock_exit_on in ('invoice','delivery_note')),
  allow_negative_stock    boolean not null default false,
  updated_at              timestamptz not null default now(),
  updated_by              uuid references auth.users(id) on delete set null
);
insert into public.company_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.vat_rates (
  id         uuid primary key default gen_random_uuid(),
  rate       numeric(5,2) not null unique check (rate between 0 and 100),
  label      text not null,
  is_default boolean not null default false,
  is_active  boolean not null default true
);
insert into public.vat_rates (rate, label, is_default) values
  (19, 'TVA 19 %', true), (13, 'TVA 13 %', false), (7, 'TVA 7 %', false), (0, 'Exonéré (0 %)', false)
on conflict (rate) do nothing;

create table if not exists public.payment_methods (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code ~ '^[a-z_]{2,40}$'),
  label              text not null,
  requires_reference boolean not null default false,
  has_due_date       boolean not null default false,
  is_active          boolean not null default true,
  sort_order         int not null default 0
);
insert into public.payment_methods (code, label, requires_reference, has_due_date, sort_order) values
  ('cash',             'Espèces',                    false, false, 1),
  ('bank_transfer',    'Virement bancaire',          true,  false, 2),
  ('cheque',           'Chèque',                     true,  true,  3),
  ('bill_of_exchange', 'Traite (effet de commerce)', true,  true,  4),
  ('other',            'Autre',                      false, false, 9)
on conflict (code) do nothing;

-- Numbering rules: prefix + (year) + counter, e.g. FAC-2026-0001.
create table if not exists public.numbering_rules (
  doc_type text primary key,
  label    text not null,
  prefix   text not null check (prefix ~ '^[A-Z0-9]{1,8}$'),
  padding  int  not null default 4 check (padding between 3 and 8),
  yearly   boolean not null default true
);
insert into public.numbering_rules (doc_type, label, prefix, padding, yearly) values
  ('customer',        'Clients',                    'CLI', 5, false),
  ('supplier',        'Fournisseurs',               'FRS', 5, false),
  ('quotation',       'Devis',                      'DEV', 4, true),
  ('order',           'Commandes clients',          'BC',  4, true),
  ('invoice',         'Factures',                   'FAC', 4, true),
  ('credit_note',     'Avoirs',                     'AV',  4, true),
  ('payment',         'Encaissements',              'ENC', 4, true),
  ('receipt',         'Reçus de paiement',          'REC', 4, true),
  ('delivery_note',   'Bons de livraison',          'BL',  4, true),
  ('purchase_order',  'Bons de commande fournisseur','BCF', 4, true),
  ('goods_receipt',   'Bons de réception',          'BR',  4, true)
on conflict (doc_type) do nothing;

create table if not exists public.document_sequences (
  doc_type   text not null references public.numbering_rules(doc_type) on delete cascade,
  period     int  not null,           -- year, or 0 for non-yearly counters
  last_value int  not null default 0 check (last_value >= 0),
  primary key (doc_type, period)
);

create table if not exists public.exchange_rates (
  id         uuid primary key default gen_random_uuid(),
  currency   char(3) not null check (currency ~ '^[A-Z]{3}$' and currency <> 'TND'),
  rate       numeric(14,6) not null check (rate > 0),   -- TND for 1 unit of currency
  rate_date  date not null default current_date,
  source     text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (currency, rate_date)
);

-- -----------------------------------------------------------------------------
-- 3. CRM : CUSTOMERS & SUPPLIERS
-- -----------------------------------------------------------------------------
create table if not exists public.customers (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  customer_type      text not null default 'company' check (customer_type in ('company','individual')),
  name               text not null check (char_length(trim(name)) between 2 and 200),
  contact_name       text not null default '' check (char_length(contact_name) <= 120),
  contact_position   text not null default '' check (char_length(contact_position) <= 120),
  tax_id             text not null default '' check (char_length(tax_id) <= 40),     -- Matricule fiscal
  trade_register     text not null default '' check (char_length(trade_register) <= 40),
  vat_exempt         boolean not null default false,
  email              text not null default '' check (email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone              text not null default '' check (char_length(phone) <= 30),
  mobile             text not null default '' check (char_length(mobile) <= 30),
  address            text not null default '' check (char_length(address) <= 300),
  city               text not null default '' check (char_length(city) <= 100),
  governorate        text not null default '' check (char_length(governorate) <= 100),
  postal_code        text not null default '' check (char_length(postal_code) <= 20),
  country            text not null default 'Tunisie',
  payment_terms_days int  not null default 30 check (payment_terms_days between 0 and 365),
  credit_limit       numeric(15,3) check (credit_limit is null or credit_limit >= 0),
  notes              text not null default '',
  source             text not null default 'manual' check (source in ('manual','website','import')),
  is_active          boolean not null default true,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists customers_name_idx on public.customers(lower(name));
create unique index if not exists customers_tax_id_key on public.customers(upper(tax_id)) where tax_id <> '';
create index if not exists customers_email_idx on public.customers(lower(email)) where email <> '';

create table if not exists public.suppliers (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  name               text not null check (char_length(trim(name)) between 2 and 200),
  contact_name       text not null default '',
  tax_id             text not null default '',
  email              text not null default '' check (email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone              text not null default '',
  website            text not null default '',
  address            text not null default '',
  city               text not null default '',
  country            text not null default '',
  currency           char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  payment_terms_days int not null default 30 check (payment_terms_days between 0 and 365),
  bank_details       text not null default '',
  notes              text not null default '',
  is_active          boolean not null default true,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists suppliers_name_idx on public.suppliers(lower(name));

-- -----------------------------------------------------------------------------
-- 4. CATALOGUE : BRANDS + ERP fields on existing products
-- -----------------------------------------------------------------------------
create table if not exists public.brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 120),
  logo_url    text,
  website     text not null default '',
  description text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists brands_name_key on public.brands(lower(name));

alter table public.products add column if not exists brand_id       uuid references public.brands(id) on delete set null;
alter table public.products add column if not exists unit           text not null default 'pièce';
alter table public.products add column if not exists purchase_price numeric(15,3) not null default 0;   -- weighted average cost (TND)
alter table public.products add column if not exists sale_price     numeric(15,3) not null default 0;   -- HT (TND)
alter table public.products add column if not exists vat_rate       numeric(5,2)  not null default 19;
alter table public.products add column if not exists stock_quantity numeric(14,3) not null default 0;
alter table public.products add column if not exists min_stock      numeric(14,3) not null default 0;
alter table public.products add column if not exists track_stock    boolean not null default true;
alter table public.products add column if not exists barcode        text not null default '';
alter table public.products add column if not exists is_active      boolean not null default true;
alter table public.products add column if not exists internal_notes text not null default '';

do $$ begin
  alter table public.products add constraint products_prices_chk check (purchase_price >= 0 and sale_price >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.products add constraint products_vat_chk check (vat_rate between 0 and 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.products add constraint products_min_stock_chk check (min_stock >= 0);
exception when duplicate_object then null; end $$;

-- Unique product references (case-insensitive). Fails loudly if duplicates already exist.
do $$
begin
  if exists (select 1 from public.products group by upper(trim(reference)) having count(*) > 1) then
    raise exception 'Références produit en double : corrigez-les avant de relancer la migration (select upper(reference), count(*) from products group by 1 having count(*) > 1).';
  end if;
end $$;
create unique index if not exists products_reference_key on public.products(upper(trim(reference)));
create index if not exists products_brand_idx on public.products(brand_id);
create index if not exists products_low_stock_idx on public.products(track_stock, stock_quantity, min_stock);

-- -----------------------------------------------------------------------------
-- 5. WEBSITE REQUESTS (unified inbox)
-- -----------------------------------------------------------------------------
create table if not exists public.contact_requests (
  id              uuid primary key default gen_random_uuid(),
  request_type    text not null default 'contact' check (request_type in ('quote','product_inquiry','availability','partnership','contact')),
  status          text not null default 'new' check (status in ('new','assigned','in_progress','converted','closed','spam')),
  full_name       text not null check (char_length(full_name) between 2 and 120),
  company         text not null default '' check (char_length(company) <= 160),
  email           text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  phone           text not null default '' check (char_length(phone) <= 30),
  subject         text not null default '' check (char_length(subject) <= 200),
  message         text not null default '' check (char_length(message) <= 4000),
  product_id      uuid references public.products(id) on delete set null,
  product         text not null default '' check (char_length(product) <= 200),
  reference       text not null default '' check (char_length(reference) <= 120),
  quantity        int check (quantity is null or quantity between 1 and 1000000),
  attachment_path text check (attachment_path is null or attachment_path ~ '^incoming/[A-Za-z0-9._-]+$'),
  locale          text not null default 'fr' check (locale in ('fr','en','ar')),
  source          text not null default 'website' check (source in ('website','legacy','manual')),
  legacy_id       uuid unique,
  assigned_to     uuid references public.users(id) on delete set null,
  customer_id     uuid references public.customers(id) on delete set null,
  quotation_id    uuid,   -- FK added below (quotations defined later)
  internal_notes  text not null default '',
  handled_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists contact_requests_status_idx on public.contact_requests(status, created_at desc);
create index if not exists contact_requests_assigned_idx on public.contact_requests(assigned_to);
create index if not exists contact_requests_customer_idx on public.contact_requests(customer_id);

-- -----------------------------------------------------------------------------
-- 6. SALES : QUOTATIONS, ORDERS, INVOICES (+ credit notes)
-- -----------------------------------------------------------------------------
create table if not exists public.quotations (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  customer_id      uuid not null references public.customers(id) on delete restrict,
  request_id       uuid references public.contact_requests(id) on delete set null,
  status           text not null default 'draft' check (status in ('draft','sent','accepted','rejected','expired')),
  issue_date       date not null default current_date,
  valid_until      date not null default (current_date + 30),
  currency         char(3) not null default 'TND' check (currency ~ '^[A-Z]{3}$'),
  discount_percent numeric(5,2)  not null default 0 check (discount_percent between 0 and 100),
  subtotal         numeric(15,3) not null default 0,
  discount_amount  numeric(15,3) not null default 0,
  total_ht         numeric(15,3) not null default 0,
  total_vat        numeric(15,3) not null default 0,
  total_ttc        numeric(15,3) not null default 0,
  customer_reference text not null default '',
  terms            text not null default '',
  notes            text not null default '',
  internal_notes   text not null default '',
  salesperson_id   uuid references public.users(id) on delete set null default auth.uid(),
  sent_at          timestamptz,
  accepted_at      timestamptz,
  rejected_at      timestamptz,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint quotations_validity_chk check (valid_until >= issue_date)
);
create index if not exists quotations_customer_idx on public.quotations(customer_id);
create index if not exists quotations_status_idx on public.quotations(status, issue_date desc);

do $$ begin
  alter table public.contact_requests add constraint contact_requests_quotation_fk
    foreign key (quotation_id) references public.quotations(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.quotation_items (
  id               uuid primary key default gen_random_uuid(),
  quotation_id     uuid not null references public.quotations(id) on delete cascade,
  position         int  not null default 0,
  product_id       uuid references public.products(id) on delete set null,
  reference        text not null default '',
  description      text not null check (char_length(trim(description)) between 1 and 1000),
  unit             text not null default 'pièce',
  quantity         numeric(14,3) not null check (quantity > 0),
  unit_price       numeric(15,3) not null check (unit_price >= 0),
  discount_percent numeric(5,2)  not null default 0 check (discount_percent between 0 and 100),
  vat_rate         numeric(5,2)  not null default 19 check (vat_rate between 0 and 100),
  total_ht         numeric(15,3) not null default 0,
  total_vat        numeric(15,3) not null default 0,
  total_ttc        numeric(15,3) not null default 0
);
create index if not exists quotation_items_parent_idx on public.quotation_items(quotation_id, position);
create index if not exists quotation_items_product_idx on public.quotation_items(product_id);

-- Sales orders reuse the accepted quotation's lines (no duplication).
create table if not exists public.orders (
  id                 uuid primary key default gen_random_uuid(),
  number             text not null unique,
  quotation_id       uuid not null unique references public.quotations(id) on delete restrict,
  customer_id        uuid not null references public.customers(id) on delete restrict,
  status             text not null default 'confirmed' check (status in ('confirmed','in_progress','delivered','invoiced','cancelled')),
  order_date         date not null default current_date,
  expected_delivery  date,
  customer_reference text not null default '',
  notes              text not null default '',
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists orders_customer_idx on public.orders(customer_id);
create index if not exists orders_status_idx on public.orders(status, order_date desc);

create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  number              text unique,                         -- assigned at validation only (no gaps)
  kind                text not null default 'invoice' check (kind in ('invoice','credit_note')),
  original_invoice_id uuid references public.invoices(id) on delete restrict,
  customer_id         uuid not null references public.customers(id) on delete restrict,
  quotation_id        uuid references public.quotations(id) on delete set null,
  order_id            uuid references public.orders(id) on delete set null,
  status              text not null default 'draft' check (status in ('draft','validated','sent','partially_paid','paid','overdue','cancelled')),
  issue_date          date not null default current_date,
  due_date            date,
  currency            char(3) not null default 'TND' check (currency ~ '^[A-Z]{3}$'),
  discount_percent    numeric(5,2)  not null default 0 check (discount_percent between 0 and 100),
  subtotal            numeric(15,3) not null default 0,
  discount_amount     numeric(15,3) not null default 0,
  total_ht            numeric(15,3) not null default 0,
  total_vat           numeric(15,3) not null default 0,
  fiscal_stamp        numeric(15,3) check (fiscal_stamp is null or fiscal_stamp >= 0),
  total_ttc           numeric(15,3) not null default 0,
  amount_paid         numeric(15,3) not null default 0,
  amount_credited     numeric(15,3) not null default 0,
  balance_due         numeric(15,3) not null default 0,
  restock             boolean not null default true,         -- credit notes: return goods to stock
  customer_snapshot   jsonb,
  customer_reference  text not null default '',
  terms               text not null default '',
  notes               text not null default '',
  reason              text not null default '',              -- credit note / cancellation reason
  validated_at        timestamptz,
  validated_by        uuid references auth.users(id) on delete set null,
  sent_at             timestamptz,
  cancelled_at        timestamptz,
  created_by          uuid references auth.users(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint invoices_credit_origin_chk check (kind = 'invoice' or original_invoice_id is not null),
  constraint invoices_number_chk check (status = 'draft' or number is not null),
  constraint invoices_due_chk check (due_date is null or due_date >= issue_date)
);
create index if not exists invoices_customer_idx on public.invoices(customer_id);
create index if not exists invoices_status_idx on public.invoices(status, issue_date desc);
create index if not exists invoices_quotation_idx on public.invoices(quotation_id);
create index if not exists invoices_order_idx on public.invoices(order_id);
create index if not exists invoices_original_idx on public.invoices(original_invoice_id);
create index if not exists invoices_due_idx on public.invoices(due_date) where status in ('validated','sent','partially_paid','overdue');

create table if not exists public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  position         int  not null default 0,
  product_id       uuid references public.products(id) on delete set null,
  reference        text not null default '',
  description      text not null check (char_length(trim(description)) between 1 and 1000),
  unit             text not null default 'pièce',
  quantity         numeric(14,3) not null check (quantity > 0),
  unit_price       numeric(15,3) not null check (unit_price >= 0),
  discount_percent numeric(5,2)  not null default 0 check (discount_percent between 0 and 100),
  vat_rate         numeric(5,2)  not null default 19 check (vat_rate between 0 and 100),
  total_ht         numeric(15,3) not null default 0,
  total_vat        numeric(15,3) not null default 0,
  total_ttc        numeric(15,3) not null default 0,
  unit_cost        numeric(15,3)            -- product cost snapshot taken at validation (margins)
);
create index if not exists invoice_items_parent_idx on public.invoice_items(invoice_id, position);
create index if not exists invoice_items_product_idx on public.invoice_items(product_id);

-- -----------------------------------------------------------------------------
-- 7. PAYMENTS, ALLOCATIONS, RECEIPTS
-- -----------------------------------------------------------------------------
create table if not exists public.payments (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  customer_id      uuid not null references public.customers(id) on delete restrict,
  payment_date     date not null default current_date,
  amount           numeric(15,3) not null check (amount > 0),
  allocated_amount numeric(15,3) not null default 0 check (allocated_amount >= 0),
  method_id        uuid not null references public.payment_methods(id),
  reference        text not null default '' check (char_length(reference) <= 120),  -- cheque n°, transfer ref…
  bank_name        text not null default '' check (char_length(bank_name) <= 120),
  due_date         date,                                                             -- cheque / bill of exchange maturity
  is_deposit       boolean not null default false,                                   -- advance payment (acompte)
  status           text not null default 'valid' check (status in ('valid','cancelled')),
  notes            text not null default '',
  cancel_reason    text not null default '',
  cancelled_at     timestamptz,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint payments_allocation_chk check (allocated_amount <= amount)
);
create index if not exists payments_customer_idx on public.payments(customer_id, payment_date desc);
create index if not exists payments_date_idx on public.payments(payment_date);

create table if not exists public.payment_allocations (
  id         uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount     numeric(15,3) not null check (amount > 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);
create index if not exists payment_allocations_invoice_idx on public.payment_allocations(invoice_id);

create table if not exists public.receipts (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,
  payment_id  uuid not null unique references public.payments(id) on delete cascade,
  issued_at   timestamptz not null default now(),
  issued_by   uuid references auth.users(id) on delete set null default auth.uid(),
  document_id uuid        -- FK added after documents
);

-- -----------------------------------------------------------------------------
-- 8. PURCHASING
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  supplier_id      uuid not null references public.suppliers(id) on delete restrict,
  status           text not null default 'draft' check (status in ('draft','sent','partially_received','received','cancelled')),
  order_date       date not null default current_date,
  expected_date    date,
  currency         char(3) not null default 'TND' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate    numeric(14,6) not null default 1 check (exchange_rate > 0),   -- TND for 1 unit
  discount_percent numeric(5,2)  not null default 0 check (discount_percent between 0 and 100),
  subtotal         numeric(15,3) not null default 0,
  discount_amount  numeric(15,3) not null default 0,
  total_ht         numeric(15,3) not null default 0,
  total_vat        numeric(15,3) not null default 0,
  total_ttc        numeric(15,3) not null default 0,
  supplier_reference text not null default '',
  terms            text not null default '',
  notes            text not null default '',
  sent_at          timestamptz,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint purchase_orders_tnd_rate_chk check (currency <> 'TND' or exchange_rate = 1)
);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders(supplier_id);
create index if not exists purchase_orders_status_idx on public.purchase_orders(status, order_date desc);

create table if not exists public.purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  position          int  not null default 0,
  product_id        uuid references public.products(id) on delete set null,
  reference         text not null default '',
  description       text not null check (char_length(trim(description)) between 1 and 1000),
  unit              text not null default 'pièce',
  quantity          numeric(14,3) not null check (quantity > 0),
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0),
  unit_price        numeric(15,3) not null check (unit_price >= 0),   -- in PO currency
  discount_percent  numeric(5,2)  not null default 0 check (discount_percent between 0 and 100),
  vat_rate          numeric(5,2)  not null default 19 check (vat_rate between 0 and 100),
  total_ht          numeric(15,3) not null default 0,
  total_vat         numeric(15,3) not null default 0,
  total_ttc         numeric(15,3) not null default 0,
  constraint purchase_order_items_received_chk check (received_quantity <= quantity)
);
create index if not exists purchase_order_items_parent_idx on public.purchase_order_items(purchase_order_id, position);
create index if not exists purchase_order_items_product_idx on public.purchase_order_items(product_id);

create table if not exists public.goods_receipts (
  id                uuid primary key default gen_random_uuid(),
  number            text not null unique,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  received_date     date not null default current_date,
  notes             text not null default '',
  received_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now()
);
create index if not exists goods_receipts_po_idx on public.goods_receipts(purchase_order_id);

create table if not exists public.goods_receipt_items (
  id                     uuid primary key default gen_random_uuid(),
  goods_receipt_id       uuid not null references public.goods_receipts(id) on delete cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete restrict,
  product_id             uuid references public.products(id) on delete set null,
  quantity               numeric(14,3) not null check (quantity > 0),
  unit_cost_tnd          numeric(15,3) not null check (unit_cost_tnd >= 0)
);
create index if not exists goods_receipt_items_parent_idx on public.goods_receipt_items(goods_receipt_id);

create table if not exists public.supplier_invoices (
  id                 uuid primary key default gen_random_uuid(),
  supplier_id        uuid not null references public.suppliers(id) on delete restrict,
  purchase_order_id  uuid references public.purchase_orders(id) on delete set null,
  supplier_reference text not null check (char_length(trim(supplier_reference)) between 1 and 80),
  invoice_date       date not null default current_date,
  due_date           date,
  currency           char(3) not null default 'TND' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate      numeric(14,6) not null default 1 check (exchange_rate > 0),
  total_ht           numeric(15,3) not null default 0 check (total_ht >= 0),
  total_vat          numeric(15,3) not null default 0 check (total_vat >= 0),
  total_ttc          numeric(15,3) not null check (total_ttc >= 0),
  amount_paid        numeric(15,3) not null default 0 check (amount_paid >= 0),
  status             text not null default 'unpaid' check (status in ('unpaid','partially_paid','paid','cancelled')),
  document_id        uuid,
  notes              text not null default '',
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (supplier_id, supplier_reference),
  constraint supplier_invoices_paid_chk check (amount_paid <= total_ttc),
  constraint supplier_invoices_tnd_rate_chk check (currency <> 'TND' or exchange_rate = 1)
);
create index if not exists supplier_invoices_supplier_idx on public.supplier_invoices(supplier_id, invoice_date desc);

create table if not exists public.supplier_payments (
  id                  uuid primary key default gen_random_uuid(),
  supplier_invoice_id uuid not null references public.supplier_invoices(id) on delete restrict,
  supplier_id         uuid not null references public.suppliers(id) on delete restrict,
  payment_date        date not null default current_date,
  amount              numeric(15,3) not null check (amount > 0),          -- in invoice currency
  exchange_rate       numeric(14,6) not null default 1 check (exchange_rate > 0),
  amount_tnd          numeric(15,3) generated always as (round(amount * exchange_rate, 3)) stored,
  method_id           uuid not null references public.payment_methods(id),
  reference           text not null default '',
  notes               text not null default '',
  created_by          uuid references auth.users(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now()
);
create index if not exists supplier_payments_invoice_idx on public.supplier_payments(supplier_invoice_id);
create index if not exists supplier_payments_supplier_idx on public.supplier_payments(supplier_id, payment_date desc);

-- -----------------------------------------------------------------------------
-- 9. INVENTORY
-- -----------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('in','out','adjustment')),
  reason       text not null check (reason in ('opening','purchase_receipt','sale_invoice','credit_note','delivery_note','manual_entry','manual_exit','inventory_adjustment','return')),
  quantity     numeric(14,3) not null check (quantity <> 0),      -- signed change
  stock_before numeric(14,3) not null default 0,
  stock_after  numeric(14,3) not null default 0,
  unit_cost    numeric(15,3),                                     -- TND
  source_type  text,
  source_id    uuid,
  source_label text not null default '',
  notes        text not null default '',
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on public.stock_movements(product_id, created_at desc);
create index if not exists stock_movements_source_idx on public.stock_movements(source_type, source_id);
create index if not exists stock_movements_date_idx on public.stock_movements(created_at);

-- -----------------------------------------------------------------------------
-- 10. DELIVERY NOTES
-- -----------------------------------------------------------------------------
create table if not exists public.delivery_notes (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  customer_id      uuid not null references public.customers(id) on delete restrict,
  order_id         uuid references public.orders(id) on delete set null,
  invoice_id       uuid references public.invoices(id) on delete set null,
  status           text not null default 'draft' check (status in ('draft','validated','cancelled')),
  delivery_date    date not null default current_date,
  delivery_address text not null default '',
  carrier          text not null default '',
  vehicle          text not null default '',
  notes            text not null default '',
  validated_at     timestamptz,
  validated_by     uuid references auth.users(id) on delete set null,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists delivery_notes_customer_idx on public.delivery_notes(customer_id);
create index if not exists delivery_notes_order_idx on public.delivery_notes(order_id);
create index if not exists delivery_notes_invoice_idx on public.delivery_notes(invoice_id);

create table if not exists public.delivery_note_items (
  id               uuid primary key default gen_random_uuid(),
  delivery_note_id uuid not null references public.delivery_notes(id) on delete cascade,
  position         int  not null default 0,
  product_id       uuid references public.products(id) on delete set null,
  reference        text not null default '',
  description      text not null check (char_length(trim(description)) between 1 and 1000),
  unit             text not null default 'pièce',
  quantity         numeric(14,3) not null check (quantity > 0)
);
create index if not exists delivery_note_items_parent_idx on public.delivery_note_items(delivery_note_id, position);

-- -----------------------------------------------------------------------------
-- 11. DOCUMENTS & ACTIVITY LOGS
-- -----------------------------------------------------------------------------
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  doc_type    text not null check (doc_type in ('quotation','invoice','credit_note','receipt','purchase_order','delivery_note','supplier_invoice','supplier_document','customer_document','other')),
  entity_type text not null check (entity_type ~ '^[a-z_]+$'),
  entity_id   uuid,
  title       text not null check (char_length(title) between 1 and 200),
  file_path   text not null unique check (file_path ~ '^[a-z_]+/[A-Za-z0-9._/-]+$'),
  file_name   text not null,
  mime_type   text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes  int  not null check (size_bytes between 1 and 15728640),
  notes       text not null default '',
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists documents_entity_idx on public.documents(entity_type, entity_id, created_at desc);

do $$ begin
  alter table public.receipts add constraint receipts_document_fk foreign key (document_id) references public.documents(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.supplier_invoices add constraint supplier_invoices_document_fk foreign key (document_id) references public.documents(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.activity_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid,
  user_email   text not null default '',
  action       text not null,                -- e.g. insert, update, delete, invoice.validated, auth.login
  entity_type  text not null default '',
  entity_id    uuid,
  entity_label text not null default '',
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists activity_logs_date_idx on public.activity_logs(created_at desc);
create index if not exists activity_logs_entity_idx on public.activity_logs(entity_type, entity_id);
create index if not exists activity_logs_user_idx on public.activity_logs(user_id, created_at desc);
