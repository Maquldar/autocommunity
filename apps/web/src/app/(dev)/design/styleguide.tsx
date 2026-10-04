'use client';

import { CAR_BRANDS, CITIES, type Paginated, type PrivacyMode } from '@autoc/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Car,
  EyeOff,
  Flag,
  Globe,
  Heart,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { AccountMenu } from '@/components/shell/account-menu';
import { AppShell } from '@/components/shell/app-shell';
import { LanguageSwitcher } from '@/components/shell/language-switcher';
import { NotificationBell } from '@/components/shell/notification-bell';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Avatar } from '@/components/ui/avatar';
import { Badge, CountBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmergencyCallButton } from '@/components/ui/emergency-call-button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { InfiniteList } from '@/components/ui/infinite-list';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListGroup, ListItem } from '@/components/ui/list-item';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { OtpInput } from '@/components/ui/otp-input';
import { PageHeader } from '@/components/ui/page-header';
import { PhoneInput } from '@/components/ui/phone-input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioCard, RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { RatingBadge } from '@/components/ui/rating-badge';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { CardSkeleton, ListItemSkeleton, Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';

const SECTIONS = [
  'colors',
  'typography',
  'buttons',
  'badges',
  'avatars',
  'forms',
  'auth',
  'selection',
  'tabs',
  'overlays',
  'lists',
  'states',
  'infinite',
  'sos',
  'shell',
] as const;
type SectionKey = (typeof SECTIONS)[number];

const COLOR_GROUPS: Array<{ name: string; tokens: string[] }> = [
  { name: 'Neutral', tokens: ['background', 'card', 'muted', 'accent', 'border', 'input', 'foreground', 'muted-foreground'] },
  { name: 'Brand', tokens: ['primary', 'primary-hover', 'primary-soft', 'primary-soft-foreground', 'secondary', 'ring'] },
  { name: 'SOS / danger', tokens: ['sos', 'sos-hover', 'sos-soft', 'sos-soft-foreground', 'danger', 'danger-soft'] },
  { name: 'Status', tokens: ['success', 'success-soft', 'warning', 'warning-soft'] },
  {
    name: 'Trust',
    tokens: ['trust-low', 'trust-low-soft', 'trust-medium', 'trust-medium-soft', 'trust-high', 'trust-high-soft'],
  },
  { name: 'Avatar', tokens: Array.from({ length: 8 }, (_, i) => `avatar-${i + 1}`) },
];

const PRIVACY_ICONS: Record<PrivacyMode, LucideIcon> = {
  hidden: EyeOff,
  community: UsersRound,
  friends: Heart,
  everyone: Globe,
};

const DEMO_USER = { id: 'b3c1d9e0-demo-user', nickname: 'asset', avatarUrl: null, rating: 74 };
const AVATAR_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b8cff"/><stop offset="1" stop-color="#0f766e"/></linearGradient></defs><rect width="80" height="80" fill="url(#g)"/><circle cx="40" cy="32" r="14" fill="#fff" opacity=".9"/><rect x="16" y="52" width="48" height="30" rx="15" fill="#fff" opacity=".9"/></svg>',
  );

export function Styleguide() {
  const t = useTranslations();
  const d = useTranslations('styleguide.demo');

  return (
    <AppShell
      title={t('styleguide.title')}
      actions={<ThemeToggle />}
      notificationSlot={<NotificationBell count={3} onClick={() => notify.info(d('toastInfoText'))} />}
      accountSlot={<AccountMenu user={{ ...DEMO_USER, name: d('demoUser') }} onLogout={() => notify.info(t('common.logout'))} />}
    >
      <PageHeader title={t('styleguide.title')} description={t('styleguide.intro')} />

      <nav aria-label={t('styleguide.contents')} className="mb-8">
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((key) => (
            <li key={key}>
              <a
                href={`#${key}`}
                className="inline-flex h-9 items-center rounded-full border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-ring"
              >
                {t(`styleguide.sections.${key}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-14">
        <ColorsSection />
        <TypographySection />
        <ButtonsSection />
        <BadgesSection />
        <AvatarsSection />
        <FormsSection />
        <AuthSection />
        <SelectionSection />
        <TabsSection />
        <OverlaysSection />
        <ListsSection />
        <StatesSection />
        <InfiniteSection />
        <SosSection />
        <ShellSection />
      </div>
    </AppShell>
  );
}

function Section({ id, children, note }: { id: SectionKey; children: ReactNode; note?: ReactNode }) {
  const t = useTranslations('styleguide.sections');
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div className="mb-5 flex flex-col gap-1 border-b pb-3">
        <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
          {t(id)}
        </h2>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Demo({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
      <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- colours */

function ColorsSection() {
  const d = useTranslations('styleguide.demo');
  return (
    <Section id="colors" note={d('tokensNote')}>
      {COLOR_GROUPS.map((group) => (
        <Demo key={group.name} label={group.name} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {group.tokens.map((token) => (
            <div key={token} className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="size-10 shrink-0 rounded-lg ring-1 ring-inset ring-black/10 dark:ring-white/15"
                style={{ background: `var(--${token})` }}
              />
              <code className="min-w-0 truncate text-xs text-muted-foreground">{token}</code>
            </div>
          ))}
        </Demo>
      ))}
    </Section>
  );
}

/* ------------------------------------------------------------- typography */

function TypographySection() {
  const d = useTranslations('styleguide.demo');
  const rows: Array<{ token: string; className: string; text: string }> = [
    { token: 'display · 30/36 bold', className: 'text-3xl font-bold tracking-tight', text: d('typeDisplay') },
    { token: 'title · 24/32 semibold', className: 'text-2xl font-semibold tracking-tight', text: d('typeTitle') },
    { token: 'heading · 18/28 semibold', className: 'text-lg font-semibold', text: d('typeHeading') },
    { token: 'body · 15/22', className: 'text-[0.9375rem] leading-[1.375rem]', text: d('typeBody') },
    { token: 'small · 14/20', className: 'text-sm text-muted-foreground', text: d('typeSmall') },
    { token: 'caption · 12/16 semibold caps', className: 'text-xs font-semibold tracking-wide text-muted-foreground', text: d('typeCaption') },
  ];
  return (
    <Section id="typography">
      <Card padding="none" className="divide-y overflow-hidden">
        {rows.map((row) => (
          <div key={row.token} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:gap-6">
            <code className="w-56 shrink-0 text-xs text-muted-foreground">{row.token}</code>
            <p className={cn('min-w-0', row.className)}>{row.text}</p>
          </div>
        ))}
      </Card>
    </Section>
  );
}

/* ---------------------------------------------------------------- buttons */

function ButtonsSection() {
  const d = useTranslations('styleguide.demo');
  const tc = useTranslations('common');
  const [loading, setLoading] = useState(false);
  function simulate() {
    setLoading(true);
    setTimeout(() => setLoading(false), 2000);
  }
  return (
    <Section id="buttons">
      <Demo label="Variants">
        <Button>{d('primary')}</Button>
        <Button variant="secondary">{d('secondary')}</Button>
        <Button variant="outline">{d('outline')}</Button>
        <Button variant="ghost">{d('ghost')}</Button>
        <Button variant="danger" leadingIcon={<Trash2 aria-hidden="true" />}>
          {d('danger')}
        </Button>
        <Button variant="link">{d('link')}</Button>
      </Demo>
      <Demo label="Sizes">
        <Button size="sm">{d('small')}</Button>
        <Button size="md">{d('medium')}</Button>
        <Button size="lg">{d('large')}</Button>
        <Button size="xl">{d('xlarge')}</Button>
      </Demo>
      <Demo label="States">
        <Button leadingIcon={<Plus aria-hidden="true" />}>{d('withIcon')}</Button>
        <Button loading>{d('loading')}</Button>
        <Button variant="secondary" loading>
          {d('loading')}
        </Button>
        <Button disabled>{d('disabled')}</Button>
        <Button variant="outline" disabled>
          {d('disabled')}
        </Button>
        <Button variant="outline" loading={loading} onClick={simulate}>
          {d('loadingToggle')}
        </Button>
        <Button asChild variant="secondary">
          <a href="#buttons">{d('asLink')}</a>
        </Button>
      </Demo>
      <Demo label="Full width (mobile forms)">
        <div className="w-full max-w-sm">
          <Button fullWidth size="lg">
            {tc('continue')}
          </Button>
        </div>
      </Demo>
      <Demo label="IconButton">
        <IconButton aria-label={d('menuEdit')}>
          <Pencil />
        </IconButton>
        <IconButton aria-label={d('menuShare')} variant="secondary">
          <Share2 />
        </IconButton>
        <IconButton aria-label={d('menuEdit')} variant="outline">
          <SlidersHorizontal />
        </IconButton>
        <IconButton aria-label={d('withIcon')} variant="primary">
          <Plus />
        </IconButton>
        <IconButton aria-label={d('menuDelete')} variant="danger">
          <Trash2 />
        </IconButton>
        <IconButton aria-label={d('loading')} variant="secondary" loading>
          <Search />
        </IconButton>
        <IconButton aria-label={d('small')} size="sm">
          <MoreHorizontal />
        </IconButton>
        <IconButton aria-label={d('large')} size="lg" variant="secondary">
          <Car />
        </IconButton>
      </Demo>
    </Section>
  );
}

/* ----------------------------------------------------------------- badges */

function BadgesSection() {
  const d = useTranslations('styleguide.demo');
  return (
    <Section id="badges">
      <Demo label="Badge">
        <Badge>{d('neutral')}</Badge>
        <Badge variant="primary">{d('info')}</Badge>
        <Badge variant="success">{d('success')}</Badge>
        <Badge variant="warning">{d('warning')}</Badge>
        <Badge variant="danger">{d('error')}</Badge>
        <Badge variant="outline">{d('neutral')}</Badge>
        <Badge variant="sos">{d('activeSos')}</Badge>
        <Badge size="sm" variant="primary">
          sm
        </Badge>
      </Demo>
      <Demo label="CountBadge">
        <CountBadge count={1} />
        <CountBadge count={12} />
        <CountBadge count={240} />
      </Demo>
      <Demo label="RatingBadge · 0–29 low · 30–69 medium · 70–100 high">
        <RatingBadge rating={12} />
        <RatingBadge rating={29} />
        <RatingBadge rating={30} />
        <RatingBadge rating={50} />
        <RatingBadge rating={70} />
        <RatingBadge rating={96} />
      </Demo>
      <Demo label="RatingBadge · sizes & label">
        <RatingBadge rating={18} size="sm" showLabel />
        <RatingBadge rating={55} size="md" showLabel />
        <RatingBadge rating={88} size="lg" showLabel />
      </Demo>
    </Section>
  );
}

/* ---------------------------------------------------------------- avatars */

function AvatarsSection() {
  const names = ['Асет Улымадияр', 'Aidana K.', 'Данияр', 'Ержан Сейткали', 'Maria Ivanova', 'nomad_77', 'Ли Вэй', 'Gulnar B.'];
  return (
    <Section id="avatars">
      <Demo label="Sizes (xs → xl)">
        {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
          <Avatar key={size} id="user-1" name="Асет Улымадияр" size={size} />
        ))}
      </Demo>
      <Demo label="Deterministic colour from id">
        {names.map((name, index) => (
          <Avatar key={name} id={`user-${index * 7 + 3}`} name={name} size="lg" />
        ))}
      </Demo>
      <Demo label="Image · square (communities)">
        <Avatar id="user-1" name="Asset" src={AVATAR_IMAGE} size="lg" />
        <Avatar id="community-4x4" name="Almaty 4x4 Club" size="lg" shape="square" />
        <Avatar id="community-toyota" name="Toyota Club" src={AVATAR_IMAGE} size="lg" shape="square" />
      </Demo>
    </Section>
  );
}

/* ------------------------------------------------------------------ forms */

function FormsSection() {
  const t = useTranslations('common');
  const d = useTranslations('styleguide.demo');
  const [bio, setBio] = useState('');
  const [city, setCity] = useState<string>('');
  return (
    <Section id="forms">
      <Card className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField label={d('nickname')} hint={d('nicknameHint')} required>
          <Input placeholder={d('nicknamePlaceholder')} autoComplete="username" />
        </FormField>
        <FormField label={d('nickname')} error={d('nicknameTaken')} required>
          <Input defaultValue="asset" />
        </FormField>
        <FormField label={d('plate')} hint={d('plateHint')}>
          <Input placeholder="123 ABC 02" className="uppercase" />
        </FormField>
        <FormField label={d('readOnly')}>
          <Input value="+7 701 *** ** 67" disabled readOnly />
        </FormField>
        <FormField label={d('city')}>
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger>
              <SelectValue placeholder={d('cityPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {CITIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label={t('search')}>
          <Input type="search" placeholder="Toyota, 4x4, Алматы…" />
        </FormField>
        <FormField label={d('bio')} className="sm:col-span-2">
          <Textarea
            showCount
            maxLength={300}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder={d('bioPlaceholder')}
          />
        </FormField>
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <Button variant="ghost">{d('secondary')}</Button>
          <Button>{d('primary')}</Button>
        </div>
      </Card>
    </Section>
  );
}

/* ------------------------------------------------------------ phone & OTP */

function AuthSection() {
  const t = useTranslations();
  const d = useTranslations('styleguide.demo');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [completed, setCompleted] = useState<string | null>(null);
  return (
    <Section id="auth">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <FormField label={t('phone.label')} hint={t('phone.hint')} required>
            <PhoneInput value={phone} onChange={setPhone} />
          </FormField>
          <p className="text-sm text-muted-foreground">
            {d('phoneOutput')}: <code className="font-mono text-foreground">{JSON.stringify(phone)}</code>
          </p>
        </Card>
        <Card className="flex flex-col gap-4">
          <FormField
            label={t('otp.label')}
            error={code.length > 0 && code.length < 6 ? t('form.invalidCode') : undefined}
          >
            <OtpInput
              value={code}
              onChange={(next) => {
                setCode(next);
                if (next.length < 6) setCompleted(null);
              }}
              onComplete={setCompleted}
            />
          </FormField>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {completed ? (
              <span className="font-medium text-success">{d('otpComplete', { code: completed })}</span>
            ) : (
              <>
                {d('otpOutput')}: <code className="font-mono text-foreground">{JSON.stringify(code)}</code>
              </>
            )}
          </p>
        </Card>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------- selection controls */

function SelectionSection() {
  const t = useTranslations();
  const d = useTranslations('styleguide.demo');
  const [privacy, setPrivacy] = useState<PrivacyMode>('community');
  const [receiveSos, setReceiveSos] = useState(true);
  const modes: PrivacyMode[] = ['hidden', 'community', 'friends', 'everyone'];
  return (
    <Section id="selection">
      <Demo label={`RadioCard — ${t('privacy.label')}`} className="block">
        <RadioGroup
          aria-label={t('privacy.label')}
          value={privacy}
          onValueChange={(value) => setPrivacy(value as PrivacyMode)}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {modes.map((mode) => (
            <RadioCard
              key={mode}
              value={mode}
              icon={PRIVACY_ICONS[mode]}
              title={t(`privacy.${mode}.title`)}
              description={t(`privacy.${mode}.description`)}
              aside={
                mode === 'community' ? (
                  <Badge size="sm" variant="neutral">
                    {d('recommended')}
                  </Badge>
                ) : null
              }
            />
          ))}
        </RadioGroup>
      </Demo>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Demo label="RadioGroup" className="block">
          <RadioGroup defaultValue="5" aria-label={d('radioLabel')}>
            {(['5', '10', '20'] as const).map((km) => (
              <div key={km} className="flex min-h-11 items-center gap-3">
                <RadioGroupItem value={km} id={`radius-${km}`} />
                <Label htmlFor={`radius-${km}`}>{d(`radio${km}`)}</Label>
              </div>
            ))}
            <div className="flex min-h-11 items-center gap-3">
              <RadioGroupItem value="50" id="radius-50" disabled />
              <Label htmlFor="radius-50">50 km · {d('disabled')}</Label>
            </div>
          </RadioGroup>
        </Demo>

        <Demo label="Switch" className="block">
          <div className="flex flex-col gap-1">
            <div className="flex min-h-11 items-center justify-between gap-4">
              <Label htmlFor="sw-sos">{d('receiveSos')}</Label>
              <Switch id="sw-sos" checked={receiveSos} onCheckedChange={setReceiveSos} />
            </div>
            <div className="flex min-h-11 items-center justify-between gap-4">
              <Label htmlFor="sw-loc">{d('shareLocation')}</Label>
              <Switch id="sw-loc" />
            </div>
            <div className="flex min-h-11 items-center justify-between gap-4">
              <Label htmlFor="sw-push">{d('notificationsSwitch')}</Label>
              <Switch id="sw-push" disabled defaultChecked />
            </div>
          </div>
        </Demo>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------- tabs */

function TabsSection() {
  const d = useTranslations('styleguide.demo');
  const panels = [
    { value: 'all', label: d('tabsAll'), content: d('tabsAllContent') },
    { value: 'mine', label: d('tabsMine'), content: d('tabsMineContent') },
    { value: 'nearby', label: d('tabsNearby'), content: d('tabsNearbyContent') },
  ];
  return (
    <Section id="tabs">
      {(['segmented', 'underline'] as const).map((variant) => (
        <Demo key={variant} label={variant} className="block">
          <Tabs defaultValue="all">
            <TabsList variant={variant}>
              {panels.map((panel) => (
                <TabsTrigger key={panel.value} value={panel.value}>
                  {panel.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {panels.map((panel) => (
              <TabsContent key={panel.value} value={panel.value}>
                <p className="text-[0.9375rem] text-muted-foreground">{panel.content}</p>
              </TabsContent>
            ))}
          </Tabs>
        </Demo>
      ))}
    </Section>
  );
}

/* --------------------------------------------------------------- overlays */

function OverlaysSection() {
  const t = useTranslations();
  const d = useTranslations('styleguide.demo');
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <Section id="overlays">
      <Demo label="Dialog · Sheet · ConfirmDialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">{d('openDialog')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{d('dialogTitle')}</DialogTitle>
              <DialogDescription>{d('dialogDescription')}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-4">
              <FormField label={d('brand')} required>
                <Input placeholder="Toyota" />
              </FormField>
              <FormField label={d('model')} required>
                <Input placeholder="Camry" />
              </FormField>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">{t('common.cancel')}</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button>{t('common.save')}</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" leadingIcon={<SlidersHorizontal aria-hidden="true" />}>
              {d('openSheet')}
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{d('sheetTitle')}</SheetTitle>
              <SheetDescription>{d('sheetDescription')}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col">
              {[d('tabsMine'), d('listGroup'), 'Toyota', 'Lexus'].map((label, index) => (
                <div key={label} className="flex min-h-12 items-center justify-between gap-4 border-b last:border-b-0">
                  <Label htmlFor={`filter-${index}`}>{label}</Label>
                  <Switch id={`filter-${index}`} defaultChecked={index === 0} />
                </div>
              ))}
            </div>
            <SheetFooter>
              <Button fullWidth size="lg">
                {t('common.done')}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          {d('openConfirm')}
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          tone="danger"
          title={d('confirmTitle')}
          description={d('confirmDescription')}
          confirmLabel={d('confirmAction')}
          onConfirm={async () => {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            notify.success(d('deleted'));
          }}
        />
      </Demo>

      <Demo label="DropdownMenu · Popover">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label={d('openMenu')} variant="outline">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem>
              <Pencil aria-hidden="true" />
              {d('menuEdit')}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Share2 aria-hidden="true" />
              {d('menuShare')}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Flag aria-hidden="true" />
              {d('menuReport')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive>
              <Trash2 aria-hidden="true" />
              {d('menuDelete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="link">{d('openPopover')}</Button>
          </PopoverTrigger>
          <PopoverContent align="start">
            <div className="flex flex-col gap-2">
              <RatingBadge rating={30} showLabel />
              <p className="text-sm">{d('popoverBody')}</p>
            </div>
          </PopoverContent>
        </Popover>
      </Demo>

      <Demo label="Toasts">
        <Button variant="secondary" onClick={() => notify.success(d('toastSaved'))}>
          {d('toastSuccess')}
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            notify.error(d('toastFailed'), {
              retry: { label: t('common.retry'), onClick: () => notify.success(d('errorRetried')) },
            })
          }
        >
          {d('toastError')}
        </Button>
        <Button variant="secondary" onClick={() => notify.info(d('toastInfoText'))}>
          {d('toastInfo')}
        </Button>
      </Demo>
    </Section>
  );
}

/* ------------------------------------------------------------------ lists */

function ListsSection() {
  const d = useTranslations('styleguide.demo');
  const [sos, setSos] = useState(true);
  return (
    <Section id="lists">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ListGroup label={d('listGroup')}>
          <ListItem
            leading={<Avatar id="user-aidana" name={d('listTitle')} decorative />}
            title={d('listTitle')}
            description={d('listDescription')}
            trailing={<RatingBadge rating={82} size="sm" />}
            onClick={() => notify.info(d('listTitle'))}
          />
          <ListItem
            leading={<Avatar id="community-4x4" name={d('listTitle2')} shape="square" decorative />}
            title={d('listTitle2')}
            description={d('listDescription2')}
            trailing={<CountBadge count={4} />}
            onClick={() => notify.info(d('listTitle2'))}
          />
          <ListItem
            leading={<Avatar id="user-x" name="Данияр" decorative />}
            title="Данияр"
            description="Lada Vesta"
            trailing={<RatingBadge rating={24} size="sm" />}
          />
        </ListGroup>
        <ListGroup label={d('listSettings')}>
          <ListItem
            leading={
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                <Car aria-hidden="true" className="size-5" />
              </span>
            }
            title="Toyota Camry · 2019"
            description={d('plateHint')}
            onClick={() => undefined}
          />
          <div className="flex min-h-16 items-center gap-3 px-4 py-3">
            <Label htmlFor="list-sos" className="flex-1 text-[0.9375rem]">
              {d('listStatic')}
              <span className="block text-sm font-normal text-muted-foreground">{d('receiveSosHint')}</span>
            </Label>
            <Switch id="list-sos" checked={sos} onCheckedChange={setSos} />
          </div>
        </ListGroup>
      </div>
    </Section>
  );
}

/* ----------------------------------------------------------------- states */

function StatesSection() {
  const t = useTranslations();
  const d = useTranslations('styleguide.demo');
  const [retrying, setRetrying] = useState(false);
  return (
    <Section id="states">
      <Demo label={d('skeletons')} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border bg-card [&>*+*]:border-t" aria-busy="true">
          <span className="sr-only">{t('states.loading')}</span>
          <ListItemSkeleton />
          <ListItemSkeleton />
          <ListItemSkeleton />
        </div>
        <CardSkeleton withMedia />
      </Demo>
      <Demo label="Skeleton primitives">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-11 w-32 rounded-lg" />
      </Demo>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card padding="none">
          <EmptyState
            icon={UsersRound}
            title={d('emptyTitle')}
            description={d('emptyDescription')}
            action={<Button leadingIcon={<Search aria-hidden="true" />}>{d('emptyAction')}</Button>}
          />
        </Card>
        <Card padding="none">
          <ErrorState
            retrying={retrying}
            onRetry={() => {
              setRetrying(true);
              setTimeout(() => setRetrying(false), 1500);
            }}
          />
        </Card>
      </div>
      <Demo label="ErrorState · compact">
        <Card padding="none" className="w-full">
          <ErrorState compact title={t('errors.loadMoreFailed')} onRetry={() => notify.info(d('errorRetried'))} />
        </Card>
      </Demo>
      <Demo label={d('offlineDemo')} className="block">
        <div className="overflow-hidden rounded-xl">
          <OfflineBanner forceVisible />
        </div>
      </Demo>
      <Demo label={d('spinner')}>
        <Spinner size="sm" />
        <Spinner />
        <Spinner size="lg" className="text-primary" />
      </Demo>
    </Section>
  );
}

/* ---------------------------------------------------------- infinite list */

type DemoDriver = { id: string; n: number; brand: string; rating: number };
type Scenario = 'normal' | 'empty' | 'error';
const BRANDS = Object.keys(CAR_BRANDS);
const PAGE_SIZE = 8;
const TOTAL_PAGES = 4;

/** In-memory paginated "API" with latency so every state of InfiniteList is exercised for real. */
async function fetchDrivers(scenario: Scenario, cursor: number): Promise<Paginated<DemoDriver>> {
  await new Promise((resolve) => setTimeout(resolve, 700));
  if (scenario === 'error') throw new Error('Demo failure');
  if (scenario === 'empty') return { items: [], nextCursor: null };
  const items = Array.from({ length: PAGE_SIZE }, (_, i) => {
    const n = cursor * PAGE_SIZE + i + 1;
    return { id: `driver-${n}`, n, brand: BRANDS[n % BRANDS.length] ?? 'Toyota', rating: (n * 37) % 101 };
  });
  return { items, nextCursor: cursor + 1 < TOTAL_PAGES ? String(cursor + 1) : null };
}

function InfiniteSection() {
  const d = useTranslations('styleguide.demo');
  const [scenario, setScenario] = useState<Scenario>('normal');
  const query = useInfiniteQuery({
    queryKey: ['styleguide', 'drivers', scenario],
    queryFn: ({ pageParam }) => fetchDrivers(scenario, Number(pageParam)),
    initialPageParam: '0',
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
  return (
    <Section id="infinite">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className="text-sm font-medium">
          {d('infiniteScenario')}
        </span>
        <SegmentedControl
          label={d('infiniteScenario')}
          value={scenario}
          onValueChange={setScenario}
          className="w-full max-w-sm"
          options={[
            { value: 'normal', label: d('infiniteNormal') },
            { value: 'empty', label: d('infiniteEmpty') },
            { value: 'error', label: d('infiniteError') },
          ]}
        />
      </div>
      <InfiniteList
        query={query}
        label={d('infiniteLabel')}
        getKey={(driver) => driver.id}
        skeleton={<ListItemSkeleton />}
        skeletonCount={4}
        className="overflow-hidden rounded-2xl border bg-card"
        listClassName="[&>li+li]:border-t"
        empty={
          <EmptyState icon={UsersRound} title={d('infiniteEmptyTitle')} description={d('infiniteEmptyDescription')} />
        }
        renderItem={(driver) => (
          <ListItem
            leading={<Avatar id={driver.id} name={d('infiniteItem', { n: driver.n })} decorative />}
            title={d('infiniteItem', { n: driver.n })}
            description={d('infiniteItemDescription', { brand: driver.brand, rating: driver.rating })}
            trailing={<RatingBadge rating={driver.rating} size="sm" />}
          />
        )}
      />
    </Section>
  );
}

/* -------------------------------------------------------------------- SOS */

function SosSection() {
  const t = useTranslations();
  const d = useTranslations('styleguide.demo');
  return (
    <Section id="sos" note={d('sosNote')}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Demo label="Button variant=sos" className="block">
            <Button variant="sos" size="xl" fullWidth>
              {d('sosRequest')}
            </Button>
          </Demo>
          <Demo label="EmergencyCallButton" className="flex-col items-stretch">
            <EmergencyCallButton />
            <div>
              <EmergencyCallButton variant="compact" />
            </div>
          </Demo>
          <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">{t('emergency.disclaimer')}</p>
        </div>

        <Demo label="SOS alert card" className="block">
          <Card padding="none" className="overflow-hidden border-sos/40">
            <div className="flex items-center gap-2 bg-sos-soft px-4 py-2.5 text-sm font-semibold text-sos-soft-foreground">
              <span aria-hidden="true" className="size-2.5 animate-sos-pulse rounded-full bg-sos" />
              {d('activeSos')}
            </div>
            <div className="flex flex-col gap-4 p-4">
              <CardHeader>
                <div className="flex items-start gap-3">
                  <Avatar id="user-aidana" name={d('listTitle')} size="lg" decorative />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <CardTitle>{d('sosAlertTitle')}</CardTitle>
                    <CardDescription>{d('sosAlertBody')}</CardDescription>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-sm font-medium">{d('listTitle')}</span>
                      <RatingBadge rating={82} size="sm" />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="mt-0">
                <p className="text-sm text-muted-foreground">{d('listDescription')}</p>
              </CardContent>
              <CardFooter className="mt-0 grid grid-cols-[1fr_auto] gap-2">
                <Button size="lg">{d('sosHelp')}</Button>
                <EmergencyCallButton variant="compact" className="h-12" />
              </CardFooter>
            </div>
          </Card>
        </Demo>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ shell */

function ShellSection() {
  const t = useTranslations();
  const d = useTranslations('styleguide.demo');
  return (
    <Section id="shell">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Demo label={t('theme.label')} className="block">
          <ThemeToggle variant="segmented" />
        </Demo>
        <Demo label={t('language.label')} className="block">
          <LanguageSwitcher variant="segmented" />
        </Demo>
      </div>
      <Demo label="Menu variants · NotificationBell · AccountMenu">
        <ThemeToggle />
        <LanguageSwitcher />
        <NotificationBell count={0} onClick={() => undefined} />
        <NotificationBell count={7} onClick={() => undefined} />
        <AccountMenu user={{ ...DEMO_USER, name: d('demoUser') }} onLogout={() => notify.info(t('common.logout'))} />
      </Demo>
      <Demo label="PageHeader" className="block">
        <Card>
          <PageHeader
            back
            title={d('pageHeaderTitle')}
            description={d('pageHeaderDescription')}
            actions={
              <IconButton aria-label={d('menuShare')}>
                <Share2 />
              </IconButton>
            }
            headingLevel={2}
            className="pb-0 pt-0"
          />
        </Card>
      </Demo>
    </Section>
  );
}
