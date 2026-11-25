import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Boxes, FileText, Inbox, Receipt, Users, Wallet } from 'lucide-react';
import { PageHeader } from '@/admin/ui';
import { rpc } from '../lib/db';
import { useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { amount, fmtDate, fmtDateTime, money, qty } from '../lib/format';
import { ACTION_LABEL, ENTITY_LABEL, INVOICE_STATUS, CREDIT_NOTE_STATUS } from '../lib/status';
import { BarChart, ErrorBox, LoadingBlock, Section, StatCard, StatusBadge } from '../components/ui';

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

export default function ErpDashboard() {
  const { access, can } = useAccess();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => rpc<Stats>('dashboard_stats'), []);

  if (!can('dashboard.view')) {
    return (
      <>
        <PageHeader title={`Bonjour${access?.full_name ? ` ${access.full_name}` : ''}`} subtitle={access?.role_label} />
        <p className="text-navy/60">Utilisez le menu pour accéder à vos modules.</p>
      </>
    );
  }

  const s = data ?? {};
  const sales = (s.monthly_sales ?? []).map((m) => ({ label: `${MONTHS[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(2, 4)}`, value: Number(m.total_ht), hint: `${m.invoices} facture(s)` }));

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle={`Activité réelle au ${fmtDate(new Date().toISOString())} — ${access?.full_name || access?.email} (${access?.role_label})`} />
      {error && <div className="mb-6"><ErrorBox message={error} onRetry={reload} /></div>}
      {loading && !data && <LoadingBlock />}

      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {s.revenue_year_ht !== undefined && (
              <StatCard accent label="Chiffre d'affaires HT (année)" value={money(s.revenue_year_ht)} icon={<Receipt className="h-5 w-5" />}
                hint={`Ce mois : ${money(s.revenue_month_ht)} · Total : ${money(s.revenue_total_ht)}`} onClick={can('reports.view') ? () => navigate('/admin/reports') : undefined} />
            )}
            {s.outstanding_amount !== undefined && (
              <StatCard label="Factures impayées" value={money(s.outstanding_amount)} icon={<AlertTriangle className="h-5 w-5" />}
                hint={<>{s.outstanding_count} facture(s){s.overdue_count ? <> · <span className="font-semibold text-brand-red">{s.overdue_count} en retard ({money(s.overdue_amount)})</span></> : null}</>}
                onClick={() => navigate('/admin/invoices?status=unpaid')} />
            )}
            {s.payments_month !== undefined && (
              <StatCard label="Paiements reçus (mois)" value={money(s.payments_month)} icon={<Wallet className="h-5 w-5" />}
                hint={`Année : ${money(s.payments_year)}${s.unallocated_payments ? ` · Non affecté : ${money(s.unallocated_payments)}` : ''}`} onClick={() => navigate('/admin/payments')} />
            )}
            {s.pending_quotations !== undefined && (
              <StatCard label="Devis en attente" value={s.pending_quotations} icon={<FileText className="h-5 w-5" />}
                hint={`${money(s.pending_quotations_amount)} HT · ${s.quotations_sent_month} envoyé(s) ce mois`} onClick={() => navigate('/admin/quotations?status=pending')} />
            )}
            {s.customers_total !== undefined && (
              <StatCard label="Clients actifs" value={s.customers_active} icon={<Users className="h-5 w-5" />}
                hint={`Facturés sur 12 mois · ${s.customers_total} client(s) au fichier`} onClick={() => navigate('/admin/customers')} />
            )}
            {s.products_in_stock !== undefined && (
              <StatCard label="Produits en stock" value={s.products_in_stock} icon={<Boxes className="h-5 w-5" />}
                hint={`${qty(s.units_in_stock)} unités · ${s.products_total} produit(s) actifs${s.stock_value != null ? ` · Valeur ${money(s.stock_value)}` : ''}`}
                onClick={can('inventory.view') ? () => navigate('/admin/inventory') : undefined} />
            )}
            {s.low_stock_count !== undefined && (
              <StatCard label="Alertes de stock" value={<span className={s.low_stock_count ? 'text-brand-red' : ''}>{s.low_stock_count}</span>}
                icon={<AlertTriangle className="h-5 w-5" />} hint="Produits sous le seuil minimum" onClick={can('inventory.view') ? () => navigate('/admin/inventory?filter=low') : undefined} />
            )}
            <StatCard label="Demandes du site" value={<span className={s.new_requests ? 'text-brand-red' : ''}>{s.new_requests ?? 0}</span>}
              icon={<Inbox className="h-5 w-5" />} hint={can('requests.view') ? 'Nouvelles demandes à traiter' : 'Demandes qui vous sont affectées'} onClick={() => navigate('/admin/requests')} />
          </div>

          {s.monthly_sales && (
            <Section title="Ventes mensuelles HT (12 mois, avoirs déduits)" actions={can('reports.view') ? <Link to="/admin/reports" className="btn-link !text-[11px]">Rapports <ArrowRight className="h-3.5 w-3.5" /></Link> : undefined}>
              <div className="p-5">
                {sales.some((d) => d.value !== 0) ? <BarChart data={sales} format={(v) => amount(v, 0)} /> : <p className="py-10 text-center text-sm text-navy/50">Aucune facture validée sur les 12 derniers mois.</p>}
              </div>
            </Section>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            {s.recent_invoices && (
              <Section title="Dernières factures" actions={<Link to="/admin/invoices" className="btn-link !text-[11px]">Tout voir <ArrowRight className="h-3.5 w-3.5" /></Link>}>
                <ul className="divide-y divide-navy/10">
                  {s.recent_invoices.map((i) => (
                    <li key={i.id}>
                      <Link to={`/admin/invoices/${i.id}`} className="flex items-center justify-between gap-4 px-5 py-3 text-sm hover:bg-mist/60">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-navy">{i.number ?? 'Brouillon'} <span className="font-normal text-navy/50">· {i.customer}</span></p>
                          <p className="text-xs text-navy/50">{i.kind === 'credit_note' ? 'Avoir' : 'Facture'} du {fmtDate(i.issue_date)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <StatusBadge map={i.kind === 'credit_note' ? CREDIT_NOTE_STATUS : INVOICE_STATUS} value={i.status} />
                          <p className="mt-1 text-xs tabular-nums text-navy/60">{money(i.total_ttc)}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                  {!s.recent_invoices.length && <li className="px-5 py-10 text-center text-sm text-navy/50">Aucune facture pour le moment.</li>}
                </ul>
              </Section>
            )}

            {s.low_stock && (
              <Section title="Alertes de stock" actions={can('inventory.view') ? <Link to="/admin/inventory?filter=low" className="btn-link !text-[11px]">Stock <ArrowRight className="h-3.5 w-3.5" /></Link> : undefined}>
                <ul className="divide-y divide-navy/10">
                  {s.low_stock.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                      <div className="min-w-0"><p className="truncate font-semibold text-navy">{p.name}</p><p className="font-mono text-xs text-navy/50">{p.reference}</p></div>
                      <p className={`shrink-0 tabular-nums ${Number(p.stock_quantity) <= 0 ? 'font-bold text-brand-red' : 'text-amber-700'}`}>{qty(p.stock_quantity)} / min {qty(p.min_stock)} {p.unit}</p>
                    </li>
                  ))}
                  {!s.low_stock.length && <li className="px-5 py-10 text-center text-sm text-navy/50">Aucun produit sous le seuil minimum.</li>}
                </ul>
              </Section>
            )}

            {s.recent_activity && (
              <Section title="Activité récente" className="xl:col-span-2" actions={can('logs.view') ? <Link to="/admin/logs" className="btn-link !text-[11px]">Journal <ArrowRight className="h-3.5 w-3.5" /></Link> : undefined}>
                <ul className="divide-y divide-navy/10">
                  {s.recent_activity.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                      <span className="text-navy"><strong>{ACTION_LABEL[a.action] ?? a.action}</strong> · {ENTITY_LABEL[a.entity_type] ?? a.entity_type} {a.entity_label && <span className="text-navy/60">« {a.entity_label} »</span>}</span>
                      <span className="text-xs text-navy/45">{a.user_email || 'Système'} · {fmtDateTime(a.created_at)}</span>
                    </li>
                  ))}
                  {!s.recent_activity.length && <li className="px-5 py-8 text-center text-sm text-navy/50">Aucune activité.</li>}
                </ul>
              </Section>
            )}
          </div>
        </div>
      )}
    </>
  );
}
