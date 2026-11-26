import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Boxes, CircleCheck, FileText, Inbox, PenLine, Receipt, Users, Wallet, type LucideIcon } from 'lucide-react';
import { rpc } from '../lib/db';
import { useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { amount, fmtDate, fmtDateTime, money, qty } from '../lib/format';
import { ACTION_LABEL, ENTITY_LABEL, INVOICE_STATUS, CREDIT_NOTE_STATUS } from '../lib/status';
import { BarChart, ErrorBox, LoadingBlock, Section, StatCard, StatusBadge } from '../components/ui';
import { useQuickActions } from '../components/QuickCreate';

interface Stats {
  revenue_total_ht?: number; revenue_year_ht?: number; revenue_month_ht?: number;
  outstanding_amount?: number; outstanding_count?: number; overdue_amount?: number; overdue_count?: number; draft_invoices?: number;
  monthly_sales?: { month: string; total_ht: number; total_ttc: number; invoices: number }[];
  recent_invoices?: { id: string; number: string | null; kind: string; status: string; issue_date: string; total_ttc: number; balance_due: number; customer: string }[];
  payments_month?: number; payments_year?: number; unallocated_payments?: number;
  pending_quotations?: number; pending_quotations_amount?: number; quotations_sent_month?: number;
  customers_total?: number; customers_active?: number;
  products_total?: number; products_in_stock?: number; units_in_stock?: number; low_stock_count?: number; stock_value?: number | null;
  low_stock?: { id: string; reference: string; name: string; stock_quantity: number; min_stock: number; unit: string }[];
  new_requests?: number;
  recent_activity?: { id: number; user_email: string; action: string; entity_type: string; entity_id: string | null; entity_label: string; created_at: string }[];
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

interface Todo { Icon: LucideIcon; label: string; count: number; to: string; urgent?: boolean; hint?: string }

export default function ErpDashboard() {
  const { access, can } = useAccess();
  const navigate = useNavigate();
  const actions = useQuickActions(6);
  const { data, error, loading, reload } = useAsync(() => (can('dashboard.view') ? rpc<Stats>('dashboard_stats') : Promise.resolve(null)), []);

  const quick = actions.length > 0 && (
    <div className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {actions.map(({ label, to, Icon }) => (
        <Link key={to} to={to} className="chamfer chamfer-sm group flex flex-col items-center gap-2 bg-white px-2 py-4 text-center ring-1 ring-navy/10 transition-colors hover:bg-navy hover:text-white">
          <Icon className="h-5 w-5 text-brand-red transition-colors group-hover:text-white" strokeWidth={1.75} />
          <span className="text-[13px] font-semibold leading-tight">{label}</span>
        </Link>
      ))}
    </div>
  );

  if (!can('dashboard.view')) {
    return (
      <>
        <h1 className="mb-6 font-display text-[26px] font-extrabold text-navy">Bonjour{access?.full_name ? ` ${access.full_name}` : ''}</h1>
        {quick}
        <p className="text-navy/60">Utilisez le menu pour accéder à vos modules.</p>
      </>
    );
  }

  const s = data ?? {};
  const sales = (s.monthly_sales ?? []).map((m) => ({ label: `${MONTHS[Number(m.month.slice(5, 7)) - 1]}`, value: Number(m.total_ht), hint: `${m.invoices} facture(s)` }));

  const todos: Todo[] = [
    { Icon: Inbox, label: 'Demandes du site à traiter', count: s.new_requests ?? 0, to: '/admin/requests', urgent: true },
    ...(s.overdue_count !== undefined ? [{ Icon: AlertTriangle, label: 'Factures en retard', count: s.overdue_count, to: '/admin/invoices?status=overdue', urgent: true, hint: s.overdue_count ? money(s.overdue_amount) : undefined }] : []),
    ...(s.draft_invoices !== undefined ? [{ Icon: PenLine, label: 'Factures brouillons à valider', count: s.draft_invoices, to: '/admin/invoices?status=draft' }] : []),
    ...(s.pending_quotations !== undefined ? [{ Icon: FileText, label: 'Devis en attente de réponse', count: s.pending_quotations, to: '/admin/quotations?status=pending' }] : []),
    ...(s.low_stock_count !== undefined ? [{ Icon: Boxes, label: 'Produits sous le seuil', count: s.low_stock_count, to: '/admin/inventory?filter=low', urgent: true }] : []),
    ...(s.unallocated_payments ? [{ Icon: Wallet, label: 'Paiements à affecter', count: 1, to: '/admin/payments', hint: money(s.unallocated_payments) }] : []),
  ];
  const pending = todos.filter((t) => t.count > 0);

  return (
    <>
      {quick}
      {error && <div className="mb-6"><ErrorBox message={error} onRetry={reload} /></div>}
      {loading && !data && <LoadingBlock />}

      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {s.revenue_month_ht !== undefined && (
              <StatCard accent label="Chiffre d'affaires HT · ce mois" value={money(s.revenue_month_ht)} icon={<Receipt className="h-4 w-4" />}
                hint={`Année : ${money(s.revenue_year_ht)}`} onClick={can('reports.view') ? () => navigate('/admin/reports') : undefined} />
            )}
            {s.outstanding_amount !== undefined && (
              <StatCard label="Reste à encaisser" value={money(s.outstanding_amount)} icon={<AlertTriangle className="h-4 w-4" />}
                hint={s.overdue_count ? <span className="font-semibold text-brand-red">{s.overdue_count} facture(s) en retard</span> : `${s.outstanding_count} facture(s) ouverte(s)`}
                onClick={() => navigate('/admin/invoices?status=unpaid')} />
            )}
            {s.payments_month !== undefined && (
              <StatCard label="Encaissé ce mois" value={money(s.payments_month)} icon={<Wallet className="h-4 w-4" />}
                hint={`Année : ${money(s.payments_year)}`} onClick={() => navigate('/admin/payments')} />
            )}
            {s.customers_active !== undefined ? (
              <StatCard label="Clients actifs (12 mois)" value={s.customers_active} icon={<Users className="h-4 w-4" />}
                hint={`${s.customers_total} au fichier`} onClick={() => navigate('/admin/customers')} />
            ) : s.products_in_stock !== undefined && (
              <StatCard label="Produits en stock" value={s.products_in_stock} icon={<Boxes className="h-4 w-4" />}
                hint={`${qty(s.units_in_stock)} unités`} onClick={can('inventory.view') ? () => navigate('/admin/inventory') : undefined} />
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Section title="À traiter" className="xl:order-2">
              {pending.length ? (
                <ul className="divide-y divide-navy/10">
                  {pending.map(({ Icon, label, count, to, urgent, hint }) => (
                    <li key={label}>
                      <Link to={to} className="group flex items-center gap-3 px-5 py-3.5 hover:bg-mist/70">
                        <span className={`chamfer chamfer-sm flex h-9 w-9 shrink-0 items-center justify-center ${urgent ? 'bg-brand-red/10 text-brand-red' : 'bg-navy-50 text-navy'}`}>
                          <Icon className="h-4 w-4" strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-medium text-navy">{label}</span>
                          {hint && <span className="block text-[12.5px] text-navy/50">{hint}</span>}
                        </span>
                        {label !== 'Paiements à affecter' && <span className={`min-w-[2rem] px-2 py-0.5 text-center text-[13px] font-bold ${urgent ? 'bg-brand-red text-white' : 'bg-navy text-white'}`}>{count}</span>}
                        <ArrowRight className="h-4 w-4 text-navy/30 transition-transform group-hover:translate-x-0.5 group-hover:text-navy" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
                  <CircleCheck className="h-8 w-8 text-emerald-600" strokeWidth={1.5} />
                  <p className="font-semibold text-navy">Tout est à jour</p>
                  <p className="text-sm text-navy/50">Aucune action en attente.</p>
                </div>
              )}
            </Section>

            {s.monthly_sales && (
              <Section title="Ventes HT sur 12 mois" className="xl:col-span-2 xl:order-1"
                actions={can('reports.view') ? <Link to="/admin/reports" className="btn-link !text-[13px]">Rapports <ArrowRight className="h-3.5 w-3.5" /></Link> : undefined}>
                <div className="p-5">
                  {sales.some((d) => d.value !== 0) ? <BarChart data={sales} format={(v) => amount(v, 0)} height={200} /> : <p className="py-12 text-center text-sm text-navy/50">Aucune facture validée sur les 12 derniers mois.</p>}
                </div>
              </Section>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            {s.recent_invoices && (
              <Section title="Dernières factures" actions={<Link to="/admin/invoices" className="btn-link !text-[13px]">Tout voir <ArrowRight className="h-3.5 w-3.5" /></Link>}>
                <ul className="divide-y divide-navy/10">
                  {s.recent_invoices.slice(0, 5).map((i) => (
                    <li key={i.id}>
                      <Link to={`/admin/invoices/${i.id}`} className="flex items-center justify-between gap-4 px-5 py-3 text-sm hover:bg-mist/60">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-navy">{i.customer}</p>
                          <p className="text-xs text-navy/50">{i.number ?? 'Brouillon'} · {fmtDate(i.issue_date)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="tabular-nums text-navy">{money(i.total_ttc)}</span>
                          <StatusBadge map={i.kind === 'credit_note' ? CREDIT_NOTE_STATUS : INVOICE_STATUS} value={i.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                  {!s.recent_invoices.length && <li className="px-5 py-10 text-center text-sm text-navy/50">Aucune facture pour le moment.</li>}
                </ul>
              </Section>
            )}

            {s.low_stock && s.low_stock.length > 0 ? (
              <Section title="Stock à réapprovisionner" actions={can('inventory.view') ? <Link to="/admin/inventory?filter=low" className="btn-link !text-[13px]">Stock <ArrowRight className="h-3.5 w-3.5" /></Link> : undefined}>
                <ul className="divide-y divide-navy/10">
                  {s.low_stock.slice(0, 5).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                      <div className="min-w-0"><p className="truncate font-semibold text-navy">{p.name}</p><p className="text-xs text-navy/50">{p.reference}</p></div>
                      <p className={`shrink-0 tabular-nums ${Number(p.stock_quantity) <= 0 ? 'font-bold text-brand-red' : 'font-semibold text-amber-700'}`}>{qty(p.stock_quantity)} <span className="font-normal text-navy/45">/ min {qty(p.min_stock)}</span></p>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : s.recent_activity && (
              <Activity items={s.recent_activity} canLogs={can('logs.view')} />
            )}
          </div>

          {s.low_stock && s.low_stock.length > 0 && s.recent_activity && <Activity items={s.recent_activity} canLogs={can('logs.view')} />}
        </div>
      )}
    </>
  );
}

function Activity({ items, canLogs }: { items: NonNullable<Stats['recent_activity']>; canLogs: boolean }) {
  return (
    <Section title="Activité récente" actions={canLogs ? <Link to="/admin/logs" className="btn-link !text-[13px]">Journal <ArrowRight className="h-3.5 w-3.5" /></Link> : undefined}>
      <ul className="divide-y divide-navy/10">
        {items.slice(0, 6).map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
            <span className="min-w-0 truncate text-navy"><strong className="font-semibold">{ACTION_LABEL[a.action] ?? a.action}</strong> {ENTITY_LABEL[a.entity_type] ?? a.entity_type}{a.entity_label && <span className="text-navy/55"> {a.entity_label}</span>}</span>
            <span className="text-xs text-navy/45">{fmtDateTime(a.created_at)}</span>
          </li>
        ))}
        {!items.length && <li className="px-5 py-8 text-center text-sm text-navy/50">Aucune activité.</li>}
      </ul>
    </Section>
  );
}
