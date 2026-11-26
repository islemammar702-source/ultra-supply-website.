import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { SectionHeading } from '../SectionHeading';
import { SectorCard } from '../SectorCard';
import { Reveal } from '../Reveal';
import { useI18n } from '@/i18n';
import { useCatalog } from '@/hooks/useCatalog';

export function Sectors() {
  const { t } = useI18n();
  const { categories } = useCatalog();
  return (
    <section aria-labelledby="sectors-title" className="section-y bg-mist">
      <div className="container-site">
        <SectionHeading
          id="sectors-title"
          label={t('sectors.label')}
          title={t('sectors.title')}
          aside={
            <Link to="/industries" className="btn-link">
              {t('nav.industries')} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </Link>
          }
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.slice(0, 6).map((c, i) => (
            <Reveal key={c.id} delay={(i % 3) * 60}>
              <SectorCard category={c} index={i} className="h-full" />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
