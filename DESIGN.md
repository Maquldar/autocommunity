# AutoCommunity — Design System

Companion to `SPEC.md` / `ARCHITECTURE.md`. Everything here is implemented in `apps/web`:

| What | Where |
|---|---|
| Tokens (colour, radius, shadow, z-index, motion, safe areas) | `apps/web/src/app/globals.css` |
| UI primitives | `apps/web/src/components/ui/*` |
| App shell, nav config, theme/language switchers | `apps/web/src/components/shell/*` |
| Strings (ru default, en) | `apps/web/messages/{ru,en}.json` |
| Live styleguide (QA every component, both themes) | **`/design`** (`src/app/(dev)/design`) |
| Contrast check | `pnpm --filter @autoc/web check:contrast` (`scripts/check-contrast.mjs`) |
| Icon generation | `pnpm --filter @autoc/web icons` (`scripts/generate-icons.mjs`) |
| Screenshots (390×844, 1280×800, light/dark) | `pnpm --filter @autoc/web screenshots` with the server running |

If code and this file disagree, the code (and `/design`) wins. Fix this file in the same change.

---

## 1. Principles

1. **Calm by default, loud only for emergencies.** Graphite neutrals and one blue accent. SOS red appears only when something is actually wrong on the road, so it keeps its meaning.
2. **One-handed, outdoors, in a hurry.** Drivers use this at the roadside, in sunlight, sometimes with gloves. Touch targets are at least 44×44, primary actions sit at the bottom on phones, contrast is AA or better, and body text is never below 15px.
3. **Trust is visible.** Ratings, verification and privacy state always show colour **and** an icon or word, never colour alone.
4. **Honest states.** Every data view has loading (skeleton), empty (what to do next), error (retry) and offline states. Nothing spins forever and nothing fails silently.
5. **Privacy is a feature.** The UI says who can see what ("Only you and your friends can see it"). Plates and exact positions are never decoration.
6. **Russian first.** Russian strings run about 20–30% longer than English. Layouts wrap; buttons never truncate a verb.

---

## 2. Colour

Raw values are CSS variables on `:root` (light) and `.dark` (dark). `@theme inline` maps them to Tailwind utilities: `bg-primary`, `text-muted-foreground`, `border-input`, `bg-trust-high-soft`, and so on. **Never use raw hex or Tailwind palette colours (`bg-blue-600`) in feature code.**

The theme is the `class` strategy via `next-themes` (`light` / `dark` / `system`, default `system`). Meta `theme-color` follows `prefers-color-scheme` (`#f4f5f7` / `#0e1116`, `src/lib/theme-colors.ts`).

### 2.1 Tokens

| Group | Token | Light | Dark | Use |
|---|---|---|---|---|
| Surface | `background` | `#f4f5f7` | `#0e1116` | Page background (asphalt light / night) |
| | `card` | `#ffffff` | `#161a21` | Cards, lists, inputs, bottom bar |
| | `popover` | `#ffffff` | `#1b2028` | Menus, dialogs, sheets |
| | `muted` | `#eaecf0` | `#1f242d` | Tracks (segmented, tabs), icon tiles, disabled fields |
| | `accent` | `#e7eaef` | `#252b35` | Hover / highlighted rows and menu items |
| | `border` | `#dde1e7` | `#2a303a` | Hairlines, card borders (decorative, no contrast requirement) |
| | `input` | `#7d8695` | `#687284` | Form control borders, unchecked switch (≥3:1) |
| | `overlay` | 48% ink | 64% black | Scrim behind dialogs and sheets |
| Text | `foreground` | `#12161d` | `#e8ebf0` | Primary text |
| | `muted-foreground` | `#555e6c` | `#9ba4b2` | Secondary text, hints, captions |
| Brand | `primary` | `#1f5ae0` | `#7ba3ff` | Primary buttons, links, active nav, focus ring (`ring`) |
| | `primary-hover` | `#1a4cc0` | `#95b6ff` | Hover |
| | `primary-foreground` | `#ffffff` | `#0a1633` | Text on primary |
| | `primary-soft` / `-foreground` | `#e7eefd` / `#1a48b0` | `#1a2747` / `#b0c7ff` | Selected cards, info badges, active nav pill, empty-state icon tile |
| | `secondary` / `-hover` / `-foreground` | `#e4e7ec` / `#d7dbe2` / `#1b2029` | `#262c36` / `#303743` / `#e8ebf0` | Secondary buttons, skeleton base |
| **SOS** | `sos` / `sos-hover` / `sos-foreground` | `#d92a1f` / `#b8211a` / white | `#d42a20` / `#b5211a` / white | **SOS and emergency only** (§10) |
| | `sos-soft` / `sos-soft-foreground` | `#fdecea` / `#a3160f` | `#3a1513` / `#ffaaa3` | SOS banners. **Use `text-sos-soft-foreground` for SOS-coloured text** (plain `sos` is too light for small text on dark surfaces) |
| Danger | `danger` / `-hover` / `-foreground` | `#b42318` / `#971d14` / white | `#ff8a80` / `#ffa49c` / `#2b0705` | Destructive buttons, error text, invalid borders |
| | `danger-soft` / `-foreground` | `#fdf0ee` / `#8f1b12` | `#35171a` / `#ffb3ab` | Error banners, destructive menu-item hover |
| Status | `success` (+`-soft`, `-soft-foreground`, `-foreground`) | `#157a3b` | `#4cc67d` | Confirmed, online, verified visit |
| | `warning` (+ same set) | `#a35207` | `#f0a63a` | Pending moderation, near a limit |
| Trust | `trust-low` / `-soft` / `-foreground` | `#c2410c` / `#fdeee6` / `#96330a` | `#ff8f57` / `#33200f` / `#ffb68f` | Rating 0–29. **Orange, not red**, so low trust never reads as an emergency |
| | `trust-medium` (set) | `#a16207` / `#fbf3d9` / `#7a4a06` | `#efbf45` / `#2e2611` / `#f5d47f` | Rating 30–69 |
| | `trust-high` (set) | `#157a3b` / `#e6f5eb` / `#14622f` | `#4cc67d` / `#12291b` / `#8ee0ae` | Rating 70–100 |
| Avatar | `avatar-1` … `avatar-8` | blue, teal, violet, rust, olive, cyan, raspberry, slate | same | Initials fallback. White text ≥5.4:1 on each. No SOS red in the set |

Trust thresholds live in `src/lib/rating.ts`. `medium` starts at `RATING.sosHelpMin` (30), the minimum rating to respond to SOS, so a "low" badge also explains why someone can't help yet. `high` starts at 70.

### 2.2 Contrast (WCAG 2.1 AA)

Computed from the real CSS values by `scripts/check-contrast.mjs` (exit 1 on any failure). Text pairs need 4.5:1. Non-text UI (input borders, focus ring, the SOS button against the page, active icons) needs 3:1.

| Foreground | Background | Usage | Min | Light | Dark |
|---|---|---|---|---|---|
| `foreground` | `background` | Body text | 4.5 | 16.62 ✅ | 15.83 ✅ |
| `card-foreground` | `card` | Text on cards | 4.5 | 18.13 ✅ | 14.60 ✅ |
| `popover-foreground` | `popover` | Menus, popovers | 4.5 | 18.13 ✅ | 13.69 ✅ |
| `muted-foreground` | `background` | Secondary text | 4.5 | 6.01 ✅ | 7.52 ✅ |
| `muted-foreground` | `card` | Secondary text on cards | 4.5 | 6.55 ✅ | 6.93 ✅ |
| `muted-foreground` | `muted` | Secondary text on muted | 4.5 | 5.54 ✅ | 6.19 ✅ |
| `accent-foreground` | `accent` | Hovered menu item | 4.5 | 15.03 ✅ | 11.91 ✅ |
| `primary-foreground` | `primary` | Primary button | 4.5 | 5.84 ✅ | 7.25 ✅ |
| `primary-foreground` | `primary-hover` | Primary button hover | 4.5 | 7.40 ✅ | 8.86 ✅ |
| `primary` | `background` | Links on page | 4.5 | 5.35 ✅ | 7.68 ✅ |
| `primary` | `card` | Links on cards | 4.5 | 5.84 ✅ | 7.08 ✅ |
| `primary-soft-foreground` | `primary-soft` | Selected / info badge | 4.5 | 6.95 ✅ | 8.74 ✅ |
| `secondary-foreground` | `secondary` | Secondary button | 4.5 | 13.18 ✅ | 11.75 ✅ |
| `secondary-foreground` | `secondary-hover` | Secondary button hover | 4.5 | 11.76 ✅ | 10.02 ✅ |
| `sos-foreground` | `sos` | SOS button | 4.5 | 4.88 ✅ | 5.06 ✅ |
| `sos-foreground` | `sos-hover` | SOS button hover | 4.5 | 6.42 ✅ | 6.57 ✅ |
| `sos-soft-foreground` | `sos-soft` | SOS alert banner | 4.5 | 6.85 ✅ | 8.89 ✅ |
| `sos-soft-foreground` | `card` | SOS-coloured text on cards | 4.5 | 7.84 ✅ | 9.58 ✅ |
| `sos-soft-foreground` | `background` | SOS-coloured text on page | 4.5 | 7.19 ✅ | 10.38 ✅ |
| `danger-foreground` | `danger` | Danger button | 4.5 | 6.57 ✅ | 8.10 ✅ |
| `danger-foreground` | `danger-hover` | Danger button hover | 4.5 | 8.39 ✅ | 9.73 ✅ |
| `danger` | `card` | Error text on cards | 4.5 | 6.57 ✅ | 7.64 ✅ |
| `danger` | `background` | Error text on page | 4.5 | 6.03 ✅ | 8.28 ✅ |
| `danger-soft-foreground` | `danger-soft` | Error banner | 4.5 | 8.09 ✅ | 9.53 ✅ |
| `success-foreground` | `success` | Success solid | 4.5 | 5.41 ✅ | 7.94 ✅ |
| `success` | `card` | Success text | 4.5 | 5.41 ✅ | 8.04 ✅ |
| `success-soft-foreground` | `success-soft` | Success badge | 4.5 | 6.61 ✅ | 9.88 ✅ |
| `warning-foreground` | `warning` | Warning solid | 4.5 | 5.57 ✅ | 8.37 ✅ |
| `warning` | `card` | Warning text | 4.5 | 5.57 ✅ | 8.49 ✅ |
| `warning-soft-foreground` | `warning-soft` | Warning badge | 4.5 | 7.29 ✅ | 9.89 ✅ |
| `trust-low` | `card` | Trust low text | 4.5 | 5.18 ✅ | 7.74 ✅ |
| `trust-low-foreground` | `trust-low-soft` | Trust low badge | 4.5 | 6.68 ✅ | 9.11 ✅ |
| `trust-medium` | `card` | Trust medium text | 4.5 | 4.92 ✅ | 10.14 ✅ |
| `trust-medium-foreground` | `trust-medium-soft` | Trust medium badge | 4.5 | 6.74 ✅ | 10.42 ✅ |
| `trust-high` | `card` | Trust high text | 4.5 | 5.41 ✅ | 8.04 ✅ |
| `trust-high-foreground` | `trust-high-soft` | Trust high badge | 4.5 | 6.61 ✅ | 9.88 ✅ |
| `input` | `card` | Input border on card | 3 | 3.67 ✅ | 3.60 ✅ |
| `input` | `background` | Input border on page | 3 | 3.37 ✅ | 3.90 ✅ |
| `ring` | `background` | Focus ring on page | 3 | 5.35 ✅ | 7.68 ✅ |
| `ring` | `card` | Focus ring on card | 3 | 5.84 ✅ | 7.08 ✅ |
| `sos` | `background` | SOS button vs page | 3 | 4.48 ✅ | 3.74 ✅ |
| `primary` | `muted` | Active nav icon on muted | 3 | 4.94 ✅ | 6.32 ✅ |
| `white` | `avatar-1` | Avatar initials | 4.5 | 5.84 ✅ | 5.84 ✅ |
| `white` | `avatar-2` | Avatar initials | 4.5 | 5.47 ✅ | 5.47 ✅ |
| `white` | `avatar-3` | Avatar initials | 4.5 | 6.40 ✅ | 6.40 ✅ |
| `white` | `avatar-4` | Avatar initials | 4.5 | 7.31 ✅ | 7.31 ✅ |
| `white` | `avatar-5` | Avatar initials | 4.5 | 7.08 ✅ | 7.08 ✅ |
| `white` | `avatar-6` | Avatar initials | 4.5 | 5.74 ✅ | 5.74 ✅ |
| `white` | `avatar-7` | Avatar initials | 4.5 | 7.62 ✅ | 7.62 ✅ |
| `white` | `avatar-8` | Avatar initials | 4.5 | 7.69 ✅ | 7.69 ✅ |

Notes: `trust-medium` on white (4.92) and `sos-foreground` on `sos` in light mode (4.88) pass, but only just. Don't lighten either. Translucent text (`text-foreground/70` and the like) is not covered by the check, so avoid it for anything a user has to read.

---

## 3. Typography

**Inter** via `next/font/google` (subsets `latin` + `cyrillic`, self-hosted at build time, `display: swap`), exposed as `--font-inter` → `font-sans`. Fallback: `ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, …`. Body sets `font-feature-settings: 'cv11','ss01','ss03'` (straight-sided digits, open shapes) and antialiasing. Numbers that change or line up (ratings, counters, phone, OTP) use `tabular-nums`.

| Role | Classes | Size / line | Use |
|---|---|---|---|
| Display | `text-3xl font-bold tracking-tight` | 30/36 | Landing, big SOS status |
| Title (h1) | `text-2xl font-semibold tracking-tight` | 24/32 | `PageHeader` |
| Section (h2) | `text-xl font-semibold tracking-tight` | 20/28 | Page sections |
| Heading (h3) | `text-lg font-semibold` / `text-base font-semibold` | 18/28, 16/24 | Card titles, dialog titles |
| Body | `text-[0.9375rem]` (15px) | 15/22 | Lists, descriptions, buttons (`md`) |
| Input | `text-base` | 16 | All form controls (**16px stops iOS zoom-on-focus**) |
| Small | `text-sm` | 14/20 | Hints, metadata, secondary lines |
| Caption | `text-xs font-semibold uppercase tracking-wide` | 12/16 | Group labels ("NEARBY DRIVERS") |
| Micro | `text-[0.6875rem]` | 11 | Bottom tab labels only |

Rules: one `h1` per page (`PageHeader`). Use `text-balance` on headings and `text-pretty` on long leads. Never set body text below 14px.

## 4. Spacing & layout grid

Tailwind's 4px scale. The ones we use:

| Token | px | Use |
|---|---|---|
| `gap-1` / `gap-1.5` | 4 / 6 | Icon ↔ label, label ↔ control |
| `gap-2` / `gap-3` | 8 / 12 | Buttons in a row, list-item internals |
| `gap-4` / `p-4` | 16 | Card padding (mobile), form field gap, **page gutter on phones** |
| `gap-5` / `sm:p-5` | 20 | Card padding ≥640px, form grids |
| `gap-6` / `px-6` | 24 | Page gutter ≥640px, groups inside a section |
| `gap-14` | 56 | Between page sections |

Page content: `max-w-content` (60rem / 960px), centred. Forms and reading columns: `max-w-narrow` (40rem / 640px). Gutters: 16px under 640px and 24px from 640px up, always `max()`-ed with the safe-area insets.

## 5. Radius

| Token | Value | Use |
|---|---|---|
| `rounded-sm` | 6px | Tiny chips inside controls |
| `rounded-md` | 10px | Menu items, select items |
| `rounded-lg` | 14px | Buttons, inputs, nav items |
| `rounded-xl` | 18px | Large buttons (`xl`), radio cards, menus, icon tiles |
| `rounded-2xl` | 24px | Cards, dialogs, sheets (top corners), list groups |
| `rounded-full` | — | Avatars, badges, icon buttons, switches, pills |

## 6. Elevation

Shadows are tinted with the ink colour (`--shadow-color`) and get heavier in dark mode.

| Token | Use |
|---|---|
| `shadow-sm` | Cards at rest, primary/danger buttons, selected segment |
| `shadow-md` | Hovered interactive cards, SOS button, emergency call block |
| `shadow-lg` | Menus, popovers, select, toasts, raised SOS tab |
| `shadow-xl` | Dialogs, sheets, landing illustration |

Prefer borders over shadows for flat structure. Shadows mean "this floats above the page".

### Z-index layers

Use the utilities. Never write raw numbers.

| Utility | Value | Layer |
|---|---|---|
| `z-map` | 0 | MapLibre canvas |
| `z-raised` | 10 | Map controls, FABs over the map |
| `z-header` | 30 | Sticky top bar (contains the offline banner) |
| `z-nav` | 40 | Bottom tab bar, desktop sidebar |
| `z-sheet` | 50 | Sheets and their scrim |
| `z-modal` | 60 | Dialogs and their scrim |
| `z-popover` | 70 | Menus, popovers, select (they open from inside dialogs too) |
| `z-toast` | 80 | Toasts |
| `z-skip` | 90 | Skip-to-content link |

## 7. Motion

| Token | Value | Use |
|---|---|---|
| `duration-fast` | 120ms | Hover, press, colour changes |
| `duration-base` | 200ms | Switches, tab indicators, fades |
| `duration-slow` | 320ms | Sheets sliding in |
| `ease-standard` | `cubic-bezier(.2,0,0,1)` | Enter / move |
| `ease-exit` | `cubic-bezier(.4,0,1,1)` | Leave (exits are faster than entries) |
| Animations | `animate-fade-in/out`, `animate-pop-in/out`, `animate-sheet-up/down/left/right`, `animate-shimmer`, `animate-sos-pulse` | Wired to Radix `data-[state=open/closed]` |

`prefers-reduced-motion: reduce` collapses every animation and transition to ~0ms globally (`globals.css`), and the skeleton shimmer stops. `animate-sos-pulse` is **only** for a live, active SOS (a status dot or marker). Never use it on the nav or on buttons at rest.

## 8. Iconography

- **lucide-react** only, 24px grid, default stroke 2. Active nav icons use stroke 2.25 and inactive ones 1.75. Empty/error tiles use 1.75.
- Sizes: 16 (`size-4`, in small buttons, badges and inline text), 18 (`md` buttons), 20 (`size-5`, list and nav), 22 (bottom tabs), 28 (empty-state tile, SOS tab).
- Decorative icons get `aria-hidden="true"`. Icon-only controls use `IconButton`, whose `aria-label` is **required by its type**.
- Direction-sensitive icons (back arrow, chevrons) carry `rtl:rotate-180`.
- Domain mapping: map `Map`, communities `UsersRound`, SOS `Siren`, chats `MessageCircle`, profile `UserRound`, feed `Newspaper`, services `Wrench`, events `CalendarDays`, notifications `Bell`, settings `Settings`, trust `ShieldAlert / Shield / ShieldCheck`, emergency call `Phone`, offline `WifiOff`. Privacy modes: hidden `EyeOff`, community `UsersRound`, friends `Heart`, everyone `Globe`.
- **Logo mark**: a map pin holding a steering wheel ("drivers on the map"), white on brand blue `#1f5ae0`. Source: `components/shell/logo.tsx` (`LogoMark`, `Logo`) and `scripts/generate-icons.mjs` (same geometry).

---

## 9. Components

All live in `src/components/ui/`. They are typed, accept `className` (merged with `cn()` from `src/lib/cn.ts`), forward refs where a DOM node is useful, and use variants built with `class-variance-authority`. Interactive primitives wrap Radix, which provides focus management, ARIA and keyboard behaviour. Anything with built-in text (loading, retry, close, OTP labels and so on) is translated through next-intl.

| Component | Variants / API | Usage rules |
|---|---|---|
| `Button` | `variant`: primary · secondary · outline · ghost · danger · sos · link. `size`: sm (36 + hit-area extension to 44) · md (44) · lg (48) · xl (56). `loading`, `leadingIcon`, `trailingIcon`, `fullWidth`, `asChild` | **One primary per view.** `type="button"` by default; pass `type="submit"` in forms. `loading` keeps the label, shows a spinner, sets `disabled` + `aria-busy`. `fullWidth` buttons wrap long labels instead of truncating. Use `asChild` to style a `Link`. `danger` is for destructive actions, `sos` for SOS only |
| `IconButton` | same variants (minus link), sizes sm/md/lg, `aria-label` **required** | Round, 44×44 by default. Always pair with a tooltip-quality label |
| `Input` | native props | `h-11`, 16px text. Wrap in `FormField` |
| `Textarea` | `showCount` + `maxLength` | Counter turns warning at 90% and has screen-reader text ("12 of 300 characters used") |
| `Label` | `required` (visual asterisk) | Always visible. Never placeholder-only |
| `FormField` | `label`, `hint`, `error`, `required`, `labelAside` | Wires `id`, `aria-describedby` (error, else hint), `aria-invalid` and `aria-required` into its single child. The error replaces the hint and shows an icon plus text |
| `Select` (+Trigger/Value/Content/Item/Group/Label/Separator) | Radix Select, popper positioned | For 5+ options. For 2–4, use `SegmentedControl` or `RadioGroup` |
| `Switch` | Radix | Immediate-effect settings only (no Save button). Put it in a row with a `Label htmlFor`; the 44px hit area is built in |
| `RadioGroup` / `RadioGroupItem` | Radix | Classic list choice; each row `min-h-11` |
| `RadioCard` | `title`, `description`, `icon`, `aside` | Big choices with explanations (**privacy modes**, SOS type). Selected = border + tint + filled dot |
| `SegmentedControl` | `options`, `value`, `onValueChange`, `label` | 2–4 short exclusive options (theme, language, filters). Arrow-key navigation. Icons hide below 416px |
| `Tabs` (+List/Trigger/Content) | `TabsList variant`: segmented · underline | Only when the tabs switch **panels**. For filtering one list use `SegmentedControl` |
| `Dialog` (+Trigger/Content/Header/Title/Description/Footer/Close) | `hideClose` | Short focused tasks. Centred, max 28rem. Footer stacks on phones (primary on top) |
| `Sheet` (+Trigger/Content/Header/Title/Description/Footer/Close) | `side`: auto (bottom on phones, right panel ≥1024px) · bottom · right | Filters, pickers, map object details. Drag handle shown on bottom sheets. Content scrolls and the footer stays visible |
| `ConfirmDialog` | `tone`: default · danger; `onConfirm` may return a promise; optional `children` (extra content, e.g. a "type DELETE" field) + `confirmDisabled` | Irreversible actions only. Focus starts on **Cancel**. Stays open if `onConfirm` rejects |
| `DropdownMenu` (+Item `destructive`, CheckboxItem, RadioItem, Label, Separator, Sub) | Radix | Overflow actions (⋯). Destructive items go last, after a separator |
| `Popover` | Radix | Contextual explanations ("What is the trust rating?"). Not for navigation |
| `Avatar` | `id`, `name`, `src`, `size` xs–xl, `shape` circle · square, `decorative` | Initials fallback: the first letter/digit of up to two words, coloured deterministically from `id` (FNV-1a → `avatar-1..8`). Communities use `square` (corner radius ≈25% of the size at every size, so small ones never read as circles). Pass `decorative` when the name is printed next to it |
| `Badge` / `CountBadge` | neutral · primary · success · warning · danger · sos · outline; sm/md | Status labels. `sos` variant only for live SOS status. `CountBadge` caps at 99+ |
| `RatingBadge` | `rating` 0–100, `size`, `showLabel` | The only way to show trust. Colour + icon shape + optional word + sr-only "Trust rating 72 out of 100, High" |
| `Card` (+Header/Title/Description/Content/Footer) | `variant`: default · flat · elevated · interactive; `padding` | Group related content. Don't nest cards |
| `ListItem` / `ListGroup` | `href` → Link, `onClick` → button, otherwise static; `leading`, `trailing` | Rows `min-h-16`. Navigable rows show a chevron. **Never put a button inside a navigable row**; use a static row with the control in `trailing` |
| `PageHeader` | `title`, `description`, `back` (true = history, string = href), `actions`, `headingLevel` | The page's `h1`. Use `back="/parent"` for deep-linkable pages |
| `Skeleton`, `ListItemSkeleton`, `CardSkeleton` | — | Loading placeholders that **match the real layout** |
| `Spinner` / `SpinnerGlyph` | sm/md/lg, `label` | Only for small inline waits (load more, button). Never a full-page spinner |
| `EmptyState` | `icon`, `title`, `description`, `action` | See §11 |
| `ErrorState` | `title`, `description`, `onRetry`, `retrying`, `compact` | See §11 |
| `OfflineBanner` | `forceVisible` | Lives in the shell header. Uses `navigator.onLine` + events (`useOnlineStatus`) |
| `OtpInput` | `value`, `onChange`, `onComplete`, `length`=6 | 6 boxes. `inputMode="numeric"`, `autocomplete="one-time-code"` on box 1 (SMS autofill). Auto-advance, smart backspace, arrow keys, paste of the full code into any box, tapping a later box jumps to the first empty one |
| `PhoneInput` | `value`/`onChange` in **E.164**, `onComplete` | Displays `+7 (7XX) XXX-XX-XX`. Accepts typing, `8 7XX…`, `+7…`, `77…` and pasted formatted numbers. `isCompleteKzPhone()` in `lib/phone-mask.ts` for validation |
| `InfiniteList` | `query` (pass the `useInfiniteQuery` result), `renderItem`, `getKey`, `skeleton`, `empty`, `label` | Cursor lists (`Paginated<T>`). IntersectionObserver sentinel (600px ahead), "Load more" fallback, inline retry for a failed next page, "That's everything" at the end |
| `EmergencyCallButton` | `variant`: full · compact | Real `tel:112` link. See §10 |
| `Toaster` + `notify` (`lib/toast.ts`) | `notify.success / info / warning / error(msg, { retry }) / promise / dismiss` | Confirm an action or report a background failure. Never the only place important information appears |

Shell (`src/components/shell/`): `AppShell`, `nav-config.ts`, `ThemeToggle` (menu · segmented), `LanguageSwitcher` (menu · segmented), `NotificationBell`, `AccountMenu`, `Logo`/`LogoMark`.

## 10. SOS & emergency rules

1. **`sos` red is reserved** for: the SOS tab/button, the SOS creation flow, live SOS status (badge, map marker, pulse dot), the accident type, and the 112 call. It is never used for decoration, marketing, "new", "hot", unread counts, errors or low ratings. Destructive and error UI uses **`danger`** (a darker, quieter red). Low trust uses **orange**.
2. The bottom-bar SOS item is a raised 56px red circle in the centre, labelled "SOS". In the desktop sidebar it is a full-width `Button variant="sos"`. It doesn't pulse at rest.
3. **Call 112** (`EmergencyCallButton`) is a real `<a href="tel:112">` that works without JavaScript. `full` (≥64px tall block: phone icon, "Call 112", "Emergency services, free from any phone") goes at the top of the SOS flow and first for type `accident`. `compact` (outlined pill) goes on SOS cards and SOS screens. Always pair it with `emergency.disclaimer` text on SOS creation (SPEC A-12, F-24).
4. An SOS action never sits next to a destructive action. Cancelling an SOS uses `ConfirmDialog` (default tone, not danger: cancelling is legitimate).
5. On SOS screens the primary action (I can help / Resolved) uses `primary`, not `sos`. Red marks the situation, blue the next step.
6. SOS cards show the requester's `RatingBadge`, distance and age, so helpers can judge trust at a glance (F-21).

## 11. Layout & navigation

- **Phones (<1024px):** sticky top bar (logo, page title, actions, bell, avatar menu), content, fixed **bottom tab bar** (`h-16` + `env(safe-area-inset-bottom)`). Main content is padded so the bar never covers it.
- **Desktop (≥1024px, `lg`):** fixed **sidebar** (`--sidebar-width` 16rem) with the logo, SOS button, primary items, a "More" group of secondary items, and theme/language switchers at the bottom. The bottom bar is hidden.
- **Content width:** `max-w-content` (960px). Forms use `max-w-narrow` (640px).
- **Navigation config** (`nav-config.ts`): one array of `{ key, href, icon, labelKey, enabled, placement: 'tab' | 'secondary', emphasis?: 'sos' }`. **Disabled items do not render.** Flip `enabled: true` in the same change that ships the page. Currently enabled: `map`, `communities`, `chats`, `profile` (tabs) and `friends`, `notifications`, `settings`. `AppShell` takes `badges` (`{ chats: n }`): a `CountBadge` on the icon and an accessible name like "Chats, 3 unread" (`shell.navUnread`). `AccountMenu` takes its Profile/Settings links from the same config.
- **Conversations (`/chats/{id}`)** are full-bleed like the map, and the phone tab bar steps aside (`hidesTabBar`): the composer owns the bottom edge (`pb-safe`). Back goes to `/chats`.
- **Safe areas:** `viewport-fit=cover`. Use the utilities `pt-safe`, `pb-safe`, `px-safe` and the variables `--safe-top/right/bottom/left`. The header, bottom bar, sheets and toasts already respect them.
- **Skip link:** "Skip to content" (first focusable) jumps to `#main-content` (`tabIndex=-1`).
- **No horizontal scrolling at 320px and up.** Grids use `grid-cols-1` (minmax 0) on mobile. Long words wrap (`break-words`). Checked by e2e at 320 and 390.
- **PWA:** `app/manifest.ts` (standalone, `start_url: /profile` until the map ships in Phase 2 — then `/map`, together with `HOME_ROUTE` in `src/lib/routes.ts`; maskable icon). Icons live in `public/icons/` and `public/favicon.ico`.

## 11a. Communities & chat patterns (Phase 3)

**Community header** (`features/communities/community-view.tsx`): back link · square `Avatar lg` · name as the page `h1` · a meta row of `PrivacyBadge` (Lock/Globe icon **and** the word "Private/Public", never colour alone) · member count (`UsersRound`) · city (`MapPin`) · description (`whitespace-pre-line`) · the membership control (full width on phones). Moderators get a `Settings` `IconButton` that opens the settings `Sheet` (details form per rights, members & roles, owner-only danger zone with `ConfirmDialog tone="danger"`).
- Membership control states: **Join** (primary) · **Request to join** (primary, private) · **Request sent** (`warning` badge + ghost "Cancel request") · **Leave** (outline, confirmed) · owner: a muted note "You're the owner — transfer or delete to leave" instead of a button.
- Private communities show a locked `EmptyState` to non-members and pending users; members see `Tabs` Chat · Members · Requests (moderators; `CountBadge` with the pending count). Member rows put role badges and a ⋯ `DropdownMenu` (promote/demote/transfer/remove; destructive last) beside the profile link, never inside it.

**Chat list row**: `Avatar lg` (square for communities), title (semibold when unread), time (`tabular-nums`; today HH:mm · Yesterday · weekday · date), one-line preview ("You: …", sender prefix in group chats, *Message deleted* in italics, media as words: Photo / Location / Voice message), `CountBadge` + sr-only "N unread messages".

**Chat bubble** (`features/chats/message-bubble.tsx`):
- Own messages right, `bg-primary text-primary-foreground`; others left, `bg-card` + border. `rounded-2xl`, the last bubble of a run gets a small tail corner (`rounded-ee-md` / `rounded-es-md`). Max width `min(85%, 30rem)`; text `whitespace-pre-wrap` + `overflow-wrap:anywhere`.
- Runs: same sender within 5 minutes. In community chats the sender name (link, `text-primary`) tops the first bubble and the avatar sits beside the last.
- Footer: time + delivery icon for own messages — `Clock` sending · `Check` sent · `CheckCheck` read · `AlertCircle` failed — each with an sr-only word. Failed sends show "Not sent · Retry · Remove" under the bubble (`role=alert`).
- Media: photo thumbnail sized by the upload's aspect ratio (no layout shift) opening a full-size `Dialog`; location = a token-coloured street-grid tile (`.location-tile`) with a pin, coordinates and an "Open in maps" link (OpenStreetMap); voice = round play/pause button, a native range slider for seeking, duration, over a real `<audio>`.
- Deleted: dashed outline, muted italic "Message deleted" with `Ban` icon — the placeholder keeps its place.
- Actions: a ⋯ `IconButton` beside deletable bubbles (own, or any in a community chat for moderators). Always in the tab order; on hover-capable screens it fades in on hover/focus. Delete goes through `ConfirmDialog tone="danger"`.
- Day separators: a sticky centred pill (Today · Yesterday · weekday, date), days in Asia/Almaty.

**History scrolling**: newest at the bottom; a top sentinel loads older pages (keyset) and the view keeps its reading position (`overflow-anchor: none` + manual anchoring); new messages keep the view pinned only if it already was at the bottom (or the message is yours); a "Jump to latest" button appears when far up. The list is `role="log"`.

**Composer** (`features/chats/composer.tsx`): [Attach ⋯ (Photo, My location)] [auto-growing textarea, 16px, max ~6 lines] [Send when there is text/photo, otherwise Mic]. Enter sends, Shift+Enter breaks the line (IME composition respected); max 4000 with a counter from 80% (warning colour, danger at the limit, sr-only "n of 4000 characters used"). A chosen photo shows as a removable preview strip; the text becomes its caption. Location asks first (`ConfirmDialog`: "Everyone in this chat will see where you are"). Recording replaces the row: Cancel (trash) · a `role=status` pill with a `danger` dot and `m:ss / 3:00` · Send. A typing line ("Aidar is typing…", `aria-live=polite`) sits above the composer in group chats; direct chats show "typing…" in the header.

## 12. State patterns

| State | Pattern |
|---|---|
| **Loading** | Skeletons that match the content (`ListItemSkeleton` for rows, `CardSkeleton` for cards). The container gets `aria-busy="true"` plus sr-only "Loading…". No full-screen spinners. Show cached data while refetching (TanStack `staleTime` 30s) |
| **Empty** | `EmptyState`: icon in a `primary-soft` tile, a title that says what's missing, one sentence on why it matters, and **one primary action** that fixes it ("Find communities") |
| **Error** | `ErrorState`: a plain-language title, a hint, **Retry** wired to `refetch`. In lists, a failed next page shows the compact inline variant and keeps loaded items. Mutations report errors with `notify.error(msg, { retry })` |
| **Offline** | `OfflineBanner` in the header (dark-on-light inverse bar, `role="status"`). Queries refetch on reconnect. Keep showing cached content and disable actions that need the network |
| **End of list** | "That's everything" in muted text |
| **Saving** | The button `loading` (keeps its label). Success → `notify.success`. Forms stay editable after an error |

Query defaults (`lib/query-client.ts`): `staleTime` 30s, `gcTime` 5min, no retry on 4xx (except 408/429), two retries otherwise, refetch on focus and on reconnect, no mutation retries.

## 13. Forms

1. **The label is always visible** above the control. Placeholders only show format examples.
2. Required fields: `required` on `FormField` gives a visual asterisk plus `aria-required`. Mark optional fields "(optional)" only when most fields are required.
3. **Inline errors** under the field (icon + text, `text-danger`, linked with `aria-describedby`, field `aria-invalid`). Validate on blur and on submit, then live once a field is invalid. On submit with errors, focus the first invalid field. Server errors (`NICKNAME_TAKEN`) map to the same field error.
4. **Disabled vs loading:** a *disabled* button means "you can't do this yet". Explain why nearby, and don't disable submit just because the form is incomplete; show errors instead. A *loading* button means "working on it": spinner, `aria-busy`, still readable, not clickable.
5. Use the right keyboard: `PhoneInput` (`type=tel`), `OtpInput` (`inputMode=numeric`), `type="email"`, `type="search"`, `enterKeyHint` for multi-step flows.
6. Primary submit sits at the bottom, full width on phones (`fullWidth size="lg"`) and right-aligned on desktop. Secondary action to its left, or above it on phones.
7. Validation uses the zod schemas from `@autoc/shared` with react-hook-form (`@hookform/resolvers`). Never duplicate rules.

## 14. Accessibility

- **WCAG 2.1 AA** contrast for all tokens (§2.2). Run `check:contrast` when you touch colours.
- **Focus:** every interactive element shows a 2px `ring` outline with a 2px offset on `:focus-visible` (global rule + `focus-ring` utility). Never remove an outline without replacing it.
- **Touch targets ≥ 44×44.** Small visual controls (sm buttons, switches, radios) extend their hit area with `::after`.
- **Icon-only buttons need `aria-label`** (enforced by `IconButton`'s type). Decorative icons are `aria-hidden`.
- **Keyboard:** Dialogs and sheets trap focus, close on Esc and return focus to their trigger (Radix). Menus and selects move with the arrow keys, Home/End and type-ahead. Segmented controls and radio groups move with the arrows. The skip link is the first stop.
- **Colour is never the only signal:** rating = colour + icon + number (+ word); errors = colour + icon + text; selected radio card = border + tint + dot; active nav = pill + bolder icon + `aria-current="page"`.
- Live regions: `OfflineBanner` (`role=status`), `ErrorState` (`role=alert`), toasts (sonner), the OTP result in the styleguide (`aria-live`).
- `lang` on `<html>` follows the locale. Language names render in their own language with `lang` set.
- Reduced motion is respected globally (§7).

## 15. Internationalisation

- next-intl **without locale URL prefixes**. The locale comes from the `NEXT_LOCALE` cookie (`ru` default, `en`), read in `src/i18n/request.ts`. `LanguageSwitcher` writes the cookie (1 year, `SameSite=Lax`) and calls `router.refresh()`. Time zone `Asia/Almaty`.
- Message keys are **type-checked** (`src/i18n/global.d.ts` → `en.json` is the reference). `src/i18n/messages.test.ts` checks that ru and en have the same keys and the same ICU placeholders.
- Namespaces: `meta`, `common` (actions), `nav`, `shell`, `states`, `errors`, `form`, `otp`, `phone`, `rating`, `theme`, `language`, `emergency`, `privacy`, `landing`, `styleguide`. Feature agents add their own namespace per feature (`auth`, `profile`, `map`, `sos`, `communities`, …) and reuse `common` / `states` / `errors`.
- Use ICU plurals for every count (Russian has one/few/many). Never concatenate translated fragments.

## 16. Contributing checklist

- [ ] Uses tokens/utilities only (no hex, no Tailwind palette colours, no raw z-index)
- [ ] Works at 320px, no horizontal scroll; checked in `/design` in light and dark, ru and en
- [ ] Loading / empty / error / offline handled
- [ ] Keyboard and screen reader pass (labels, focus, `aria-current`, `aria-invalid`)
- [ ] SOS red used only per §10
- [ ] New strings added to **both** `ru.json` and `en.json`
- [ ] New UI primitive added to `/design`
