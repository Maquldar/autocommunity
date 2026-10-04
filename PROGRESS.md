# Progress

| Phase | Status |
|---|---|
| 0. Spec + architecture + API contract | ✅ done |
| 1. Foundation, auth, profile, vehicles | ✅ done |
| 2. Map, privacy, friends, notifications | ⏳ |
| 3. Communities + chat | ⏳ |
| 4. SOS + direct chats | ⏳ |
| 5. Ratings, reviews, reports | ⏳ |
| 6. Admin, antifraud, hardening | ⏳ |
| 7. Services catalog | ⏳ |
| 8. Events, feed, polish | ⏳ |

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
