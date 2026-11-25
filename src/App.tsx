import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Layout } from '@/components/Layout';
import Home from '@/pages/Home';
import { AuthProvider, RequireAdmin } from '@/admin/auth';
import { RequirePerm } from '@/erp/lib/access';
import { erpEnabled } from '@/erp/lib/db';

const Products = lazy(() => import('@/pages/Products'));
const ProductDetail = lazy(() => import('@/pages/ProductDetail'));
const Industries = lazy(() => import('@/pages/Industries'));
const ImportDistribution = lazy(() => import('@/pages/ImportDistribution'));
const About = lazy(() => import('@/pages/About'));
const Partners = lazy(() => import('@/pages/Partners'));
const Contact = lazy(() => import('@/pages/Contact'));
const Quote = lazy(() => import('@/pages/Quote'));
const NotFound = lazy(() => import('@/pages/NotFound'));

// Website administration (existing)
const AdminLayout = lazy(() => import('@/admin/AdminLayout'));
const Login = lazy(() => import('@/admin/Login'));
const Dashboard = lazy(() => import('@/admin/Dashboard'));
const ProductsAdmin = lazy(() => import('@/admin/ProductsAdmin'));
const CategoriesAdmin = lazy(() => import('@/admin/CategoriesAdmin'));
const PartnersAdmin = lazy(() => import('@/admin/PartnersAdmin'));
const QuotesAdmin = lazy(() => import('@/admin/QuotesAdmin'));
const MessagesAdmin = lazy(() => import('@/admin/MessagesAdmin'));
const ContentAdmin = lazy(() => import('@/admin/ContentAdmin'));

// ERP / CRM
const ErpDashboard = lazy(() => import('@/erp/pages/Dashboard'));
const Customers = lazy(() => import('@/erp/pages/Customers'));
const CustomerDetail = lazy(() => import('@/erp/pages/Customers').then((m) => ({ default: m.CustomerDetail })));
const Suppliers = lazy(() => import('@/erp/pages/Suppliers'));
const SupplierDetail = lazy(() => import('@/erp/pages/Suppliers').then((m) => ({ default: m.SupplierDetail })));
const Brands = lazy(() => import('@/erp/pages/Brands'));
const Quotations = lazy(() => import('@/erp/pages/Quotations'));
const QuotationEditor = lazy(() => import('@/erp/pages/Quotations').then((m) => ({ default: m.QuotationEditor })));
const Orders = lazy(() => import('@/erp/pages/Orders'));
const OrderDetail = lazy(() => import('@/erp/pages/Orders').then((m) => ({ default: m.OrderDetail })));
const Invoices = lazy(() => import('@/erp/pages/Invoices'));
const InvoiceEditor = lazy(() => import('@/erp/pages/Invoices').then((m) => ({ default: m.InvoiceEditor })));
const Payments = lazy(() => import('@/erp/pages/Payments'));
const Deliveries = lazy(() => import('@/erp/pages/Deliveries'));
const DeliveryEditor = lazy(() => import('@/erp/pages/Deliveries').then((m) => ({ default: m.DeliveryEditor })));
const Purchases = lazy(() => import('@/erp/pages/Purchases'));
const PurchaseOrderEditor = lazy(() => import('@/erp/pages/Purchases').then((m) => ({ default: m.PurchaseOrderEditor })));
const SupplierInvoices = lazy(() => import('@/erp/pages/SupplierInvoices'));
const Inventory = lazy(() => import('@/erp/pages/Inventory'));
const Requests = lazy(() => import('@/erp/pages/Requests'));
const Documents = lazy(() => import('@/erp/pages/Documents'));
const Reports = lazy(() => import('@/erp/pages/Reports'));
const Users = lazy(() => import('@/erp/pages/Users'));
const Roles = lazy(() => import('@/erp/pages/Users').then((m) => ({ default: m.RolesPage })));
const Logs = lazy(() => import('@/erp/pages/Logs'));
const Settings = lazy(() => import('@/erp/pages/Settings'));
const Account = lazy(() => import('@/erp/pages/Account'));

function Fallback() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-navy" />
    </div>
  );
}

/** Permission-guarded ERP page. */
const erp = (perm: string, el: ReactNode) => <RequirePerm perm={perm}>{el}</RequirePerm>;
/** Website-administration page (also available in demo mode). */
const site = (perm: string, el: ReactNode) => <RequirePerm perm={perm} erp={false}>{el}</RequirePerm>;

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<Fallback />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="products" element={<Products />} />
            <Route path="products/:slug" element={<ProductDetail />} />
            <Route path="industries" element={<Industries />} />
            <Route path="import-distribution" element={<ImportDistribution />} />
            <Route path="about" element={<About />} />
            <Route path="partners" element={<Partners />} />
            <Route path="contact" element={<Contact />} />
            <Route path="quote" element={<Quote />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="admin/login" element={<Login />} />
          <Route path="admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
            <Route index element={erpEnabled ? <ErpDashboard /> : <Dashboard />} />
            {/* Website administration */}
            <Route path="products" element={site('products.view|website.manage', <ProductsAdmin />)} />
            <Route path="categories" element={site('products.edit|website.manage', <CategoriesAdmin />)} />
            <Route path="partners" element={site('website.manage', <PartnersAdmin />)} />
            <Route path="content" element={site('website.manage', <ContentAdmin />)} />
            <Route path="quotes" element={site('website.manage', <QuotesAdmin />)} />
            <Route path="messages" element={site('website.manage', <MessagesAdmin />)} />
            {/* ERP / CRM */}
            <Route path="requests" element={erp('*', <Requests />)} />
            <Route path="customers" element={erp('customers.view', <Customers />)} />
            <Route path="customers/:id" element={erp('customers.view', <CustomerDetail />)} />
            <Route path="suppliers" element={erp('suppliers.view', <Suppliers />)} />
            <Route path="suppliers/:id" element={erp('suppliers.view', <SupplierDetail />)} />
            <Route path="brands" element={erp('products.view', <Brands />)} />
            <Route path="quotations" element={erp('quotations.view', <Quotations />)} />
            <Route path="quotations/:id" element={erp('quotations.view', <QuotationEditor />)} />
            <Route path="orders" element={erp('orders.view', <Orders />)} />
            <Route path="orders/:id" element={erp('orders.view', <OrderDetail />)} />
            <Route path="invoices" element={erp('invoices.view', <Invoices />)} />
            <Route path="invoices/:id" element={erp('invoices.view', <InvoiceEditor />)} />
            <Route path="payments" element={erp('payments.view', <Payments />)} />
            <Route path="deliveries" element={erp('deliveries.view', <Deliveries />)} />
            <Route path="deliveries/:id" element={erp('deliveries.view', <DeliveryEditor />)} />
            <Route path="purchases" element={erp('purchases.view', <Purchases />)} />
            <Route path="purchases/:id" element={erp('purchases.view', <PurchaseOrderEditor />)} />
            <Route path="supplier-invoices" element={erp('purchases.view', <SupplierInvoices />)} />
            <Route path="inventory" element={erp('inventory.view', <Inventory />)} />
            <Route path="documents" element={erp('documents.view', <Documents />)} />
            <Route path="reports" element={erp('reports.view', <Reports />)} />
            <Route path="users" element={erp('users.view', <Users />)} />
            <Route path="roles" element={erp('users.view', <Roles />)} />
            <Route path="logs" element={erp('logs.view', <Logs />)} />
            <Route path="settings" element={erp('settings.view', <Settings />)} />
            <Route path="account" element={erp('*', <Account />)} />
          </Route>
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
