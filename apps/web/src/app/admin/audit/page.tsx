import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuditView } from '@/features/admin/audit-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.audit');
  return { title: t('title') };
}

export default function AdminAuditPage() {
  return <AuditView />;
}
