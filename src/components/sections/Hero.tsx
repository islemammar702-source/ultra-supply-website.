import { Link } from 'react-router-dom';
import { ArrowRight, FileText } from 'lucide-react';
import { Img } from '../Img';
import { useI18n } from '@/i18n';
import { images } from '@/data/images';
import { useCatalog } from '@/hooks/useCatalog';
import { iconFor } from '@/data/sectors';

export function Hero() {
  const { t, loc } = useI18n();
  const { categories } = useCatalog();
  return (
    <section aria-labelledby="hero-title" className="relative isolate flex min-h-[92svh] flex-col overflow-hidden bg-navy-950 text-white">
      <Img src={images.hero} alt={t('hero.label')} priority className="absolute inset-0 -z-30 h-full w-full animate-kenburns object-cover" />
      <div className="absolute inset-0 -z-20 bg-gradient-to-r from-navy-950/95 via-navy-950/70 to-navy/20 rtl:bg-gradient-to-l" />
      <div className="absolute inset-0 -z-20 bg-gradient-to-t from-navy-950 via-transparent to-navy-950/40" />

      <div className="container-site flex flex-1 flex-col justify-center pb-10 pt-32 sm:pt-36">
        <div className="max-w-3xl">
          <h1 id="hero-title" className="display-xl brand-latin">
            <span className="block">Ultra</span>
            <span className="block">Supply<span className="text-brand-red">.</span></span>
          </h1>
          <p className="mt-8 max-w-xl font-display text-[clamp(1.2rem,2vw,1.6rem)] font-semibold leading-snug">{t('hero.subtitle')}</p>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/65">{t('hero.description')}</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link to="/products" className="btn btn-red">
              {t('hero.ctaProducts')} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </Link>
            <Link to="/quote" className="btn btn-ghost-light">
              <FileText className="h-4 w-4" /> {t('hero.ctaQuote')}
            </Link>
          </div>
        </div>
      </div>

      {/* Sector rail: one tap to each product family. */}
      {categories.length > 0 && (
        <nav aria-label={t('sectors.title')} className="border-t border-white/10 bg-navy-950/55 backdrop-blur-md">
          <ul className="container-site grid grid-cols-3 sm:grid-cols-6">
            {categories.slice(0, 6).map((c) => {
              const Icon = iconFor(c.slug);
              return (
                <li key={c.id} className="border-white/10 [&:not(:last-child)]:border-e max-sm:[&:nth-child(3)]:border-e-0 max-sm:[&:nth-child(-n+3)]:border-b">
                  <Link to={`/products?category=${c.slug}`} className="group flex flex-col items-center gap-2 px-2 py-4 text-center sm:py-5">
                    <span className="chamfer chamfer-sm flex h-11 w-11 items-center justify-center bg-white/10 transition-colors group-hover:bg-brand-red">
                      <Icon className="h-5 w-5" strokeWidth={1.6} />
                    </span>
                    <span className="line-clamp-2 text-[12px] font-medium leading-tight text-white/75 group-hover:text-white sm:text-[13px]">{loc(c.name)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </section>
  );
}
