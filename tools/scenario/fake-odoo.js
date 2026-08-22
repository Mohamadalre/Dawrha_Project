'use strict';

const http = require('http');

const PORT = 8069;
let seq = 100;
const nextId = () => ++seq;

function handleCall(model, method, args, kwargs) {
  const key = model + '.' + method;

  switch (key) {
    case 'recycle.product.category.create':
    case 'recycle.product.create':
    case 'recycle.measurement.unit.create':
    case 'recycle.material.condition.create':
    case 'recycle.warehouse.create':
    case 'recycle.driver.request.create':
    case 'recycle.shift.change.request.create':
    case 'recycle.truck.problem.create':
    case 'recycle.truck.handover.create':
    case 'res.users.create':
      return nextId();

    case 'recycle.order.backend_upsert_part':
      return { odoo_id: nextId(), created: true };
    case 'recycle.order.backend_cancel_part':
      return { cancelled: true, reason: args[1] ?? null };
    case 'recycle.order.action_reserve_stock':
      return { reserved: true };

    case 'recycle.delivery.trip.backend_upsert':
      return { ok: true, id: nextId(), trip_number: 'T' + nextId() };

    case 'recycle.collection.request.backend_register_intake':
      return { odoo_id: nextId() };

    case 'recycle.warehouse.notify_complaint':
      return { notified: true };

    case 'recycle.stock.transfer_grade':
      return { transferred: true, moved: args[3], requested: args[3] };

    case 'recycle.delivery.driver.backend_driver_for_truck':
      return {};
    case 'recycle.delivery.driver.backend_available_driver_truck_ids':
      return [];

    case 'recycle.province.backend_upsert':
      return nextId();
    case 'recycle.province.backend_archive':
      return true;
    case 'recycle.province.backend_sync_all':
      return { synced: (args[0] || []).length, archived: 0 };

    case 'res.users.action_reset_password':
      return true;
  }

  if (method === 'search_read' || method === 'read') {
    if (model === 'recycle.shift') {
      return [{
        id: 1, name: 'Shift A', start_time: 8.0, end_time: 16.0,
        shift_type: 'driver', is_global: true, warehouse_ids: [], tolerance: 0,
      }];
    }
    if (model === 'recycle.truck') {
      return [{
        id: 1, model: 'Toyota Hiace', year: 2020, plate_number: 'D-12345',
        max_payload_kg: 1500, warehouse_id: false, is_active: true, truck_type: 'collection',
      }];
    }
    return [];
  }
  if (method === 'search_count') return 0;
  if (method === 'read_group') return [];
  if (method === 'create') return nextId();
  if (method === 'write' || method === 'unlink') return true;
  if (model === 'res.users' && method === 'read') return [];

  return null;
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = req.url || '';
    let parsed = null;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { message: 'invalid json' } }));
      return;
    }

    const id = parsed && parsed.id !== undefined ? parsed.id : null;

    if (url.endsWith('/web/session/authenticate')) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'session_id=fakeodoo; Path=/',
      });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { uid: 1 } }));
      console.log('[fake-odoo] authenticate ok');
      return;
    }

    if (url.endsWith('/web/dataset/call_kw')) {
      const params = (parsed && parsed.params) || {};
      const model = params.model || '';
      const method = params.method || '';
      const args = params.args || [];
      const kwargs = params.kwargs || {};
      const result = handleCall(model, method, args, kwargs);
      console.log('[fake-odoo]', model + '.' + method, JSON.stringify(args).slice(0, 120));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { message: 'not found: ' + url } }));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[fake-odoo] listening on http://localhost:' + PORT);
});
