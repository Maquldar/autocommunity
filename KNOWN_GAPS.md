# Known gaps

Features from PLAN.md that are not in this build, with the reason. Updated every phase.

| Plan item | Status | Reason |
|---|---|---|
| Flutter native app (PLAN §0) | Replaced by a PWA | Owner decision Q-1: Flutter can't be run or tested in the build environment. The API is client-agnostic, so a Flutter client can be added later. |
| Background location ("Always") | Not possible on web | Browsers only give location while the app is open. This is the plan's own fallback (risk #8). |
| Publishing to App Store / Google Play, TestFlight beta | Out of scope | Needs developer accounts and store review. A PWA installs from the browser instead. |
| Premium, business accounts for service centers, store billing (Stage 3) | Out of scope | Owner decision Q-2. The plan says these come after an audience exists. |
| AI assistant, breakdown prediction, OBD-II, parts marketplace, insurance (v3.0) | Out of scope | Owner decision Q-2. |
| Real SMS / Google / Apple / Mapbox / R2 / FCM | Adapters built, providers off | Owner decision Q-3: no credentials yet. SMS codes go to the server log (and the dev-code hint), maps use OpenStreetMap, storage uses local disk (the S3/R2 driver is the same code path), push uses Web Push. |
| Legal texts (privacy policy, ToS, personal-data consent under KZ law) | Drafts | They need review by a lawyer before launch. |
| Public demo (Render free plan) | Ready to deploy, not deployed | No hosting account in the build environment; the owner deploys with one click (DEPLOY.md). Demo mode shows login codes on screen, the service sleeps when idle, and the free database expires after 30 days. Photos are stored in Postgres because the free plan has no disk. |
