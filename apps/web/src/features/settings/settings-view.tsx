'use client';

import type { Locale, UpdateSettingsInput } from '@autoc/shared';
import { BadgeCheck, CarFront, FileText, Flag, LogOut, MonitorSmartphone, Phone, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { LanguageSwitcher } from '@/components/shell/language-switcher';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ListGroup, ListItem } from '@/components/ui/list-item';
import { PageHeader } from '@/components/ui/page-header';
import { useErrorMessage } from '@/hooks/use-error-message';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-provider';
import { useCurrentUser } from '@/lib/auth/guards';
import { formatKzPhone, fromE164 } from '@/lib/phone-mask';
import { notify } from '@/lib/toast';
import { useUpdateMe, useUpdateSettings } from '@/features/profile/queries';
import { LinkPhoneDialog } from './link-phone-dialog';
import { PrivacyModePicker } from './privacy-mode-picker';
import { PushRow } from './push-row';
import { ReceiveSosRow } from './receive-sos-row';

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 px-1">
        <h2 id={id} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsView() {
  const t = useTranslations('settings');
  const me = useCurrentUser();
  const errorMessage = useErrorMessage();
  const settings = useUpdateSettings();
  const updateMe = useUpdateMe();

  function save(input: UpdateSettingsInput) {
    settings.mutate(input, {
      onSuccess: () => notify.success(t('saved')),
      onError: (error) => notify.error(errorMessage(error), { retry: { label: t('retry'), onClick: () => save(input) } }),
    });
  }

  function saveLocale(locale: Locale) {
    // The cookie already switched the UI; the profile copy is for server-sent texts (SMS, push).
    updateMe.mutate({ locale }, { onError: (error) => notify.error(errorMessage(error)) });
  }

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-10">
      <PageHeader title={t('title')} />

      <Section id="settings-privacy" title={t('privacy.title')} description={t('privacy.description')}>
        <PrivacyModePicker value={me.privacyMode} onChange={(privacyMode) => save({ privacyMode })} labelledBy="settings-privacy" />
        <ReceiveSosRow checked={me.receiveSos} onCheckedChange={(receiveSos) => save({ receiveSos })} />
      </Section>

      <Section id="settings-notifications" title={t('push.title')} description={t('push.description')}>
        <PushRow />
      </Section>

      <Section id="settings-appearance" title={t('appearance.title')}>
        <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t('appearance.language')}</p>
            <LanguageSwitcher variant="segmented" onLocaleChange={saveLocale} />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t('appearance.theme')}</p>
            <ThemeToggle variant="segmented" />
          </div>
        </div>
      </Section>

      <PhoneSection />
      <SessionsSection />

      <Section id="settings-reports" title={t('reports.title')}>
        <ListGroup>
          <ListItem
            href="/settings/reports"
            leading={<Flag aria-hidden="true" className="size-5 text-muted-foreground" />}
            title={t('reports.mine')}
            description={t('reports.hint')}
          />
          <ListItem
            href="/settings/violations"
            leading={<CarFront aria-hidden="true" className="size-5 text-muted-foreground" />}
            title={t('reports.violations')}
            description={t('reports.violationsHint')}
          />
        </ListGroup>
      </Section>

      <Section id="settings-legal" title={t('legal.title')}>
        <ListGroup>
          <ListItem href="/legal/privacy" leading={<ShieldCheck aria-hidden="true" className="size-5 text-muted-foreground" />} title={t('legal.privacy')} />
          <ListItem href="/legal/terms" leading={<FileText aria-hidden="true" className="size-5 text-muted-foreground" />} title={t('legal.terms')} />
        </ListGroup>
      </Section>

      <DeleteAccountSection />
    </div>
  );
}

function PhoneSection() {
  const t = useTranslations('settings.phone');
  const me = useCurrentUser();
  const [open, setOpen] = useState(false);
  const verified = me.phone !== null && me.phoneVerified;

  return (
    <Section id="settings-phone" title={t('title')} description={verified ? undefined : t('missing')}>
      <ListGroup>
        <ListItem
          leading={<Phone aria-hidden="true" className="size-5 text-muted-foreground" />}
          title={me.phone ? <span className="tabular-nums">{formatKzPhone(fromE164(me.phone)) || me.phone}</span> : t('none')}
          description={
            verified ? (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="success" size="sm">
                  <BadgeCheck aria-hidden="true" />
                  {t('verified')}
                </Badge>
                {t('verifiedHint')}
              </span>
            ) : undefined
          }
          trailing={
            verified ? undefined : (
              <Button size="sm" onClick={() => setOpen(true)}>
                {t('link')}
              </Button>
            )
          }
        />
      </ListGroup>
      {verified ? null : <LinkPhoneDialog open={open} onOpenChange={setOpen} />}
    </Section>
  );
}

function SessionsSection() {
  const t = useTranslations('settings.sessions');
  const { logout, logoutAll } = useAuth();
  const errorMessage = useErrorMessage();
  const [loggingOut, setLoggingOut] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  return (
    <Section id="settings-sessions" title={t('title')} description={t('description')}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="outline"
          leadingIcon={<LogOut aria-hidden="true" />}
          loading={loggingOut}
          onClick={async () => {
            setLoggingOut(true);
            await logout();
          }}
        >
          {t('logout')}
        </Button>
        <Button variant="outline" leadingIcon={<MonitorSmartphone aria-hidden="true" />} onClick={() => setConfirmAll(true)}>
          {t('logoutAll')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t('logoutAllTitle')}
        description={t('logoutAllDescription')}
        confirmLabel={t('logoutAll')}
        onConfirm={async () => {
          try {
            await logoutAll();
            notify.success(t('loggedOutAll'));
          } catch (error) {
            notify.error(errorMessage(error));
            throw error;
          }
        }}
      />
    </Section>
  );
}

const DELETE_WORD = 'DELETE';

function DeleteAccountSection() {
  const t = useTranslations('settings.delete');
  const { forgetSession, expectSessionEnd } = useAuth();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  return (
    <Section id="settings-delete" title={t('title')} description={t('description')}>
      <div>
        <Button
          variant="danger"
          leadingIcon={<Trash2 aria-hidden="true" />}
          onClick={() => {
            setTyped('');
            setOpen(true);
          }}
        >
          {t('action')}
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title={t('confirmTitle')}
        description={t('confirmDescription')}
        confirmLabel={t('confirmAction')}
        confirmDisabled={typed.trim() !== DELETE_WORD}
        onConfirm={async () => {
          expectSessionEnd('/');
          try {
            await api.me.remove();
          } catch (error) {
            expectSessionEnd(null);
            notify.error(errorMessage(error));
            throw error;
          }
          forgetSession('/');
          notify.success(t('done'));
        }}
      >
        <FormField label={t('typeLabel', { word: DELETE_WORD })}>
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </FormField>
      </ConfirmDialog>
    </Section>
  );
}
