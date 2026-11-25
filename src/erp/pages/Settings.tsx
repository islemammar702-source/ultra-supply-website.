import { useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { PageHeader, toast } from '@/admin/ui';
import { errMsg, sb, unwrap } from '../lib/db';
import { invalidate, useAsync } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { fmtDate, today } from '../lib/format';
import { CURRENCIES } from '../lib/status';
import type { CompanySettings, ExchangeRate, NumberingRule, PaymentMethod, VatRate } from '../lib/types';
import { Check, DataTable, ErrorBox, Field, LoadingBlock, NumberInput, Section, SelectInput, Tabs, TextArea, TextInput } from '../components/ui';

type Tab = 'company' | 'sales' | 'vat' | 'payments' | 'numbering' | 'rates';

export default function SettingsPage() {
  const { can } = useAccess();
  const edit = can('settings.edit');
  const [tab, setTab] = useState<Tab>('company');
  const { data, error, reload } = useAsync(async () => {
    const [settings, vat, methods, numbering, rates] = await Promise.all([
      sb().from('company_settings').select('*').eq('id', 1).single().then(unwrap) as Promise<CompanySettings>,
      sb().from('vat_rates').select('*').order('rate', { ascending: false }).then(unwrap) as Promise<VatRate[]>,
      sb().from('payment_methods').select('*').order('sort_order').then(unwrap) as Promise<PaymentMethod[]>,
      sb().from('numbering_rules').select('*').order('label').then(unwrap) as Promise<NumberingRule[]>,
      sb().from('exchange_rates').select('*').order('rate_date', { ascending: false }).limit(200).then(unwrap) as Promise<ExchangeRate[]>,
    ]);
    return { settings, vat, methods, numbering, rates };
  }, []);
  const refresh = async () => { invalidate(); await reload(); };
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <LoadingBlock />;

  return (
    <>
      <PageHeader title="Paramètres" subtitle={edit ? 'Informations légales, documents, TVA, modes de paiement, numérotation et devises.' : 'Lecture seule.'} />
      <div className="border border-navy/10 bg-white">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'company', label: 'Société' }, { value: 'sales', label: 'Ventes & stock' }, { value: 'vat', label: 'TVA' },
          { value: 'payments', label: 'Modes de paiement' }, { value: 'numbering', label: 'Numérotation' }, { value: 'rates', label: 'Taux de change' },
        ]} />
        <div className="p-5">
          {tab === 'company' && <CompanyForm settings={data.settings} edit={edit} onSaved={refresh} />}
          {tab === 'sales' && <SalesForm settings={data.settings} edit={edit} onSaved={refresh} />}
          {tab === 'vat' && <VatTable rows={data.vat} edit={edit} onSaved={refresh} />}
          {tab === 'payments' && <MethodsTable rows={data.methods} edit={edit} onSaved={refresh} />}
          {tab === 'numbering' && <NumberingTable rows={data.numbering} edit={edit} onSaved={refresh} />}
          {tab === 'rates' && <RatesTable rows={data.rates} edit={can('settings.edit|purchases.edit')} onSaved={refresh} />}
        </div>
      </div>
    </>
  );
}

function useSave(onSaved: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const save = async (fn: () => Promise<unknown>, ok = 'Paramètres enregistrés') => {
    setBusy(true);
    try { await fn(); toast(ok); await onSaved(); } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(false); }
  };
  return { busy, save };
}

function CompanyForm({ settings, edit, onSaved }: { settings: CompanySettings; edit: boolean; onSaved: () => Promise<void> }) {
  const [s, setS] = useState(settings);
  const { busy, save } = useSave(onSaved);
  useEffect(() => setS(settings), [settings]);
  const f = (k: keyof CompanySettings, label: string, opts: { area?: boolean; span?: boolean; hint?: string } = {}) => (
    <Field label={label} hint={opts.hint} className={opts.span ? 'md:col-span-2' : ''}>
      {opts.area ? <TextArea value={String(s[k] ?? '')} disabled={!edit} onChange={(v) => setS({ ...s, [k]: v })} rows={2} />
        : <TextInput value={String(s[k] ?? '')} disabled={!edit} onChange={(v) => setS({ ...s, [k]: v })} />}
    </Field>
  );
  return (
    <div>
      <p className="mb-4 text-sm text-navy/60">Ces informations figurent sur tous les PDF (en-tête et pied de page).</p>
      <div className="grid gap-4 md:grid-cols-2">
        {f('legal_name', 'Raison sociale')}{f('company_name', 'Nom commercial')}
        {f('activity', 'Activité (en-tête des documents)', { span: true })}
        {f('tax_id', 'Matricule fiscal')}{f('trade_register', 'Registre du commerce')}
        {f('customs_code', 'Code en douane')}{f('website', 'Site web')}
        {f('address', 'Adresse')}{f('city', 'Ville')}{f('postal_code', 'Code postal')}{f('country', 'Pays')}
        {f('phone', 'Téléphone')}{f('phone2', 'Téléphone 2')}{f('email', 'E-mail')}
        {f('bank_name', 'Banque')}{f('bank_account', 'RIB / IBAN')}{f('bank_swift', 'BIC / SWIFT')}
        {f('pdf_footer', 'Mention libre en pied de page', { span: true, hint: 'Ex. capital social, mentions légales complémentaires.' })}
      </div>
      {edit && <button className="btn btn-red mt-5 !min-h-[42px]" disabled={busy} onClick={() => save(async () => {
        const { id: _id, ...row } = s;
        void _id;
        unwrap(await sb().from('company_settings').update({ ...row, updated_at: new Date().toISOString() }).eq('id', 1));
      })}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer</button>}
    </div>
  );
}

function SalesForm({ settings, edit, onSaved }: { settings: CompanySettings; edit: boolean; onSaved: () => Promise<void> }) {
  const [s, setS] = useState(settings);
  const { busy, save } = useSave(onSaved);
  useEffect(() => setS(settings), [settings]);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Field label="TVA par défaut (%)"><NumberInput value={Number(s.default_vat_rate)} disabled={!edit} onChange={(v) => setS({ ...s, default_vat_rate: v })} /></Field>
      <Field label="Validité des devis (jours)"><NumberInput value={s.quotation_validity_days} disabled={!edit} onChange={(v) => setS({ ...s, quotation_validity_days: Math.round(v) })} /></Field>
      <Field label="Échéance des factures par défaut (jours)"><NumberInput value={s.invoice_due_days} disabled={!edit} onChange={(v) => setS({ ...s, invoice_due_days: Math.round(v) })} /></Field>
      <Field label="Timbre fiscal (DT)" hint="Ajouté au total TTC des factures."><NumberInput value={Number(s.fiscal_stamp)} disabled={!edit} onChange={(v) => setS({ ...s, fiscal_stamp: v })} /></Field>
      <div className="md:col-span-2"><Check checked={s.apply_fiscal_stamp} onChange={(v) => edit && setS({ ...s, apply_fiscal_stamp: v })} label="Appliquer le timbre fiscal sur les nouvelles factures" /></div>
      <Field label="Sortie de stock déclenchée par" className="md:col-span-2" hint="Une seule source pour éviter les doubles sorties.">
        <SelectInput value={s.stock_exit_on} disabled={!edit} onChange={(v) => setS({ ...s, stock_exit_on: v as CompanySettings['stock_exit_on'] })}>
          <option value="invoice">La validation de la facture</option><option value="delivery_note">La validation du bon de livraison</option>
        </SelectInput>
      </Field>
      <div className="md:col-span-2"><Check checked={s.allow_negative_stock} onChange={(v) => edit && setS({ ...s, allow_negative_stock: v })} label="Autoriser le stock négatif (déconseillé)" /></div>
      <Field label="Conditions par défaut des devis" className="md:col-span-2"><TextArea value={s.quotation_terms} disabled={!edit} onChange={(v) => setS({ ...s, quotation_terms: v })} /></Field>
      <Field label="Conditions par défaut des factures" className="md:col-span-2"><TextArea value={s.invoice_terms} disabled={!edit} onChange={(v) => setS({ ...s, invoice_terms: v })} /></Field>
      {edit && <div><button className="btn btn-red !min-h-[42px]" disabled={busy} onClick={() => save(async () => unwrap(await sb().from('company_settings').update({
        default_vat_rate: s.default_vat_rate, quotation_validity_days: s.quotation_validity_days, invoice_due_days: s.invoice_due_days, fiscal_stamp: s.fiscal_stamp,
        apply_fiscal_stamp: s.apply_fiscal_stamp, stock_exit_on: s.stock_exit_on, allow_negative_stock: s.allow_negative_stock, quotation_terms: s.quotation_terms,
        invoice_terms: s.invoice_terms, updated_at: new Date().toISOString(),
      }).eq('id', 1)))}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer</button></div>}
    </div>
  );
}

function VatTable({ rows, edit, onSaved }: { rows: VatRate[]; edit: boolean; onSaved: () => Promise<void> }) {
  const [rate, setRate] = useState(0);
  const [label, setLabel] = useState('');
  const { busy, save } = useSave(onSaved);
  return (
    <div className="space-y-4">
      <DataTable rows={rows} minWidth={480} columns={[
        { key: 'r', header: 'Taux', render: (v) => <strong>{Number(v.rate)} %</strong> },
        { key: 'l', header: 'Libellé', render: (v) => v.label },
        { key: 'a', header: 'Actif', render: (v) => <Check checked={v.is_active} onChange={(x) => edit && void save(async () => unwrap(await sb().from('vat_rates').update({ is_active: x }).eq('id', v.id)))} label="" /> },
        { key: 'x', header: '', align: 'right', render: (v) => edit && <button className="p-2 text-navy/40 hover:text-brand-red" title="Supprimer" onClick={() => void save(async () => unwrap(await sb().from('vat_rates').delete().eq('id', v.id)), 'Taux supprimé')}><Trash2 className="h-4 w-4" /></button> },
      ]} />
      {edit && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Taux (%)"><NumberInput value={rate} onChange={setRate} /></Field>
          <Field label="Libellé"><TextInput value={label} onChange={setLabel} placeholder="TVA …" /></Field>
          <button className="btn btn-navy !min-h-[42px]" disabled={busy} onClick={() => save(async () => { unwrap(await sb().from('vat_rates').insert({ rate, label: label || `TVA ${rate} %` })); setLabel(''); }, 'Taux ajouté')}><Plus className="h-4 w-4" /> Ajouter</button>
        </div>
      )}
      <p className="text-xs text-navy/50">Les taux utilisés sur des documents existants restent figés sur ces documents.</p>
    </div>
  );
}

function MethodsTable({ rows, edit, onSaved }: { rows: PaymentMethod[]; edit: boolean; onSaved: () => Promise<void> }) {
  const [label, setLabel] = useState('');
  const { busy, save } = useSave(onSaved);
  const upd = (m: PaymentMethod, patch: Partial<PaymentMethod>) => save(async () => unwrap(await sb().from('payment_methods').update(patch).eq('id', m.id)));
  return (
    <div className="space-y-4">
      <DataTable rows={rows} minWidth={640} columns={[
        { key: 'l', header: 'Mode', render: (m) => <span className="font-semibold">{m.label}</span> },
        { key: 'r', header: 'Référence obligatoire', render: (m) => <Check checked={m.requires_reference} onChange={(v) => edit && void upd(m, { requires_reference: v })} label="" /> },
        { key: 'd', header: 'Date d’échéance', render: (m) => <Check checked={m.has_due_date} onChange={(v) => edit && void upd(m, { has_due_date: v })} label="" /> },
        { key: 'a', header: 'Actif', render: (m) => <Check checked={m.is_active} onChange={(v) => edit && void upd(m, { is_active: v })} label="" /> },
      ]} />
      {edit && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Nouveau mode de paiement"><TextInput value={label} onChange={setLabel} placeholder="Ex. Carte bancaire, compensation…" /></Field>
          <button className="btn btn-navy !min-h-[42px]" disabled={busy || !label.trim()} onClick={() => save(async () => {
            const code = label.toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'autre';
            unwrap(await sb().from('payment_methods').insert({ code: `${code}_${Date.now().toString(36).slice(-4)}`, label: label.trim(), sort_order: rows.length + 1 }));
            setLabel('');
          }, 'Mode ajouté')}><Plus className="h-4 w-4" /> Ajouter</button>
        </div>
      )}
    </div>
  );
}

function NumberingTable({ rows, edit, onSaved }: { rows: NumberingRule[]; edit: boolean; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const { busy, save } = useSave(onSaved);
  return (
    <div className="space-y-4">
      <p className="text-sm text-navy/60">Format : PRÉFIXE-ANNÉE-NUMÉRO (ex. FAC-2026-0001). Les factures sont numérotées uniquement à la validation, sans trou.</p>
      <DataTable rows={rows.map((r) => ({ ...r, id: r.doc_type }))} minWidth={560} columns={[
        { key: 'l', header: 'Document', render: (r) => r.label },
        { key: 'p', header: 'Préfixe', render: (r) => edit ? <input className="field !min-h-[38px] !w-28 !py-1.5 font-mono uppercase" value={draft[r.doc_type] ?? r.prefix} onChange={(e) => setDraft({ ...draft, [r.doc_type]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) })} /> : <span className="font-mono">{r.prefix}</span> },
        { key: 'e', header: 'Exemple', render: (r) => <span className="font-mono text-navy/60">{(draft[r.doc_type] ?? r.prefix)}-{r.yearly ? `${today().slice(0, 4)}-` : ''}{'1'.padStart(r.padding, '0')}</span> },
      ]} />
      {edit && <button className="btn btn-red !min-h-[42px]" disabled={busy || !Object.keys(draft).length} onClick={() => save(async () => {
        for (const [doc_type, prefix] of Object.entries(draft)) if (prefix) unwrap(await sb().from('numbering_rules').update({ prefix }).eq('doc_type', doc_type));
        setDraft({});
      })}><Save className="h-4 w-4" /> Enregistrer</button>}
    </div>
  );
}

function RatesTable({ rows, edit, onSaved }: { rows: ExchangeRate[]; edit: boolean; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ currency: 'EUR', rate: 0, rate_date: today(), source: 'BCT' });
  const { busy, save } = useSave(onSaved);
  return (
    <div className="space-y-4">
      <p className="text-sm text-navy/60">Taux en dinars pour une unité de devise (ex. 1 EUR = 3,400 TND). Utilisés par défaut sur les achats ; chaque document conserve son propre taux.</p>
      {edit && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Devise"><SelectInput value={f.currency} onChange={(v) => setF({ ...f, currency: v })}>{CURRENCIES.filter((c) => c !== 'TND').map((c) => <option key={c} value={c}>{c}</option>)}</SelectInput></Field>
          <Field label="Taux (TND)"><NumberInput value={f.rate} onChange={(v) => setF({ ...f, rate: v })} /></Field>
          <Field label="Date"><input type="date" className="field !min-h-[42px] !py-2" value={f.rate_date} onChange={(e) => setF({ ...f, rate_date: e.target.value })} /></Field>
          <Field label="Source"><TextInput value={f.source} onChange={(v) => setF({ ...f, source: v })} /></Field>
          <button className="btn btn-navy !min-h-[42px]" disabled={busy || !(f.rate > 0)} onClick={() => save(async () => unwrap(await sb().from('exchange_rates').upsert(f, { onConflict: 'currency,rate_date' })), 'Taux enregistré')}><Plus className="h-4 w-4" /> Enregistrer</button>
        </div>
      )}
      <Section title="Historique">
        <DataTable rows={rows} minWidth={480} columns={[
          { key: 'd', header: 'Date', render: (r) => fmtDate(r.rate_date) },
          { key: 'c', header: 'Devise', render: (r) => <strong>{r.currency}</strong> },
          { key: 'r', header: 'Taux', align: 'right', render: (r) => <span className="tabular-nums">{Number(r.rate).toFixed(4)} TND</span> },
          { key: 's', header: 'Source', render: (r) => r.source },
        ]} />
      </Section>
    </div>
  );
}
