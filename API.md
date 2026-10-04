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
type Me = UserPublic & {
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
| POST | `/auth/otp/request` | public | `{ phone }` (E.164, `+7…` normalized server-side) | `200 { retryAfterSec: number, devCode?: string }` — `devCode` only when `SMS_PROVIDER=console` and `AUTH_EXPOSE_DEV_CODE=true` |
| POST | `/auth/otp/verify` | public | `{ phone, code }` | `200 { accessToken, user: Me, isNew: boolean }` + sets cookies |
| POST | `/auth/google` | public | `{ idToken }` | same as verify |
| POST | `/auth/apple` | public | `{ idToken, name? }` | same as verify |
| POST | `/auth/refresh` | cookie + CSRF | — | `{ accessToken }` (rotates cookie) |
| POST | `/auth/logout` | cookie + CSRF | — | `204` |
| POST | `/auth/logout-all` | bearer | — | `204` (revokes all refresh tokens, disconnects sockets) |
| GET | `/me` | ✓ | — | `Me` |
| PATCH | `/me` | ✓ | `{ name?, nickname?, city?, bio?, avatarUploadId? (null removes), locale? }` | `Me` (`CONFLICT NICKNAME_TAKEN`) |
| PATCH | `/me/settings` | ✓ | `{ privacyMode?, receiveSos? }` | `Me` |
| POST | `/me/onboarding/complete` | ✓ | — | `Me` (requires name + nickname set) |
| POST | `/me/phone/request` | ✓ | `{ phone }` | like `/auth/otp/request` (link phone to OAuth account; `CONFLICT PHONE_IN_USE`) |
| POST | `/me/phone/verify` | ✓ | `{ phone, code }` | `Me` |
| DELETE | `/me` | ✓ | `{ confirm: "DELETE" }` | `204` — anonymizes profile, deletes location, vehicles, push subs, tokens |
| GET | `/me/vehicles` | ✓ | — | `VehicleDto[]` |
| POST | `/me/vehicles` | ✓ | `{ brand, model, year, plate?, isPrimary? }` | `VehicleDto` (first vehicle is primary automatically; max 5) |
| PATCH | `/me/vehicles/:id` | ✓ | partial of above | `VehicleDto` |
| DELETE | `/me/vehicles/:id` | ✓ | — | `204` (if primary deleted, next oldest becomes primary) |
| GET | `/users/:id` | ✓ | — | `UserPublic` |
| GET | `/users/:id/vehicles` | ✓ | — | `VehicleDto[]` |
| GET | `/users` | ✓ | `q` (≥2 chars, nickname/name prefix), cursor, limit | page of `UserPublic` |
| POST | `/uploads` | ✓ | multipart: `file`, `purpose` ∈ `avatar, community, sos, message, voice, post, video, service, order`, `durationSec?` (voice/video, client-measured, clamped to limits) | `UploadDto` |
| GET | `/health` | public | — | `{ status: 'ok', db: 'ok', redis: 'ok' }` |

Rules
- Nickname: 3–24 chars `[a-z0-9_.]`, case-insensitive unique. Name 1–60. Bio ≤ 300. City from `CITIES` list (shared).
- Vehicle: brand from `CAR_BRANDS` (shared) or free text ≤ 40; model ≤ 40; year 1950..current+1; plate ≤ 12, normalized uppercase.
- Upload limits: images (jpeg/png/webp/heic) ≤ 10 MB → re-encoded WebP, EXIF stripped, max 2048 px + 400 px thumb; voice (webm/ogg/mp4/mpeg audio) ≤ 5 MB, ≤ 3 min; video (mp4/webm) ≤ 50 MB. Type checked by magic bytes.
- Rate limits: OTP request: phone 1/60 s & 5/h, IP 20/h. OTP verify: 5 attempts per code, 10 failures/h per phone → `RATE_LIMITED`. Uploads 60/h per user.
- New user created on first successful verify with `nickname = null` → `onboardingCompleted=false`. Client routes to onboarding until complete. Default `privacyMode = 'community'`, `receiveSos = true`, `rating = 50`.

## 2. Phase 2 — Location, map, friends, notifications (FROZEN at Phase 2 start)

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

## 7. Phase 7 — Services (DRAFT)

`ServiceCategory = 'repair'|'tires'|'wash'|'parts'|'tow'`
`GET /services?category&q&lat&lng&sort=distance|rating&cursor` · `GET /map/services?bbox&category` · `GET /services/:id` · `POST /services` (submit → `pending`) · `GET /services/:id/reviews` · `POST /services/:id/visits` `{method:'geo',lat,lng}|{method:'qr',code}|{method:'photo',uploadId}` (geo ≤ 150 m & qr → verified; photo → pending admin) · `POST /services/:id/reviews {stars, comment, visitId}` (verified visit, one review per visit, max 1 per service per 30 days)

## 8. Phase 8 — Events & feed (DRAFT)

Events: `GET /events?communityId&scope=upcoming|past&cursor` · `POST /communities/:id/events {title, description, place, lat, lng, startsAt, endsAt?, route?: [lng,lat][]}` (mods) · `GET|PATCH|DELETE /events/:id` · `POST /events/:id/rsvp {status:'going'|'interested'|'none'}` · `GET /events/:id/participants?cursor` · `GET /map/events?bbox`
Feed: `GET /feed?communityId&authorId&cursor` · `POST /posts {text?, mediaUploadIds?, communityId?, poll?: {question, options (2–6), multiple}}` · `DELETE /posts/:id` · `POST|DELETE /posts/:id/like` · `GET|POST /posts/:id/comments` · `DELETE /comments/:id` · `POST /posts/:id/poll/vote {optionIds}`
