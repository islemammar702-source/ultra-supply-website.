import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Img } from './Img';
import { useI18n } from '@/i18n';
import { iconFor } from '@/data/sectors';
import type { Category } from '@/lib/types';

interface Props {
  category: Category;
  /** Kept for compatibility with existing callers. */
  index?: number;
  className?: string;
}

export function SectorCard({ category, className = '' }: Props) {
  const { t, loc } = useI18n();
  const Icon = iconFor(category.slug);
  const title = loc(category.name);
  return (
    <Link
      to={`/products?category=${category.slug}`}
      aria-label={`${title} — ${t('common.discover')}`}
      className={`chamfer chamfer-lg group relative isolate flex min-h-[300px] flex-col justify-end overflow-hidden bg-navy-950 text-white sm:min-h-[340px] ${className}`}
    >
      <Img src={category.image_url} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-75 transition-transform duration-700 ease-out group-hover:scale-105" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-navy-950 via-navy-950/60 to-navy-950/0" />

      <span className="chamfer chamfer-sm absolute start-6 top-6 flex h-12 w-12 items-center justify-center bg-white/10 backdrop-blur-sm transition-colors duration-300 group-hover:bg-brand-red">
        <Icon className="h-5 w-5" strokeWidth={1.6} />
      </span>
      <ArrowUpRight className="absolute end-6 top-7 h-5 w-5 text-white/60 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white rtl:-scale-x-100" aria-hidden />

      <div className="p-6">
        <h3 className="display-md text-white">{title}</h3>
        <p className="mt-2 line-clamp-2 max-w-sm text-[14px] text-white/70">{loc(category.description)}</p>
      </div>
    </Link>
  );
}
