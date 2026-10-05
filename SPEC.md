# AutoCommunity — SPEC

Source: `PLAN.md` (AutoCommunity development plan, based on ТЗ v1.0).
Product: a social platform for drivers — live map, communities, SOS roadside help, service-center catalog, trust rating.

Status: **Step 0 complete.** Blockers resolved by the owner on 2026-10-04 (see §8).

---

## 1. Scope

| Plan stage | In this build? | Notes |
|---|---|---|
| Stage 0 — prep (design system, schema, API contract, legal) | Yes (engineering parts) | Design system, DB schema, API.md. Legal texts = placeholder privacy/ToS pages with the required disclaimers (see A-12). |
| Stage 1 — MVP (Sprints 1–10) | **Yes, fully** | Except store publishing (TestFlight / Play) — see KNOWN_GAPS. |
| Stage 2 — v2.0 | **Yes** | Services catalog, events, feed, event/SOS group chats, notifications for all event types. |
| Stage 3 — monetization + v3.0 | **No** | Premium, business accounts, store billing, AI assistant, breakdown prediction, OBD-II, parts marketplace, insurance → KNOWN_GAPS.md. The plan itself says "after audience is built". |

MVP acceptance criterion (from plan): *a user registers, sees others on the map, joins a community, creates an SOS, receives help, leaves a rating.* This is the primary end-to-end test.

---

## 2. User roles

| Role | Scope | How obtained |
|---|---|---|
| Guest | Landing, login/registration, legal pages | — |
| User (driver) | Everything below unless restricted | Phone verification |
| Community owner | Full control of their community, assigns moderators, deletes community | Creates a community |
| Community moderator | Approve/reject join requests, remove members, delete posts/messages in the community | Assigned by owner |
| Admin (platform) | Web admin: users (search, block, warn), communities, SOS history, reports, service-center verification, antifraud review | Seeded / CLI-promoted |

Note: "helper" and "requester" are not roles — they are per-SOS relations.

---

## 3. Features (extracted)

### 3.1 Auth & account (Sprint 1–2)
- F-1 Register / log in by phone + SMS one-time code.
- F-2 Log in with Google; log in with Apple ID.
- F-3 JWT access + refresh tokens, refresh rotation, logout (revoke).
- F-4 Brute-force protection on code entry; SMS spam protection (per phone, per IP, per device limits; cooldown; CAPTCHA hook) — plan risk #10.
- F-5 Onboarding flow after first login: profile → car → location consent → privacy mode.

### 3.2 Profile & vehicles
- F-6 Profile: photo, name, nickname (unique), city, bio.
- F-7 Vehicles: brand, model, year, plate (optional). Multiple vehicles per user, one marked primary.
- F-8 Plate is **never** shown on the map; visible on profile only per privacy (plan risk #3).

### 3.3 Map, location, privacy (Sprint 3–4)
- F-9 Location sharing: foreground updates at an interval, with battery-saving throttle (min distance / min interval). Background = see A-4.
- F-10 Map of users with clustering.
- F-11 Privacy modes: Hidden / Community / Friends / Everyone. **Enforced server-side.**
- F-12 "Everyone" mode shows coordinates rounded (fuzzed); "Go invisible" one-tap button (risk #3).
- F-13 Friends: send / accept / decline / cancel request, unfriend, friend list.
- F-14 Geo queries: radius and bbox (PostGIS).

### 3.4 Communities (Sprint 5–6)
- F-15 Community CRUD; open / closed; join requests for closed.
- F-16 Moderator role: manage members, handle requests, delete content.
- F-17 Map filters: one community / several / friends / car brand.
- F-18 Community group chat.

### 3.5 SOS & chats (Sprint 7–8)
- F-19 Create SOS: type, description, photos, coordinates.
- F-20 Dispatch: find users within radius → nearest first → notify → show on map. Radius expands if nobody responds (assumption A-7).
- F-21 SOS card: requester name, rating, car, photos, distance, time.
- F-22 Actions: Help / Call / Message.
- F-23 Lifecycle: created → accepted → in_progress → closed / cancelled / expired.
- F-24 "Call 112" button on SOS screens + disclaimer (risk #5).
- F-25 Share SOS/route with a trusted contact via link (risk #4).
- F-26 Direct chats: text, photo, location, voice messages.

### 3.6 Rating & reviews (Sprint 9)
- F-27 Mutual rating after SOS close (1–5 + comment), only between requester and a confirmed helper.
- F-28 Trust rating from help, reviews, activity, tenure — weighted, capped, decaying (see A-8).
- F-29 Penalties: confirmed report −10, confirmed fake SOS −50.
- F-30 Reports on users (and on content: posts, messages, SOS).
- F-31 Rating ledger (`RatingEvents`) visible to the user ("why is my rating X").

### 3.7 Admin & antifraud (Sprint 10)
- F-32 Web admin: users (search, block, warn), communities, SOS history, reports queue.
- F-33 Antifraud v1: SOS rate limits, fake-SOS heuristics, automatic temporary blocks, minimum rating thresholds.
- F-34 Load & security testing (scripted, documented results).

### 3.8 v2.0
- F-35 Service catalog: car service (СТО), tire service, car wash, parts, tow trucks. Map + list, filters.
- F-36 Service card: name, address, phone, hours, photos, rating.
- F-37 Service reviews with visit verification (geolocation proximity / QR code / order photo).
- F-38 Service rating (reviews, visits, activity).
- F-39 Service submission by users + moderation/verification in admin.
- F-40 Events: place, date/time, participants (RSVP), route.
- F-41 Feed: posts with text, photos, video, polls. Likes + comments (assumption A-11).
- F-42 Group chats for events and SOS (requester + helpers).
- F-43 Notifications for all event types (in-app list + push).

---

## 4. User flows

1. **Onboarding**: open app → enter phone → receive code → enter code → (new user) profile form → add car → location permission explained → choose privacy mode → map.
2. **See others**: map opens at user's location → markers/clusters of visible users → tap marker → mini-card (nickname, car brand/model, rating) → open profile → add friend / message.
3. **Join community**: Communities tab → search/browse → open community → Join (open: instant; closed: request → moderator approves → notification) → community chat + community filter on map.
4. **SOS (requester)**: big SOS button → pick type → description + photos → confirm location → submit → nearby users notified → helper taps "Help" → requester sees helper, accepts → status in_progress → requester taps "Resolved" → both rate each other.
5. **SOS (helper)**: notification → SOS card (distance, car, rating, photos) → Help / Call / Message → navigate → mark arrived → after close rate requester.
6. **Report**: any profile / message / post / SOS → Report → reason → admin queue → admin confirms → penalty applied + ledger entry.
7. **Service review**: Services tab → service card → "Leave review" → verify visit (be within N meters / scan QR / attach order photo) → stars + text → rating recalculated.
8. **Event**: community → Events → create (place, time, route) → members RSVP → event chat.
9. **Admin**: admin login → dashboard → users (search, warn, block) / reports queue / SOS history / service verification / communities.

---

## 5. Data entities

From the plan schema, plus additions needed to make features work (marked ➕):

| Entity | Key fields | Notes |
|---|---|---|
| User | id, phone, name, nickname, avatar, city, bio➕, rating, privacy_mode, role➕, status➕ (active/warned/blocked), created_at | |
| AuthIdentity ➕ | user_id, provider (phone/google/apple), provider_uid | Multiple login methods per user |
| OtpCode ➕ | phone, code_hash, attempts, expires_at | SMS verification |
| RefreshToken ➕ | user_id, token_hash, device, expires_at, revoked_at | Rotation/revocation |
| Vehicle | id, user_id, brand, model, year, plate, is_primary➕ | |
| UserLocation ➕ | user_id, location geography, updated_at | Latest position only (history not stored — privacy) |
| Friend | user_id, friend_id, status | |
| Community | id, name, description, is_private, owner_id, avatar➕ | |
| CommunityMember | community_id, user_id, role (owner/moderator/member), status➕ (pending/active) | |
| SOSRequest | id, user_id, type, description, photo_urls, location, status, created_at, closed_at, radius_m➕, expires_at➕ | |
| SOSResponse | id, sos_id, helper_id, status, created_at | |
| ServiceCenter | id, name, category, address, phone, hours, location, rating, status➕ (pending/verified/rejected), qr_secret➕ | |
| Review | id, author_id, target_type (user/service), target_id, stars, comment, verified_by, ref_id➕ (SOS id / visit id) | |
| ServiceVisit ➕ | id, user_id, service_id, method (geo/qr/photo), evidence, status | Visit verification |
| Chat | id, type (direct/community/event/sos), ref_id | |
| ChatMember ➕ | chat_id, user_id, last_read_at | Direct chats, unread counts |
| Message | id, chat_id, sender_id, type (text/photo/location/voice), body, created_at, deleted_at➕ | |
| Event | id, community_id, title➕, place, location➕, starts_at, route | |
| EventParticipant ➕ | event_id, user_id, status | Plan lists "participants" |
| Post ➕ | id, author_id, community_id?, text, media, poll | Feed (v2.0) |
| PollOption / PollVote ➕, PostLike ➕, PostComment ➕ | | |
| Notification | id, user_id, type, payload, read_at | |
| PushSubscription ➕ | user_id, endpoint/token, platform | |
| RatingEvent | id, user_id, delta, reason, ref_id, created_at | |
| Report | id, reporter_id, target_type➕, target_id, reason, status | |
| AdminAction ➕ | id, admin_id, action, target, note, created_at | Audit log for warnings/blocks |
| Upload ➕ | id, owner_id, key, mime, size, width, height | File-upload checks |

---

## 6. Additions not in the plan (small essentials)

- Refresh-token revocation & "log out of all devices".
- Account deletion (required by App Store / personal-data law).
- Admin audit log.
- Unread counters for chats and notifications.
- Health-check endpoint, structured logs.
- Seed data generator (realistic users/communities/services in the pilot city).

No password reset: there are no passwords (phone OTP + OAuth only).

---

## 7. Assumptions (defaults I'm taking unless told otherwise)

- **A-1 Pilot city: Almaty.** Plan says "one city first" and references Kazakhstan law (РК). Seed data, map default center and phone format (+7) follow that.
- **A-2 External services run through adapters with working local implementations.** SMS: dev adapter logs the code to the server console (Twilio adapter ready, enabled by env). Maps: OpenStreetMap tiles via MapLibre/Leaflet by default; Mapbox token optional. File storage: S3-compatible API (MinIO locally, Cloudflare R2 in prod — same code). Push: Web Push (VAPID) + in-app; FCM adapter for native. Google/Apple sign-in: implemented, enabled only when client IDs are set in env; otherwise hidden in UI. Nothing is faked — every adapter actually works with its backing service.
- **A-3 Server-side privacy rule**: a viewer sees user U on the map iff U.mode = Everyone, or Friends and they are accepted friends, or Community and they are friends or share an active community. The position is exact only for friends and co-members of a shared *private* community (approval-gated); everyone else — including co-members of public communities — sees it fuzzed to a ~500 m grid. Hidden = never. Blocked users never visible. Location older than 15 min is not shown.
- **A-4 Background location**: not implemented on web (browsers don't allow it). Foreground updates every 30 s or 100 m, whichever comes later, while the app is open — this is the plan's own fallback (risk #8).
- **A-5 Plate**: never on map, never in API responses to non-friends.
- **A-6 SOS types**: flat tire, dead battery, out of fuel, stuck (snow/mud), breakdown, accident, tow needed, other. "Accident" shows the 112 call prominently.
- **A-7 SOS dispatch**: start radius 5 km, notify up to 20 nearest eligible users (location fresh < 15 min, not hidden... see A-3 caveat below), expand to 10 → 20 km after 5 / 10 min without response. Expire after 2 h without acceptance. **Hidden users still receive SOS alerts** about others nearby (they opt in to "receive SOS" separately) — their own position is never revealed.
- **A-8 Trust rating formula** (fixes risk #6): starts at **50** (fixes risk #7 — no dead-lock for newcomers), clamped 0–100.
  `rating = 50 + help (capped +25, each confirmed help weighted by stars, 180-day half-life) + reviews (avg stars deviation, capped ±15) + activity (capped +5) + tenure (capped +5) − penalties`. Recomputed from the `RatingEvents` ledger, so it's auditable.
- **A-9 Thresholds**: create SOS requires phone verified + rating ≥ 20; help requires rating ≥ 30. Max 3 SOS per 24 h; > 2 cancelled/fake in 7 days → auto temporary SOS ban (antifraud v1).
- **A-10 Reviews only after confirmed help**: an SOS review is allowed only if the SOSResponse reached `in_progress` and the SOS was closed (not cancelled). One review per direction per SOS.
- **A-11 Feed**: posts are global (followers not in plan) with an optional community scope; likes and comments included (a feed without them is unusable). Video: upload + playback, size-limited (50 MB), no transcoding.
- **A-12 Legal**: privacy policy, ToS with "not a replacement for emergency services 103/112" disclaimer, and explicit geolocation consent screen. Texts are drafts, marked as needing lawyer review.
- **A-13 Load/security testing**: k6 (or autocannon) script for map + SOS endpoints and an OWASP checklist run; results documented. Not a substitute for a real pentest.
- **A-14 Store publishing**: out of scope for an automated build — needs developer accounts. Listed in KNOWN_GAPS.
- **A-16 SOS phone sharing**: the plan's "Call" button would expose the requester's phone to every nearby user. Default: the requester opts in per SOS (`sharePhone`); otherwise the phone is revealed only to the accepted helper (and the helper's to the requester).
- **A-15 Repo location**: temporarily `autocommunity/` in the current repo; moves to a dedicated repo (Q-4).

---

## 8. Open questions

### Resolved blockers (owner decisions, 2026-10-04)

- **Q-1 Platform → Next.js PWA.** Flutter isn't runnable/testable in this environment. Client = mobile-first installable web app; API stays mobile-ready for a future Flutter client. Deviation from PLAN.md §0 is intentional.
- **Q-2 Scope → MVP + v2.0.** Stage 3 (monetization, v3.0) → KNOWN_GAPS.md.
- **Q-3 Third-party keys → local adapters** as in A-2. Real providers enabled via env vars later.
- **Q-4 Repo → new separate repo.** Work starts in `autocommunity/` here and moves to the new repo (with history) once the owner creates it.

### Minor (defaults chosen, no need to answer)

- Q-5 UI language: default Russian + English (i18n), Russian primary, since the pilot is Almaty.
