import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg, sb, unwrap } from './db';
import type { CompanySettings, PaymentMethod, StaffUser, VatRate } from './types';

/** Loads async data; reload() re-runs it. Ignores results of stale calls. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const v = await run();
      if (id === seq.current) { setData(v); setError(null); }
    } catch (e) {
      if (id === seq.current) setError(errMsg(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [run]);

  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

// ---------------------------------------------------------------------------
// Small reference-data cache shared by all pages (settings, VAT, payment methods, staff).
// ---------------------------------------------------------------------------
const cache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    const p = loader().catch((e) => { cache.delete(key); throw e; });
    cache.set(key, p);
  }
  return cache.get(key) as Promise<T>;
}

export const invalidate = (...keys: string[]) => (keys.length ? keys.forEach((k) => cache.delete(k)) : cache.clear());

export const loadSettings = () =>
  cached('settings', async () => unwrap(await sb().from('company_settings').select('*').eq('id', 1).single()) as CompanySettings);

export const loadVatRates = () =>
  cached('vat', async () => unwrap(await sb().from('vat_rates').select('*').order('rate', { ascending: false })) as VatRate[]);

export const loadPaymentMethods = () =>
  cached('payment_methods', async () => unwrap(await sb().from('payment_methods').select('*').order('sort_order')) as PaymentMethod[]);

export const loadStaff = () =>
  cached('staff', async () => unwrap(await sb().from('users').select('id,email,full_name,phone,role_id,is_active,last_login_at,created_at').order('full_name')) as StaffUser[]);

export function useReference() {
  return useAsync(async () => {
    const [settings, vatRates, methods] = await Promise.all([loadSettings(), loadVatRates(), loadPaymentMethods()]);
    return { settings, vatRates, methods };
  }, []);
}

/** Debounced value for search inputs. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
