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
- Rate limits: OTP request: phone 1/60 s & 5/h, IP 20/h. OTP verify: 5 attempts per code, 10 failures/h per phone **from one IP** and 30 failures/h per phone overall → `RATE_LIMITED` (both also block new codes). Uploads 60/h per user, at most 2 in flight per user and 300 MB per rolling 24 h per user (→ `429 RATE_LIMITED`). Without `?purpose=` the stream is capped at the image limit (10 MB) — send `?purpose=video` / `voice` for those. Uploads never attached to anything are deleted 24 h after upload (hourly job).
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
  - `everyone` → any authenticated viewer.
  - **Exact vs approximate** (applies to `community` and `everyone` targets): exact coordinates go only to friends and to co-members of a shared **private** community (membership is approval-gated). Everyone else who may see the target — including co-members of public communities only — gets coordinates snapped to the centre of a ~500 m grid cell, with `approximate: true` (co-members keep `relation: 'community'`).
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

- **Review fixes (Phase 2 audit):**
  - `GET /map/users` requires a completed onboarding → `403 ONBOARDING_INCOMPLETE`; rate limit 60/min per user → `429`. Approximate entries have `updatedAt` rounded down to the minute and are ordered by that value.
  - Friend requests: after a decline or a cancel, the same requester can't ask the same person again for 24 h → `409 FRIEND_REQUEST_COOLDOWN` (details `{ retryAfterSec }`); the reverse direction is not affected. The `friend_request` notification is deleted when the request is accepted (also auto-accepted), declined or cancelled (a `notification:count` follows). Accept re-checks that the requester is still active and onboarded → else `404`.
  - JSON bodies take real numbers only (no string coercion): `PUT /me/location` (`lat`, `lng`, `accuracyM`), message `location`, and vehicle `year` (`vehicleBodySchema` / `updateVehicleBodySchema` in shared; `vehicleSchema` still coerces for web forms). Query strings keep coercion.
  - Account deletion: the user's own notifications are deleted; in other users' notifications the user (`payload.user`) is replaced by `{ id, nickname: '', name: 'Deleted user', avatarUrl: null, rating: 0 }`, and their pending `friend_request` notifications are deleted. (Actors are snapshotted at creation time, not rendered at read time.)
  - Read notifications older than 90 days are deleted by a daily job (Redis lock, at most once a day across instances). Unread ones are kept.
  - Push endpoints: exact hosts `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`; host must be `[a-z0-9.-]` (no IP literals, userinfo or non-443 ports) and parse identically with WHATWG `URL` and Node's legacy `url.parse` (what web-push uses). The normalized URL is stored. An endpoint registered to another account → `409 PUSH_ENDPOINT_IN_USE` (the client must unsubscribe on sign-out).
  - Demo live locations only move positions written by the seed (`user_locations.source = 'seed'`); `PUT /me/location` marks the row `client`, so a visitor's real position on a shared demo account is never refreshed and expires after 15 min.

- **Map:**
  - Grid: cells are 0.0045° of latitude (~500 m) high and 0.0045°/cos(lat) of longitude wide (~500 m) in each latitude row; approximate users are returned at their cell's centre (stable while they stay in the cell).
  - For approximate users the bbox test uses the *returned* point, not the exact one, so moving the bbox edge can't reveal the exact position. Their point may therefore lie up to half a cell outside the bbox, and a user just outside the bbox may appear.
  - Ties in `updated_at` are ordered by `userId` desc. A temporarily blocked user whose `blockedUntil` has passed counts as active.
  - `vehicle` is the primary vehicle (`null` if none). Bbox: `minLng < maxLng`, `minLat < maxLat` (no antimeridian wrap), else `VALIDATION_ERROR`.
- **Friends:**
  - `POST /friends/requests` → `201 { id, status: 'pending' }` for a new request; `200 { id, status: 'accepted' }` when it accepted the target's pending request (`id` is that request's id).
  - The caller must have completed onboarding → else `400 ONBOARDING_INCOMPLETE` (details `{ missing }`). Rate limit: 50 requests/h per user → `429 RATE_LIMITED`.
  - `DELETE /friends/:userId` when not friends → `404`.
  - `GET /friends` is ordered by acceptance time, newest first; `GET /friends/requests` by request time, newest first; each item's `user.relation` is `request_in` / `request_out`.
- **Notifications:** `POST /notifications/:id/read` → `404` unless the notification is the caller's; reading twice is a no-op `204`.
- **Web Push:**
  - `endpoint` must be a browser push service URL (see the review fixes above), else `400 INVALID_PUSH_ENDPOINT` (the server POSTs to it, so arbitrary URLs would be SSRF).
  - At most 10 subscriptions per user (oldest dropped). `DELETE` is idempotent and only removes the caller's own subscription.
  - Push `url` is a web path: `/u/{userId}` (the other user) for `friend_request` and `friend_accepted`; `tag` is `friend_request:{userId}` / `friend_accepted:{userId}`.
  - `GET /push/vapid-public-key` requires auth (like every Phase 2 route); `key` is `null` only if the key pair can't be loaded.
  - Delivery runs on a BullMQ queue (one job per subscription, 5 attempts with exponential backoff on 429/5xx/network errors; other 4xx are dropped). Push failures never fail the HTTP request.
- **Socket.IO:**
  - On connect the server sends `notification:count`; it is sent again after every new notification, read and read-all.
  - `friends:changed {}` goes to both users whenever a request between them is created, accepted (also auto-accepted), declined or cancelled, and on unfriend.
  - `connect_error` always has `message: 'UNAUTHORIZED'`; `err.data.code` is `UNAUTHORIZED` or `ACCOUNT_BLOCKED`. Sockets whose `Origin` header isn't in `WEB_ORIGIN` are refused. Expiry of the access token after the handshake doesn't disconnect the socket; revocation does.
  - The web app's same-origin proxy must forward `/socket.io/*` to the API (polling works through a plain HTTP rewrite).
- **Demo live locations:** seeded users are marked by the `users.is_seed` flag (set by the seed; not a phone pattern), and only their seed-written positions (`source = 'seed'`) move. The tick runs once at boot and then every 60 s, one instance per tick (Redis lock).

## 3. Phase 3 — Communities & chats (FROZEN)

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

### Phase 3 rules (FROZEN)

- **Scope:** the chat engine serves all chat types. Phase 3 ships `community` and `direct` chats, with all four message types (text, photo, location, voice). `event` and `sos` chats reuse it later.
- **Communities:**
  - name 3–60 characters, unique among non-deleted communities (case-insensitive) → 409 `COMMUNITY_NAME_TAKEN`; description ≤ 1000; city from `CITIES`; avatar upload with purpose `community`.
  - Each user can create at most 10 communities → 409 `COMMUNITY_LIMIT`. Creating one also creates its community chat with the owner as a member.
  - DELETE is a soft delete (`deleted_at`): members lose chat access and the community disappears from lists.
- **Joining:** a public community → `active` immediately and the user is added to the chat. A private one → `pending`; moderators get a `community_request` notification `{ communityId, communityName, user: UserMini }`. Approval → `active`, chat membership, and a `community_approved` notification to the user. Reject deletes the pending row silently.
- **Repeats and limits:** joining again when already active or pending → 409 `ALREADY_MEMBER`. A user can belong to (or have pending requests in) at most 50 communities → 409 `MEMBERSHIP_LIMIT`.
- **Roles:** the owner can promote members to moderator or demote them, and transfer ownership (`PATCH /communities/:id/members/:userId {role:'owner'}`), which makes the old owner a moderator. Moderators can approve or reject requests, remove members (not the owner or other moderators), delete messages in the community chat, and edit name, description and avatar. Promoting or demoting sends a `community_role` notification.
- **Leaving:** leave or removal → leaves the chat as well; `memberCount` is kept consistent transactionally.
- **Visibility:**
  - Private communities appear in search with name, description and memberCount, but members and chat are visible only to active members.
  - `GET /communities?mine=true` returns the viewer's active and pending communities.
  - `q` searches by name prefix or substring; results are ordered by memberCount desc, then name.
- **Chats:**
  - Only chat members can read or write. `GET /chats` is ordered by `lastMessageAt desc`, and `unreadCount` counts messages after `lastReadAt` that aren't the viewer's own.
  - **Direct chat:** created for any two active, onboarded users, unless the target has blocked DMs (not in scope). Its `title` and `avatarUrl` are the peer's.
  - **Message limits:** text 1–4000 characters; photo must be an upload with purpose `message`; voice must be an upload with purpose `voice`; location must be valid coordinates.
  - Deleted messages keep their row, with `deletedAt` set and `text`/`upload` nulled in responses.
  - Rate limit: 30 messages/min per user → 429.
- **Realtime:**
  - The server automatically joins every socket to `chat:{id}` for all chats of the user on connect, and on join/leave changes. `chat:join` is still available, with an ack, for chats joined while connected.
  - Events: `message:new` to `chat:{id}`, `message:deleted`, `chat:typing` (throttled to 1 per 3 s per user per chat, never to self), and `chat:read { chatId, userId, lastReadAt }`.
  - Membership changes emit `chats:changed {}` to the affected user.
- **Push and notifications:** a new message in a direct chat creates no notification row (chats have their own unread counters) but sends Web Push, unless the recipient is currently connected to the chat's room. Community chats don't push (too noisy), except mentions — out of scope.
- **Map filter:** `communityIds` works with real memberships now.
- **Seed:** 6 communities in Almaty (e.g. a Land Cruiser club, a Toyota club, an offroad 4x4 group, an EV owners group, women drivers Almaty, a private "Night drive" club). The demo user is a member of 2 and has a pending request to the private one. There are realistic chat histories (Russian) in the community chats and 2 direct chats with friends.

**Socket.IO** namespace `/rt`, `auth: { token }`.
Client → server: `chat:join {chatId}` (ack `{ok}`), `chat:leave {chatId}`, `chat:typing {chatId}`.
Server → client: `message:new MessageDto`, `message:deleted {chatId, messageId}`, `chat:typing {chatId, user: UserMini}`, `notification:new NotificationDto`, `sos:new SosDto`, `sos:update SosDto`, `session:revoked`.

### Phase 3 clarifications (added during implementation)

- **Shared:** schemas and types live in `packages/shared/src/communities.ts` (`CommunityDto`, `CommunityMemberDto`, `ChatDto`, `MessageDto`, event payloads, `COMMUNITY_LIMITS`, `CHAT_LIMITS`, request schemas). `ServerToClientEvents` / `ClientToServerEvents` in `types.ts` include the chat events.
- **Communities:**
  - `POST /communities` → `201 CommunityDto`; `POST /communities/:id/join` → `200 { status }`.
  - Unknown or deleted community → `404` on every route. Acting without the required role → `403 FORBIDDEN`.
  - `PATCH`: moderators may change `name`, `description`, `avatarUploadId` (null removes; the old avatar upload is deleted); `city` and `isPrivate` are owner-only (`403` for moderators). Making a private community public doesn't approve pending requests.
  - `POST /communities/:id/leave`: the owner → `400 OWNER_CANNOT_LEAVE`; a pending user leaving cancels the request; not a member → `404`.
  - Members list item: `{ user: UserPublic, role, status, joinedAt: string | null (null while pending), requestedAt }`, newest first. `status=active` of a public community is visible to every signed-in user; of a private one to active members only (`403` otherwise). `status=pending` → owner/moderators only.
  - approve/reject a user who has no pending request → `404`.
  - `PATCH /members/:userId`: owner only; target must be an active member (`404`); targeting yourself → `400 INVALID_TARGET`; same role → no-op `204` without notification. Transfer to a user who already owns 10 communities → `409 COMMUNITY_LIMIT`.
  - `DELETE /members/:userId` also removes pending requests; targeting yourself → `400 INVALID_TARGET` (use leave).
  - `community_role` payload: `{ communityId, communityName, role }` (also sent to the new owner on transfer). `community_approved`: `{ communityId, communityName }`. All three community notifications are pushed (ru/en) with `url` `/communities/{id}` (`/communities/{id}/requests` for requests).
  - `GET /communities`: `q` (1–60 chars) matches a case-insensitive substring (prefix included; LIKE wildcards are literal), `city` from `CITIES`, `mine=true` = active and pending. Cursor is opaque (keyset on memberCount desc, name, id).
  - Account deletion leaves all communities (memberCount kept) and soft-deletes communities the user owns.
- **Chats:**
  - A chat the caller isn't a member of (or whose community is deleted) → `404` on every chat route (existence isn't revealed).
  - `POST /chats/direct` → `200 ChatDto` (get or create; one chat per pair even under concurrent calls); self → `400 INVALID_TARGET`; missing/blocked/deleted/un-onboarded peer → `404`. `refId` is `null` for direct chats; `title` = peer name (nickname if empty).
  - `POST /chats/:id/messages` → `201 MessageDto`. Photo `text` is optional (≤ 4000). An upload that isn't the caller's or has the wrong purpose → `400 INVALID_UPLOAD`.
  - Unread counts exclude deleted messages and your own; sending a message marks the chat read up to it; joining a community starts with nothing unread (history stays readable).
  - `DELETE /chats/:id/messages/:messageId`: sender, or an active owner/moderator for community chats (`403` otherwise); unknown message → `404`; deleting twice is a no-op `204`. Deleted messages also withhold `lat`/`lng`, and the attached upload (file) is deleted.
  - Rate limit 30 messages/min per user → `429 RATE_LIMITED` with `Retry-After`.
  - `GET /chats` keyset is on (`lastMessageAt`, id); chats without messages sort by creation time.
- **Realtime:**
  - `chat:read { chatId, userId, lastReadAt }` goes to the chat room (all members' sockets, including the reader's other tabs).
  - `chat:join` acks `{ ok: false }` for chats the user can't access; `chat:typing` from a socket not in the room is ignored; typing goes to every socket in the room except all of the typer's sockets.
  - `chats:changed {}` goes to the affected user(s) on: community create, join (public), approve, leave, removal, community delete (all former chat members), and direct-chat creation (both users).
  - Direct-message push: `{ title: sender name, body: text preview (≤ 120 chars) or a localized media label, url: '/chats/{chatId}', tag: 'chat:{chatId}' }`, skipped when any socket of the recipient is in the chat room (with auto-join that means: connected).

## 4. Phase 4 — SOS (FROZEN)

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

### Phase 4 rules (FROZEN)

- **Create** (`POST /sos`):
  - Requires `phoneVerified`, rating ≥ 20 (`RATING.sosCreateMin`), not `sosBannedUntil > now`, ≤ 3 SOS per rolling 24 h, and no other SOS of the user in `created|accepted|in_progress`.
  - Errors: 403 `PHONE_NOT_VERIFIED` | `RATING_TOO_LOW` | `SOS_BANNED` (details `{until}`); 429 `SOS_RATE_LIMIT`; 409 `SOS_ALREADY_OPEN`.
  - Photos must be the caller's uploads with purpose `sos` (≤ 4).
  - On creation the requester's location is also upserted (source client).
  - `expiresAt` = createdAt + 2 h.
- **Dispatch** (BullMQ job `sos.dispatch`, immediately, then delayed re-runs at +5 min with radius 10 km and +10 min with 20 km, only while the status is still `created`):
  - Candidates are `active` onboarded users with `receive_sos = true` and rating ≥ 30, excluding the requester, with a location < 15 min old, `ST_DWithin(location, sos.location, radius)`. **This includes `hidden`-mode users** (their position is used, never revealed).
  - Ordered by distance, top 20 not already in `sos_dispatches`.
  - Each candidate gets a `sos_nearby` notification `{ sosId, type, distanceM, requester: UserMini }`, a Web Push (title localized, url `/sos/{id}`, tag `sos:{id}`) and a socket `sos:new SosDto` (viewer = recipient).
  - `radiusM` on the SOS is updated to the current radius.
- **Visibility:**
  - `GET /sos/:id` is allowed for the requester, any responder, and users within 20 km of the SOS (by their last location) or who were dispatched.
  - Others → 404.
  - The public share link is separate.
  - `GET /sos/nearby` and `GET /map/sos` return open (`created|accepted|in_progress`) SOS within 20 km / the bbox, excluding the viewer's own.
- **Lifecycle:**
  - `respond` (helper; rating ≥ 30, receive not required, not the requester, SOS status `created|accepted`) → response `offered`, and notify the requester `sos_response`.
    - Max 10 active offers per SOS.
    - A helper may have at most 1 response in `accepted|arrived` across all SOS.
  - `withdraw`: helper, status `offered|accepted` → `withdrawn`. If no accepted helper remains, the SOS goes back to `created` (dispatch does not restart).
  - `accept` (requester; response `offered`) → response `accepted`.
    - The SOS becomes `accepted` (first time sets `acceptedAt`).
    - Other offers stay `offered` (several helpers can be accepted, max 3).
    - Creates or extends the SOS group chat (type `sos`, refId = sosId) with requester + accepted helpers, and posts system messages.
    - Notifies the helper `sos_accepted`.
  - `decline` (requester; `offered`) → `declined`.
  - `arrived` (accepted helper or requester) → that response `arrived` and the SOS `in_progress`.
  - `close` (requester; `accepted|in_progress`) → `closed`, `closedAt`.
  - `cancel` (requester; `created|accepted|in_progress`) → `cancelled`.
  - Job `sos.expire` at `expiresAt`: if still `created` → `expired`.
  - Every transition emits `sos:update` to room `sos:{id}` (requester, responders and dispatched users) and a `sos_status` notification to the counterpart(s).
  - Invalid transitions → 409 `SOS_INVALID_STATE`.
- **Contact:**
  - `contactPhone` = the requester's phone when `sharePhone` is true (any viewer allowed to see the SOS), or when the viewer is an accepted helper.
  - The requester sees `contactPhone` of each accepted helper inside `responses[].helperPhone` (field added to `SosResponseDto`: `helperPhone: string | null`).
  - Never exposed otherwise.
- **Share link:**
  - `POST /sos/:id/share` (requester) returns `{ url: "<WEB_ORIGIN>/s/<token>" }`, a 32-byte random base64url token, stored hashed.
  - `GET /public/sos/:token` (public, rate-limited 60/min/IP) returns the type, status, exact lat/lng, the requester's first name, accepted helper nicknames and `updatedAt`, while the SOS is open or until 1 h after it ended; then 404.
- **`canReview`:** false in Phase 4 (reviews are Phase 5) — always return false.
- **Distances:** `distanceM` is from the viewer's last location (null if none).
- **Seed:** 1 open SOS near central Almaty from a seed user (flat_tire, with a photo), 1 closed SOS where the demo user helped, and 1 expired.
- **Realtime:** sockets auto-join `sos:{id}` for SOS where the user is requester/responder/dispatched; `chat:{id}` for SOS chats as usual.

### Phase 4 clarifications (added during implementation)

- **Shared:** `packages/shared/src/sos.ts`: `SosDto`, `SosResponseDto` (with `helperPhone`), `SosMapItem`, `PublicSosDto`, `SosType`, `SosStatus`, `SOS_OPEN_STATUSES`, `SOS_LIMITS`, `createSosSchema`, `cancelSosSchema`, `sosNearbyQuerySchema`. `ServerToClientEvents` has `sos:new` / `sos:update`.
- **Status codes:** `POST /sos` → `201 SosDto`. Every lifecycle `POST` (`respond`, `withdraw`, `accept`, `decline`, `arrived`, `close`, `cancel`) → `200 SosDto` rendered for the caller. `share` → `200 { url }`.
- **Errors beyond the frozen list:**
  - `409 SOS_HELPER_LIMIT`: accepting a 4th helper.
  - `409 SOS_HELPER_BUSY`: the helper already has an accepted/arrived response in another *open* SOS.
  - `409 SOS_OFFER_LIMIT`: an 11th live offer.
  - `403 RATING_TOO_LOW` on respond (rating < 30).
  - `400 INVALID_TARGET`: responding to your own SOS.
  - `403 FORBIDDEN`: a requester-only action by someone who can see the SOS.
  - `404`: the SOS isn't visible to the caller (every route), or the response id doesn't belong to it.
  - Photos that aren't the caller's `sos` uploads → `400 INVALID_UPLOAD`.
  - `SOS_RATE_LIMIT` carries `details.retryAfterSec` and a `Retry-After` header.
- **Gate order on create:** phone → rating → ban → 24 h rate → already open. A partial unique index also guarantees one open SOS per user under concurrent creates.
- **Lifecycle details:**
  - A withdrawn helper may offer again; a declined one may not (`409 SOS_INVALID_STATE`). An `arrived` helper can't withdraw.
  - `accept` is also allowed while `in_progress` (the SOS stays `in_progress`).
  - `arrived` by the requester marks **every** accepted response arrived. By a helper, only their own.
  - If a withdraw would revert the SOS to `created` after `expiresAt`, it becomes `expired` instead.
- **`closedAt`** is set when the SOS ends in any way (closed, cancelled, expired); the share link's grace hour counts from it.
- **`sos_status` notification payload:** `{ sosId, status, event?, actor? }`. `event` ∈ `withdrawn` (to the requester), `declined` (to the helper), `arrived` (to the requester), `in_progress` (to helpers, when the requester marks arrival). Close/cancel go to helpers with a live response; expire goes to the requester. `accept` sends `sos_accepted` instead.
- **Payloads:** `sos_response`: `{ sosId, responseId, helper: UserMini }`. `sos_accepted`: `{ sosId, requester: UserMini }`. All four SOS notifications are pushed (ru/en) with `url` `/sos/{id}` and `tag` `sos:{id}`.
- **Phones:**
  - `contactPhone` and `helperPhone` are only filled while the SOS is open.
  - `contactPhone` is always `null` for the requester themself.
- **Distances:**
  - `responses[].distanceM` is the helper's distance to the SOS, rounded to 100 m; `null` for helpers in `hidden` mode.
  - `distanceM` is rounded to 10 m. For `/sos/nearby` it is measured from the query point, which is limited to 50 SOS.
- **Lists:**
  - `GET /map/sos` uses the same 2° × 2° bbox limit (`BBOX_TOO_LARGE`) and returns at most 500 items, newest first.
  - `GET /sos/active` = open SOS where the user is the requester or has an `offered|accepted|arrived` response.
- **Realtime:**
  - `sos:update` and `sos:new` payloads are viewer-specific, so they're sent to each participant's `user:{id}` room (requester, all responders, dispatched users), not as one emit to `sos:{id}`.
  - Sockets still auto-join `sos:{id}` for open SOS on connect and when they become participants.
- **SOS chat:**
  - Type `sos`, `refId` = SOS id. `title` is `SOS · <requester name>`, `avatarUrl` is `null`.
  - A helper who withdraws after being accepted is removed from the chat.
  - System messages: `type: 'system'`, `text` is a key for the client to localize: `sos.chat_created`, `sos.helper_accepted:<nickname>`, `sos.helper_arrived:<nickname>`, `sos.helper_withdrew:<nickname>`, `sos.closed`, `sos.cancelled`. `sender` is the user whose action caused the message.
- **Share link:**
  - Each `POST /share` rotates the token (the old link stops working). Allowed only while open (`409 SOS_INVALID_STATE` after).
  - The public response adds `helperNicknames: string[]` (`helperNickname` = the first, or `null`).
  - `requesterName` is the first word of the requester's name.
  - Unknown/expired token → `404`; more than 60 requests/min per IP → `429 RATE_LIMITED`. Responses carry `Cache-Control: no-store`; the token is redacted (`[redacted]`) in request logs.
- **Jobs:**
  - BullMQ queue `sos`: `sos.dispatch` steps at 0, +`SOS_EXPAND_DELAY_MS`, +2×`SOS_EXPAND_DELAY_MS` (default 5 min), and `sos.expire` at `expiresAt`. `expiresAt` = createdAt + `SOS_TTL_SEC` (default 7200).
  - Both env variables exist only to shorten test runs.
  - A once-a-minute sweep (Redis lock) expires overdue `created` SOS in case a delayed job was lost.
  - Dispatch is idempotent (`sos_dispatches` primary key + `ON CONFLICT`). Each step picks up to 20 *new* users.
- **Seed:** the open seeded SOS has a real 2 h expiry, so on a long-running dev/demo instance it expires 2 h after seeding (re-run the seed to get it back).

## 5. Phase 5 — Ratings, reviews, reports (FROZEN)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/sos/:id/reviews` | `{ stars 1..5, comment? ≤500 }` | requester ↔ helper who reached `arrived`/`in_progress`, SOS `closed`; one per direction |
| GET | `/users/:id/reviews` | cursor | page of `{ id, author: UserMini, stars, comment, refType: 'sos', createdAt }` |
| GET | `/me/rating` | — | `{ rating, breakdown: { base, help, reviews, activity, tenure, penalties } }` |
| GET | `/me/rating/events` | cursor | page of `{ id, delta, reason, refId, createdAt }` |
| POST | `/reports` | `{ targetType: 'user'\|'message'\|'post'\|'comment'\|'sos'\|'community'\|'service', targetId, reason: 'spam'\|'fake_sos'\|'harassment'\|'fraud'\|'inappropriate'\|'dangerous'\|'other', details? ≤500 }` | 10/day; one open report per reporter+target |
| GET | `/me/reports` | cursor | own reports with status |

### Phase 5 rules (FROZEN)

**Trust rating** (SPEC A-8; pure function `computeRating(input, now)` in `packages/shared/src/rating.ts`, unit-tested). Result: `clamp(0, 100, round(base + help + reviews + activity + tenure + penalties))`, with `base = 50`.
- **help** (cap +25): sum over *confirmed helps*, i.e. the user was a helper whose response reached `arrived` on an SOS that ended `closed`.
  - Each help is worth `3 × q × 0.5^(ageDays/180)`.
  - `q` = requester's stars / 5 if the requester reviewed the helper, else 0.6.
- **reviews** (range ±15): from all reviews *received* about the user (SOS reviews, both directions).
  - Bayesian mean `m = (Σstars + 4.0×3) / (n + 3)`; component `= clamp(-15, 15, (m - 3.5) × 10)`.
  - 0 when n = 0.
- **activity** (cap +5): `min(5, activeDays30 / 4)`. `activeDays30` = distinct days in the last 30 days with ≥ 1 of: a message sent, an SOS response, an SOS created, a review written.
- **tenure** (cap +5): `min(5, monthsSinceOnboarded × 0.5)`.
- **penalties**: sum of negative `rating_events` deltas from the last 365 days.
  - `report_confirmed` −10, `fake_sos` −50 (Phase 6 creates these). Older penalties expire.

**Recompute and ledger:**
- Rating is recomputed transactionally after each relevant event (review created, SOS closed, penalty), and by a daily job for decay, tenure and activity (Redis lock).
- Each recompute that changes the rating writes a `rating_events` row with `delta` = new − old.
  - `reason` ∈ `help_confirmed`, `review_received`, `penalty`, `recalc_daily`, `recalc`.
  - `refId` = the SOS, review or report id when there is one.
- The `users.rating` cache is updated in the same transaction.
- `GET /me/rating` → `{ rating, breakdown: { base, help, reviews, activity, tenure, penalties }, nextThresholds: { sosCreate: 20, sosHelp: 30 } }`. The breakdown is computed live, so it sums to the rating (±1 rounding).
- `GET /users/:id/rating`: same shape, readable by anyone (transparency). The ledger stays private (`/me/rating/events`).

**SOS reviews** (`POST /sos/:id/reviews`):
- Allowed when the SOS is `closed` and the pair is (requester → helper whose response reached `arrived`) or (that helper → requester).
- Body `{ targetUserId, stars, comment? }`; `targetUserId` is required because there can be several helpers.
- One review per direction per SOS → 409 `ALREADY_REVIEWED`; window 14 days after `closedAt` → 409 `REVIEW_WINDOW_CLOSED`.
- Otherwise 403 `REVIEW_NOT_ALLOWED`.
- The target gets a `review_received` notification.
- `SosDto.canReview` becomes true when the viewer has at least one pending allowed review, and `SosDto.reviewTargets: UserMini[]` lists them.
- Reviews are public on profiles (`GET /users/:id/reviews`, newest first) with author UserMini, stars, comment and createdAt.
- Authors can't edit or delete their reviews; admins can (Phase 6).

**Reports** (`POST /reports`):
- Allowed target types: `user | message | sos | community | service`. `post | comment` are accepted only after Phase 8 adds them; until then → 400 `INVALID_TARGET`.
- The target must exist and be visible to the reporter (the same visibility as reading it), else 404.
- `targetUserId` is resolved server-side: the user, message sender, SOS requester, community owner, or service submitter.
- Can't report yourself → 400 `INVALID_TARGET`.
- One `open` report per reporter + target → 409 `ALREADY_REPORTED`; 10 reports/day per reporter → 429.
- `reason='fake_sos'` only for targetType `sos`.
- `details` ≤ 500.
- Creation notifies no one (the admin queue comes in Phase 6).
- `GET /me/reports` returns the user's own reports with status and resolution note.

**SOS fixes carried into Phase 5:**
- `GET /sos/nearby` uses the viewer's stored location (< 15 min old), never arbitrary coordinates.
  - `lat`/`lng` become optional hints, ignored unless within 1 km of the stored location.
  - No fresh location → 409 `LOCATION_REQUIRED`.
- `/map/sos` keeps bbox semantics but returns only SOS within 20 km of the viewer's stored location (otherwise empty), so SOS positions can't be harvested city-wide.
- **Demo:** when `DEMO_LIVE_LOCATIONS` is on, the ticker makes sure there is always one open SOS from a seed account near the centre (re-created when the previous one expires, closes or is cancelled), so the demo always has something to help with.

### Phase 5 clarifications (added during implementation)

- **Shared:**
  - `packages/shared/src/rating.ts`: `computeRating(input, now)`, `RATING_FORMULA`, `RATING_PENALTIES`, `RatingInput`, `RatingDto`, `RatingEventDto`.
  - `reviews-reports.ts`: `ReviewDto`, `ReportDto`, `createSosReviewSchema`, `createReportSchema`, `REVIEW_LIMITS`, `REPORT_LIMITS`.
  - `SosDto` gains `reviewTargets: UserMini[]`.
- **Formula details:**
  - A "month" for tenure is 30 days.
  - Activity days are calendar days in Asia/Almaty. System chat messages don't count.
  - Help age counts from the SOS `closedAt`.
  - Breakdown components are reported with 2 decimals; the rating is computed from unrounded values, then rounded and clamped.
  - The reviews component approaches ±15 asymptotically (Bayesian prior).
- **Penalties:**
  - A penalty is one `rating_events` row with `reason: 'penalty'`, carrying the penalty points in the new columns `penalty_points` / `penalty_kind` (`report_confirmed` | `fake_sos`).
  - Its `delta` is the actual rating change (e.g. 0 when already at 0).
  - `computeRating` sums `penalty_points`, not negative deltas, so decay or recalculation deltas are never counted as penalties.
  - Phase 6 calls `RatingService.applyPenalty(userId, kind, refId)`.
- **Ledger:**
  - A recompute that doesn't change the rating writes no row; `applyPenalty` always writes one.
  - Closing an SOS recomputes every `arrived` helper (`help_confirmed`, `refId` = SOS id).
  - A review recomputes its target (`review_received`, `refId` = review id).
  - `GET /me/rating` and `/users/:id/rating` refresh a drifted cache first (`recalc`), so `rating` always matches the live breakdown.
  - Anti-farming inputs: SOS marked fake count neither as helps nor for the reviews left on them (mark-fake recomputes the helpers too, ledger reason `recalc`, `refId` = SOS id); helps for the same requester and reviews from the same author count at most once per 30 days. The ledger satisfies `50 + sum(delta) = users.rating` (the seed included).
  - `/me/rating/events` returns newest first (keyset pagination).
- **Daily job:** first run 10 min after boot, then every 24 h. A Redis lock held ~23 h means it runs once a day across instances. It covers all onboarded, non-deleted users, one short transaction per user.
- **`/users/:id/rating`, `/users/:id/reviews`:** same visibility as `GET /users/:id` (404 for deleted / un-onboarded, self excepted).
- **Reviews:**
  - `POST /sos/:id/reviews` → `201 ReviewDto`. Check order: SOS exists (404) → pair allowed (403 `REVIEW_NOT_ALLOWED`, which also covers a non-closed SOS, self, helpers who never reached `arrived`, and helper ↔ helper) → not yet reviewed (409 `ALREADY_REVIEWED`) → window (409 `REVIEW_WINDOW_CLOSED`).
  - `stars` must be an integer 1..5 (JSON number). An empty `comment` is stored as `null`.
  - `review_received` payload: `{ reviewId, sosId, stars, author: UserMini }`. Push url `/u/{authorId}?tab=reviews`.
  - Each review triggers `sos:update` so `canReview` / `reviewTargets` refresh.
- **Reports:**
  - `POST /reports` → `201 ReportDto` (`{ id, targetType, targetId, reason, details, status, resolutionNote, createdAt, resolvedAt }`).
  - Visibility per type:
    - user: onboarded and not deleted (blocked users are reportable);
    - message: the reporter can read the chat;
    - sos: the SOS visibility rule;
    - community: not deleted;
    - service: `verified`, or the reporter's own submission.
  - Reporting your own message, SOS, community or service → `400 INVALID_TARGET`.
  - `fake_sos` on a non-SOS target → `400 VALIDATION_ERROR`.
  - 10/day is a rolling 24 h → `429 RATE_LIMITED` with `details.retryAfterSec`.
  - A service without a submitter is reportable with `targetUserId = null`.
  - A partial unique index guarantees one open report per reporter + target, also under concurrency.
- **SOS hardening:**
  - `GET /sos/nearby`: `lat`/`lng` are now optional hints.
  - `/map/sos`: "within 20 km of the viewer's stored location" uses the stored position whatever its age; no stored position → empty list.
- **Demo SOS keep-alive:** runs in the demo ticker (same lock, every 60 s). When no seed account has an open SOS, it inserts one directly near the centre: rotating seed requester and type, never the two login accounts, no dispatch. It expires after `SOS_TTL_SEC` like any other.
- **Seed:** ratings are computed from the seeded data with `computeRating` (one `recalc` ledger row each). Seed data includes 4 extra closed helps between seed users and 9 reviews.

## 6. Phase 6 — Admin, antifraud, hardening (FROZEN) — all `/admin/*` require `role=admin`

`GET /admin/stats` · `GET /admin/users?q&status&cursor` · `GET /admin/users/:id` · `POST /admin/users/:id/warn {note}` · `POST /admin/users/:id/block {note, until?}` · `POST /admin/users/:id/unblock {note}` · `GET /admin/communities?q&cursor` · `DELETE /admin/communities/:id {note}` · `GET /admin/sos?status&cursor` · `GET /admin/sos/:id` · `POST /admin/sos/:id/mark-fake {note}` · `GET /admin/reports?status=open|confirmed|dismissed&cursor` · `POST /admin/reports/:id/resolve {decision:'confirm'|'dismiss', note}` · `GET /admin/fraud-flags?cursor` · `GET /admin/audit?cursor` · `GET /admin/services?status&cursor` · `POST /admin/services/:id/verify|reject {note}` · `GET /admin/services/:id/qr` · `GET /admin/visits?status=pending` · `POST /admin/visits/:id/approve|reject`


### Phase 6 rules (FROZEN)

**Common:**
- Every mutating admin action writes an `admin_actions` row (`action`, `targetType`, `targetId`, `targetUserId`, `note` required, 3–500 chars).
- Admins can't act on themselves or on other admins (403 `INVALID_TARGET`).
- Lists use keyset pagination; every list endpoint supports `q` where meaningful.
- Admin endpoints are rate-limited to 300/min per admin.

**Endpoints:**
- `GET /admin/stats`: `{ users: {total, active7d, new7d, blocked}, sos: {open, last7d, closed7d, medianFirstResponseSec7d, fakeRate30d}, reports: {open}, services: {pending}, visits: {pending}, communities: {total} }`. These cover the MVP success metrics in PLAN §8 that the data supports.
- Users:
  - `GET /admin/users?q&status&cursor`: q matches nickname, name, or phone digits.
  - `GET /admin/users/:id` → `{ user: Me-like incl. phone and status, blockedUntil, sosBannedUntil, counts: {sosCreated, helps, reportsAgainst, reportsFiled, warnings}, recentRatingEvents, recentAdminActions, fraudFlags }`.
- Warn and block:
  - `warn {note}` → `admin_warning` notification to the user (the note is shown to them).
  - `block {note, until?}` → status blocked (temporary if `until`); revokes all sessions and disconnects sockets; open SOS cancelled.
  - `unblock {note}`.
  - `sos-ban {note, until}` / `sos-unban {note}` → set or clear `sosBannedUntil`.
- Communities: `GET /admin/communities?q&cursor` (incl. deleted flag); `DELETE /admin/communities/:id {note}` → soft delete with the same side effects as an owner delete.
- SOS:
  - `GET /admin/sos?status&cursor` and `GET /admin/sos/:id` (full detail incl. responses, dispatch count, chat id, reports).
  - `POST /admin/sos/:id/mark-fake {note}` → `isFake=true`; the SOS is cancelled if open; a `fake_sos` penalty (−50) on the requester via the rating ledger (refId = sosId); the requester is notified.
- Reports:
  - `GET /admin/reports?status=open|confirmed|dismissed&targetType&cursor`, with target preview: content snippet or deleted marker, target user mini.
  - `POST /admin/reports/:id/resolve {decision:'confirm'|'dismiss', note, removeContent?: boolean}`.
  - `confirm` → `report_confirmed` penalty (−10) on `targetUserId`, plus content removal when `removeContent` (message, post and comment soft-delete — a comment decrements the post's `commentCount`; community soft-delete; service reject; SOS → treated like mark-fake when reason=fake_sos). The status change, the removal, the penalty and the audit rows commit in one transaction; a removal writes an extra audit row `report.remove_content` (`targetType` = the content type, `targetId` = the content id). If anything fails the report stays `open` and the call can be retried.
  - Neither decision is allowed on a report whose target user is the admin themselves or another admin → `403 INVALID_TARGET`.
  - Report `preview` for `post` / `comment` targets: `text` (snippet), `imageUrl` (the post's first image or video thumbnail; comments `null`), `title` (community name or `null`), `deleted` (post/comment deleted or its community deleted) and `postId` (the post itself, or the comment's parent post) — link to `/posts/{postId}`. Other target types omit `postId`.
  - Admins (`role=admin` from the account state) can `GET /posts/:id` and `GET /posts/:id/comments` for any non-deleted post regardless of community privacy or deletion.
  - The reporter gets a `report_resolved` notification `{ reportId, decision }`.
  - Other open reports with the same target are resolved with the same decision.
- `GET /admin/fraud-flags?cursor` and `GET /admin/audit?cursor&adminId&targetUserId`.
- Services (from Phase 7):
  - `GET /admin/services?status&cursor`; `POST /admin/services/:id/verify|reject {note}` → `service_status` notification to the submitter.
  - `GET /admin/visits?status=pending&cursor` (photo visits, with the photo) and `POST /admin/visits/:id/approve|reject {note}` → `visit_status` notification; approval enables review.
  - `GET /services/:id/qr` (admin) already exists.

**Antifraud v1** (automatic; every trigger writes a `fraud_flags` row `{kind, details}` and is visible in admin):
- `sos_cancel_streak`: more than 2 SOS cancelled within 30 min of creation, or marked fake, in 7 days → automatic SOS ban for 72 h, with a notification (SPEC A-9).
- `duplicate_sos_photo`: an SOS photo whose `contentHash` matches a photo from a *different* user's SOS in the last 30 days → flag only.
- `report_burst`: ≥ 3 distinct reporters with open reports against the same user within 24 h → flag, plus an automatic temporary block for 24 h if the user's rating < 30. Only credible reporters count: account ≥ 7 days old, rating ≥ 40, none of their reports ever dismissed. Concurrent reports produce one flag / one block (Redis `SET NX af:burst:{userId}`, 24 h).
- `reciprocal_sos`: two users who helped each other (closed, non-fake SOS, helper `arrived`, both directions) ≥ 2 times within 7 days → a flag on each (details `{ otherUserId, helps, sosIds }`), once per pair per 7 days; flag only.
- `location_teleport`: ≥ 3 implausible location jumps in 1 h → flag (uses the Phase 5 untrusted-location detection).
- `new_account_sos`: an SOS created by an account < 24 h old → flag only (allowed, as SPEC permits).
- `otp_abuse`: more than 3 OTP lockouts for the same phone in 24 h → flag (no user yet: `userId` null allowed, `details.phoneMasked`).

**Load and security testing** (F-34, A-13):
- `load/` contains k6 scripts for `/map/users`, `/sos/nearby`, `GET /chats` and message sending with seeded users. Run results go in `load/RESULTS.md`: p50/p95/p99, error rate and the hardware used, at 50 and 200 virtual users against a local production build.
- `SECURITY.md` holds an OWASP ASVS L1-style checklist with the status of each item and links to tests, plus a summary of the review findings fixed in Phases 1–5.

### Phase 6 clarifications (added during implementation)

- **Shared:** `packages/shared/src/admin.ts`: request schemas (`adminNoteBodySchema`, `adminBlockSchema`, `adminSosBanSchema`, `adminResolveReportSchema`, list queries), DTOs (`AdminStatsDto`, `AdminUserRow`, `AdminUserDetail`, `AdminActionDto`, `FraudFlagDto`, `AdminCommunityDto`, `AdminSosRow`/`AdminSosDetail`, `AdminReportDto` with `preview`, `AdminResolveResult`, `AdminServiceDto`, `AdminVisitDto`, `AdminServiceQrDto`), `ADMIN_ACTIONS`, `FRAUD_FLAG_KINDS`, `ANTIFRAUD` thresholds, notification payload types.
- **Status codes:** every admin `POST` → `200` (user actions return the fresh `AdminUserDetail`, mark-fake the `AdminSosDetail`, resolve `{ report, resolvedSiblings, penaltyApplied, contentRemoved }`, services/visits the updated item). `DELETE /admin/communities/:id` → `204`. Non-admins → `403 FORBIDDEN` on every route (the role is read from the account state, not the token). `GET /admin/services/:id` (one service) and `GET /admin/services/:id/qr` → `{ code, validFor: 'today', url }` (`url` = what the printed QR encodes) were added.
- **Notes:** `note` is trimmed, 3–500 chars. `until` (block, sos-ban) must be an ISO date-time in the future; sos-ban requires it, block without it is indefinite.
- **Errors:** `403 INVALID_TARGET` (self/other admin; also resolving — confirm or dismiss — a report about an admin, verifying/rejecting a service submitted by an admin, approving/rejecting an admin's visit, mark-fake on an admin's SOS, deleting an admin-owned community, moderating your own service submission or visit), `409 NOT_BLOCKED`, `409 NOT_SOS_BANNED`, `409 SOS_ALREADY_FAKE`, `409 REPORT_ALREADY_RESOLVED` (siblings included), `409 SERVICE_STATUS_UNCHANGED`, `409 VISIT_NOT_PENDING`, `429 RATE_LIMITED` (300/min/admin).
- **Users list:** `q` = case-insensitive substring of nickname or name; 3+ digits also match the phone. `status=active` includes expired temporary blocks.
- **Block side effects:** status `blocked` (+ `blockedUntil`), refresh tokens revoked and access tokens invalidated, `session:revoked` + socket disconnect, open SOS cancelled with `cancelReason = 'system:admin_blocked'` (helpers notified as usual), `admin_warning` notification.
- **Notifications:** `admin_warning` `{ kind: 'warning'|'blocked'|'sos_ban'|'fake_sos', note, until, automatic, sosId? }` (automatic sanctions use it too, `note: null, automatic: true`); `report_resolved` `{ reportId, decision: 'confirmed'|'dismissed', targetType }` to every reporter (siblings included); `service_status` `{ serviceId, serviceName, status, note }`; `visit_status` `{ visitId, serviceId, serviceName, status, note }`. All pushed (ru/en); `url` is `/notifications` for warnings and reports, `/services/{id}` for services and visits.
- **Reports:** removal per type: message → soft delete (+ file); community → owner-delete side effects; service → `rejected` (+ `service_status`); SOS with `fake_sos` → mark-fake (−50, on top of the −10). One `report_confirmed` penalty per resolution (refId = the resolved report), none for dismissals. `q` matches report details.
- **Mark-fake:** an open SOS is cancelled (`system:fake`); a closed one keeps its status. Penalty refId = SOS id.
- **Antifraud details:** counted cancellations exclude platform cancellations (`cancel_reason` prefixed `system:`; users can't send that prefix — it is stripped). The streak ban isn't re-applied while a ban is in force; `report_burst` flags at most once per 24 h per user and never blocks admins; teleport and OTP lockout counters live in Redis (sliding windows), one flag per window. An OTP lockout = the wrong guess that exhausts a failure rule (counted once per phone+IP lockout). `otp_abuse` details carry `phoneMasked`, never the number. `new_account_sos` and `duplicate_sos_photo` run in the background after the SOS is created (the request is never slowed or failed by them).

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

## 8. Phase 8 — Events & feed (FROZEN)

Events: `GET /events?communityId&scope=upcoming|past&cursor` · `POST /communities/:id/events {title, description, place, lat, lng, startsAt, endsAt?, route?: [lng,lat][]}` (mods) · `GET|PATCH|DELETE /events/:id` · `POST /events/:id/rsvp {status:'going'|'interested'|'none'}` · `GET /events/:id/participants?cursor` · `GET /map/events?bbox`
Feed: `GET /feed?communityId&authorId&cursor` · `POST /posts {text?, mediaUploadIds?, communityId?, poll?: {question, options (2–6), multiple}}` · `DELETE /posts/:id` · `POST|DELETE /posts/:id/like` · `GET|POST /posts/:id/comments` · `DELETE /comments/:id` · `POST /posts/:id/poll/vote {optionIds}`

### Phase 8 rules (FROZEN)

**Events** (F-40):
- Created by community owners and moderators: `title` 3–100, `description` ≤ 2000, `place` 2–200, lat/lng, `startsAt` in the future (≤ 1 year), `endsAt` > startsAt (optional), `route` an optional array of 2–200 `[lng,lat]` points.
- PATCH and DELETE by the creator or community moderators; delete is a hard delete that notifies participants.
- Visibility: events of public communities are visible to all users. Events of private communities are visible only to active members, else 404.
- `EventDto = { id, community: {id,name,avatarUrl,isPrivate}, createdBy: UserMini, title, description, place, lat, lng, startsAt, endsAt, route, goingCount, interestedCount, myRsvp: 'going'|'interested'|null, chatId: string|null (only when myRsvp='going'), distanceM }`.
- RSVP:
  - `going` joins the event chat (type `event`, created lazily on the first `going`); changing away from `going` leaves it.
  - RSVP is allowed only if the viewer can see the event and it hasn't ended.
  - Max 500 going → 409 `EVENT_FULL`.
- Lists:
  - `GET /events?scope=upcoming|past&communityId&cursor`: upcoming ordered by startsAt asc, past desc.
  - `GET /communities/:id/events`.
  - `GET /map/events?bbox`: upcoming within 7 days.
- Notifications:
  - `event_new` to active community members (in-app; push only to members who RSVPed to any event of that community in the past 90 days, to avoid spam);
  - `event_reminder` 2 h before start to going participants (BullMQ delayed job, rescheduled on PATCH of startsAt);
  - an update/cancel notification to participants (`event_new` with `payload.change`).
- Seed: 4 upcoming events (a Toyota club meetup, an offroad trip with a route, an EV charging meetup, a private night drive) and 1 past.

**Feed** (F-41, A-11):
- Posts are global, or scoped to a community (members only, for private ones).
- `text` ≤ 3000; media ≤ 6 uploads (images purpose `post`, or a single `video` purpose upload); a poll needs `question` 3–200 and 2–6 options of 1–80 chars, with `multiple` bool.
- At least one of text/media/poll is required.
- `PostDto = { id, author: UserMini, community: {id,name}|null, text, media: UploadDto[], poll: { question, multiple, options: [{id,text,voteCount}], myVotes: string[], totalVoters } | null, likeCount, commentCount, likedByMe, createdAt }`.
- Feed `GET /feed?scope=all|communities|friends&communityId&authorId&cursor`, newest first:
  - `all` = global posts + posts of public communities + posts of the viewer's communities;
  - `communities` = only the viewer's communities;
  - `friends` = authors who are friends.
- Deletion: the author, or a community moderator for community posts; soft delete.
- Comments:
  - 1–1000 chars, keyset ascending; deleted by the comment author, the post author or a community moderator.
  - `post_comment` notification to the post author (not self, and collapsed by a 10-min throttle per post).
- Likes: idempotent; `post_like` notification throttled to 1 per post per hour.
- Polls: votes are final; `multiple` allows several options in one vote; voting again → 409 `ALREADY_VOTED`.
- Reports: targetType `post` and `comment` are now accepted.
- Rate limits: 20 posts/day, 60 comments/hour per user.
- Seed: about 25 realistic Russian posts (photos from generated images, 3 polls) across global and community scopes, with likes and comments.

**Push for all event types** (F-43): every notification type has localized push text and a URL.

### Phase 8 clarifications (added during implementation)

- **Shared:** `packages/shared/src/events.ts` (`EVENT_LIMITS`, `EventDto`, `EventParticipantDto`, `EventMapItem`, `EventNotificationPayload`, request schemas, `eventEndsAt`) and `feed.ts` (`FEED_LIMITS`, `PostDto`, `PollDto`, `PostCommentDto`, `LikeResult`, request schemas, `textPreview`).
- **Events:**
  - `EventDto` also has `canManage: boolean` (active owner/moderator of the community, or the creator while still an active member). A creator who left or was removed gets `403` on PATCH/DELETE.
  - An event without `endsAt` counts as ended 3 h after `startsAt`. *Upcoming* = not ended, `startsAt` asc; *past* = ended, `startsAt` desc. Keyset on (`startsAt`, id).
  - `POST /communities/:id/events` → `201 EventDto`; non-moderators → `403`; unknown/deleted community → `404`. `PATCH` takes any subset of the create fields (`null` clears `endsAt` / `route`); time rules are re-checked on the merged event, and `startsAt` must be in the future only when it is sent. A PATCH that changes nothing sends no notices.
  - `GET /events?communityId=` and `GET /communities/:id/events` for a private community the viewer isn't an active member of → `403`. `GET /events/:id`, participants and RSVP for an invisible event → `404`.
  - `POST /events/:id/rsvp` → `200 EventDto`; requires onboarding; ended → `409 EVENT_ENDED`; 500 going → `409 EVENT_FULL` (checked under a row lock). Repeating the current status is a no-op.
  - `GET /events/:id/participants?status=going|interested&cursor` → page of `{ user: UserMini, status, createdAt }`, oldest RSVP first.
  - `GET /map/events?bbox` → `{ items: EventMapItem[], truncated }` (`{ id, title, place, lat, lng, startsAt, communityName, goingCount, myRsvp }`, at most 200, soonest first).
  - `distanceM` is from the viewer's stored position (any age), `null` without one.
  - The event chat's `ChatDto.title` is the event title; owners/moderators of the event's community may delete messages in it. Deleting an event deletes its chat.
  - `event_new` payload `{ eventId, communityId, communityName, title, startsAt, place, change? }`. In-app to all active members except the creator; pushed only to members with an RSVP (any event of that community) created in the last 90 days. Change notices (`change: 'updated'`) go to all participants except the actor, at most one per event per 10 min (Redis `notify:event_updated:{eventId}`); delete sends `change: 'cancelled'`. Change/cancel notices and reminders go only to participants who can still see the event (live community; public, or they are an active member).
  - Leaving or being removed from a community drops the user's RSVPs to its events (`goingCount` recomputed) and their event-chat memberships (`chats:changed`, sockets leave the rooms); deleting a community does this for everyone. Event-chat access (read, send, list) also requires the event's community to be live and public or the user an active member.
  - Rate limits: event create 10 / 24 h per user, PATCH 30 / h, RSVP 30 / min, `GET /map/events` 60 / min → `429 RATE_LIMITED`.
  - `event_reminder` (same payload, no `change`) goes once to `going` participants `EVENT_REMINDER_LEAD_MS` (env, default 2 h) before the start. BullMQ job id `event-reminder-{eventId}-{startsAtMs}`; PATCH of `startsAt` removes the old job and resets `reminderSentAt`; delete removes it; the handler re-checks the event and its `startsAt`. An event created inside the lead window gets no reminder.
- **Feed:**
  - `PostDto` and `PostCommentDto` also carry `canDelete: boolean`. `GET /posts/:id` returns one visible post (`404` otherwise; deleted posts and posts of deleted authors/communities are invisible).
  - `POST /posts` → `201 PostDto`; requires onboarding; community posts need an active membership (`403`), unknown/deleted community `404`. Media: own uploads only, all `post` (≤ 6) or exactly one `video` (mixing → `400 VALIDATION_ERROR`); not one's own / wrong purpose / already attached to another post → `400 INVALID_UPLOAD`. Poll options must differ (case-insensitive).
  - `GET /feed?communityId` of a private community the viewer isn't in → `403`. `authorId` and `communityId` narrow any scope.
  - `POST|DELETE /posts/:id/like` → `200 { likeCount, likedByMe }`.
  - `POST /posts/:id/comments` → `201 PostCommentDto`; `GET` excludes deleted comments; `DELETE /comments/:id` → `204` (soft; `commentCount` decremented).
  - `POST /posts/:id/poll/vote { optionIds }` → `200 PollDto`. No poll → `404`; several options on a single-choice poll → `400 VALIDATION_ERROR`; an option of another poll → `400 INVALID_OPTION`; second vote → `409 ALREADY_VOTED` (serialized by a row lock on the poll). `polls.total_voters` counts distinct voters.
  - `post_comment` payload `{ postId, commentId, preview, user }`, `post_like` `{ postId, preview, user }` (`preview` ≤ 120 chars). Throttles are Redis `SET NX EX` keys per post (`notify:post_comment:{postId}` 10 min, `notify:post_like:{postId}` 1 h): events inside the window create no notification.
  - Rate limits: `feed-post:{userId}` 20 / 24 h, `feed-comment:{userId}` 60 / h, `feed-like:{userId}` 120 / min (like and unlike together) → `429 RATE_LIMITED`.
- **Reports:** `post` / `comment` targets are visible when the post is (comments: not deleted); `targetUserId` is the post / comment author.
- **Push (F-43):** every `NotificationType` has ru/en text and a URL (enforced at compile time and by `push-text.spec.ts`): `event_new` → `/events/{id}` (cancelled → `/communities/{id}?tab=events`), `event_reminder` → `/events/{id}`, `post_comment`/`post_like` → `/posts/{id}`, `message` → `/chats/{chatId}`, `service_status`/`visit_status` → `/services/{serviceId}`, `admin_warning`/`report_resolved` → `/notifications`. Event times in push texts are Asia/Almaty.

## 9. Phase 9 — Wallet, premium, driver votes, vehicle violations, vehicle details, rating tiers (FROZEN)

Owner decisions (final): internal coins with no cash-out, premium for coins, driver votes, moderated vehicle violations, detailed vehicles, rating tiers. Shared: `packages/shared/src/wallet.ts` (wallet, payments, premium), `votes.ts`, `violations.ts`, `tiers.ts`; vehicle details in `schemas.ts`; new rating component in `rating.ts`.

### 9.0 Changes to shared objects

```ts
type UserMini = { id; nickname; name; avatarUrl; rating; isPremium: boolean }   // tier: compute with tierForRating(rating)
type UserPublic = { ...; isPremium: boolean; profileFrame: 'premium' | null; tier: RatingTier }  // Me inherits them
type RatingTier = 'warning' | 'none' | 'bronze' | 'silver' | 'gold' | 'platinum'
type VehicleDto = { id; brand; model; year; plate; isPrimary;
  engineVolumeL: number | null; fuel: VehicleFuel | null; transmission: VehicleTransmission | null; drive: VehicleDrive | null;
  bodyType: VehicleBodyType | null; color: VehicleColor | null; mileageKm: number | null; description: string | null; photos: UploadDto[] }
type OwnVehicleDto = VehicleDto & { vin: string | null }          // GET/POST/PATCH /me/vehicles only
type VehicleDetailDto = VehicleDto & { owner: UserMini; approvedViolations: number }
type RatingBreakdown = { base; help; reviews; activity; tenure; votes; penalties }   // `votes` is new
```

- `isPremium` is true while the user's premium period hasn't ended (`currentPeriodEnd > now`), on every rendering of the user (UserMini everywhere, UserPublic, Me). Notification payloads snapshot `UserMini` at creation time, so payloads stored before Phase 9 lack `isPremium` — clients treat a missing value as `false`.
- `tierForRating(rating)` (shared, pure): 0–29 `warning` (a visible red "низкое доверие" marker), 30–49 `none`, 50–64 `bronze`, 65–79 `silver`, 80–89 `gold`, 90–100 `platinum`. UserPublic / Me carry `tier`; for UserMini the client calls the same function.
- New `NotificationType`s: `wallet_received`, `wallet_admin`, `premium_reminder`, `premium_renewed`, `premium_expired`, `vote_received`, `violation_reported`, `violation_status` (payloads below; all pushed, ru/en).
- New upload purposes (images, same pipeline as `post`): `vehicle`, `violation`.
- New `RatingEventReason`s: `vote_received` (refId = vote id), `penalty_reversed` (refId = violation id). New penalty kind `violation` (−5).
- New `FRAUD_FLAG_KINDS`: `wallet_funnel`, `vote_burst`, `violation_rejections`. New `ADMIN_ACTIONS`: `wallet.adjust`, `wallet.freeze`, `wallet.unfreeze`, `vote.remove`, `violation.approve`, `violation.reject`, `violation.uphold`, `violation.remove`.
- New error codes: `INSUFFICIENT_FUNDS` (409), `WALLET_FROZEN` (403), `RECIPIENT_UNAVAILABLE` (409), `TRANSFER_DAILY_CAP` (409), `IDEMPOTENCY_KEY_REUSED` (409), `ACCOUNT_TOO_NEW` (403), `TOPUP_NOT_PENDING` (409), `TOPUP_EXPIRED` (409), `PAYMENT_DECLINED` (402), `ALREADY_PREMIUM` (409), `NOT_PREMIUM` (409), `WALLET_ALREADY_FROZEN` (409), `WALLET_NOT_FROZEN` (409), `ALREADY_VOTED` (409), `MEDIA_LIMIT` (400), `VIOLATION_INVALID_STATE` (409), `ALREADY_DISPUTED` (409). Reused: `RATING_TOO_LOW` (403), `INVALID_TARGET`, `INVALID_UPLOAD`, `RATE_LIMITED`, `VEHICLE_LIMIT` / `COMMUNITY_LIMIT` / `MEMBERSHIP_LIMIT` (now with `details { limit, premiumLimit }`).

### 9.1 Wallet

1 coin = 1 ₸; the UI calls them "монеты". **No cash-out** (SPEC §9). Every balance change is one row in the immutable ledger `wallet_transactions` written in the same transaction as the `wallets.balance` update (`balance >= 0` is a DB CHECK; `balance_after` = the balance after that row). A wallet is created lazily (balance 0) on first use.

```ts
type WalletTxKind = 'topup' | 'transfer_out' | 'transfer_in' | 'subscription' | 'admin_adjust' | 'refund'
type WalletDto = { balance: number; frozen: boolean; premium: PremiumDto; transferDailyRemaining: number }
type WalletTransactionDto = { id; kind: WalletTxKind; amount: number /* signed */; balanceAfter: number;
  counterparty: UserMini | null /* transfers */; ref: string | null; note: string | null; createdAt }
type TopupDto = { id; amount; status: 'pending'|'succeeded'|'declined'|'expired'; provider: 'demo'; cardLast4: string | null; createdAt; expiresAt; completedAt: string | null }
```

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/wallet` | — | `WalletDto` |
| GET | `/wallet/transactions` | `kind?`, cursor, limit | page of `WalletTransactionDto`, newest first |
| POST | `/wallet/topups` | `{ amount }` (int 500..200 000) | `201 { topup: TopupDto, checkoutUrl }` |
| GET | `/wallet/topups/:id` | — | `TopupDto` (own only, else 404) |
| POST | `/wallet/topups/:id/demo-confirm` | `{ cardNumber, expiry?: 'MM/YY', cvc? }` | `200 TopupDto` (`succeeded`) · `402 PAYMENT_DECLINED` (top-up becomes `declined`) |
| POST | `/wallet/transfers` | `{ toUserId \| toNickname, amount (int 100..50 000), message? ≤140, idempotencyKey }` | `201 TransferResult = { transaction: WalletTransactionDto (the sender's transfer_out), balance }`; a replay → `200` with the same result |

**Top-up (PaymentProvider adapter):**
- The API talks to payments only through a `PaymentProvider` interface: `createPayment({ topupId, userId, amount }) → { providerRef, checkoutUrl }` and a provider-specific completion that resolves to `{ topupId, status: 'succeeded' | 'declined' }`. Completion always goes through one idempotent `completeTopup` (row lock on the top-up; only a `pending` top-up changes; `succeeded` credits the wallet and writes one `topup` ledger row with `ref` = top-up id). A real provider (CloudPayments, Kaspi) plugs in as another adapter plus a public webhook route `POST /payments/webhook/:provider` (signature-checked) that calls the same `completeTopup`; that route is reserved and not implemented in this build.
- `PAYMENT_PROVIDER=demo` is the only provider. Its `checkoutUrl` is the in-app page `<WEB_ORIGIN>/wallet/checkout/<topupId>`, which shows the amount and a card form and calls `demo-confirm`. With any other provider configured, `demo-confirm` → `404 PROVIDER_DISABLED`.
- `demo-confirm`: card `4242 4242 4242 4242` (spaces/dashes ignored; `DEMO_TEST_CARD`) → `succeeded` and credited; any other well-formed number → `declined`, `402 PAYMENT_DECLINED`. Only the last 4 digits are stored. Idempotent: confirming a `succeeded` top-up again → `200` with the same `TopupDto`, credited once (also under concurrent confirms). Confirming a `declined` one → `409 TOPUP_NOT_PENDING`; after `expiresAt` (created + 30 min) → `409 TOPUP_EXPIRED` (the top-up becomes `expired`).
- Limits: amount 500..200 000 (`400 VALIDATION_ERROR`); 10 top-ups created per hour per user → `429 RATE_LIMITED`; a frozen wallet → `403 WALLET_FROZEN` on create and on confirm.

**Transfers:**
- Recipient by `toUserId` or `toNickname` (exactly one). Self → `400 INVALID_TARGET`. Unknown, deleted or un-onboarded → `404`. Blocked recipient or recipient's wallet frozen → `409 RECIPIENT_UNAVAILABLE`.
- Sender gates, in order: account ≥ 24 h old (`403 ACCOUNT_TOO_NEW`, details `{ minHours, retryAfterSec }`), rating ≥ 30 (`403 RATING_TOO_LOW`, details `{ min }`), wallet not frozen (`403 WALLET_FROZEN`), 10 transfers/min (`429 RATE_LIMITED`), rolling-24 h sent total + amount ≤ 100 000 (`409 TRANSFER_DAILY_CAP`, details `{ cap, remaining }`), balance ≥ amount (`409 INSUFFICIENT_FUNDS`, details `{ balance }`). Blocked senders never get here (`403 ACCOUNT_BLOCKED`).
- Atomic: one transaction locks both wallets with `SELECT … FOR UPDATE` **in wallet-id order** (no deadlocks), re-checks the balance and the daily cap under the lock, and writes `transfer_out` (−amount, sender) and `transfer_in` (+amount, recipient); each row's `ref` is the other row's id and `note` is the message. Concurrent transfers can never overdraw.
- Idempotency: `idempotencyKey` (8–64 chars `[A-Za-z0-9_-]`) is unique per sender (`wallet_transactions (user_id, idempotency_key)`). Repeating a key with the same recipient and amount returns the original result (`200`); with different ones → `409 IDEMPOTENCY_KEY_REUSED`.
- The recipient gets `wallet_received` `{ transactionId, amount, message, user: UserMini (sender) }` (in-app + push, url `/wallet`).
- Antifraud `wallet_funnel`: ≥ 3 distinct senders whose accounts are < 7 days old transfer into one account within 24 h → flag on the recipient (details `{ senderIds, total }`), at most once per 24 h per recipient; flag only. Runs in the background.

**Reads:** `GET /wallet` creates the wallet if missing. `transferDailyRemaining` = 100 000 − sent in the rolling 24 h (0 when frozen). `GET /wallet/transactions?kind=` filters by kind; keyset on (`createdAt`, id).

**Admin** (role admin, audited with a required note 3–500 chars, `assertTargetable`: not self, not another admin → `403 INVALID_TARGET`):

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/admin/users/:id/wallet` | — | `AdminWalletDto { userId, balance, frozen, frozenAt, premium: PremiumDto, sentLast24h }` |
| GET | `/admin/users/:id/wallet/transactions` | `kind?`, cursor | page of `AdminWalletTransactionDto` (= `WalletTransactionDto` + `idempotencyKey`) |
| POST | `/admin/users/:id/wallet/adjust` | `{ amount (non-zero int, \|amount\| ≤ 1 000 000), note }` | `AdminWalletDto`; a result below 0 → `409 INSUFFICIENT_FUNDS`. Writes `admin_adjust` (note = the admin note). Allowed on frozen wallets. Audit `wallet.adjust` |
| POST | `/admin/users/:id/wallet/freeze` | `{ note }` | `AdminWalletDto`; already frozen → `409 WALLET_ALREADY_FROZEN`. Audit `wallet.freeze` |
| POST | `/admin/users/:id/wallet/unfreeze` | `{ note }` | `AdminWalletDto`; not frozen → `409 WALLET_NOT_FROZEN`. Audit `wallet.unfreeze` |

Each of the three writes sends `wallet_admin` `{ action: 'adjust'|'freeze'|'unfreeze', amount, balance, note }` to the user (url `/wallet`). A frozen wallet blocks top-ups, transfers out and in, subscribing and renewals; reads still work.

`refund` is a reserved ledger kind for provider refunds (not produced by the demo provider).

### 9.2 Premium

1 490 coins for 30 days, charged from the wallet (`subscription` ledger row, `ref` = subscription id). SOS stays free for everyone.

```ts
type PremiumDto = { status: 'none' | 'active' | 'cancelled'; isPremium: boolean; autoRenew: boolean; startedAt: string | null;
  currentPeriodEnd: string | null; priceCoins: 1490; periodDays: 30;
  limits: { vehicles; postMedia; communitiesOwned; communityMemberships } }  // the limits that apply to the user now
```

| Method | Path | Response |
|---|---|---|
| GET | `/premium` | `PremiumDto` |
| POST | `/premium/subscribe` | `200 PremiumDto`; charges 1 490 now, period = now + 30 days, `autoRenew = true`. Already premium → `409 ALREADY_PREMIUM`; `409 INSUFFICIENT_FUNDS` (details `{ balance, price }`); `403 WALLET_FROZEN`. Concurrent subscribes charge once (wallet row lock + status re-check) |
| POST | `/premium/cancel` | `200 PremiumDto` with `status: 'cancelled'`: auto-renew off, premium stays until `currentPeriodEnd`. Not premium → `409 NOT_PREMIUM`; already cancelled → no-op `200` |
| POST | `/premium/resume` | `200 PremiumDto` with `status: 'active'`: auto-renew back on (only before the period ends). Not premium → `409 NOT_PREMIUM` (subscribe instead); already active → no-op `200` |

- `status` is `none` when the period has ended, whether or not the renewal job has run yet; `isPremium` is computed from `currentPeriodEnd > now` everywhere.
- **Renewal job** (timer + Redis lock, first run 10 min after boot, then every 24 h, once a day across instances):
  - Subscriptions whose period ends within the next 24 h (`PREMIUM.renewAheadHours`) and `autoRenew` on: wallet not frozen and balance ≥ 1 490 → charge, `currentPeriodEnd += 30 days`, `premium_renewed` `{ periodEnd, priceCoins, balance }`. Otherwise they are left to lapse.
  - Subscriptions whose period has ended and weren't renewed → expired (`status` none, row closed), `premium_expired` `{ reason: 'cancelled' | 'insufficient_funds' | 'wallet_frozen' }`.
  - 3 days before the period ends (once per period): `premium_reminder` `{ periodEnd, autoRenew, lowBalance, priceCoins, balance }` — "renews in 3 days" when auto-renew is on, a low-balance warning when the balance is below the price, "ends on …" when auto-renew is off.
  - Each step is idempotent per subscription and period (a re-run on the same day charges and notifies nothing twice).
- **Perks, enforced server-side** (`PREMIUM_PERK_LIMITS`, only limits that already existed are doubled):
  - premium badge (`isPremium` on UserMini / UserPublic / Me) and profile frame (`UserPublic.profileFrame = 'premium'`);
  - vehicles 10 instead of 5 (`409 VEHICLE_LIMIT`, details `{ limit, premiumLimit }`); existing vehicles are kept when premium ends, adding more is blocked;
  - images per post 12 instead of 6 (the schema accepts 12; non-premium authors with 7–12 → `400 MEDIA_LIMIT`, details `{ limit, premiumLimit }`);
  - owned communities 20 instead of 10 (`409 COMMUNITY_LIMIT`), memberships incl. pending 100 instead of 50 (`409 MEMBERSHIP_LIMIT`), both with `details { limit, premiumLimit }`; the ownership-transfer check uses the new owner's limit.
  - Perks without an existing limit are listed in KNOWN_GAPS.md, not invented.

### 9.3 Driver votes (+/−)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/users/:id/votes` | `{ value: 1 \| -1, reason, comment? ≤200 }` | `201 MyVoteDto { id, value, reason, comment, createdAt, canVoteAgainAt }` |
| GET | `/users/:id/votes/summary` | — | `VoteSummaryDto { userId, up, down, byReason: Record<VoteReason, number>, myVote: MyVoteDto \| null, eligibility }` |

- `reason` ∈ `helped_on_road | polite | good_driver` (only with +1), `rude | dangerous_driving | scam` (only with −1), `other` (either) → else `400 VALIDATION_ERROR`.
- Voter gates, in order: self → `400 INVALID_TARGET`; target unknown / deleted / un-onboarded → `404`; account ≥ 7 days (`403 ACCOUNT_TOO_NEW`, details `{ minDays, retryAfterSec }`); rating ≥ 40 (`403 RATING_TOO_LOW`, details `{ min }`); one vote per voter → target pair per 30 days (`409 ALREADY_VOTED`, details `{ canVoteAgainAt, retryAfterSec }`); 20 votes per rolling 24 h (`429 RATE_LIMITED`). Blocked voters get `403 ACCOUNT_BLOCKED`. Votes on blocked targets are allowed. Concurrent votes on the same pair produce exactly one (pair lock).
- Votes are final (no edit or delete by users).
- **Rating:** new component `votes` in `computeRating` = Σ over votes of the last 180 days of `value × weight × 0.5^(ageDays/180)`, clamped to ±15 (`RATING_FORMULA.votes`). `weight` is fixed at voting time from the voter's rating: `voteWeight(r)` = 1.5 for r ≥ 80, 1 for 60–79, 0.5 below 60. Each vote recomputes the target in the same transaction (ledger reason `vote_received`, refId = vote id; no row if the rating didn't move). The daily job applies decay. `50 + Σ delta = users.rating` still holds.
- **Summary:** public to every signed-in user (same visibility as `GET /users/:id`). Counts are all-time; `byReason` has every reason (0 when none). Voter identities are never returned to non-admins. `myVote` is the caller's vote of the last 30 days (null otherwise). `eligibility` ∈ `ok | self | account_too_new | rating_too_low | already_voted | daily_limit` tells the client whether to show the vote buttons.
- **Notification:** downvotes only — `vote_received` `{ voteId, value: -1, reason }` (no voter), pushed, url `/profile?tab=votes`. Upvotes notify no one.
- **Antifraud `vote_burst`:** ≥ 5 downvotes on one user within 24 h from voters whose account is < 30 days old or whose rating is < 50 → flag on the target (details `{ voterIds, count }`), at most once per 24 h per target (Redis `SET NX`); flag only.
- **Admin:** `GET /admin/users/:id/votes?value=1|-1&cursor` → page of `AdminVoteDto { id, voter, target, value, reason, comment, weight, createdAt }` (votes received by the user, newest first); `DELETE /admin/votes/:id {note}` → `204`, deletes the vote and recomputes the target (`recalc`, refId = vote id); audit `vote.remove` (target user = the vote's target; `assertTargetable` on the target).

### 9.4 Vehicle violations

Most traffic offences are under КоАП РК, the serious ones under УК РК. Article numbers are **not** hardcoded: a category plus an optional free-text `article` (≤ 60, e.g. "ст. 610 КоАП").

```ts
type ViolationCategory = 'speeding'|'red_light'|'drunk_driving'|'wrong_lane'|'no_license'|'accident_fled'|'dangerous_driving'|'parking'|'other'
type ViolationStatus = 'pending'|'approved'|'rejected'|'disputed'|'removed'
type ViolationDto = { id; vehicle: { id, brand, model, year }; category; codeType: 'koap'|'uk'; article: string | null; occurredAt;
  description; photos: UploadDto[]; status; dispute: { text, createdAt } | null /* owner + admins only */;
  submittedByMe: boolean; canDispute: boolean; createdAt; decidedAt: string | null }
```

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/vehicles/:id` | — | `VehicleDetailDto` (plate per the usual rule; never the VIN) |
| POST | `/vehicles/:id/violations` | `{ category, codeType, article?, occurredAt, description 10..1000, photoUploadIds (1–3, purpose violation) }` | `201 ViolationDto` (`pending`) |
| GET | `/vehicles/:id/violations` | cursor | page of `ViolationDto`, newest `occurredAt` first |
| GET | `/users/:id/violations` | cursor | page of `ViolationDto` across the user's vehicles |
| GET | `/me/violations/submitted` | cursor | page of `ViolationDto` the caller submitted (any status) |
| POST | `/violations/:id/dispute` | `{ text 10..1000 }` | `200 ViolationDto` (`disputed`) |

- **Submit:** the vehicle's owner, or anyone with an account ≥ 7 days and rating ≥ 40 (`403 ACCOUNT_TOO_NEW` / `403 RATING_TOO_LOW`). Vehicle of a deleted or un-onboarded owner → `404`. 5 submissions per rolling 24 h per submitter → `429 RATE_LIMITED`. `occurredAt` not in the future and ≤ 3 years ago. Photos: the caller's own uploads with purpose `violation`, not attached elsewhere → else `400 INVALID_UPLOAD`. When the submitter isn't the owner, the owner gets `violation_reported` `{ violationId, vehicleId, category, vehicle: 'Brand Model' }` (pushed, url `/vehicles/{vehicleId}?tab=violations`).
- **Visibility:** everyone sees only `approved` violations. The owner additionally sees `pending` and `disputed` ones (with status and their dispute). The submitter sees their own submissions in `/me/violations/submitted`. `rejected` and `removed` are visible to admins only (and to the submitter in their list). The submitter's identity is never returned outside admin DTOs.
- **Dispute:** owner only (`403 FORBIDDEN` for others who can see it, `404` otherwise); status `pending` or `approved` → `disputed`; a second dispute → `409 ALREADY_DISPUTED`; other states → `409 VIOLATION_INVALID_STATE`. An approved violation keeps its penalty while disputed.
- **Admin** (audited with a note; `assertTargetable` on the vehicle owner; an admin can't moderate their own submission → `403 INVALID_TARGET`):
  - `GET /admin/violations?status&cursor` → page of `AdminViolationDto` (adds `owner`, `submitter`, `dispute`, `submitterRejectedCount`, `penaltyApplied`, `decisionNote`), oldest first for `pending|disputed`, newest first otherwise.
  - `POST /admin/violations/:id/approve {note}` (`pending` → `approved`, audit `violation.approve`), `/reject {note}` (`pending` → `rejected`, audit `violation.reject`), `/resolve-dispute {decision: 'uphold'|'remove', note}` (`disputed` → `approved`, audit `violation.uphold`; or → `removed`, audit `violation.remove`). Wrong state → `409 VIOLATION_INVALID_STATE`. Each returns the `AdminViolationDto`.
  - Notifications `violation_status` `{ violationId, vehicleId, category, status: 'approved'|'rejected'|'removed', role: 'owner'|'submitter' }` to the owner (approve, uphold, remove) and to the submitter when it isn't the owner (approve, reject).
- **Rating:** approval (incl. upholding a dispute of a pending one) applies a `violation` penalty of −5 to the owner through the ledger (`reason: 'penalty'`, `penaltyKind: 'violation'`, refId = violation id), once per violation. `computeRating` caps violation penalties at −20 in total; like other penalties they expire after 365 days. Removal writes a `penalty_reversed` row (refId = violation id) and the penalty no longer counts.
- **Antifraud `violation_rejections`:** a submitter's rejected submissions reach 3 within 90 days → flag on the submitter (details `{ count, violationIds }`), at most once per 30 days; flag only.

### 9.5 Vehicle details

`POST /me/vehicles` and `PATCH /me/vehicles/:id` accept, all optional (`null` clears on PATCH):

| Field | Rule |
|---|---|
| `vin` | 17 chars `[A-HJ-NPR-Z0-9]` (no I/O/Q), upper-cased. **Owner only**: returned in `OwnVehicleDto` (`/me/vehicles`), never in any other DTO (profiles, map, admin lists, violations) |
| `engineVolumeL` | 0.6–8.0, rounded to 1 decimal |
| `fuel` | `petrol \| diesel \| gas \| hybrid \| electric` |
| `transmission` | `manual \| automatic \| robot \| cvt` |
| `drive` | `fwd \| rwd \| awd` |
| `bodyType` | `sedan \| hatchback \| wagon \| suv \| crossover \| coupe \| minivan \| pickup \| van` |
| `color` | `white \| black \| silver \| gray \| red \| blue \| green \| brown \| beige \| yellow \| orange \| other` (added after the contract freeze, additive) |
| `mileageKm` | integer 0..2 000 000 |
| `description` | ≤ 500, no invisible characters (`''` → null) |
| `photoUploadIds` | ≤ 5 own uploads with purpose `vehicle` (→ else `400 INVALID_UPLOAD`); replaces the whole set in the given order; removed photos are deleted |

JSON bodies take real numbers only (`vehicleBodySchema`); `vehicleSchema` coerces for web forms. Year, brand, model and plate rules are unchanged; plates are still never on the map. `GET /me/vehicles` returns `OwnVehicleDto[]`; `GET /users/:id/vehicles` and `primaryVehicle` return `VehicleDto` (no VIN). Vehicle limit per §9.2. Deleting a vehicle deletes its photos; its violations are kept for admins but disappear from public reads.

### 9.6 Web routes referenced by push URLs

`/wallet` (balance, history, top-up, transfer), `/wallet/checkout/{topupId}` (demo checkout), `/premium`, `/profile?tab=votes`, `/vehicles/{id}?tab=violations`, `/admin/violations`.

### Phase 9 clarifications (added during implementation)

All additive; no field or route of §9.0–9.6 changed.

- **Vehicle `color`** (added after the freeze, additive): optional enum `white | black | silver | gray | red | blue | green | brown | beige | yellow | orange | other` on create/PATCH and in every `VehicleDto`.
- **Embedded vehicles:** `UserPublic.primaryVehicle.photos` (and every other user view that embeds the primary vehicle) holds only the **cover** — the first photo — so user lists render without extra queries. The full ordered set is in `GET /me/vehicles`, `GET /users/:id/vehicles` and `GET /vehicles/:id`.
- **Vehicle photos:** an upload can belong to one vehicle only (`400 INVALID_UPLOAD` otherwise). Photos removed by a PATCH and the photos of a deleted vehicle are deleted. Vehicle and violation photos count as attached for the hourly orphan purge.
- **Wallet:**
  - `PAYMENT_PROVIDER` (env, default and only value `demo`).
  - `ACCOUNT_TOO_NEW` on transfers has `details { minHours, retryAfterSec }`; `RATING_TOO_LOW` has `details { min }`.
  - A replayed transfer key is answered before the sender gates (a replay succeeds even if a limit has been hit since). Concurrent requests with the same key move coins once; all of them get the same transaction (`201` for the first, `200` for the rest).
  - The ledger has DB guards: `wallets.balance >= 0`, `wallet_transactions.amount <> 0` and `balance_after >= 0` (CHECKs), and an append-only trigger that rejects `UPDATE`/`DELETE` on `wallet_transactions`.
  - Admin wallet reads (`GET /admin/users/:id/wallet[/transactions]`) work for any user (`404` if unknown); the writes use `assertTargetable`.
- **Premium:**
  - `users.premium_until` caches the paid period end.
  - Renewal charges carry the idempotency key `renew:{subscriptionId}:{periodEndMs}`, so a period can never be charged twice. A subscription whose period lapsed (auto-renew on, coins arrived later) restarts from the renewal time, not from the old end.
  - `POST /premium/subscribe` after a lapsed period (before the job ran) closes the old row and starts a new one.
  - Deleting an account turns auto-renew off.
- **Votes:**
  - The daily limit (20 per rolling 24 h) is counted in the database under a per-voter lock: `429 RATE_LIMITED` with `details.retryAfterSec`.
  - `ACCOUNT_TOO_NEW` has `details { minDays, retryAfterSec }`.
  - Votes received count in the rating only while they are less than 180 days old.
  - Admin removal recomputes the target with ledger reason `recalc` (refId = vote id).
- **Violations:**
  - Non-owner gates: `ACCOUNT_TOO_NEW` (`details { minDays, retryAfterSec }`) and `RATING_TOO_LOW` (`details { min }`). An owner reporting their own vehicle is never gated and gets no `violation_reported` notification.
  - The daily limit is counted in the database under a per-submitter lock (`429 RATE_LIMITED`, `details.retryAfterSec`).
  - Each photo can back only one violation (`400 INVALID_UPLOAD`).
  - Rows keep a vehicle snapshot (brand, model, year). When the vehicle is deleted, `vehicle.id` is `''` and the violation leaves the public and owner lists (it stays in `/me/violations/submitted` and admin lists).
  - Disputes: the submitter and the public get `dispute: null`.
  - `POST /violations/:id/dispute` by someone who can see the violation but isn't the owner (the public for approved ones, the submitter) → `403 FORBIDDEN`; everyone else → `404`.
  - `GET /admin/violations` without `status` is newest first. Approving or upholding applies the −5 penalty only if this violation has none yet; `remove` writes `penalty_reversed` only if a penalty exists.
- **Seed:**
  - Wallets for the demo user and 8 others, all with succeeded demo top-ups and transfers. The demo user has premium (renews in about 20 days) and 2 000 coins; a friend of theirs has a cancelled premium.
  - 7 driver votes (3 up on demo), a detailed demo car with 2 photos and details on 12 other cars.
  - 5 violations: 2 approved with penalties on one driver, 1 pending, 1 disputed, 1 rejected.
  - Wallet ledgers and the rating ledger are consistent.

### Phase 9 security review fixes

- **Transfers by nickname** match exactly: `nickname` is citext, so the match ignores case, but `_` and `%` are ordinary characters, not wildcards.
- **Ledger order:**
  - Every ledger row has a per-wallet `seq` (1, 2, 3, …), taken under the wallet row lock; `created_at` is `clock_timestamp()` at that moment. Ordered by `seq`, each row's `balance_after` = the previous row's `balance_after` + `amount`.
  - `GET /wallet/transactions` and `GET /admin/users/:id/wallet/transactions` are ordered newest first by `seq`. The cursor is still opaque: cursors issued before this change aren't accepted (`400 VALIDATION_ERROR`). The DTOs don't change.
- **Locks:** rating recomputes, and the other per-user serialization locks, take `FOR NO KEY UPDATE` on the user row, so they don't conflict with the key-share locks taken by foreign-key inserts (votes, penalties, ledger rows). Concurrent votes on one user no longer deadlock.
- **Violations:** submissions against a vehicle owned by an admin → `403 INVALID_TARGET`, the owner included. Admins never moderate admins, so such a violation could never be decided.
- **Wallet reads** (`GET /wallet`, the admin wallet reads) only read; the wallet row is created on the first use that needs it.
- **Premium cancel near the period end:** the renewal job charges subscriptions whose period ends within the next 24 h. A `cancel` after that charge doesn't refund it: the renewed period (already paid, `currentPeriodEnd` already moved 30 days on) stays active, and auto-renew is off from then on, so the next period isn't charged. To avoid the early charge, cancel more than 24 h before `currentPeriodEnd`. No DTO change.

## 10. Phase 10 — Tier names, driving vote reasons, "what people say" (client request)

Shared: `tiers.ts` (`RATING_TIER_NAMES`, `tierNameForRating`), `votes.ts` (new reasons, `VOTE_REASON_SIGN`, `VOTE_TRAIT_RULES`, `computeVoteTraits`, `VoteTraitsDto`). Migration `20261006172949_phase10_vote_reason_enum`.

### 10.1 Rating tier names

Labels only: the tier keys (`RatingTier`), the thresholds and `tierForRating` don't change, and the API still returns `tier`.

| Rating | `tier` | ru | en |
|---|---|---|---|
| 0–29 | `warning` | Злостный нарушитель | Repeat offender |
| 30–49 | `none` | Обычный водитель | Regular driver |
| 50–64 | `bronze` | Надёжный водитель | Reliable driver |
| 65–79 | `silver` | Уважаемый водитель | Respected driver |
| 80–89 | `gold` | Образцовый водитель | Exemplary driver |
| 90–100 | `platinum` | Легенда дорог | Road legend |

- `RATING_TIER_NAMES[tier][locale]` is the source of truth; the web's `tiers.name.*` messages must match it (unit-tested).
- Web: the tier name is a visible chip on the profile header and in the tier legend, for every tier (`none` gets a muted chip). The 0–29 tier keeps the red ring, the warning corner mark and a red chip. The compact mark next to names in lists still skips `none`.

### 10.2 Vote reasons

`VoteReason` gains driving-specific reasons; the Phase 9 ones stay.

| Sign | Reasons |
|---|---|
| +1 | `helped_on_road`, `polite`, `good_driver`, `lets_merge` (Пропускает), `careful_driver` (Аккуратно водит), `signals_properly` (Всегда включает поворотники) |
| −1 | `rude`, `dangerous_driving`, `scam`, `cuts_off` (Подрезает), `no_turn_signals` (Не включает поворотники), `speeding` (Превышает скорость), `tailgating` (Не держит дистанцию), `bad_parking` (Паркуется как попало), `aggressive` (Агрессивно водит), `phone_while_driving` (Отвлекается на телефон) |
| either | `other` |

- `VOTE_REASON_SIGN[reason]` is `1`, `-1` or `0` (`other`). A reason that doesn't match the vote's sign → `400 VALIDATION_ERROR`, as before.
- Database: `user_votes.reason` is now the Postgres enum `"VoteReason"` (was text; existing rows are cast in place), and the CHECK `user_votes_reason_sign_check` enforces the sign rule too. Adding a reason later needs `ALTER TYPE "VoteReason" ADD VALUE` plus a new CHECK.
- `VoteSummaryDto.byReason` and `AdminVoteDto.reason` / `MyVoteDto.reason` / the `vote_received` payload simply carry the larger enum.

### 10.3 "What people say" (traits)

`GET /users/:id/votes/summary` gains `traits`:

```ts
type VoteTrait = { reason: VoteReason; count: number }
type VoteTraitsDto = { negative: VoteTrait[]; positive: VoteTrait[] }
type VoteSummaryDto = { ...; traits: VoteTraitsDto }
```

- Same visibility as the summary (every signed-in user, the target included). No voter ids, names or comments.
- Rules (`VOTE_TRAIT_RULES`), over the votes of the last **180 days**, counting **different voters** (a voter who votes again after the 30-day cooldown counts once):
  - no traits at all until **3** different voters voted in the window, so one or two people can't label anyone;
  - a reason is a trait when **≥ 2** voters chose it and they are **≥ 25%** of the voters of its sign;
  - `other` is never a trait; at most **3** per sign; sorted by count (desc), then by the reason order above.
- `byReason`, `up` and `down` stay all-time vote counts.
- Web: one line under the profile name/bio (own and other profiles), e.g. "Часто отмечают: подрезает · не включает поворотники · хвалят: пропускает" — negative traits in danger-tinted chips, positive ones in success-tinted chips; "Хвалят: …" when there are only positive ones; nothing when both lists are empty.

### 10.4 Seed

- `@daniyar_almaty` (the driver with the approved violations): 9 downvotes from 9 different voters, 4 × `cuts_off` and 3 × `no_turn_signals`, plus 4 approved violations (penalties capped at −20). Rating ≈ 25 → "Злостный нарушитель", traits "подрезает · не включает поворотники".
- Demo: 8 upvotes from 8 voters, including 3 × `lets_merge` and 2 × `careful_driver` → traits "хвалят: пропускает · аккуратно водит".
- Ratings are still computed from the seeded data; `50 + Σ delta = users.rating` holds for every user.

## 11. Phase 10 — "Оплата на точке" (payments at partner points)

A driver pays a partner point (a gas station, an oil-change service) from the app: tap the phone on the NFC sticker at the counter, or scan its QR code. **Demo only:** coins are internal (SPEC §9.2) and Google Pay runs in its TEST environment, so no real money moves. Shared: `packages/shared/src/pay.ts`.

### 11.0 Changes to shared objects (additive)

- `ServiceCategory` gains `fuel` (АЗС). `ServiceDto` / `ServiceListItem` gain `acceptsPayments: boolean`; `ServiceDto` gains `canManagePay: boolean` (viewer is an admin or the point's owner).
- `WalletTxKind` gains `purchase` (buyer, −total, `ref` = order id, `note` = point name) and `sale` (the point owner, +total, `counterparty` = buyer, `ref` = order id).
- New `NotificationType` `purchase_paid` `{ orderId, serviceId, pointName, total, method }` (in-app + push, url `/pay/orders/{orderId}`; the web app doesn't toast it, the buyer is on the receipt).
- New `ADMIN_ACTIONS`: `pay.partner`, `pay.items`, `pay.tag_rotate` (target type `service`).
- New error codes: `POINT_UNAVAILABLE` (409), `INVALID_ITEM` (400), `INVALID_QTY` (400), `ORDER_LIMIT` (400), `SERVICE_NOT_VERIFIED` (409). Reused: `INSUFFICIENT_FUNDS`, `WALLET_FROZEN`, `PAYMENT_DECLINED` (402), `IDEMPOTENCY_KEY_REUSED`, `INVALID_TARGET`, `RATE_LIMITED`.

```ts
type PayUnit = 'l' | 'pcs' | 'service'            // liters (0.1 step) | pieces | one job
type PayMethod = 'coins' | 'google_pay'
type PayItemDto = { id; name; priceCoins: number; unit: PayUnit }
type PayPointDto = { serviceId; name; category; address; logoUrl: string | null; items: PayItemDto[] }
type PayPointManageDto = PayPointDto & { acceptsPayments; ownerId: string | null; ownerNickname: string | null;
  payTag: string | null; payUrl: string | null /* <WEB_ORIGIN>/pay/t/<payTag> */; canRotate: boolean }
type PayLineDto = { itemId: string | null; name: string | null; unit: PayUnit | null; qty: number; priceCoins: number; totalCoins: number }
type PayReceiptDto = { orderId; point: { serviceId; name; category; address }; items: PayLineDto[]; total: number; method: PayMethod;
  paidAt; balanceAfter: number | null /* coins only */; card: { network; last4 } | null /* google_pay */; demo: true }
```

### 11.1 Routes

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/pay/points/:serviceId` | — | `PayPointDto`. A verified service with `acceptsPayments`, else `404` |
| GET | `/pay/t/:tag` | — | `PayPointDto` for the point whose `payTag` is `tag` (`400` if the tag isn't `[A-Za-z0-9_-]{16,64}`, `404` if unknown / not a partner). 60 lookups/min per user |
| POST | `/pay/orders` | `{ serviceId, items?: [{ itemId, qty }] (1–10, each item once), amount?: int 1..200 000, method, googlePay?: { token, cardNetwork?, cardDetails? }, idempotencyKey }` | `201 PayReceiptDto`; a replay → `200` with the same receipt |
| GET | `/pay/orders` | cursor, limit | page of my `PayReceiptDto`, newest first |
| GET | `/pay/orders/:id` | — | `PayReceiptDto` (own only, else `404`) |
| GET | `/pay/points/:serviceId/manage` | — | `PayPointManageDto`; admin or the owner, else `403` |
| PUT | `/pay/points/:serviceId/items` | `{ items: [{ id?, name 2..80, priceCoins int 1..1 000 000, unit }] (≤ 30, order = display order), note? }` | `PayPointManageDto`. Admin or owner. Replaces the list (ids kept when given; an id not on this point → `400 INVALID_ITEM`). An admin who isn't the owner must give `note` (3–500) → audit `pay.items` |
| PUT | `/admin/services/:id/partner` | `{ acceptsPayments, ownerId?: uuid \| null, note }` | `PayPointManageDto`. Only verified services can be enabled (`409 SERVICE_NOT_VERIFIED`); an unknown / deleted / un-onboarded owner → `404`. The first enable issues a `payTag`. Audit `pay.partner` |
| POST | `/admin/services/:id/pay-tag/rotate` | `{ note }` | `PayPointManageDto` with a new `payTag`; the old sticker / QR stops resolving at once. Audit `pay.tag_rotate` |

### 11.2 Rules

- **payTag:** 128 random bits, base64url (22 chars), unique, never derived from the service id. NFC stickers (an NDEF URL record) and counter QR codes carry `https://<web origin>/pay/t/<payTag>`; the web route resolves it through `GET /pay/t/:tag`.
- **Pricing is server-side.** Names, units and prices come from the point's list; any price the client sends is ignored. A line's total = `round(priceCoins × qty)` (half up). `qty`: liters 0.1–200 in 0.1 steps, pieces 1–20 whole, services 1–20 whole → else `400 INVALID_QTY`. Total 1..200 000 (`400 ORDER_LIMIT`). `amount` is a free sum (one line with `itemId: null`).
- **Gates**, like transfers: blocked accounts get `403 ACCOUNT_BLOCKED`; a frozen buyer wallet → `403 WALLET_FROZEN`; buying from your own point → `400 INVALID_TARGET`; the owner's account blocked/deleted or wallet frozen → `409 POINT_UNAVAILABLE`; 10 orders/min per user → `429 RATE_LIMITED`.
- **coins:** one transaction locks the buyer's (and the owner's) wallet rows in user-id order, re-checks the balance (`409 INSUFFICIENT_FUNDS`, details `{ balance, total }`), inserts the order, writes `purchase` (−total) and either `sale` (+total) to the owner or a `merchant_settlements` row (status `pending`) when the point has no owner. Ledger `seq`, `balance_after` and the DB guards of §9 apply.
- **google_pay:** the token goes through the `PaymentProvider` adapter (`chargeGooglePay`). The demo provider accepts Google Pay TEST tokens only (`examplePaymentMethodToken` from the `example` gateway, or a TEST envelope with `protocolVersion` + `signedMessage`); anything else → `402 PAYMENT_DECLINED`, nothing written. Success = a demo top-up spent at once: a `topups` row (`succeeded`, provider `demo`), ledger `topup` (+total) then `purchase` (−total) — the coin balance doesn't change — plus `sale` / settlement as above. `balanceAfter` is null; `card` shows the TEST card from `paymentMethodData.info`.
- **Idempotency:** `idempotencyKey` is unique per buyer (`pay_orders (user_id, idempotency_key)`). The same key with the same point, method and basket returns the original receipt (`200`), even if prices changed since; anything different → `409 IDEMPOTENCY_KEY_REUSED`. Concurrent requests with one key: the buyer's wallet lock serializes them, the later ones see the committed order and replay — coins move once.
- **Web routes:** `/pay` (NFC scanner with QR and manual-code fallbacks; `?simulateTag=<payTag>` only in dev builds or with `NEXT_PUBLIC_DEMO_MODE=true`), `/pay/t/{payTag}`, `/pay/{serviceId}`, `/pay/orders`, `/pay/orders/{id}` (receipt).
- **Seed (demo data):** RP (fuel, пр. Райымбека, 480; АИ-92 205, АИ-95 245, ДТ 290 per liter; no owner → settlements) and GT Oil Service (repair, ул. Жандосова, 140; "Замена масла 5W-30 (4 л)" 18 000, "Масляный фильтр" 3 500, "Замена масла + фильтр" 20 000; owned by a seeded driver). Deterministic tags `base64url(sha256("seed-paytag:<name>"))[0..22]`. The demo account keeps 2 000 coins, so 5 l of АИ-95 (1 225) works.
