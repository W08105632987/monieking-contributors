// Load test for the "everyone logs in at once" question.   Tool: k6  (https://k6.io)
//
//   !! RUN THIS ONLY AGAINST A STAGING COPY (own Railway service + own Supabase project), NEVER against live. !!
//   It creates real login traffic and will trip rate limits, lock accounts and use up your Supabase auth quota.
//
//   Prepare:  create N test customers on STAGING and put them in users.json as [{"phone":"0801...", "password":"..."}]
//   Run:      k6 run -e BASE=https://YOUR-STAGING-API -e VUS=500 backend/loadtest/login_burst.js
//   Ramp:     start with VUS=100, then 500, 1000, 2500 ... watch Railway CPU/memory, DB connections and error rate.
//
// What "pass" looks like: login p95 under ~2 s, error rate under 1 %, no 5xx, DB connections below the pooler limit.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const users = new SharedArray('users', () => JSON.parse(open('./users.json')));
const BASE = __ENV.BASE;
const VUS = parseInt(__ENV.VUS || '100');

export const options = {
  scenarios: {
    burst: { executor: 'ramping-vus', startVUs: 0, stages: [
      { duration: '30s', target: VUS },      // everyone arrives
      { duration: '2m',  target: VUS },      // and stays busy
      { duration: '30s', target: 0 },
    ] },
  },
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{name:login}': ['p(95)<2000'] },
};

export default function () {
  const u = users[Math.floor(Math.random() * users.length)];
  const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ phone_number: u.phone, password: u.password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } });
  const ok = check(res, { 'login 200': (r) => r.status === 200 });
  if (ok) {
    // what a real customer does right after logging in
    http.get(`${BASE}/api/v1/users/me`, { tags: { name: 'me' } });
    http.get(`${BASE}/api/v1/wallets/me`, { tags: { name: 'wallet' } });
    http.get(`${BASE}/api/v1/notifications`, { tags: { name: 'notifications' } });
  }
  sleep(1 + Math.random() * 2);
}
