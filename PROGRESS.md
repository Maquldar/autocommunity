# Progress

| Phase | Status |
|---|---|
| 0. Spec + architecture + API contract | ✅ done |
| 1. Foundation, auth, profile, vehicles | 🚧 in progress |
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
