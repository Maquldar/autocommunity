# Known gaps

Features from PLAN.md that are not in this build, with the reason. Updated every phase.

| Plan item | Status | Reason |
|---|---|---|
| Flutter native app (PLAN §0) | Replaced by a PWA | Owner decision Q-1: Flutter can't be run or tested in the build environment. The API is client-agnostic, so a Flutter client can be added later. |
| Background location ("Always") | Not possible on web | Browsers only give location while the app is open. This is the plan's own fallback (risk #8). |
| Publishing to App Store / Google Play, TestFlight beta | Out of scope | Needs developer accounts and store review. A PWA installs from the browser instead. |
| Business accounts for service centers, store billing (Stage 3) | Out of scope | Owner decision Q-2. Premium and the coin wallet were built in Phase 9 (owner decision 2026-10-06); business accounts and App Store / Google Play billing were not. |
| Real payment provider (CloudPayments, Kaspi) | Adapter interface only | Phase 9 ships the `demo` provider with an in-app checkout. A real provider needs a merchant account, keys and a signed webhook (`POST /payments/webhook/:provider` is reserved in API.md §9.1). |
| Coin cash-out | Deliberately not built | Keeps coins out of e-money regulation (SPEC §9.2). |
| Premium perks without an existing limit | Not invented | Phase 9 only doubles limits that already existed (vehicles, post images, owned communities, memberships). There is nothing to hook these into, so they are not perks: an ad-free mode (the app has no ads), priority SOS dispatch (SOS stays equal and free for everyone by owner decision), larger upload sizes, longer chat or location history, extra map filters, custom profile themes beyond the premium frame, more events per day (the event limit is an anti-spam rate limit, not a product quota), more friend requests or reports per day (anti-abuse limits). |
| AI assistant, breakdown prediction, OBD-II, parts marketplace, insurance (v3.0) | Out of scope | Owner decision Q-2. |
| Real SMS / Google / Apple / Mapbox / R2 / FCM | Adapters built, providers off | Owner decision Q-3: no credentials yet. SMS codes go to the server log (and the dev-code hint), maps use OpenStreetMap, storage uses local disk (the S3/R2 driver is the same code path), push uses Web Push. |
| Legal texts (privacy policy, ToS, personal-data consent under KZ law) | Drafts | They need review by a lawyer before launch. |
| Public demo (Render free plan) | Ready to deploy, not deployed | No hosting account in the build environment; the owner deploys with one click (DEPLOY.md). Demo mode shows login codes on screen, the service sleeps when idle, and the free database expires after 30 days. Photos are stored in Postgres because the free plan has no disk. |

## Known issues in the built features

| Issue | Why it's left |
|---|---|
| Duplicate SOS photo detection uses an exact hash of the re-encoded image, so re-uploading a downloaded photo is not caught | Needs a perceptual hash (dHash); this is low impact, and the photo is still visible to admins |
| A report about an admin can't be resolved by any admin (it stays open) | Deliberate: admins never moderate other admins. A super-admin role would be needed |
| The CSP allows inline scripts (`'unsafe-inline'`) | Next.js's inline bootstrap needs it without nonce middleware. No XSS was found; nonce CSP is the next hardening step |
| Phase 8 posts use a smaller report dialog than the rest of the app | Cosmetic; both send the same report API |
| A socket that connects at the same moment as its removal from a chat can get one event for about 1–3 ms | Rooms are re-checked right after the connection; the window is one DB query |
| Uploads used as service photos are not in the exclusive-attachment check | The services module was built in parallel; low impact, since the owner uploads their own photos |
| The free Render plan has 512 MB of RAM, sleeps when idle, and its database expires after 30 days | Hosting limits; DEPLOY.md explains how to upgrade |

