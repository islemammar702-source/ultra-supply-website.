import { Link } from 'react-router-dom';
import { ArrowRight, Cog, Ship, Truck, Wrench } from 'lucide-react';
import { Img } from '../Img';
import { Reveal } from '../Reveal';
import { useI18n } from '@/i18n';
import { images } from '@/data/images';

export function Intro() {
  const { t } = useI18n();
  const pillars = [
    { Icon: Ship, label: t('hero.tag1') },
    { Icon: Truck, label: t('hero.tag2') },
    { Icon: Cog, label: t('hero.tag3') },
    { Icon: Wrench, label: t('hero.tag4') },
  ];
  return (
    <section id="intro" aria-labelledby="intro-title" className="section-y scroll-mt-20">
      <div className="container-site grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <Reveal className="relative">
          <Img src={images.intro} alt={t('intro.caption')} className="chamfer chamfer-lg aspect-[4/3] w-full object-cover" />
          <span className="absolute -bottom-3 -start-3 h-16 w-16 border-b-4 border-s-4 border-brand-red" aria-hidden />
        </Reveal>

        <Reveal delay={100}>
          <span className="eyebrow">{t('intro.label')}</span>
          <h2 id="intro-title" className="display-lg mt-4 text-navy">{t('intro.title')}</h2>
          <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-navy-950/70">{t('intro.p1')}</p>
          <ul className="mt-8 grid max-w-xl grid-cols-2 gap-3">
            {pillars.map(({ Icon, label }) => (
              <li key={label} className="flex items-center gap-3 bg-navy-50 px-4 py-3 text-[14px] font-semibold text-navy">
                <Icon className="h-5 w-5 shrink-0 text-brand-red" strokeWidth={1.75} /> {label}
              </li>
            ))}
          </ul>
          <Link to="/about" className="btn-link mt-8">
            {t('common.discoverMore')} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
