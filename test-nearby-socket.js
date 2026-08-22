const http = require('http');
const io = require('socket.io-client');

const BASE = 'http://localhost:3000';
let step = 0;
function log(m){ step++; console.log(`\n[${step}] ${m}`); }

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}/api/v1${path}`);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ ...JSON.parse(data), _status: res.statusCode }); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function login(email, password, deviceId, endpoint) {
  const res = await request('POST', `/auth/login/${endpoint}`, { email, password, deviceId });
  const token = res.data?.details?.token?.accessToken || res.result?.details?.token?.accessToken;
  if (!token) throw new Error(`login failed: ${JSON.stringify(res)}`);
  return token;
}

async function main() {
  const token = await login('producer.flow@dawrha.com', 'Producer@123', '77777777-7777-7777-7777-777777777777', 'user-app');
  log('connected as CITIZEN');

  const socket = io(`${BASE}/collection`, { auth: { token }, transports: ['websocket'] });

  socket.on('connect', () => {
    log('socket connected: ' + socket.id);
    socket.emit('user:nearby_drivers', { lat: 33.5138, lng: 36.2765, radius_km: 10 }, (res) => {
      log('ACK user:nearby_drivers: ' + JSON.stringify(res).slice(0, 600));
      socket.close();
      process.exit(0);
    });
  });

  socket.on('connect_error', (e) => { log('connect_error: ' + e.message); process.exit(1); });
  setTimeout(() => { log('TIMEOUT'); process.exit(1); }, 8000);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
