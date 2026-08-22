const http = require('http');
const io = require('socket.io-client');

const BASE = 'http://abd.softup.agency:5902';
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
  const token = await login('firstmail851@gmail10p.com', 'M@123456', '77777777-7777-7777-7777-777777777777', 'user-app');
  log('connected as CITIZEN');

  const socket = io(`${BASE}/collection`, { auth: { token }, transports: ['websocket'] });

  socket.onAny((event, ...args) => {
    log('RECV event=' + event + ' ' + JSON.stringify(args).slice(0, 400));
  });

  socket.on('connect', () => {
    log('socket connected: ' + socket.id);

    // control probe: a simple handler that does NOT touch findNearbyZones
    socket.emit('user:subscribe_request', { requestId: 'diagnostic-probe' }, (res) => {
      log('ACK user:subscribe_request: ' + JSON.stringify(res).slice(0, 300));
    });

    // target probe: the nearby handler
    socket.emit('user:nearby_drivers', { lat: 33.5138, lng: 36.2765, radius_km: 10 }, (res) => {
      log('ACK user:nearby_drivers: ' + JSON.stringify(res).slice(0, 600));
    });

    setTimeout(() => { socket.close(); process.exit(0); }, 6000);
  });

  socket.on('connect_error', (e) => { log('connect_error: ' + e.message); process.exit(1); });
  setTimeout(() => { log('TIMEOUT'); process.exit(1); }, 12000);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
