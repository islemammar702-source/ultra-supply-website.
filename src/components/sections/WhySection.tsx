import { HeartHandshake, Layers, ShieldCheck, Users } from 'lucide-react';
import { SectionHeading } from '../SectionHeading';
import { Reveal } from '../Reveal';
import { useI18n } from '@/i18n';
import type { DictKey } from '@/i18n/fr';

const ITEMS = [
  { n: 1, Icon: ShieldCheck },
  { n: 2, Icon: Layers },
  { n: 3, Icon: HeartHandshake },
  { n: 4, Icon: Users },
] as const;

export function WhySection() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="why-title" className="section-y relative overflow-hidden">
      <div className="container-site">
        <SectionHeading id="why-title" label={t('why.label')} title={t('why.title')} />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map(({ n, Icon }, i) => (
            <Reveal
              key={n}
              delay={i * 60}
              className="group bg-mist p-6"
            >
              <span className="chamfer chamfer-sm flex h-12 w-12 items-center justify-center bg-navy text-white transition-colors group-hover:bg-brand-red">
                <Icon className="h-6 w-6" strokeWidth={1.5} />
              </span>
              <h3 className="mt-5 font-display text-[18px] font-bold leading-tight text-navy">
                {t(`why.${n}.title` as DictKey)}
              </h3>
              <p className="mt-2 text-[14px] text-navy-950/60">{t(`why.${n}.text` as DictKey)}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
