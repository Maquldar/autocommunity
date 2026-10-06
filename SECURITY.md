# AutoCommunity: security checklist

Phase 6 (F-34, A-13). This is an OWASP ASVS 4.0 **Level 1** checklist, adapted to this stack and filled in from the code and tests as of the `phase6` branch. It is a self-assessment written by the team that built the system. It does **not** replace a real penetration test (see "Residual risks").

Status: ✅ done and tested · 🟡 partial or untested against the real service · ❌ not done · n/a not applicable.
Paths are relative to the repository root. API tests are in `apps/api/test/*.int.spec.ts` (integration, real Postgres + Redis) and `apps/api/src/**/*.spec.ts` (unit). Web tests are in `apps/web/src/**/*.test.ts(x)` and `apps/web/e2e/*.spec.ts`.

## V2 Authentication

| # | Requirement | Status | Where / test |
|---|---|---|---|
| 2.1 | No passwords; phone OTP, Google and Apple ID tokens only | ✅ | `modules/auth/*`; `auth.int.spec.ts › OTP login` |
| 2.2.1 | Anti-automation on login: OTP request 1/60 s and 5/h per phone, 20/h per IP, global circuit breaker | ✅ | `otp.service.ts`; `auth.int.spec.ts` (cooldown, per-IP, global) |
| 2.2.1 | Brute force on codes: 5 attempts per code, 10 failures/h per phone+IP, 30/h per phone; reservation is atomic under parallel guesses | ✅ | `otp.service.ts › verify`; `auth.int.spec.ts › parallel guesses … never exceed the 10-failure lockout` |
| 2.2.1 | Repeated OTP lockouts are flagged for review (antifraud `otp_abuse`) | ✅ | `antifraud.service.ts › recordOtpLockout`; `antifraud.int.spec.ts › otp_abuse` |
| 2.5 | No account recovery questions; phone can't be replaced once verified (prevents takeover with a stolen access token) | ✅ | `phone-link.controller.ts`; `users.int.spec.ts` (PHONE_ALREADY_VERIFIED) |
| 2.7.1 | OTP via SMS only to allowed country prefixes (toll fraud) | ✅ | `OTP_ALLOWED_PREFIXES`; `auth.int.spec.ts › refuses SMS to countries outside …` |
| 2.7.2 | OTP lifetime 5 min, single use | ✅ | `LIMITS.otpTtlSec`; `auth.int.spec.ts` (OTP_EXPIRED on reuse) |
| 2.7.6 | Codes stored as HMAC(OTP_SECRET, phone:code), compared in constant time | ✅ | `hashOtp`, `safeEqual`; `otp.service.spec.ts`, `auth-helpers.spec.ts` |
| 2.8 | Dev code exposure (`devCode`) refused in production unless `DEMO_MODE` | ✅ | `config/env.ts`; `env.spec.ts` |
| 2.x | Google / Apple ID token verification (audience, issuer, JWKS) | 🟡 | `oauth-verifier.service.ts`; unit-tested with local keys, never run against Google/Apple |

## V3 Session management

| # | Requirement | Status | Where / test |
|---|---|---|---|
| 3.2 | Access JWT 15 min (HS256, issuer/audience checked); refresh 30 days, random, stored hashed, rotated on every use | ✅ | `access-token.service.ts`, `refresh-token.service.ts`; `auth.int.spec.ts › sessions` |
| 3.3.1 | Logout revokes the session; logout-all revokes every refresh token and every access token issued before it | ✅ | `session.service.ts`; `auth.int.spec.ts`, `realtime.int.spec.ts › emits session:revoked …` |
| 3.3 | Refresh-token reuse ends the whole family and all outstanding access tokens | ✅ | `refresh-token.service.ts`; `auth.int.spec.ts` |
| 3.4 | Refresh cookie `httpOnly`, `SameSite=Strict`, `Secure` in prod, path `/api/v1/auth`; CSRF double-submit on cookie routes | ✅ | `common/http/auth-cookies.ts`; `auth.int.spec.ts` (CSRF_FAILED) |
| 3.5 | Blocking an account revokes sessions and disconnects sockets immediately (admin and automatic blocks) | ✅ | `antifraud/sanctions.service.ts › block`; `admin.int.spec.ts › block: sessions revoked, sockets disconnected …`; e2e `admin.spec.ts` (open page logged out) |
| 3.x | Access token expiring mid-socket-connection doesn't drop the socket (only revocation does) | 🟡 | Documented in API.md §2; accepted |

## V4 Access control

| # | Requirement | Status | Where / test |
|---|---|---|---|
| 4.1.1 | Deny by default: global `JwtAuthGuard`, `@Public()` opt-out | ✅ | `common/auth/jwt-auth.guard.ts`; `auth.int.spec.ts › authentication guard` |
| 4.1.3 | Role checks on the server: every `/admin/*` route `@Roles('admin')`; role read from account state, not the token claim | ✅ | `admin.controller.ts`, `roles.guard.ts`; `admin.int.spec.ts › every admin route answers 403 …`, `roles.guard.spec.ts` |
| 4.1.3 | Admins can't act on themselves or on other admins (403 INVALID_TARGET) | ✅ | `admin-view.service.ts › assertTargetable`; `admin.int.spec.ts › admins cannot act on themselves …` |
| 4.1.5 | Every admin action is audited (`admin_actions`, note required 3–500 chars) in the same transaction where possible | ✅ | `admin-audit.service.ts`; `admin.int.spec.ts` (audit rows per action) |
| 4.2.1 | Object-level checks (IDOR): chats, communities, SOS visibility, uploads (own + purpose), reports (target visible to reporter) | ✅ | `chats.int.spec.ts`, `communities.int.spec.ts › authorization matrix`, `sos.int.spec.ts`, `reports.int.spec.ts` |
| 4.2 | Location privacy enforced in SQL (hidden/friends/community/everyone; approximate positions for strangers) | ✅ | `map.service.ts`; `map.int.spec.ts › visibility / approximate positions` |
| 4.2 | SOS positions can't be harvested city-wide (fresh, trusted stored location; 20 km) | ✅ | `sos.service.ts`; `sos.int.spec.ts › location trust and SOS visibility (review H1)` |
| 4.3 | Admin UI is hidden from non-admins (not-found page); the API enforces it independently | ✅ | `features/admin/admin-gate.tsx`; e2e `admin.spec.ts › a non-admin opening /admin …` |

## V5 Validation, sanitization and encoding

| # | Requirement | Status | Where / test |
|---|---|---|---|
| 5.1 | Every body, query and param validated by zod schemas from `packages/shared`; unknown keys stripped; JSON numbers not coerced | ✅ | `common/validation/zod.pipe.ts`; `packages/shared/src/*.test.ts`; per-module tests |
| 5.1 | Only JSON (≤ 100 KB) and multipart on `/uploads` are parsed; malformed JSON → fixed message | ✅ | `bootstrap.ts`; `health.int.spec.ts › HTTP pipeline hardening` |
| 5.2 | Names/bios reject control, zero-width and bidi characters; community names normalized (confusables) | ✅ | `shared/schemas.ts`, `communityNameKey`; `communities.int.spec.ts › name normalization` |
| 5.3 | Output encoding by React; no `dangerouslySetInnerHTML` on user content; notification links restricted to same-origin paths and safe ids | ✅ | `features/notifications/describe.ts`; `notification-item.test.tsx`, `moderation-notifications.test.ts` |
| 5.3.4 | SQL: Prisma or tagged `$queryRaw` templates only (parameterized); LIKE wildcards escaped | ✅ | e.g. `communities.service.ts`, `admin-moderation.service.ts`; reviewed by grep (`$queryRawUnsafe` only on catalog table names in tests) |
| 5.x | SSRF: push endpoints restricted to exact browser push hosts, parser-differential safe | ✅ | `push-endpoint.ts`; `push-endpoint.spec.ts`, `push.int.spec.ts` |

## V6 Stored cryptography

| # | Requirement | Status | Where / test |
|---|---|---|---|
| 6.2 | Standard primitives only: HS256 (jose), HMAC-SHA256, SHA-256, `crypto.randomBytes`/`randomInt` | ✅ | `access-token.service.ts`, `otp.service.ts`, `sos.service.ts › share` |
| 6.2 | Secrets ≥ 32 chars validated at boot; never in the repo | ✅ | `config/env.ts`; `env.spec.ts` |
| 6.3 | Tokens/codes random: refresh tokens, share links (32 bytes, stored hashed), QR secrets | ✅ | `refresh-token.service.ts`, `sos.service.ts`, `services/qr.ts` |

## V7 Errors and logging

| # | Requirement | Status | Where / test |
|---|---|---|---|
| 7.1 | Unknown errors → generic `INTERNAL` without internals | ✅ | `all-exceptions.filter.ts`; `all-exceptions.filter.spec.ts` |
| 7.1 | Structured JSON logs with request ids; auth headers and cookies redacted; phones masked in fraud flags | ✅ | `config/logger.ts`; `antifraud.int.spec.ts` (flag doesn't contain the phone) |
| 7.2 | Security events recorded: admin audit log, fraud flags, OTP lockouts | ✅ | `admin_actions`, `fraud_flags`; admin UI `/admin/audit`, `/admin/fraud` |
| 7.x | Central log shipping / alerting | ❌ | Not set up (deployment concern) |

## V8 Data protection

| # | Requirement | Status | Where / test |
|---|---|---|---|
| 8.2 | Access token kept in memory only (not localStorage); refresh in httpOnly cookie | ✅ | `apps/web/src/lib/api/session.ts` |
| 8.3 | Only the latest position is stored (no history); hidden users never returned; plates only to friends | ✅ | `user_locations`; `map.int.spec.ts` |
| 8.3 | Account deletion anonymizes profile and notifications, removes location, vehicles, tokens, friendships, avatars; open SOS cancelled | ✅ | `users.service.ts`, deletion hooks; `users.int.spec.ts`, `sos.int.spec.ts › account deletion …` |
| 8.3 | Phones shown to admins (needed for moderation); phones in SOS only under the contact rules | ✅ | `sos-view.service.ts`; `sos.int.spec.ts › contact phone exposure` |
| 8.x | Data retention for read notifications (90 days) | ✅ | `notifications-retention.service.ts`; `notifications-retention.int.spec.ts` |

## V9 Communications

| # | Requirement | Status | Where / test |
|---|---|---|---|
| 9.1 | HTTPS + HSTS in production (helmet; hosting terminates TLS) | 🟡 | `bootstrap.ts` (helmet); TLS is the host's job (Render/Vercel), not tested here |
| 9.1 | CORS allow-list (`WEB_ORIGIN`); state-changing requests from other origins → 403; sockets from other origins refused | ✅ | `bootstrap.ts`; `health.int.spec.ts`, `realtime.int.spec.ts` |
| 9.x | Strict CSP on the web app (self + listed CDNs/tiles) | ✅ | `apps/web/next.config.ts` |

## V10 Malicious code / V14 Configuration

| # | Requirement | Status | Where / test |
|---|---|---|---|
| 14.1 | Env validated with zod at boot; insecure combinations refused in production (console SMS, exposed dev codes, missing secrets) | ✅ | `config/env.ts`; `env.spec.ts` |
| 14.2 | Dependencies pinned via `pnpm-lock.yaml` | 🟡 | No automated vulnerability scan (`pnpm audit`) in CI yet |
| 14.3 | `TRUST_PROXY` defaults to false (client IP can't be spoofed via X-Forwarded-For) | ✅ | `config/env.ts`, `bootstrap.ts` |
| 14.4 | Security headers (helmet: nosniff, frame-ancestors via CSP, referrer policy) | ✅ | `health.int.spec.ts › sets security headers …` |
| 14.x | Admin pages `noindex` | ✅ | `apps/web/src/app/admin/layout.tsx` |

## V12 Files and resources

| # | Requirement | Status | Where / test |
|---|---|---|---|
| 12.1 | Size limits per kind enforced while streaming (before buffering); 60 uploads/h per user | ✅ | `upload-stream.interceptor.ts`; `uploads.int.spec.ts` |
| 12.2 | Type checked by magic bytes; MIME allow-list | ✅ | `media-processor.ts`; `media-processor.spec.ts` |
| 12.3 | Random storage keys; images re-encoded to WebP with EXIF (GPS) stripped | ✅ | `uploads.service.ts`; `uploads.int.spec.ts` (EXIF GPS removed) |
| 12.4 | An upload can be attached once, only by its owner, only for its purpose | ✅ | unique indexes + checks; `chats.int.spec.ts › exclusive attachments`, `sos.int.spec.ts` |
| 12.x | Voice/video metadata not scrubbed (no ffmpeg) | 🟡 | Known gap (PROGRESS.md Phase 1) |

## V13 API

| # | Requirement | Status | Where / test |
|---|---|---|---|
| 13.1 | Rate limits (Redis sliding window) on auth, map (60/min), SOS geo (60/min), messages (30/min), reports (10/day), friend requests (50/h), uploads (60/h), visits, public SOS link (60/min/IP), admin API (300/min per admin) | ✅ | `rate-limiter.service.ts`; per-module tests, `admin.int.spec.ts › rate-limits each admin …` |
| 13.1 | Keyset pagination with a max page size (50); bbox capped at 2° × 2°; lists capped (500 map items) | ✅ | `common/pagination/cursor.ts`; `map.int.spec.ts › filters and limits` |
| 13.2 | Socket flood limits (typing throttle, joins re-checked) | ✅ | `chats-realtime.int.spec.ts › socket hardening` |
| 13.x | Abuse automation (antifraud v1): SOS cancel streak → 72 h SOS ban, report burst → 24 h block below rating 30, teleporting, duplicate SOS photos, new-account SOS, OTP abuse | ✅ | `modules/antifraud`; `antifraud.int.spec.ts` (each trigger just below / at its threshold) |

## Review findings fixed in Phases 1–5

From PROGRESS.md and the commit history (`be0dd36`, `1c6d36f`, `ac3c3bc`). Every finding was fixed with a regression test.

| Phase | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | A stolen access token could re-link the phone number and take over the account | Verified phones can't be replaced (`409 PHONE_ALREADY_VERIFIED`) |
| 1 | Medium | Phone linking revealed whether a number is registered before the code was checked | Same answer either way; the conflict is checked after the code |
| 1 | Medium | Login CSRF through form posts | JSON-only body parsing; Origin allow-list on unsafe methods |
| 1 | Medium | SMS toll fraud | `OTP_ALLOWED_PREFIXES` |
| 1 | Low (×8) | Non-atomic OTP failure counting; lockout keyed on phone only (third parties could lock owners out); `TRUST_PROXY` on by default; console SMS allowed in prod; uploads buffered before limits; refresh reuse left access tokens alive; prefix search not index-friendly; invisible characters / reserved nicknames; old avatars kept; case-sensitive Bearer; logout didn't always clear cookies | Atomic reservation; phone+IP lockout with per-phone backstop; `TRUST_PROXY=false` default; prod guard; streaming caps; reuse kills access tokens; index; validation; cleanup |
| 2 | High | Push SSRF through a URL-parser differential (WHATWG vs `url.parse`) | Exact push-host allow-list, both parsers must agree, no IPs/ports/userinfo |
| 2 | High | A demo visitor's real position was kept fresh by the demo ticker | Ticker moves only seed-written positions (`source = 'seed'`) |
| 2 | Medium | Friend-request spam | 24 h re-request cooldown, 50/h limit |
| 2 | Medium | Public-community co-members saw exact positions | Exact only for friends and private-community co-members |
| 2 | Low (×8) | Coerced JSON numbers, notification anonymization on delete, map rate limit, notification retention, onboarding requirements, etc. | See API.md §2 "Review fixes" |
| 3–4 | High | SOS positions could be harvested from anywhere by moving `/sos/nearby` / `/map/sos` coordinates | Stored, fresh, trusted location required; > 300 km/h jumps untrusted for 10 min |
| 3–4 | High | Ownership-transfer race left a community owned by a non-member | One lock order (community row, then users) for every membership change |
| 3–4 | Medium (×7) | Expired SOS still actionable; account-deletion leftovers; onboarding gate missing on social actions; socket-room races; upload reuse across messages/avatars; SOS fan-out N+1; unicode-confusable community names | Expire-before-act; deletion hooks; `OnboardedGuard`; rooms re-checked on connect; unique attachment indexes; batched notifications; normalized name keys |
| 3–4 | Low (×6) | Unread-count cap, socket flood limits, dispatch idempotency and others | See commit `ac3c3bc` |

Phase 6 changes reviewed in this pass: admin role re-read per request (a demoted admin loses access within the 60 s state cache, or immediately after `invalidate`); system SOS cancellations carry a `system:` prefix that user input can't produce (stripped from user reasons), so a user can't hide cancellations from the antifraud streak; notification `href`s for moderation types only accept safe ids.

## Residual risks

- **No external penetration test.** This checklist is a self-assessment.
- **OAuth providers, Twilio, S3/R2 and real push services** have never been exercised end to end (mocked or console adapters in every test).
- **Antifraud v1 is heuristic.** It writes flags and applies short automatic sanctions; false positives are possible (e.g. a burst of coordinated reports against a low-rated user blocks them for 24 h). Admins review flags in `/admin/fraud` and can unblock / lift bans. Counters for teleport and OTP lockouts live in Redis and reset if Redis is flushed.
- **Admin accounts** are created only by the seed / database; there is no second factor for admins. An admin session is as strong as the admin's phone.
- **Rate limits are per user / per IP** and rely on `TRUST_PROXY` being set correctly behind the host's proxy; a misconfigured proxy setting either lets clients spoof IPs or puts everyone behind one IP.
- **Content moderation is reactive** (reports); there is no automated content scanning of images or text.
- **Voice/video files keep their metadata** (no ffmpeg in the image).
- **Dependency scanning** (`pnpm audit`, Dependabot) isn't in CI.
- The **demo deployment** (`DEMO_MODE=true`) shows login codes on screen by design; it must never hold real users.
