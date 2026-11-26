import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Img } from '../Img';
import { Reveal } from '../Reveal';
import { useI18n } from '@/i18n';
import { images } from '@/data/images';

export function CtaSection() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="cta-title" className="relative isolate overflow-hidden bg-navy text-white">
      <div className="grid lg:grid-cols-12">
        <div className="relative px-4 py-16 sm:px-10 sm:py-20 lg:col-span-7 lg:ps-[max(2.5rem,calc((100vw-1360px)/2+2.5rem))] lg:pe-16">
          <div className="grain absolute inset-0 -z-10" />
          <Reveal>
            <h2 id="cta-title" className="display-lg max-w-2xl">{t('cta.title')}</h2>
            <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-white/70">{t('cta.text')}</p>
            <Link to="/quote" className="btn btn-red mt-8 !min-h-[52px] !px-8">
              {t('cta.button')} <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" />
            </Link>
          </Reveal>
        </div>
        <div className="relative min-h-[240px] lg:col-span-5">
          <Img src={images.quote} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-brand-red mix-blend-multiply opacity-60" />
          <div className="absolute inset-0 bg-gradient-to-r from-navy via-transparent to-transparent rtl:bg-gradient-to-l" />
        </div>
      </div>
    </section>
  );
}
