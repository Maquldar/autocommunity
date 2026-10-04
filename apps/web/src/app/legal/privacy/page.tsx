import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PublicLayout } from '@/components/layout/public-layout';
import { LegalDocument, PRIVACY_SECTIONS } from '@/features/legal/legal-document';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.privacy');
  return { title: t('title') };
}

export default async function PrivacyPage() {
  const t = await getTranslations('legal.privacy');
  return (
    <PublicLayout>
      <LegalDocument
        title={t('title')}
        intro={t('intro')}
        sections={PRIVACY_SECTIONS.map((id) => ({ id, title: t(`sections.${id}.title`), body: t(`sections.${id}.body`) }))}
      />
    </PublicLayout>
  );
}
