import { Link } from 'react-router-dom';
import { ArrowUpRight, FileText } from 'lucide-react';
import { Img } from './Img';
import { useI18n } from '@/i18n';
import type { Category, Product } from '@/lib/types';

interface Props {
  product: Product;
  category?: Category;
}

export function ProductCard({ product, category }: Props) {
  const { t, loc } = useI18n();
  const name = loc(product.name);
  return (
    <article className="group relative flex h-full flex-col bg-white ring-1 ring-navy/10 transition-shadow duration-300 hover:shadow-[0_24px_48px_-30px_rgba(10,36,69,0.5)]">
      <Link to={`/products/${product.slug}`} className="chamfer chamfer-lg relative block aspect-[4/3] overflow-hidden bg-mist" tabIndex={-1} aria-hidden>
        <Img src={product.image_url} alt={name} className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105" />
        {category && (
          <span className="absolute start-3 top-3 bg-white/95 px-2.5 py-1 text-[12px] font-semibold text-navy">{loc(category.name)}</span>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <p className="text-[12px] text-navy/45" dir="ltr">{product.reference}</p>
        <h3 className="mt-1 font-display text-[18px] font-bold leading-snug text-navy">
          <Link to={`/products/${product.slug}`} className="transition-colors hover:text-brand-red">{name}</Link>
        </h3>
        <p className="mt-2 line-clamp-2 flex-1 text-[14px] text-navy-950/60">{loc(product.description)}</p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <Link to={`/products/${product.slug}`} className="btn-link !text-[13px]">
            {t('common.viewDetails')} <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" />
          </Link>
          <Link to={`/quote?product=${product.slug}`} className="btn btn-red !min-h-[40px] !px-4 !text-[13px]">
            <FileText className="h-4 w-4" /> {t('common.requestQuote')}
          </Link>
        </div>
      </div>
    </article>
  );
}
