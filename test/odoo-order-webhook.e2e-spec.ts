import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { OdooWebhookController } from '@src/odoo-sync/odoo-webhook.controller';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { SuggestionsService } from '@src/waste-management/suggestions/suggestions.service';

/**
 * The Odoo → backend ORDER channel, end to end through the real controller, the
 * real DTO and the real global ValidationPipe.
 *
 * This channel was dead for three independent reasons at once, and each one was
 * invisible from the side that "owned" it:
 *
 *   1. Odoo posted to `/webhooks/odoo/orders`; the listener is at
 *      `/api/v1/odoo/webhooks/orders`.                                  → 404
 *   2. `sync_order` sent only `X-API-KEY`, never `x-odoo-webhook-secret`. → 503
 *   3. The payload carries ten fields the DTO did not declare, and the app
 *      validates with `forbidNonWhitelisted`.                            → 400
 *
 * The consequence was not a broken screen but a silent one: a warehouse
 * approved, prepared and handed over an order, and the buyer was never told any
 * of it. Fixing one or two of the three would have looked like progress and
 * changed nothing, which is why the payload below is the LITERAL body
 * `recycle.backend.sync.sync_order` builds — field for field. Any drift on
 * either side fails here instead of in production silence.
 */
const WEBHOOK_SECRET = 'test-secret-at-least-32-characters-long!!';

/** Exactly what `sync_order` posts — keep in step with backend_sync.py. */
const odooOrderPayload = (event: string, extra: Record<string, unknown> = {}) => ({
  event,
  odoo_id: 42,
  name: 'ORD/00042',
  state: 'completed',
  factory_id: 'f7a1c2e0-0000-4000-8000-000000000001',
  part_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  priority: 10,
  warehouse: 'Damascus Main',
  invoice_number: 'INV/00017',
  output_zone: 'Output A',
  stock_deducted_at: '2026-07-30 08:15:00',
  finished_at: '2026-07-30 08:40:00',
  manager_approval: 'approved',
  approval_reject_reason: '',
  handover_state: 'handed_over',
  handover_type: 'carrier',
  handover_at: '2026-07-30 09:05:00',
  handover_note: 'Carrier: Ahmad — plate 123456',
  ...extra,
});

describe('Odoo order webhook (integration/e2e)', () => {
  let app: INestApplication;
  let enqueueOrderEvent: jest.Mock;

  beforeAll(async () => {
    enqueueOrderEvent = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [OdooWebhookController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'ODOO_WEBHOOK_SECRET' ? WEBHOOK_SECRET : undefined,
          },
        },
        {
          provide: OdooSyncService,
          useValue: {
            enqueueOrderEvent,
            enqueueSyncFleet: jest.fn(),
            enqueueSyncWarehouse: jest.fn(),
            enqueueSyncDeliveryTariffs: jest.fn(),
            enqueueDriverDecision: jest.fn(),
            enqueueShiftChangeDecision: jest.fn(),
          },
        },
        { provide: getRepositoryToken(Warehouse), useValue: { find: jest.fn() } },
        { provide: SuggestionsService, useValue: { ingestFromOdoo: jest.fn() } },
        // The controller is decorated with @Throttle; without a ThrottlerGuard
        // registered the decorator is inert, which is what we want here.
        { provide: APP_GUARD, useValue: { canActivate: () => true } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Same global setup as main.ts — the point of the test is that the REAL
    // pipe accepts the REAL payload.
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => enqueueOrderEvent.mockClear());

  it('accepts the literal payload Odoo sends and queues the event', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/odoo/webhooks/orders')
      .set('x-odoo-webhook-secret', WEBHOOK_SECRET)
      .send(odooOrderPayload('handed_over'))
      .expect(202);

    expect(res.body.result).toEqual({ queued: 1 });
    expect(enqueueOrderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        partId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        odooOrderId: 42,
        event: 'handed_over',
        handoverType: 'carrier',
        invoiceNumber: 'INV/00017',
        outputZone: 'Output A',
      }),
    );
  });

  it.each([
    'manager_approved',
    'manager_rejected',
    'processing',
    'stock_deducted',
    'completed',
    'handed_over',
  ])('accepts the "%s" event — every step the buyer waits on', async (event) => {
    await request(app.getHttpServer())
      .post('/api/v1/odoo/webhooks/orders')
      .set('x-odoo-webhook-secret', WEBHOOK_SECRET)
      .send(odooOrderPayload(event))
      .expect(202);

    expect(enqueueOrderEvent).toHaveBeenCalledTimes(1);
  });

  it('carries the rejection reason through, so the buyer learns WHY', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/odoo/webhooks/orders')
      .set('x-odoo-webhook-secret', WEBHOOK_SECRET)
      .send(
        odooOrderPayload('manager_rejected', {
          manager_approval: 'rejected',
          approval_reject_reason: 'Stock reserved for an earlier order',
          handover_state: 'pending',
          handover_type: '',
        }),
      )
      .expect(202);

    expect(enqueueOrderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'manager_rejected',
        rejectReason: 'Stock reserved for an earlier order',
      }),
    );
  });

  it('rejects a wrong secret and queues nothing', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/odoo/webhooks/orders')
      .set('x-odoo-webhook-secret', 'wrong-but-same-length-secret-padding!!!!!')
      .send(odooOrderPayload('completed'))
      .expect(403);

    expect(enqueueOrderEvent).not.toHaveBeenCalled();
  });

  it('rejects a missing secret and queues nothing', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/odoo/webhooks/orders')
      .send(odooOrderPayload('completed'))
      .expect(403);

    expect(enqueueOrderEvent).not.toHaveBeenCalled();
  });

  it('accepts, but ignores, an order created inside Odoo (no part_id)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/odoo/webhooks/orders')
      .set('x-odoo-webhook-secret', WEBHOOK_SECRET)
      .send(odooOrderPayload('completed', { part_id: '' }))
      .expect(202);

    // Accepted deliberately: Odoo's own internal orders are legitimate, and
    // refusing them would fill its logs with failures for correct behaviour.
    expect(res.body.result).toEqual({ queued: 0 });
    expect(enqueueOrderEvent).not.toHaveBeenCalled();
  });

  it('still refuses a genuinely unknown field, so the contract stays honest', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/odoo/webhooks/orders')
      .set('x-odoo-webhook-secret', WEBHOOK_SECRET)
      .send(odooOrderPayload('completed', { totally_unexpected: 'x' }))
      .expect(400);

    expect(enqueueOrderEvent).not.toHaveBeenCalled();
  });
});
