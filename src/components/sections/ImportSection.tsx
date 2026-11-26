import { Link } from 'react-router-dom';
import { ArrowRight, Globe2, Ship, Truck } from 'lucide-react';
import { Img } from '../Img';
import { Reveal } from '../Reveal';
import { useI18n } from '@/i18n';
import { images } from '@/data/images';

export function useImportSteps() {
  const { t } = useI18n();
  return [
    { Icon: Globe2, title: t('import.step1.title'), text: t('import.step1.text'), image: images.sourcing },
    { Icon: Ship, title: t('import.step2.title'), text: t('import.step2.text'), image: images.logistics },
    { Icon: Truck, title: t('import.step3.title'), text: t('import.step3.text'), image: images.distribution },
  ];
}

export function ImportSection({ withLink = true }: { withLink?: boolean }) {
  const { t } = useI18n();
  const steps = useImportSteps();
  return (
    <section aria-labelledby="import-title" className="relative isolate overflow-hidden bg-navy text-white">
      <div className="relative h-[40vh] min-h-[300px] w-full overflow-hidden">
        <Img src={images.logistics} alt={t('import.step2.title')} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-navy-950/40 via-navy/30 to-navy" />
        <div className="container-site absolute inset-x-0 bottom-0 pb-10">
          <Reveal>
            <span className="eyebrow">{t('import.label')}</span>
            <h2 id="import-title" className="display-lg mt-4 max-w-3xl">{t('import.title')}</h2>
          </Reveal>
        </div>
      </div>

      <div className="container-site pb-16 pt-8 sm:pb-24">
        <div className="grid gap-10 lg:grid-cols-12">
          <Reveal className="lg:col-span-4">
            <p className="text-[16px] leading-relaxed text-white/70">{t('import.description')}</p>
            {withLink && (
              <Link to="/import-distribution" className="btn btn-red mt-8">
                {t('common.discoverMore')} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
            )}
          </Reveal>
          <ol className="grid gap-px bg-white/10 sm:grid-cols-3 lg:col-span-8">
            {steps.map(({ Icon, title, text }, i) => (
              <Reveal as="li" key={title} delay={i * 120} className="group relative bg-navy p-6 transition-colors duration-300 hover:bg-navy-900 sm:p-7">
                <div className="flex items-center gap-3">
                  <span className="chamfer chamfer-sm flex h-11 w-11 items-center justify-center bg-white/10 transition-colors group-hover:bg-brand-red">
                    <Icon className="h-5 w-5 text-white" strokeWidth={1.6} />
                  </span>
                  <span className="text-[13px] font-semibold text-white/45" dir="ltr">{i + 1}/{steps.length}</span>
                </div>
                <h3 className="mt-6 font-display text-[18px] font-bold">{title}</h3>
                <p className="mt-2 text-[14px] text-white/65">{text}</p>
                {i < steps.length - 1 && (
                  <ArrowRight className="absolute -end-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 bg-brand-red p-1 sm:block rtl:rotate-180" aria-hidden />
                )}
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
