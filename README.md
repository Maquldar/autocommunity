# AutoCommunity

A social platform for drivers (pilot city: Almaty): a live map of drivers, communities, SOS roadside help, a service catalog and a trust rating. It's a mobile-first installable web app (PWA) with a NestJS + PostgreSQL/PostGIS API.

> Status: **Phase 1 of 8 done** (accounts, onboarding, profile, cars, settings). See [PROGRESS.md](PROGRESS.md). The full README (screenshots, architecture, roadmap) comes with the final phase.

## Run locally

You need **Node.js 22+**, **pnpm 10** (`npm i -g pnpm@10`) and **Docker Desktop** (for Postgres + PostGIS and Redis).

```bash
git clone https://github.com/Maquldar/autocommunity
cd autocommunity
docker compose up -d        # Postgres + PostGIS on :5432, Redis on :6379
pnpm install
pnpm setup:local            # creates apps/api/.env and apps/web/.env.local with fresh secrets
pnpm db:migrate             # creates the tables
pnpm db:seed                # demo data: 40 drivers in Almaty
pnpm dev                    # API on http://localhost:4000, website on http://localhost:3000
```

Open **http://localhost:3000** and log in:
- Demo user: `+7 700 000 00 02`. Admin: `+7 700 000 00 01`. Or any `+7` number to register a new account.
- No SMS is sent locally. **The code is shown on the login screen** (and printed in the API terminal).

Stop with `Ctrl+C`; `docker compose down` stops the database (data is kept).

**Phone on the same Wi-Fi:** open `http://<your-computer-ip>:3000`. This needs two config changes: add that address to `WEB_ORIGIN` in `apps/api/.env`, and set `NEXT_PUBLIC_API_URL=http://<your-computer-ip>:4000` in `apps/web/.env.local`, then restart `pnpm dev`. Location features (Phase 2+) need HTTPS on phones, so use the public deploy for phone testing ([DEPLOY.md](DEPLOY.md)).

### Troubleshooting
- `Can't reach database server at localhost:5432`: Docker isn't running, or `docker compose up -d` wasn't run.
- Port 5432 already in use: a local Postgres is running. Stop it, or change the port in `docker-compose.yml` and `DATABASE_URL`.
- `pnpm: command not found`: run `npm i -g pnpm@10`.

## Tests
```bash
pnpm test     # unit + integration (needs the database running)
pnpm e2e      # Playwright browser tests (needs `pnpm dev` or built servers)
```

## Docs
[SPEC.md](SPEC.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [API.md](API.md) · [DESIGN.md](DESIGN.md) · [PROGRESS.md](PROGRESS.md) · [KNOWN_GAPS.md](KNOWN_GAPS.md) · [DEPLOY.md](DEPLOY.md)
