import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://127.0.0.1:3000/api/v1/user-app/guest';
const ok = new Trend('ok_duration', true);   // latency of 200 responses only
const c200 = new Counter('status_200');
const c429 = new Counter('status_429');
const cother = new Counter('status_other');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 30 },
        { duration: '20s', target: 30 },
        { duration: '10s', target: 0 },
      ],
      gracefulStop: '3s',
    },
  },
};

const paths = ['/categories', '/products', '/offers'];

export default function () {
  const p = paths[Math.floor(Math.random() * paths.length)];
  const res = http.get(`${BASE}${p}`, { headers: { 'x-lang': 'en' } });
  if (res.status === 200) { c200.add(1); ok.add(res.timings.duration); }
  else if (res.status === 429) c429.add(1);
  else cother.add(1);
  check(res, { 'status is 200 or 429': (r) => r.status === 200 || r.status === 429 });
}
