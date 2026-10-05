# AutoCommunity — API contract

Single source of truth for client ↔ server. Change this file **first**, then `packages/shared` zod schemas, then code.
Status per section: **FROZEN** = being built / built against; **DRAFT** = may change before its phase starts.

## 0. Conventions (FROZEN)

- Base URL: `/api/v1`. JSON, camelCase. Timestamps ISO-8601 UTC strings. IDs: UUID v7 strings.
- Auth: `Authorization: Bearer <accessToken>` on every route unless marked **public**.
- Refresh token: httpOnly cookie `ac_rt` (path `/api/v1/auth`, `SameSite=Strict`, `Secure` in prod). Cookie-authenticated routes (`/auth/refresh`, `/auth/logout`) require header `X-CSRF-Token` equal to the readable cookie `ac_csrf`.
- Errors: `{ "error": { "code": "STRING_CODE", "message": "human text", "details"?: any } }`.
  Common codes: `VALIDATION_ERROR` (400, details = zod issues), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429, details `{ retryAfterSec }`), `ACCOUNT_BLOCKED` (403), `INTERNAL` (500).
- Pagination (all lists): query `cursor?` (opaque string), `limit?` (1–50, default 20) → `{ "items": T[], "nextCursor": string | null }`.
- Coordinates: `lat` (−90..90), `lng` (−180..180) numbers. Bbox query: `bbox=minLng,minLat,maxLng,maxLat`.
- Uploads are referenced by `uploadId`; only the uploader can attach their upload, and only for the matching `purpose`.

### Shared objects

```ts
type UploadDto = { id: string; url: string; thumbUrl: string | null; mime: string; width: number | null; height: number | null; durationSec: number | null; sizeBytes: number }
type VehicleDto = { id: string; brand: string; model: string; year: number; plate: string | null; isPrimary: boolean } // plate: owner + friends only, else null
type UserPublic = {
  id: string; nickname: string; name: string; avatarUrl: string | null; city: string | null; bio: string | null;
  rating: number;                     // 0..100 trust rating
  createdAt: string;
  primaryVehicle: VehicleDto | null;
  relation: 'self' | 'none' | 'request_out' | 'request_in' | 'friend';
  status: 'active' | 'blocked';
}
type Me = Omit<UserPublic, 'nickname'> & {
  nickname: string | null;            // null until onboarding sets it
  phone: string | null; phoneVerified: boolean;
  privacyMode: 'hidden' | 'community' | 'friends' | 'everyone';
  receiveSos: boolean; role: 'user' | 'admin'; locale: 'ru' | 'en';
  onboardingCompleted: boolean; warningsCount: number;
}
type UserMini = { id: string; nickname: string; name: string; avatarUrl: string | null; rating: number }
```

---

## 1. Phase 1 — Auth, profile, vehicles, uploads (FROZEN)

| Method | Path | Auth | Body / query | Response |
|---|---|---|---|---|
| GET | `/auth/providers` | public | — | `{ google: { clientId } \| null, apple: { clientId, redirectUri } \| null, devOtp: boolean }` |
| POST | `/auth/otp/request` | public | `{ phone }` (E.164, `+7…` normalized server-side; only prefixes in `OTP_ALLOWED_PREFIXES`, default `+7`, else `400 PHONE_NOT_SUPPORTED`) | `200 { retryAfterSec: number, devCode?: string }` — `devCode` only when `SMS_PROVIDER=console` and `AUTH_EXPOSE_DEV_CODE=true` |
| POST | `/auth/otp/verify` | public | `{ phone, code }` | `200 { accessToken, user: Me, isNew: boolean }` + sets cookies |
| POST | `/auth/google` | public | `{ idToken }` | same as verify |
| POST | `/auth/apple` | public | `{ idToken, name? }` | same as verify |
| POST | `/auth/refresh` | cookie + CSRF | — | `{ accessToken }` (rotates cookie) |
| POST | `/auth/logout` | cookie + CSRF | — | `204`, always clears cookies; the session is revoked server-side only with a valid CSRF header |
| POST | `/auth/logout-all` | bearer | — | `204` (revokes all refresh tokens, disconnects sockets) |
| GET | `/me` | ✓ | — | `Me` |
| PATCH | `/me` | ✓ | `{ name?, nickname?, city?, bio?, avatarUploadId? (null removes), locale? }` | `Me` (`CONFLICT NICKNAME_TAKEN`) |
| PATCH | `/me/settings` | ✓ | `{ privacyMode?, receiveSos? }` | `Me` |
| POST | `/me/onboarding/complete` | ✓ | — | `Me` (requires name + nickname set) |
| POST | `/me/phone/request` | ✓ | `{ phone }` | like `/auth/otp/request` — only for accounts **without** a verified phone (else `409 PHONE_ALREADY_VERIFIED`; changing a phone is not supported in Phase 1). Same `200` whether or not the number is registered |
| POST | `/me/phone/verify` | ✓ | `{ phone, code }` | `Me`; code checked first, then `409 PHONE_IN_USE` if the number belongs to another account; `409 PHONE_ALREADY_VERIFIED`; 10 attempts/h per user |
| DELETE | `/me` | ✓ | `{ confirm: "DELETE" }` | `204` — anonymizes profile, deletes location, vehicles, push subs, tokens |
| GET | `/me/vehicles` | ✓ | — | `VehicleDto[]` |
| POST | `/me/vehicles` | ✓ | `{ brand, model, year, plate?, isPrimary? }` | `VehicleDto` (first vehicle is primary automatically; max 5) |
| PATCH | `/me/vehicles/:id` | ✓ | partial of above | `VehicleDto` |
| DELETE | `/me/vehicles/:id` | ✓ | — | `204` (if primary deleted, next oldest becomes primary) |
| GET | `/users/:id` | ✓ | — | `UserPublic` |
| GET | `/users/:id/vehicles` | ✓ | — | `VehicleDto[]` |
| GET | `/users` | ✓ | `q` (≥2 chars, nickname/name prefix), cursor, limit | page of `UserPublic` |
| POST | `/uploads?purpose=` | ✓ | multipart: `file`, `purpose` (query string preferred — it takes precedence and lets the server cap the stream at the per-kind limit; the multipart field is still accepted) ∈ `avatar, community, sos, message, voice, post, video, service, order`, `durationSec?` (voice/video, client-measured, clamped to limits) | `UploadDto` |
| GET | `/health` | public | — | `{ status: 'ok', db: 'ok', redis: 'ok' }` |

Rules
- Nickname: 3–24 chars `[a-z0-9_.]` with at least one letter or digit, case-insensitive unique; `RESERVED_NICKNAMES` (shared: admin, support, moderator, autocommunity, system, root, help) → `409 NICKNAME_TAKEN`. Name 1–60, single line, must contain a letter or digit. Name and bio reject control/zero-width/bidi characters (ZWJ allowed for emoji). Bio ≤ 300. City from `CITIES` list (shared).
- Vehicle: brand from `CAR_BRANDS` (shared) or free text ≤ 40; model ≤ 40; year 1950..current+1; plate ≤ 12, normalized uppercase.
- Upload limits: images (jpeg/png/webp/heic) ≤ 10 MB → re-encoded WebP, EXIF stripped, max 2048 px + 400 px thumb; voice (webm/ogg/mp4/mpeg audio) ≤ 5 MB, ≤ 3 min; video (mp4/webm) ≤ 50 MB. Type checked by magic bytes.
- Rate limits: OTP request: phone 1/60 s & 5/h, IP 20/h. OTP verify: 5 attempts per code, 10 failures/h per phone **from one IP** and 30 failures/h per phone overall → `RATE_LIMITED` (both also block new codes). Uploads 60/h per user.
- New user created on first successful verify with `nickname = null` → `onboardingCompleted=false`. Client routes to onboarding until complete. Default `privacyMode = 'community'`, `receiveSos = true`, `rating = 50`.
- Visibility: `GET /users/:id` and `/users/:id/vehicles` return `404` for users who haven't completed onboarding or deleted their account (self excepted). Blocked users are returned with `status: 'blocked'`.
- Vehicles `isPrimary`: `true` moves the primary flag; `false` on the current primary hands it to the oldest other vehicle (a lone vehicle stays primary).
- `DELETE /me` additionally removes friendships and the user's avatar uploads.
- Uploads: multipart text field `durationSec` is clamped to 180 s (voice) / 600 s (video). HEIC is accepted by type but HEVC-encoded HEIC can't be decoded by the server's image library → `415 UNSUPPORTED_FILE_TYPE` (browsers on iOS normally convert to JPEG on upload).
- `PATCH /me` with a new `avatarUploadId` (or `null`) deletes the previous avatar upload and its files. `UserPublic.status` is `'active'` once a temporary block (`blockedUntil`) has passed.
- Requests: only `application/json` bodies (≤ 100 KB) and multipart on `/uploads` are parsed — urlencoded/text bodies are ignored. `POST/PUT/PATCH/DELETE` carrying an `Origin` header outside `WEB_ORIGIN` → `403 ORIGIN_NOT_ALLOWED`. Malformed JSON → `400 INVALID_JSON`; JSON body too large → `413 PAYLOAD_TOO_LARGE`.
- Voice uploads are stored as `.weba`/`.ogg`/`.m4a`/`.mp3` and served with an `audio/*` content type.
- Refresh-token reuse also invalidates every access token of that user issued before it (all devices).
- Refresh rotation is strict: two concurrent `/auth/refresh` calls with the same cookie count as reuse and end the session. The web client must serialize refreshes (single in-flight promise, shared across tabs, e.g. Web Locks).
- Phase 1 error codes beyond §0: `OTP_INVALID` (400, details `{ attemptsLeft }`), `OTP_EXPIRED` (400, no active code / burned / used), `SESSION_EXPIRED` (401, refresh cookie missing/invalid/reused), `CSRF_FAILED` (403), `PROVIDER_DISABLED` (404), `INVALID_ID_TOKEN` (401), `SMS_UNAVAILABLE` (503), `NICKNAME_TAKEN` / `PHONE_IN_USE` / `PHONE_ALREADY_VERIFIED` / `VEHICLE_LIMIT` (409), `PHONE_NOT_SUPPORTED` (400), `ORIGIN_NOT_ALLOWED` (403), `INVALID_JSON` (400), `PAYLOAD_TOO_LARGE` (413, JSON body), `ONBOARDING_INCOMPLETE` (400, details `{ missing: ('name'|'nickname')[] }`), `INVALID_UPLOAD` (400, upload not yours / wrong purpose), `FILE_TOO_LARGE` (413), `UNSUPPORTED_FILE_TYPE` (415). `429` responses also carry a `Retry-After` header.

## 2. Phase 2 — Location, map, friends, notifications (FROZEN)

| Method | Path | Body / query | Response |
|---|---|---|---|
| PUT | `/me/location` | `{ lat, lng, accuracyM? }` | `204` (server ignores updates < 10 s apart) |
| DELETE | `/me/location` | — | `204` |
| GET | `/map/users` | `bbox`, `communityIds?` (csv), `friends?` (bool), `brand?` | `{ items: MapUser[], truncated: boolean }` (max 500) |
| GET | `/friends` | cursor, limit | page of `UserPublic` |
| GET | `/friends/requests` | `direction=in\|out`, cursor | page of `{ id, user: UserPublic, createdAt }` |
| POST | `/friends/requests` | `{ userId }` | `{ id, status }` (if a reverse request exists → auto-accept) |
| POST | `/friends/requests/:id/accept` | — | `204` |
| POST | `/friends/requests/:id/decline` | — | `204` |
| DELETE | `/friends/requests/:id` | — | `204` (cancel own) |
| DELETE | `/friends/:userId` | — | `204` |
| GET | `/notifications` | cursor, limit | page of `NotificationDto` |
| GET | `/notifications/unread-count` | — | `{ count }` |
| POST | `/notifications/:id/read` | — | `204` |
| POST | `/notifications/read-all` | — | `204` |
| GET | `/push/vapid-public-key` | — | `{ key: string \| null }` |
| POST | `/push/subscriptions` | `{ endpoint, keys: { p256dh, auth } }` | `204` |
| DELETE | `/push/subscriptions` | `{ endpoint }` | `204` |

```ts
type MapUser = { userId: string; nickname: string; avatarUrl: string | null; rating: number;
  vehicle: { brand: string; model: string } | null; lat: number; lng: number;
  approximate: boolean; relation: 'friend' | 'community' | 'public'; updatedAt: string }
type NotificationDto = { id: string; type: NotificationType; payload: Record<string, unknown>; readAt: string | null; createdAt: string }
type NotificationType = 'friend_request' | 'friend_accepted' | 'community_request' | 'community_approved' | 'community_role'
  | 'sos_nearby' | 'sos_response' | 'sos_accepted' | 'sos_status' | 'review_received' | 'message' | 'admin_warning'
  | 'event_new' | 'event_reminder' | 'post_comment' | 'post_like' | 'service_status' | 'visit_status' | 'report_resolved'
```
Privacy enforcement: see ARCHITECTURE §5. Self is never included in `/map/users`.

### Phase 2 rules and additions (FROZEN)

- **Visibility** (`/map/users`), evaluated in SQL: the target is `active`, onboarded, has a location updated < 15 min ago, isn't the viewer, and:
  - `hidden` → never;
  - `friends` → the viewer is an accepted friend;
  - `community` → the viewer is an accepted friend or shares ≥ 1 *active* community membership;
  - `everyone` → any authenticated viewer. Friends and co-members get exact coordinates; everyone else gets coordinates snapped to the centre of a ~500 m grid cell, with `approximate: true`.
  - `relation` = `friend` > `community` > `public`, the strongest that applies.
- **Filters** (combined with AND):
  - `friends=true` → friends only;
  - `communityIds` → members of those communities; only communities where the viewer is an active member are honoured, others → 403 `FORBIDDEN`;
  - `brand` → primary vehicle brand, case-insensitive.
- **Map limits:** ordered by `updated_at desc`, at most 500; `truncated: true` when more exist. The bbox may cover at most 2° × 2°, otherwise 400 `BBOX_TOO_LARGE`.
- `PUT /me/location`: a 2nd update within 10 s → `204` without writing. Positions are stored even in `hidden` mode (needed for SOS dispatch in Phase 4) but are never returned to others.
- `DELETE /me/location` removes the stored position.
- `PATCH /me/settings {privacyMode:'hidden'}` is the "go invisible" action; the client exposes it as a one-tap toggle on the map.
- **Friends:**
  - can't befriend self → 400 `INVALID_TARGET`;
  - can't befriend a blocked, deleted or un-onboarded user → 404;
  - a duplicate request → 409 `ALREADY_REQUESTED`; already friends → 409 `ALREADY_FRIENDS`;
  - only the addressee may accept or decline, only the requester may cancel → otherwise 404.
- **Notifications** created in Phase 2:
  - `friend_request` `{ requestId, user: UserMini }` to the addressee;
  - `friend_accepted` `{ user: UserMini }` to the requester.
  - Each is also pushed via Socket.IO (`notification:new`) and Web Push.
- **Web Push:**
  - VAPID keys come from env `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`. If they're unset, the API generates a key pair once and stores it in the `app_settings` table, so free hosts work without manual setup.
  - Push payload: `{ title, body, url, tag }`, localized with the recipient's `locale`.
  - Subscriptions answering 404/410 are deleted.
- **Socket.IO** namespace `/rt`, path `/socket.io`; client `auth: { token }` = access token, rejected with `connect_error` `UNAUTHORIZED`.
  - The server joins each socket to the room `user:{id}`.
  - Server → client: `notification:new NotificationDto`, `notification:count { count }`, `friends:changed {}`, `session:revoked {}`.
  - When a session is revoked (logout-all, block, refresh-token reuse), that user's sockets get `session:revoked` and are disconnected (subscribe to the existing Redis channel `auth:session-revoked`).
  - Through the same-origin proxy (demo deploy), Socket.IO must work over HTTP long-polling. The WebSocket upgrade is optional.
- **Demo live locations:** when `DEMO_LIVE_LOCATIONS=true` (default on with `DEMO_MODE`), every 60 s the API refreshes `updated_at` of seeded users who have a location, and moves each one up to ~50 m along a deterministic path. This keeps the demo map populated. It never touches real users: seeded users are marked by the `users.is_seed` flag.

### Phase 2 clarifications (added during implementation)

- **Map:**
  - Grid: cells are 0.0045° of latitude (~500 m) high and 0.0045°/cos(lat) of longitude wide (~500 m) in each latitude row; approximate users are returned at their cell's centre (stable while they stay in the cell).
  - For approximate (`public`) users the bbox test uses the *returned* point, not the exact one, so moving the bbox edge can't reveal the exact position. Their point may therefore lie up to half a cell outside the bbox, and a user just outside the bbox may appear.
  - Ties in `updated_at` are ordered by `userId` desc. A temporarily blocked user whose `blockedUntil` has passed counts as active.
  - `vehicle` is the primary vehicle (`null` if none). Bbox: `minLng < maxLng`, `minLat < maxLat` (no antimeridian wrap), else `VALIDATION_ERROR`.
- **Friends:**
  - `POST /friends/requests` → `201 { id, status: 'pending' }` for a new request; `200 { id, status: 'accepted' }` when it accepted the target's pending request (`id` is that request's id).
  - The caller must have completed onboarding → else `400 ONBOARDING_INCOMPLETE` (details `{ missing }`). Rate limit: 50 requests/h per user → `429 RATE_LIMITED`.
  - `DELETE /friends/:userId` when not friends → `404`.
  - `GET /friends` is ordered by acceptance time, newest first; `GET /friends/requests` by request time, newest first; each item's `user.relation` is `request_in` / `request_out`.
- **Notifications:** `POST /notifications/:id/read` → `404` unless the notification is the caller's; reading twice is a no-op `204`.
- **Web Push:**
  - `endpoint` must be an `https` URL of a browser push service (`*.googleapis.com`, `*.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`), else `400 INVALID_PUSH_ENDPOINT` (the server POSTs to it, so arbitrary URLs would be SSRF).
  - Subscribing an endpoint already registered by another account moves it to the caller (same browser, new account). At most 10 subscriptions per user (oldest dropped). `DELETE` is idempotent and only removes the caller's own subscription.
  - Push `url` is a web path: `/u/{userId}` (the other user) for `friend_request` and `friend_accepted`; `tag` is `friend_request:{userId}` / `friend_accepted:{userId}`.
  - `GET /push/vapid-public-key` requires auth (like every Phase 2 route); `key` is `null` only if the key pair can't be loaded.
  - Delivery runs on a BullMQ queue (one job per subscription, 5 attempts with exponential backoff on 429/5xx/network errors; other 4xx are dropped). Push failures never fail the HTTP request.
- **Socket.IO:**
  - On connect the server sends `notification:count`; it is sent again after every new notification, read and read-all.
  - `friends:changed {}` goes to both users whenever a request between them is created, accepted (also auto-accepted), declined or cancelled, and on unfriend.
  - `connect_error` always has `message: 'UNAUTHORIZED'`; `err.data.code` is `UNAUTHORIZED` or `ACCOUNT_BLOCKED`. Sockets whose `Origin` header isn't in `WEB_ORIGIN` are refused. Expiry of the access token after the handshake doesn't disconnect the socket; revocation does.
  - The web app's same-origin proxy must forward `/socket.io/*` to the API (polling works through a plain HTTP rewrite).
- **Demo live locations:** seeded users are marked by the `users.is_seed` flag (set by the seed; not a phone pattern). The tick runs once at boot and then every 60 s, one instance per tick (Redis lock). Seeded accounts someone signed in as within the last 15 min (`last_active_at`) are not moved, so a visitor's own position on the shared demo account stays put.

## 3. Phase 3 — Communities & chats (DRAFT)

```ts
type CommunityDto = { id; name; description; city; avatarUrl; isPrivate; memberCount; ownerId; chatId: string | null; // chatId only for active members
  myMembership: { role: 'owner'|'moderator'|'member'; status: 'active'|'pending' } | null; createdAt }
type ChatDto = { id; type: 'direct'|'community'|'event'|'sos'; refId: string | null; title: string; avatarUrl: string | null;
  lastMessage: MessageDto | null; unreadCount: number; peer?: UserMini }
type MessageDto = { id; chatId; sender: UserMini; type: 'text'|'photo'|'location'|'voice'|'system';
  text: string | null; upload: UploadDto | null; lat: number | null; lng: number | null; createdAt; deletedAt: string | null }
```

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/communities` | `q?`, `mine?`, `city?`, cursor | page of `CommunityDto` |
| POST | `/communities` | `{ name, description, city?, isPrivate, avatarUploadId? }` | `CommunityDto` (creator = owner) |
| GET / PATCH / DELETE | `/communities/:id` | PATCH: owner/moderator; DELETE: owner | `CommunityDto` / `204` |
| POST | `/communities/:id/join` | — | `{ status: 'active' \| 'pending' }` |
| POST | `/communities/:id/leave` | — | `204` (owner cannot leave; must transfer or delete) |
| GET | `/communities/:id/members` | `status=active\|pending` (pending: mods only), cursor | page of `{ user: UserPublic, role, status, joinedAt }` |
| POST | `/communities/:id/requests/:userId/approve` \| `/reject` | mod | `204` |
| PATCH | `/communities/:id/members/:userId` | owner: `{ role: 'moderator' \| 'member' }` | `204` |
| DELETE | `/communities/:id/members/:userId` | mod (cannot remove owner/other mods unless owner) | `204` |
| GET | `/chats` | cursor | page of `ChatDto` |
| GET | `/chats/:id` | member | `ChatDto` |
| GET | `/chats/:id/messages` | cursor (newest first) | page of `MessageDto` |
| POST | `/chats/:id/messages` | `{ type:'text', text }` \| `{ type:'photo', uploadId, text? }` \| `{ type:'location', lat, lng }` \| `{ type:'voice', uploadId }` | `MessageDto` (rate 30/min) |
| POST | `/chats/:id/read` | — | `204` |
| DELETE | `/chats/:id/messages/:messageId` | sender, or mod for community/event chats | `204` |
| POST | `/chats/direct` | `{ userId }` | `ChatDto` (get or create) |

Map filter: `/map/users?communityIds=` only accepts communities the viewer is an active member of.

**Socket.IO** namespace `/rt`, `auth: { token }`.
Client → server: `chat:join {chatId}` (ack `{ok}`), `chat:leave {chatId}`, `chat:typing {chatId}`.
Server → client: `message:new MessageDto`, `message:deleted {chatId, messageId}`, `chat:typing {chatId, user: UserMini}`, `notification:new NotificationDto`, `sos:new SosDto`, `sos:update SosDto`, `session:revoked`.

## 4. Phase 4 — SOS (DRAFT)

```ts
type SosType = 'flat_tire'|'battery'|'fuel'|'stuck'|'breakdown'|'accident'|'tow'|'other'
type SosStatus = 'created'|'accepted'|'in_progress'|'closed'|'cancelled'|'expired'
type SosDto = { id; type: SosType; description: string; photos: UploadDto[]; lat; lng; status: SosStatus;
  requester: UserPublic; distanceM: number | null; radiusM: number; createdAt; closedAt: string | null; expiresAt;
  responses: SosResponseDto[];  // full list for requester; only own response for others
  myRole: 'requester'|'helper'|'viewer'; contactPhone: string | null; chatId: string | null; canReview: boolean }
type SosResponseDto = { id; helper: UserPublic; status: 'offered'|'accepted'|'arrived'|'withdrawn'|'declined'; distanceM: number | null; createdAt }
```

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/sos` | `{ type, description (≤500), photoUploadIds (≤4), lat, lng, sharePhone: boolean }` | requires phoneVerified, rating ≥ 20, not SOS-banned, ≤ 3/24 h, no other open SOS |
| GET | `/sos/active` | — | `SosDto[]` my open SOS + ones I'm helping |
| GET | `/sos/nearby` | `lat, lng` | `SosDto[]` open SOS within 20 km (not mine) |
| GET | `/map/sos` | `bbox` | `{ items: { id, type, lat, lng, status, createdAt }[] }` |
| GET | `/sos/history` | cursor | page of `SosDto` (as requester or helper) |
| GET | `/sos/:id` | — | `SosDto` |
| POST | `/sos/:id/respond` | — | helper offers help (rating ≥ 30) |
| POST | `/sos/:id/withdraw` | — | helper withdraws |
| POST | `/sos/:id/responses/:responseId/accept` | — | requester; SOS → `accepted`; creates SOS chat |
| POST | `/sos/:id/responses/:responseId/decline` | — | requester |
| POST | `/sos/:id/arrived` | — | accepted helper or requester; → `in_progress` |
| POST | `/sos/:id/close` | — | requester; → `closed` |
| POST | `/sos/:id/cancel` | `{ reason? }` | requester; → `cancelled` |
| POST | `/sos/:id/share` | — | `{ url }` tokenized read-only link (valid until SOS ends + 1 h) |
| GET | `/public/sos/:token` | public | `{ type, status, lat, lng, requesterName, helperNickname, updatedAt }` |

`contactPhone`: requester's phone visible to viewers only if `sharePhone`; otherwise only to accepted helpers. Accepted helper's phone visible to requester.

## 5. Phase 5 — Ratings, reviews, reports (DRAFT)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/sos/:id/reviews` | `{ stars 1..5, comment? ≤500 }` | requester ↔ helper who reached `arrived`/`in_progress`, SOS `closed`; one per direction |
| GET | `/users/:id/reviews` | cursor | page of `{ id, author: UserMini, stars, comment, refType: 'sos', createdAt }` |
| GET | `/me/rating` | — | `{ rating, breakdown: { base, help, reviews, activity, tenure, penalties } }` |
| GET | `/me/rating/events` | cursor | page of `{ id, delta, reason, refId, createdAt }` |
| POST | `/reports` | `{ targetType: 'user'\|'message'\|'post'\|'comment'\|'sos'\|'community'\|'service', targetId, reason: 'spam'\|'fake_sos'\|'harassment'\|'fraud'\|'inappropriate'\|'dangerous'\|'other', details? ≤500 }` | 10/day; one open report per reporter+target |
| GET | `/me/reports` | cursor | own reports with status |

## 6. Phase 6 — Admin (DRAFT) — all require `role=admin`

`GET /admin/stats` · `GET /admin/users?q&status&cursor` · `GET /admin/users/:id` · `POST /admin/users/:id/warn {note}` · `POST /admin/users/:id/block {note, until?}` · `POST /admin/users/:id/unblock {note}` · `GET /admin/communities?q&cursor` · `DELETE /admin/communities/:id {note}` · `GET /admin/sos?status&cursor` · `GET /admin/sos/:id` · `POST /admin/sos/:id/mark-fake {note}` · `GET /admin/reports?status=open|confirmed|dismissed&cursor` · `POST /admin/reports/:id/resolve {decision:'confirm'|'dismiss', note}` · `GET /admin/fraud-flags?cursor` · `GET /admin/audit?cursor` · `GET /admin/services?status&cursor` · `POST /admin/services/:id/verify|reject {note}` · `GET /admin/services/:id/qr` · `GET /admin/visits?status=pending` · `POST /admin/visits/:id/approve|reject`

## 7. Phase 7 — Services (FROZEN, built in parallel with Phase 2)

```ts
type ServiceCategory = 'repair' | 'tires' | 'wash' | 'parts' | 'tow'
type ServiceHours = Record<'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun', string | null> // "09:00-19:00", "00:00-24:00" = 24h, null = closed
type ServiceDto = { id; name; category: ServiceCategory; description; address; phone: string | null; hours: ServiceHours;
  photos: UploadDto[]; lat; lng; rating: number; reviewCount: number; visitCount: number;
  status: 'pending'|'verified'|'rejected'; distanceM: number | null; openNow: boolean | null; // Asia/Almaty time
  myVisit: { id; method; status: 'pending'|'verified'|'rejected'; createdAt; reviewed: boolean } | null }  // latest visit of the viewer
type ServiceListItem = Omit<ServiceDto, 'description'|'hours'|'photos'|'myVisit'> & { photoUrl: string | null }
type ServiceReviewDto = { id; author: UserMini; stars: 1..5; comment: string | null; visitMethod: 'geo'|'qr'|'photo'; createdAt }
type VisitDto = { id; serviceId; method: 'geo'|'qr'|'photo'; status: 'pending'|'verified'|'rejected'; distanceM: number | null; createdAt }
```

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/services` | `category?`, `q?` (name/address, ≥2 chars), `lat?`+`lng?`, `sort=distance\|rating` (distance requires lat/lng), cursor | page of `ServiceListItem`, only `verified` |
| GET | `/map/services` | `bbox` (≤ 2°×2°), `category?` | `{ items: { id, name, category, lat, lng, rating }[], truncated }` max 500, verified only |
| GET | `/services/:id` | `lat?`, `lng?` | `ServiceDto`. Pending/rejected visible only to the submitter (and admins) |
| POST | `/services` | `{ name 2..80, category, description ≤1000, address 5..200, phone? (E.164), hours, lat, lng, photoUploadIds ≤6 (purpose service) }` | → `ServiceDto` with `status:'pending'`. 5 submissions/day per user. Duplicate guard: same category within 30 m and similar name → 409 `SERVICE_DUPLICATE` |
| GET | `/services/:id/reviews` | cursor | page of `ServiceReviewDto` (newest first) |
| POST | `/services/:id/visits` | `{ method:'geo', lat, lng }` \| `{ method:'qr', code }` \| `{ method:'photo', uploadId }` (purpose order) | → `VisitDto`. geo: verified if ≤150 m from the service, else 422 `TOO_FAR` (details `{distanceM}`). qr: code = HMAC of the service's `qr_secret` + current day (valid today and yesterday); wrong → 422 `INVALID_QR`. photo → `pending` (admin review in Phase 6). Limit 1 verified/pending visit per service per user per 24 h → 409 `VISIT_EXISTS` |
| POST | `/services/:id/reviews` | `{ visitId, stars 1..5, comment? ≤1000 }` | the visit must be the caller's and `verified`, unused → else 403 `VISIT_REQUIRED`. 1 review per visit; max 1 review per service per user per 30 days → 409 `REVIEW_COOLDOWN` |
| GET | `/services/:id/qr` | — | admin only: `{ code, validFor: 'today' }` (for printing at the service; rendered as a QR image client-side). Admin UI comes in Phase 6 |

**Service rating:** `rating` = Bayesian average of stars (prior: 3.5 with weight 5) shown to 1 decimal; `reviewCount` / `visitCount` count verified items only. Recomputed transactionally on each review or visit. The sort by rating uses `rating desc, reviewCount desc`.

**Seed:** about 40 verified services across Almaty, all categories, with plausible fictional names (not real businesses), addresses, hours, phones in `+7 727 …` format, a few reviews from seed users, and 2 `pending` submissions.

## 8. Phase 8 — Events & feed (DRAFT)

Events: `GET /events?communityId&scope=upcoming|past&cursor` · `POST /communities/:id/events {title, description, place, lat, lng, startsAt, endsAt?, route?: [lng,lat][]}` (mods) · `GET|PATCH|DELETE /events/:id` · `POST /events/:id/rsvp {status:'going'|'interested'|'none'}` · `GET /events/:id/participants?cursor` · `GET /map/events?bbox`
Feed: `GET /feed?communityId&authorId&cursor` · `POST /posts {text?, mediaUploadIds?, communityId?, poll?: {question, options (2–6), multiple}}` · `DELETE /posts/:id` · `POST|DELETE /posts/:id/like` · `GET|POST /posts/:id/comments` · `DELETE /comments/:id` · `POST /posts/:id/poll/vote {optionIds}`
