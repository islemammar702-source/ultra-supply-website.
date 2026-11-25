# ULTRA SUPPLY — Corporate website

Agricultural & Industrial Solutions. React + TypeScript + Tailwind CSS + Supabase.

## Features

- **Public site** (FR default · EN · AR with full right-to-left layout): Home, Products (search, category filter, sort), product pages, Industries, Import & Distribution, About, Partners, Contact, Request a Quote, 404.
- **Quote requests** with validation and optional image/PDF attachment → `quote_requests` table + private `quote-attachments` bucket.
- **Contact form** → `contact_messages` table. Google Maps embed driven by the address set in the admin.
- **Admin** (`/admin`, protected): dashboard, products CRUD with image upload and multilingual specs, categories, brands & partners, quote requests (status, attachment, CSV export), contact messages, site content & translations, contact details & social links.
- **ERP / CRM** (`/admin`, Supabase only): staff users with 6 roles and a permission matrix enforced by Row Level Security, customers (history, balances), suppliers, brands, product prices / VAT / stock thresholds, quotations → orders → invoices (no re-typing), legal invoice numbering at validation, immutable validated invoices, credit notes & cancellation, payments allocated to several invoices, deposits and receipts, purchase orders in foreign currencies with partial receipts and weighted average cost, supplier invoices & payments, stock movements / inventory adjustments / valuation, delivery notes, unified website-request inbox (assign, convert to customer or quotation), branded PDFs (pdf-lib) and e-mail delivery, document storage, reports with CSV export, activity log. See **[docs/ERP-MISE-EN-PRODUCTION.md](docs/ERP-MISE-EN-PRODUCTION.md)**.
- **SEO**: per-page title/description/canonical/Open Graph, JSON-LD, `robots.txt`, `sitemap.xml`, semantic HTML, lazy-loaded images, code-split routes.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

Without Supabase credentials the site runs in **demo mode**: data is stored in the browser and the admin uses
`admin@demo.local` / `ultrasupply-demo` (shown on the login page only in demo mode). Never use demo mode in production.

## Supabase setup (production)

> Full French guide for the ERP (migrations 002–004, first super administrator, server variables, backups):
> [docs/ERP-MISE-EN-PRODUCTION.md](docs/ERP-MISE-EN-PRODUCTION.md).

1. Create a Supabase project, then copy `.env.example` to `.env` and fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. In the SQL editor run `supabase/migrations/001_init.sql` (tables, Row Level Security, storage buckets), then `supabase/seed.sql` (placeholder catalogue; regenerate with `npm run seed:sql`).
3. Create the admin user in *Authentication → Users*, then grant admin rights:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'admin@your-domain.tn';
   ```
4. Disable public sign-ups in *Authentication → Providers → Email* so only invited users exist.

Security is enforced server-side by RLS: visitors can only **insert** quotes/messages and upload into `quote-attachments/incoming/`; only users listed in `admins` can read requests or modify the catalogue, content and images.

## Deployment

Static SPA: deploy `dist/` to Vercel (`vercel.json` included), Netlify (`public/_redirects` included) or any host with an SPA fallback to `index.html`. Set `VITE_SITE_URL` and update the domain in `public/robots.txt` and `public/sitemap.xml`.

## Brand assets

The official logo (`design/ultra-supply-logo-original.jpg`) is exported to `public/brand/` as transparent WebP: `logo` (header), `logo-full` (with the activities line) and white `-light` versions for dark backgrounds, plus favicon, app icons and `public/og-image.png` for link previews.

## Content to replace before launch

- **Photos**: `src/data/images.ts` uses Unsplash placeholders; product/category images can be replaced from the admin.
- **Contact details & social links**: *Admin → Contenu & traductions → Coordonnées*. Placeholders (`+216 XX XXX XXX`, …) are shown until real values are entered.
- **Product references** (`REF-…`) and **partner logos** are placeholders — add only real, authorised partners.

## Structure

```
src/
  admin/        admin shell, login, website administration screens
  erp/          ERP / CRM: lib (data access, permissions, PDF, formatting), components, pages
  components/   layout, cards, forms, home sections
  data/         seed catalogue, image placeholders, sector icons
  i18n/         fr / en / ar dictionaries + provider (DB overrides)
  lib/          types, Supabase client, data API (Supabase or demo), validation
  pages/        public routes
supabase/       SQL migrations (001 site, 002–004 ERP) and seed
api/            Vercel server functions (staff accounts, e-mail delivery) — use server-only secrets
server/         helpers shared by the server functions
scripts/        seed generator, database backup script
```
