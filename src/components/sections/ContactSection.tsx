import { Mail, MapPin, MessageCircle, Phone, type LucideIcon } from 'lucide-react';
import { SectionHeading } from '../SectionHeading';
import { ContactForm } from '../forms/ContactForm';
import { Reveal } from '../Reveal';
import { useI18n } from '@/i18n';

export function ContactSection({ heading = true }: { heading?: boolean }) {
  const { t } = useI18n();
  const phone = t('contact.phoneValue');
  const wa = t('contact.whatsappValue');
  const email = t('contact.emailValue');
  const digits = (s: string) => s.replace(/[^\d+]/g, '');
  const isReal = (s: string) => !/X{2,}/i.test(s) && digits(s).replace('+', '').length >= 8;
  const isRealEmail = !/votre-domaine|your-domain|example\./i.test(email);

  const items: { Icon: LucideIcon; label: string; value: string; href?: string; ltr?: boolean }[] = [
    ...phone.split('/').map((n) => n.trim()).filter(Boolean).map((n) => ({ Icon: Phone, label: t('contact.phone'), value: n, href: isReal(n) ? `tel:${digits(n)}` : undefined, ltr: true })),
    { Icon: MessageCircle, label: t('contact.whatsapp'), value: wa, href: isReal(wa) ? `https://wa.me/${digits(wa).replace('+', '')}` : undefined, ltr: true },
    { Icon: Mail, label: t('contact.email'), value: email, href: isRealEmail ? `mailto:${email}` : undefined, ltr: true },
    { Icon: MapPin, label: t('contact.address'), value: t('contact.addressValue') },
  ];
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(t('contact.mapQuery'))}&output=embed`;

  return (
    <section id="contact" aria-labelledby={heading ? 'contact-title' : undefined} className="section-y scroll-mt-24">
      <div className="container-site">
        {heading && <SectionHeading id="contact-title" label={t('contact.label')} title={t('contact.title')} />}
        <div className={`grid gap-8 lg:grid-cols-12 ${heading ? 'mt-10' : ''}`}>
          <Reveal className="lg:col-span-5">
            <ul className="grid gap-px border border-navy/10 bg-navy/10 sm:grid-cols-2 lg:grid-cols-1">
              {items.map(({ Icon, label, value, href, ltr }) => {
                const body = (
                  <>
                    <span className="chamfer chamfer-sm flex h-11 w-11 shrink-0 items-center justify-center bg-navy text-white transition-colors group-hover:bg-brand-red">
                      <Icon className="h-5 w-5" strokeWidth={1.5} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium text-navy/50">{label}</span>
                      <span className="mt-1 block break-words text-[16px] font-medium text-navy" dir={ltr ? 'ltr' : undefined} style={ltr ? { textAlign: 'start', unicodeBidi: 'plaintext' } : undefined}>{value}</span>
                    </span>
                  </>
                );
                return (
                  <li key={label + value} className="bg-white">
                    {href ? (
                      <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="group flex items-center gap-4 p-5 hover:bg-mist">{body}</a>
                    ) : (
                      <div className="group flex items-center gap-4 p-5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 aspect-[4/3] w-full overflow-hidden border border-navy/10 bg-mist">
              <iframe
                title={t('contact.mapTitle')}
                src={mapSrc}
                className="h-full w-full grayscale-[0.4]"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            </div>
          </Reveal>
          <Reveal delay={120} className="lg:col-span-7">
            <div className="chamfer chamfer-lg bg-mist p-6 sm:p-9">
              <h3 className="display-md text-navy">{t('contact.formTitle')}</h3>
              <div className="mt-6"><ContactForm /></div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
