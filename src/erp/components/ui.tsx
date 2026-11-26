import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Inbox, Loader2, Search, X } from 'lucide-react';
import { Modal } from '@/admin/ui';
import type { StatusDef, Tone } from '../lib/status';
import { amount, startOfMonth, startOfYear, today, addDays } from '../lib/format';

const TONES: Record<Tone, string> = {
  navy: 'bg-navy-100 text-navy',
  red: 'bg-brand-red/10 text-brand-red',
  gray: 'bg-mist text-navy/60',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  blue: 'bg-sky-50 text-sky-700',
};

export function Pill({ tone = 'navy', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 text-[12px] font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function StatusBadge({ map, value }: { map: Record<string, StatusDef>; value: string }) {
  const s = map[value] ?? { label: value, tone: 'gray' as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`h-5 w-5 animate-spin text-navy ${className}`} />;
}

export function LoadingBlock() {
  return <div className="flex justify-center py-16"><Spinner /></div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 border-l-[3px] border-brand-red bg-brand-red/5 p-4 text-sm text-navy">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand-red" />
      <div className="flex-1">{message}</div>
      {onRetry && <button className="btn-link !text-[11px]" onClick={onRetry}>Réessayer</button>}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <Inbox className="h-8 w-8 text-navy/25" strokeWidth={1.4} />
      <p className="mt-3 font-semibold text-navy">{title}</p>
      {text && <p className="mt-1 max-w-md text-sm text-navy/55">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, accent, icon, onClick }: {
  label: string; value: ReactNode; hint?: ReactNode; accent?: boolean; icon?: ReactNode; onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`flex flex-col gap-3 p-5 text-left transition-shadow ${onClick ? 'hover:shadow-[0_18px_40px_-24px_rgba(10,36,69,0.45)]' : ''} ${accent ? 'chamfer chamfer-lg bg-navy text-white' : 'bg-white ring-1 ring-navy/10'}`}>
      <div className="flex items-center gap-3">
        {icon && <span className={`chamfer chamfer-sm flex h-9 w-9 shrink-0 items-center justify-center ${accent ? 'bg-brand-red text-white' : 'bg-navy-50 text-navy'}`}>{icon}</span>}
        <p className={`text-[13px] font-medium ${accent ? 'text-white/75' : 'text-navy/60'}`}>{label}</p>
      </div>
      <p className="font-display text-[24px] font-extrabold leading-tight tracking-tight">{value}</p>
      {hint && <p className={`-mt-1 text-[12.5px] ${accent ? 'text-white/60' : 'text-navy/50'}`}>{hint}</p>}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function Field({ label, required, children, hint, className = '' }: { label: string; required?: boolean; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">{label}{required && <span className="text-brand-red"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-navy/50">{hint}</span>}
    </label>
  );
}

export const inputCls = 'field !min-h-[42px] !py-2 text-[14px]';

export function TextInput({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <input {...rest} className={`${inputCls} ${rest.className ?? ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

export function NumberInput({ value, onChange, step = 'any', min, className = '', ...rest }: {
  value: number | null; onChange: (v: number) => void; step?: string; min?: number; className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'step' | 'min'>) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) { setText(value === null || value === undefined ? '' : String(value)); last.current = value; }
  }, [value]);
  return (
    <input {...rest} inputMode="decimal" className={`${inputCls} text-right tabular-nums ${className}`} value={text} step={step} min={min}
      onChange={(e) => {
        const t = e.target.value.replace(',', '.');
        setText(e.target.value);
        const n = Number(t);
        if (t.trim() !== '' && Number.isFinite(n)) { last.current = n; onChange(n); }
        else if (t.trim() === '') { last.current = 0; onChange(0); }
      }} />
  );
}

export function SelectInput({ value, onChange, children, className = '', ...rest }: {
  value: string; onChange: (v: string) => void; children: ReactNode; className?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return <select {...rest} className={`${inputCls} ${className}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>{children}</select>;
}

export function TextArea({ value, onChange, rows = 3, ...rest }: { value: string; onChange: (v: string) => void; rows?: number } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  return <textarea {...rest} rows={rows} className={`field !min-h-0 !py-2 text-[14px] ${rest.className ?? ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-navy">
      <input type="checkbox" className="h-4 w-4 accent-navy" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

export function SearchBar({ value, onChange, placeholder = 'Rechercher…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="relative block flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/40" />
      <input className={`${inputCls} !pl-10`} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
      {value && <button type="button" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-navy/40 hover:text-navy" aria-label="Effacer"><X className="h-4 w-4" /></button>}
    </label>
  );
}

export function FilterChips<T extends string>({ value, onChange, options }: { value: T | ''; onChange: (v: T | '') => void; options: { value: T | ''; label: string; count?: number }[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button key={o.value || 'all'} type="button" onClick={() => onChange(o.value)}
          className={`min-h-[42px] px-3.5 text-xs font-semibold ${value === o.value ? 'bg-navy text-white' : 'bg-mist text-navy hover:bg-navy-100'}`}>
          {o.label}{o.count !== undefined && <span className="ml-1.5 opacity-60">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Searchable dropdown (customers, suppliers, products…). */
export interface PickOption { value: string; label: string; hint?: string }
export function SearchSelect({ value, onChange, options, placeholder = 'Sélectionner…', disabled, allowClear, className = '' }: {
  value: string | null; onChange: (v: string | null) => void; options: PickOption[]; placeholder?: string; disabled?: boolean; allowClear?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = n ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(n)) : options;
    return list.slice(0, 80);
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (o: PickOption) => { onChange(o.value); setOpen(false); setQ(''); };

  return (
    <div ref={box} className={`relative ${className}`}>
      <button type="button" disabled={disabled} onClick={() => { setOpen((o) => !o); setHi(0); }}
        className={`${inputCls} flex items-center justify-between gap-2 text-left disabled:bg-mist disabled:text-navy/60`}>
        <span className={`truncate ${selected ? '' : 'text-navy/40'}`}>{selected ? selected.label : placeholder}</span>
        <span className="flex items-center gap-1">
          {allowClear && selected && !disabled && <X className="h-4 w-4 text-navy/40 hover:text-navy" onClick={(e) => { e.stopPropagation(); onChange(null); }} />}
          <ChevronDown className="h-4 w-4 text-navy/40" />
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 border border-navy/15 bg-white shadow-xl">
          <input autoFocus className="w-full border-b border-navy/10 px-3 py-2.5 text-sm outline-none" placeholder="Rechercher…" value={q}
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              if (e.key === 'Enter' && filtered[hi]) { e.preventDefault(); pick(filtered[hi]); }
              if (e.key === 'Escape') setOpen(false);
            }} />
          <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
            {filtered.map((o, i) => (
              <li key={o.value} role="option" aria-selected={o.value === value}
                className={`cursor-pointer px-3 py-2 text-sm ${i === hi ? 'bg-navy-100' : ''} ${o.value === value ? 'font-semibold' : ''}`}
                onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
                <span className="block truncate text-navy">{o.label}</span>
                {o.hint && <span className="block truncate text-xs text-navy/50">{o.hint}</span>}
              </li>
            ))}
            {!filtered.length && <li className="px-3 py-3 text-sm text-navy/50">Aucun résultat.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
export interface Column<T> { key: string; header: ReactNode; render: (row: T) => ReactNode; className?: string; align?: 'left' | 'right' | 'center' }

export function DataTable<T extends { id: string | number }>({ columns, rows, onRowClick, empty, loading, minWidth = 760, footer }: {
  columns: Column<T>[]; rows: T[]; onRowClick?: (row: T) => void; empty?: ReactNode; loading?: boolean; minWidth?: number; footer?: ReactNode;
}) {
  const align = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead className="bg-mist text-[12px] text-navy/60">
          <tr>{columns.map((c) => <th key={c.key} className={`whitespace-nowrap px-4 py-3 font-semibold ${align(c.align)} ${c.className ?? ''}`}>{c.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-navy/10">
          {rows.map((r) => (
            <tr key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'cursor-pointer hover:bg-mist/60' : ''}>
              {columns.map((c) => <td key={c.key} className={`px-4 py-3 align-middle ${align(c.align)} ${c.className ?? ''}`}>{c.render(r)}</td>)}
            </tr>
          ))}
          {loading && !rows.length && <tr><td colSpan={columns.length}><LoadingBlock /></td></tr>}
          {!loading && !rows.length && <tr><td colSpan={columns.length}>{empty ?? <EmptyState title="Aucun élément" />}</td></tr>}
        </tbody>
        {footer && <tfoot className="border-t-2 border-navy/15 bg-mist/60 font-semibold">{footer}</tfoot>}
      </table>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-navy/10" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-[14px] font-semibold ${value === t.value ? 'border-brand-red text-navy' : 'border-transparent text-navy/50 hover:text-navy'}`}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-navy/40">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------
export function ConfirmModal({ open, title, message, confirmLabel = 'Confirmer', danger, onConfirm, onClose, reasonLabel }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: (reason: string) => Promise<void> | void; onClose: () => void; reasonLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason(''); setError(null); } }, [open]);
  return (
    <Modal open={open} title={title} onClose={onClose}
      footer={<>
        {error && <p className="mr-auto self-center text-sm text-brand-red">{error}</p>}
        <button className="btn btn-ghost !min-h-[40px]" onClick={onClose}>Annuler</button>
        <button className={`btn ${danger ? 'btn-red' : 'btn-navy'} !min-h-[40px]`} disabled={busy || (Boolean(reasonLabel) && !reason.trim())}
          onClick={async () => {
            setBusy(true); setError(null);
            try { await onConfirm(reason.trim()); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); } finally { setBusy(false); }
          }}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {confirmLabel}
        </button>
      </>}>
      <div className="space-y-4 text-sm text-navy/80">
        <div>{message}</div>
        {reasonLabel && <Field label={reasonLabel} required><TextArea value={reason} onChange={setReason} rows={3} /></Field>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Date range with presets
// ---------------------------------------------------------------------------
export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const t = today();
  const presets: [string, string, string][] = [
    ['Ce mois', startOfMonth(), t],
    ['30 jours', addDays(t, -29), t],
    ['Cette année', startOfYear(), t],
    ['12 mois', addDays(t, -364), t],
  ];
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block"><span className="field-label">Du</span><input type="date" className={inputCls} value={from} onChange={(e) => onChange(e.target.value, to)} /></label>
      <label className="block"><span className="field-label">Au</span><input type="date" className={inputCls} value={to} onChange={(e) => onChange(from, e.target.value)} /></label>
      <div className="flex flex-wrap gap-1">
        {presets.map(([label, f, tt]) => (
          <button key={label} type="button" onClick={() => onChange(f, tt)}
            className={`min-h-[42px] px-3 text-xs font-semibold ${from === f && to === tt ? 'bg-navy text-white' : 'bg-mist text-navy hover:bg-navy-100'}`}>{label}</button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimal SVG bar chart (no dependency)
// ---------------------------------------------------------------------------
export function BarChart({ data, height = 220, format = (v: number) => amount(v, 0) }: {
  data: { label: string; value: number; hint?: string }[]; height?: number; format?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const [hover, setHover] = useState<number | null>(null);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * max);
  return (
    <div className="relative">
      <div className="flex" style={{ height }}>
        <div className="flex w-16 shrink-0 flex-col-reverse justify-between pb-6 pr-2 text-right text-[10px] text-navy/40">
          {ticks.map((v, i) => <span key={i}>{format(v)}</span>)}
        </div>
        <div className="relative flex flex-1 items-end gap-1.5 border-b border-l border-navy/10 pb-0 sm:gap-3">
          {ticks.slice(1).map((v, i) => <div key={i} className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-navy/10" style={{ bottom: `${(v / max) * 100}%` }} />)}
          {data.map((d, i) => (
            <div key={d.label} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <div className={`w-full transition-colors ${hover === i ? 'bg-brand-red' : i === data.length - 1 ? 'bg-navy' : 'bg-navy/70'}`}
                style={{ height: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / max) * 100)}%` }} />
              {hover === i && (
                <div className="absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap bg-navy-950 px-2.5 py-1.5 text-[11px] text-white shadow-lg">
                  <strong>{d.label}</strong> · {format(d.value)}{d.hint ? ` · ${d.hint}` : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="ml-16 mt-1.5 flex gap-1.5 sm:gap-3">
        {data.map((d) => <span key={d.label} className="flex-1 truncate text-center text-[10px] text-navy/50">{d.label}</span>)}
      </div>
    </div>
  );
}

export function Section({ title, actions, children, className = '' }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`border border-navy/10 bg-white ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy/10 px-5 py-3.5">
        <h2 className="font-display text-[16px] font-bold text-navy">{title}</h2>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-navy/10">
      {items.map(([k, v]) => (
        <div key={k} className="grid grid-cols-5 gap-3 px-5 py-2.5 text-sm">
          <dt className="col-span-2 text-navy/50">{k}</dt>
          <dd className="col-span-3 break-words text-navy">{v === '' || v === null || v === undefined ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}
