import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PublicLayout } from '@/components/layout/public-layout';
import { EmergencyCallButton } from '@/components/ui/emergency-call-button';
import { LegalDocument, TERMS_SECTIONS } from '@/features/legal/legal-document';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.terms');
  return { title: t('title') };
}

export default async function TermsPage() {
  const t = await getTranslations('legal.terms');
  return (
    <PublicLayout>
      <LegalDocument
        title={t('title')}
        intro={t('intro')}
        sections={TERMS_SECTIONS.map((id) => ({
          id,
          title: t(`sections.${id}.title`),
          body: t(`sections.${id}.body`),
          extra: id === 'emergency' ? <EmergencyCallButton /> : undefined,
        }))}
      />
    </PublicLayout>
  );
}
