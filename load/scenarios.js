// k6 load test: map, SOS nearby, chat list and message sending as the users from setup-users.mjs.
//
//   k6 run -e VUS=50 -e DURATION=30s -e API_URL=http://localhost:4500 -e TOKENS_FILE=load/.tokens.json load/scenarios.js
//
// Each VU is one driver (VU n uses user n), so per-user rate limits stay meaningful: /map/users and
// /sos/nearby allow 60/min per user, messages 30/min. Pacing keeps a VU under those limits; 429s are still
// counted (as `rate_limited`) and excluded from the error rate, which counts 5xx / network failures / other 4xx.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const API = `${__ENV.API_URL || 'http://localhost:4500'}/api/v1`;
const data = JSON.parse(open(__ENV.TOKENS_FILE || './.tokens.json'));
const users = data.users;
const ORIGIN = __ENV.WEB_ORIGIN || 'http://localhost:3500';

export const errors = new Rate('errors');
export const rateLimited = new Counter('rate_limited');

export const options = {
  scenarios: {
    drivers: { executor: 'constant-vus', vus: Number(__ENV.VUS || 50), duration: __ENV.DURATION || '30s' },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    errors: ['rate<0.01'],
    // Per-endpoint sub-metrics (also makes k6 print p50/p95/p99 per endpoint).
    'http_req_duration{name:map_users}': ['p(95)<1000'],
    'http_req_duration{name:sos_nearby}': ['p(95)<1000'],
    'http_req_duration{name:post_message}': ['p(95)<1000'],
    'http_reqs{name:map_users}': ['count>0'],
    'http_reqs{name:sos_nearby}': ['count>0'],
    'http_reqs{name:post_message}': ['count>0'],
  },
};

function record(res, name) {
  if (res.status === 429) {
    rateLimited.add(1, { endpoint: name });
    errors.add(false, { endpoint: name });
    return;
  }
  const ok = res.status >= 200 && res.status < 300;
  errors.add(!ok, { endpoint: name });
  check(res, { [`${name} 2xx`]: () => ok });
}

export default function () {
  const u = users[(__VU - 1) % users.length];
  const headers = { authorization: `Bearer ${u.token}`, 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': u.ip };
  const tags = (name) => ({ headers, tags: { name } });
  // ~2 km × 2 km around the driver.
  const bbox = [u.lng - 0.012, u.lat - 0.009, u.lng + 0.012, u.lat + 0.009].map((v) => v.toFixed(5)).join(',');
  record(http.get(`${API}/map/users?bbox=${bbox}`, tags('map_users')), 'map_users');
  record(http.get(`${API}/sos/nearby`, tags('sos_nearby')), 'sos_nearby');
  if (u.chatId && __ITER % 2 === 0) {
    record(http.post(`${API}/chats/${u.chatId}/messages`, JSON.stringify({ type: 'text', text: `load ${__VU}/${__ITER}` }), tags('post_message')), 'post_message');
  }
  // 2 reads per ~1.1 s per user → ~55/min each (limit 60); a message every ~2.2 s (limit 30/min).
  sleep(1.1);
}
