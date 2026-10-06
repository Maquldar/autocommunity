# Load test results (Phase 6, F-34 / A-13)

Run on 2026-10-06 against a **local production build** of the API. These numbers come from a shared, noisy machine (see "Machine"). Read them as a rough baseline, not as a capacity guarantee.

## Scope (reduced; please read)

The lead asked for a shorter run to save time, so this run is smaller than the plan in API.md §6:

- **Endpoints:** `GET /map/users`, `GET /sos/nearby` and `POST /chats/:id/messages`. **`GET /chats` was not load-tested** (no script for it in this run).
- **Duration:** 30 s per level (not 60 s), at **50 and 200 virtual users**. There was no ramp-up and no soak test.
- **Tool:** k6 v0.54.0. apt had no package for it, so I used the official static binary from GitHub releases.

## Setup

- API: `apps/api` built with `nest build`, started as `NODE_ENV=production DEMO_MODE=true DEMO_LIVE_LOCATIONS=false TRUST_PROXY=loopback LOG_LEVEL=warn node dist/main.js`. That is **one Node.js process** (no cluster), with the default Prisma pool (9 connections on 4 CPUs) and DB `autoc_p6` (seeded). `DEMO_MODE` is set only so the dev OTP code works in production mode.
- **Rate limits were respected, not raised.** No env or code change was made for the run. Each VU is its own driver (`setup-users.mjs` signs up 200 users through the public API, each with its own `X-Forwarded-For`, so the per-IP OTP limit holds). The script paces each VU to stay below the per-user limits (map and SOS geo 60/min, messages 30/min). The `rate_limited` counter (429s) stayed at **0** in both runs.
- Users: 200 fresh accounts, onboarded, privacy `everyone`, with fresh positions spread over about 6 × 6 km of central Almaty, paired into 100 direct chats. They join the 40 seeded users.
- Each iteration does map users (≈ 2 × 2 km bbox) + SOS nearby, plus a text message every other iteration, then sleeps 1.1 s.

Reproduce:

```sh
N=200 API_URL=http://localhost:4500 TOKENS_FILE=/tmp/tokens.json node load/setup-users.mjs
k6 run -e VUS=50  -e DURATION=30s -e TOKENS_FILE=/tmp/tokens.json load/scenarios.js
k6 run -e VUS=200 -e DURATION=30s -e TOKENS_FILE=/tmp/tokens.json load/scenarios.js
```

(Access tokens live 15 min, so run k6 right after the setup.)

## Machine

- 4 vCPU (Intel Xeon @ 2.80 GHz), 15 GiB RAM, Linux 6.18, Node 22.22, PostgreSQL 16.14 + PostGIS, Redis 7.0.15, all on the same host. k6 ran on the same host too.
- **The host was shared** with other agents' builds and browser tests during the run. The 1-minute load average was **7–13** on 4 cores, and `top` showed about 2 % idle CPU at 200 VUs. Expect better numbers on a dedicated machine.

## Results

Latency is `http_req_duration` (send + wait + receive). The error rate counts 5xx, network errors and unexpected 4xx; 429s are counted separately (there were none).

### 50 VUs, 30 s

| Endpoint | Requests | RPS | p50 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| `GET /map/users` | 1217 | 38.8 | 24 ms | 120 ms | 368 ms | 576 ms |
| `GET /sos/nearby` | 1217 | 38.8 | 47 ms | 192 ms | 259 ms | 346 ms |
| `POST /chats/:id/messages` | 617 | 19.7 | 72 ms | 259 ms | 336 ms | 398 ms |
| **All** | **3051** | **97.3** | **41 ms** | **197 ms** | **312 ms** | 576 ms |

Error rate: **0.00 %** (0 / 3051). 429: 0.

### 200 VUs, 30 s

| Endpoint | Requests | RPS | p50 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| `GET /map/users` | 1909 | 58.0 | 506 ms | 1.56 s | 2.40 s | 3.09 s |
| `GET /sos/nearby` | 1909 | 58.0 | 1.03 s | 1.70 s | 2.10 s | 2.27 s |
| `POST /chats/:id/messages` | 1027 | 31.2 | 1.01 s | 1.50 s | 1.79 s | 2.15 s |
| **All** | **4845** | **147.1** | **795 ms** | **1.64 s** | **2.33 s** | 3.09 s |

Error rate: **0.00 %** (0 / 4845). 429: 0. The script's own threshold (p95 < 1 s per endpoint) **failed** at 200 VUs.

A 20 s probe run at 200 VUs (used to watch CPU, below) gave similar numbers: 130 RPS, p50 1.01 s, p95 1.75 s.

## Bottleneck

- At 50 VUs the API keeps up: the offered load (about 100 RPS) is served with p95 under 200 ms.
- At 200 VUs the offered load would be about 360 RPS (200 VUs × ~1.8 requests per 1.2 s iteration), but throughput **flattens at about 130–150 RPS** and latency grows. That is queueing: requests wait their turn, nothing fails.
- During the 200-VU run the API's **single Node.js process sat at one full core**, while Postgres was mostly idle: of the API's 10 connections, 1 was active and 8 idle. Each Postgres backend used about 8 % CPU. **So the limit is the one Node event loop (JWT verification, Prisma (de)serialization, JSON, Nest pipeline), not the database.** The CPU contention from other processes on the host made it worse.
- **No missing index or slow query showed up.** Postgres was not the constraint, and earlier phases already have GiST indexes on `user_locations` / `sos_requests` and keyset indexes for messages. So there was no "obvious fix" with before/after numbers to make in this run.
- **What would raise capacity:** run several API processes (Node cluster or several containers). Socket.IO already uses the Redis adapter, and rate limits and session state are in Redis, so instances can scale out horizontally. Then profile per-request CPU with `--cpu-prof` to find the hottest handlers.

## Not covered

- `GET /chats`; Socket.IO fan-out under load; uploads; ramp/soak tests; multi-instance runs; a dedicated machine.
- `load/setup-users.mjs` leaves its 200 `load_*` users in the target database. Run it against a disposable or demo database.
