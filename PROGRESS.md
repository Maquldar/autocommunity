# Progress

| Phase | Status |
|---|---|
| 0. Spec + architecture + API contract | ✅ done |
| 1. Foundation, auth, profile, vehicles | ✅ done |
| 2. Map, privacy, friends, notifications | ✅ done |
| 3. Communities + chat | ✅ done |
| 4. SOS + direct chats | ✅ done |
| 5. Ratings, reviews, reports | ✅ done |
| 6. Admin, antifraud, hardening | ✅ done |
| 7. Services catalog | ✅ done (built in parallel) |
| 8. Events, feed, polish | ✅ done |
| Final release gate (DoD) | ✅ done (2026-10-06) |
| 9. Wallet, Premium, votes, violations, vehicle details, tiers (client request) | ✅ done (2026-10-06) |
| 9. Wallet, premium, votes, violations, vehicle details, tiers | ✅ API done + security review fixed (web in progress) |

## Phase 0 — Spec, architecture, contract (2026-10-04)

**Built:** SPEC.md (features, roles, flows, entities, assumptions), ARCHITECTURE.md (stack, ERD, auth model, phase plan), API.md (contract; Phases 1–2 frozen), `packages/shared` (zod schemas, constants, DTO types), Prisma schema for all phases plus the first migration with PostGIS GiST indexes.

**Tested:** shared package unit tests (phone normalization) pass, 10/10. Migration applied to Postgres 16 + PostGIS 3.4.

**Environment note:** there's no Docker daemon in the build container, so Postgres + PostGIS and Redis run natively here. `docker-compose.yml` is provided for local setup, but it couldn't be run in this environment.

## Phase 1 — Foundation, auth, profile, vehicles (2026-10-04)

**Built**
- API (NestJS): env validation, error format, keyset pagination, Redis rate limiter, storage (local / S3) and SMS (console / Twilio) adapters. Phone OTP login, Google and Apple login (switched off until keys are set), JWT access tokens plus rotating refresh tokens with reuse detection, CSRF protection. Profile, settings, phone linking, account deletion, user search, vehicles, image uploads (GPS data removed). Deterministic Almaty seed with 40 users.
- Web (Next.js PWA): design system (light/dark, AA contrast, 35+ components), app shell, ru/en. Login, 3-step onboarding, profile and editing, cars, other users' profiles, settings, legal drafts. Login is coordinated across tabs so two tabs never refresh at the same time.

**Tested (run by the lead, not just reported by agents)**
- API: 101/101 (30 unit + 71 integration against real Postgres + PostGIS and Redis).
- Shared: 19/19.
- Web: 113/113 unit; 24/24 Playwright e2e on mobile and desktop, including the full journey: sign-up → onboarding with avatar and car → edit → reload → log out → log back in.

**Review gate:** an adversarial review found 1 high, 3 medium and 8 low issues. All are fixed with regression tests (see commit `be0dd36`). The high one: a stolen access token could re-link the phone number and take over the account.

**Known issues**
- HEIC images are rejected; voice/video files aren't scrubbed of metadata (needs ffmpeg).
- Google, Apple, Twilio and S3 have never been tested against the real services.
- Cross-tab login coordination is unit-tested only; there's no real two-tab browser test.
- Because the map arrives in Phase 2, post-login landing and the PWA start page are `/profile`, and the phone bottom bar has a single item.
- e2e needs the API started with `TRUST_PROXY=loopback` (the Playwright config does this).

## Phase 2 — Map, privacy, friends, notifications (2026-10-05)

**Built**
- API: location updates (10 s throttle), privacy-aware map in a single SQL query. Exact positions go only to friends and to co-members of private communities; strangers and public-community co-members get ~500 m snapped positions. Plus the friends lifecycle with a 24 h re-request cooldown, notifications (in-app + Socket.IO + Web Push via BullMQ), auto-generated VAPID keys, Socket.IO `/rt` with Redis adapter and session revocation, and a demo live-locations ticker that moves only seed-written positions.
- Web: MapLibre map with clustering, driver cards, filters and one-tap invisibility. Location sharing only after explicit consent, while the app is visible. Friends and notifications pages, a live bell, a push toggle and service worker. Socket.IO works through the same-origin proxy (long-polling).

**Tested (run by the lead)**
- API 209/209 (includes Phase 3); web unit 198/198; e2e 28 passed, 2 skipped by design (journeys that run once per run).
- The e2e suite includes a two-browser live friend-request test. It was also run in same-origin proxy mode (the Render setup).

**Review gate:** an adversarial review found 2 high, 2 medium and 8 low issues; all are fixed with tests.
- High: push SSRF via a URL-parser differential.
- High: a demo visitor's real position was kept alive by the demo ticker.
- Medium: friend-request spam.
- Medium: public-community members saw exact positions.

**Known issues**
- In one full e2e run the desktop "new driver" map test failed once (an element wasn't visible). It passed in 2 isolated reruns and in the next full run. The root cause isn't confirmed; it looks like map-load timing under parallel load.
- Push was never sent to real FCM/Mozilla/Apple services; the sender is mocked in tests.
- An access token that expires mid-connection doesn't drop the socket (only revocation does).

## Phase 3 — Communities and chats (2026-10-05)

**Built**
- Communities: open and private, join requests, roles (owner/moderator/member), ownership transfer, soft delete, limits.
- Chat engine: community and direct chats with text, photo, location and voice; read state; unread counts; typing indicator; deletion.
- Live delivery via Socket.IO rooms, plus push for direct messages.
- Web: communities hub, community page with members, requests and settings; chat list and conversation with optimistic send, voice recorder and photo/location messages; community filter on the map.

**Tested:** API and web unit suites green; e2e covers a two-browser private-community journey (request → live approval → live chat both ways → typing → promotion → moderator deletion) and a DM with a photo, unread badges and read receipts.

**Fixed along the way:** the intermittent map e2e failure (root cause: keyboard zoom steps lost during MapLibre easing).

## Phase 7 — Service catalog (2026-10-05, built in parallel)

**Built**
- Services list and map, filters, search, sort by distance or rating, open-now in Asia/Almaty.
- Details with hours, photos and reviews.
- Visit verification by geo (≤150 m), daily QR code or order photo (pending admin).
- Reviews only after a verified visit, with a 30-day cooldown and a Bayesian rating.
- User submissions (pending moderation) with a duplicate guard.
- Seed: about 40 fictional Almaty services.

**Tested (lead, on the integrated branch with Phases 1–4)**
- Typecheck clean; API 263/263; shared 29/29; web unit 303/303.
- e2e 46 passed, 4 skipped by design.

**Known issues**
- Admin approval of photo visits and pending services comes in Phase 6.
- The map tiles can't load in the build sandbox, so screenshots show a blank map background.

## Phase 4 + 5 — APIs (2026-10-05)

**Built**
- **SOS:** creation gates; dispatch with radius expansion 5 → 10 → 20 km via BullMQ; lifecycle state machine (exhaustively tested); up to 3 helpers; SOS group chat; contact-phone rules; a rotating share link with a public page; expiry plus a 24 h timeout for abandoned SOS.
- **Trust rating:** the formula from SPEC A-8 (weights, caps, 180-day decay, penalties expiring after 365 days) as a pure function with a ledger, transactional recompute and a daily job. Public breakdown, private ledger.
- **SOS reviews:** both directions, a 14-day window, `canReview` / `reviewTargets`. **Reports** on users, messages, SOS, communities and services, with target resolution and limits.

**Review gate (Phases 3 + 4 backend):** 2 high, 7 medium and 6 low findings, all fixed with tests.
- High: SOS harvesting from anywhere, now limited to a fresh, trusted stored location (> 300 km/h jumps aren't trusted for 10 min).
- High: an ownership-transfer race that left a community owned by a non-member.
- Medium: expired SOS still actionable, account deletion leftovers, the onboarding gate, socket-room races, upload reuse, SOS fan-out N+1, unicode-confusable community names.

**Tested (lead, merged with Phase 7):** API 305/305 (3 consecutive green runs before the merge); shared 38/38; web unit 303/303; e2e 46 passed, 4 skipped by design, 2 consecutive full runs.

**Fixed while verifying**
- A process-wide query counter made a performance test flaky (background jobs). The test now takes the minimum of repeated measurements, and counting is test-only.
- A socket that was still in the auth middleware missed `socketsLeave`, so it could stay in a chat room after removal. Rooms are now re-checked on `connection`.
- The map e2e zoom-in loop raced the hint re-render. It now uses a converging `toPass` check.

**Known issues**
- After a removal that coincides with the user's connect, a socket can still receive a chat event for the duration of one DB query (~1–3 ms).
- Uploads used as service photos aren't part of the exclusive-attachment check yet (the services module was built in parallel).

## Phase 6 — Admin, antifraud, load and security (2026-10-06)

**Built**
- Admin API (`/admin/*`, API.md §6): stats, users (search, detail, warn, block with optional end, unblock, SOS ban/unban), communities (delete), SOS (list, detail, mark fake → −50 penalty), reports (queue with target previews, confirm/dismiss, content removal per type, sibling reports, reporter notifications), fraud flags, audit log, services verify/reject + QR, photo-visit approve/reject. Every action is audited with a required note; admins can't act on themselves or other admins; 300 requests/min per admin.
- Antifraud v1: SOS cancel streak (→ 72 h SOS ban), duplicate SOS photo, report burst (→ 24 h block under rating 30), location teleport, SOS from a new account, OTP abuse. All are hooked into the existing services and run in the background.
- Web admin at `/admin` (role-gated, a not-found page for others, an "Admin panel" item in the account menu): dashboard, users and user detail, reports queue, SOS list and detail, communities, services moderation with map preview and a printable QR, photo visits, fraud flags, audit log. ru/en; notifications render the moderation types.
- `load/` (k6 scripts + RESULTS.md, reduced scope) and `SECURITY.md` (ASVS L1 checklist, findings from Phases 1–5, residual risks).

**Known issues:** see the Phase 6 report. Load capacity is bound by the single Node process (about 140 RPS on a shared 4-core host). The e2e admin journey signs in the seeded admin, whose phone is limited to 5 codes/h, so more than ~4 runs per hour hit the OTP limit.

## Phase 4 + 5 UI and Phase 8 — Events and feed (2026-10-06)

**Built**
- SOS UI: create flow (type, photos, location), nearby SOS card and map layer, Help / Call / Message, accept up to 3 helpers, the SOS group chat, the share link, a "Call 112" button everywhere. Rating breakdown on profiles, mutual reviews after a closed SOS, a report dialog on every reportable target.
- Events: community events with a route, RSVP with a cap, an event chat for those going, reminders, an events layer on the map. Feed: posts with photos, video and polls, likes and comments, community and personal feeds.

## Final release gate (2026-10-06)

**Security review of Phases 5–8 and XSS** (real HTTP, Socket.IO and Playwright): no XSS and no admin authorization bypass. Findings: 2 high, 5 medium, 6 low and 3 nits. All of them are fixed with regression tests except L2 (see KNOWN_GAPS.md).
- High: people removed from a community (or whose community was deleted) kept event-chat access and event notices. They now lose their RSVPs and event chats, and event chats require a live community plus membership or a public community.
- High: admins could not see or remove reported posts and comments. Previews and removal are added, and admins can read any post.
- Medium:
  - The report-burst auto-block could be triggered by throwaway accounts. Only credible reporters count now, and a Redis lock deduplicates it.
  - The rating could be farmed with two accounts. Fake SOS no longer count, each counterpart counts once per 30 days, and a `reciprocal_sos` fraud flag is added.
  - A removed event creator could still edit their event.
  - Upload memory and quota abuse: a 10 MB default cap, 2 uploads in flight per user, a daily byte quota, and an hourly orphan purge.
  - Event notification spam: new rate limits and throttles.
- Low:
  - Admins could act on other admins' services.
  - Report resolution is now one transaction, and removals get audit rows.
  - The public SOS JSON is now `no-store`, and the share token is redacted in logs.
  - SECURITY.md no longer overclaims the CSP.
  - Missing rate limits are added.
- Nits: the service-worker URL check, punycode display of look-alike link hosts, and seed ledger consistency.

**Tested on the final commit**
- TypeScript: 0 errors.
- API: 415/415 tests.
- Web unit: 390/390 tests.
- Shared: 44/44 tests.
- Playwright e2e: 62 passed, 0 failed (14 skipped by design). This ran against the exact Render build and start scripts from a fresh clone (production mode, demo mode, Postgres file storage, no `.env`).

## Phase 9 — Monetization and trust (2026-10-06, in progress)

**Step A — contract (done):** API.md §9 and SPEC.md §9 written; `packages/shared` has the zod schemas and DTOs (`wallet.ts`, `votes.ts`, `violations.ts`, `tiers.ts`, vehicle details in `schemas.ts`), the `votes` rating component and the capped `violation` penalty in `computeRating`, 8 notification types with ru/en push texts, upload purposes `vehicle` / `violation`, 3 fraud flag kinds and 8 admin actions. Shared tests 72/72; API and web typecheck clean; web unit 390/390; API unit 86/86. The API returns placeholder values for the new DTO fields (`isPremium: false`, empty vehicle details) until Step B.

**Step B — API (done):**
- Migrations `20261006120000_phase9_wallet_premium_votes_violations` and `20261006120100_phase9_vehicle_cover` (wallets with a `balance >= 0` CHECK, an append-only ledger trigger, top-ups, premium subscriptions with one live row per user, votes, violations, vehicle details).
- Modules `wallet` (PaymentProvider adapter + demo provider, transfers, premium, daily renewal job with a Redis lock), `votes` and `violations` (plus `GET /vehicles/:id`), admin routes for wallets, votes and violations (audited), and the antifraud flags `wallet_funnel`, `vote_burst` and `violation_rejections`.
- Premium limits are hooked into vehicles, post images, owned communities and memberships.
- The rating gains votes, capped violation penalties and penalty reversal.
- Seed data for every Phase 9 feature.
- Integration tests: `wallet`, `premium`, `votes` and `violations` (49 tests), including the races: concurrent transfers never overdraw, opposite transfers don't deadlock, a repeated or concurrent top-up confirm credits once, a concurrent idempotent transfer moves coins once, concurrent votes on one pair produce exactly one, and concurrent subscribes charge once.

**Security review (Phase 9 API):** 2 high, 1 medium, 2 low findings and 1 nit, all fixed with regression tests:
- High: a nickname transfer matched `_` / `%` as wildcards (ILIKE on citext).
- High: concurrent votes on one target deadlocked (an FK key-share lock against the recompute's `FOR UPDATE`; now `FOR NO KEY UPDATE`).
- Medium: the ledger order could disagree with `balance_after`; a per-wallet `seq` was added (migration `20261006130000_phase9_wallet_ledger_seq`).
- Low: violations could be filed against admin-owned vehicles; wallet reads wrote to the database.
- Nit: the early-renewal-then-cancel behaviour is now documented.

## Phase 9 — Monetization and driver trust (client request, 2026-10-06)

**Owner decisions:**
- Internal coins (1 coin = 1 ₸) with a demo payment provider and no cash-out. Real money transfers between people would need an e-money licence or a payment partner.
- Premium costs 1 490 coins a month.
- Violations are published only after admin review.
- Driver votes (+/−) come with limits.
- Buying items with coins is deferred.

**Built**
- **Wallet:**
  - an immutable ledger with a per-wallet sequence;
  - demo top-up through a payment-provider adapter;
  - transfers with idempotency, a daily cap and sender gates;
  - admin view, adjust and freeze.
- **Premium:** subscribe, cancel and resume, with a daily renewal job. Perks are the badge, the profile frame and doubled vehicle, post-image, community and membership limits.
- **Votes:** one per pair every 30 days, from voters aged 7 days or more with rating 40 or more. The effect on the rating is capped at ±15, and voters are never shown publicly.
- **Violations:** grouped by category, under КоАП or УК, each with 1–3 evidence photos.
  - Flow: admin approve or reject, then an owner dispute.
  - Rating: −5 per violation, −20 at most, expiring after 365 days.
- **Vehicle details:** VIN (visible to the owner only), engine, fuel, transmission, drive, body, mileage, colour, description and photos.
- **Rating tiers:** shown on every avatar.
- **Antifraud flags:** `wallet_funnel`, `vote_burst` and `violation_rejections`.

**Review gate:** 2 high, 1 medium, 2 low and 1 nit. All were fixed with regression tests.
- High: a nickname transfer matched `_` as a wildcard and could pay the wrong user.
- High: concurrent votes on one target deadlocked, because the row locks were changed to `FOR NO KEY UPDATE`.
- Medium: the ledger order didn't match `balance_after` under concurrency; a per-wallet sequence fixes it.
- Verified solid: no overdraw under concurrent transfers or subscriptions, top-ups are credited once, the daily cap holds under races, and neither the VIN nor submitter or voter identities leak.

**Tested on the final commit:**
- TypeScript: 0 errors.
- API tests: 476/476.
- Web unit tests: 495/495.
- Shared tests: 72/72.
- Playwright e2e: 67 passed, 0 failed (17 skipped by design). The run used the exact Render scripts from a fresh clone and includes the new wallet, premium, votes and violations journeys.

