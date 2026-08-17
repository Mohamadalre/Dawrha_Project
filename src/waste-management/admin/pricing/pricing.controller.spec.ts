import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { Product } from '@src/waste-management/entities/product.entity';
import { ProductPricing } from '@src/waste-management/entities/product-pricing.entity';
import { ProductPricingHistory } from '@src/waste-management/entities/product-pricing-history.entity';
import { CartItem } from '@src/waste-management/entities/cart-item.entity';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { AuditService } from '@src/waste-management/common/providers/audit.service';
import { CatalogCacheService } from '@src/waste-management/common/providers/catalog-cache.service';
import { ConditionsService } from '@src/waste-management/common/providers/conditions.service';
import { ProductConditionsService } from '@src/waste-management/admin/product-conditions.service';
import { OfferSettlementService } from '@src/waste-management/common/providers/offer-settlement.service';
import { Account } from '@src/user/entities/account.entity';
import { NotificationService } from '@src/notification/notification.service';
import { PlatformSettingsService } from '@src/platform-settings/platform-settings.service';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { TransformInterceptor } from '@src/common/interceptors/transform.interceptor';

/**
 * Integration test: real PricingController + PricingService wired through a Nest
 * TestingModule, with mocked repositories. Exercises guards (overridden), the
 * global ValidationPipe, the controller/service flow and the response envelope.
 */
describe('PricingController (integration)', () => {
  let app: INestApplication;
  const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';

  const updateQb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  };

  const productRepo = { findOne: jest.fn().mockResolvedValue({ id: PRODUCT_ID, isActive: true }) };
  const pricingRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(updateQb),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve(x)),
    find: jest.fn().mockResolvedValue([]),
  };
  const historyRepo = {
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve(x)),
    find: jest.fn().mockResolvedValue([]),
  };
  const cartItemRepo = { find: jest.fn().mockResolvedValue([]), save: jest.fn() };
  const odooSync = { enqueueUpdatePricing: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PricingController],
      providers: [
        PricingService,
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(ProductPricing), useValue: pricingRepo },
        { provide: getRepositoryToken(ProductPricingHistory), useValue: historyRepo },
        { provide: getRepositoryToken(CartItem), useValue: cartItemRepo },
        { provide: OdooSyncService, useValue: odooSync },
        { provide: AuditService, useValue: audit },
        { provide: CatalogCacheService, useValue: { invalidate: jest.fn() } },
        {
          provide: ConditionsService,
          useValue: {
            validateActiveCode: jest.fn(async (c: string) => String(c).toUpperCase()),
            labelMapFor: jest.fn(async () => new Map()),
          },
        },
        {
          // A price change re-settles the offers on that material: the stored
          // percentage is computed against the old price, and an amount that no
          // longer fits the new one would make the price negative.
          provide: OfferSettlementService,
          useValue: {
            resettle: jest.fn().mockResolvedValue({ repriced: 0, suspended: 0 }),
          },
        },
        {
          // The pricing shape is decided by the MATERIAL now, so the test has
          // to declare which grades the product under test has.
          provide: ProductConditionsService,
          useValue: {
            hasConditions: jest.fn().mockResolvedValue(true),
            activeCodes: jest.fn().mockResolvedValue(['EXCELLENT']),
            // A price is linked to its grade BY ID, so both entry points —
            // the id and the legacy code — resolve to the grade row.
            findByCodeForProduct: jest.fn(async (_p: string, code: string) => ({
              id: `cond-${code}`,
              code,
            })),
            resolveForProduct: jest.fn(async (id: string) => ({
              id,
              code: 'EXCELLENT',
            })),
          },
        },
        // The expiry sweep notifies every admin; irrelevant to these route tests.
        { provide: getRepositoryToken(Account), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: NotificationService, useValue: { createNotification: jest.fn(), enqueueNotification: jest.fn() } },
        { provide: PlatformSettingsService, useValue: { defaultCurrency: jest.fn().mockResolvedValue('SYP') } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { id: 'admin1', role: 'ADMIN' };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // 200, not 201: this REPLACES the price list of an existing product — an
  // upsert on a sub-resource, so nothing new is created at a new URL.
  it('POST /admin/waste/products/:id/pricing sets all four tiers (200 + envelope)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/admin/waste/products/${PRODUCT_ID}/pricing`)
      .send({ individual: 0.3, company: 0.27, factory: [{ condition: 'EXCELLENT', price: 0.25 }], free_facility: [{ condition: 'EXCELLENT', price: 0.26 }] })
      .expect(200);

    expect(res.body.success).toBe(true);
    // Each role comes back with its pricing-row id. Sent as a CODE and returned
    // with the grade's ID resolved beside it — a caller written before the link
    // existed keeps working, and its price is filed against a real grade.
    expect(res.body.data.pricing.individual).toMatchObject({ price: 0.3 });
    expect(res.body.data.pricing.company).toMatchObject({ price: 0.27 });
    expect(res.body.data.pricing.factory[0]).toMatchObject({
      condition: 'EXCELLENT',
      condition_id: 'cond-EXCELLENT',
      price: 0.25,
    });
    expect(res.body.data.pricing.free_facility[0]).toMatchObject({
      condition: 'EXCELLENT',
      condition_id: 'cond-EXCELLENT',
      price: 0.26,
    });
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: PRODUCT_ID });
  });

  it('rejects a body missing the free_facility tier (400)', async () => {
    await request(app.getHttpServer())
      .post(`/admin/waste/products/${PRODUCT_ID}/pricing`)
      .send({ individual: 0.3, company: 0.27, factory: [{ condition: 'EXCELLENT', price: 0.25 }] })
      .expect(400);
  });

  it('rejects an invalid (non-UUID) product id (400)', async () => {
    await request(app.getHttpServer())
      .post('/admin/waste/products/not-a-uuid/pricing')
      .send({ individual: 0.3, company: 0.27, factory: [{ condition: 'EXCELLENT', price: 0.25 }], free_facility: [{ condition: 'EXCELLENT', price: 0.26 }] })
      .expect(400);
  });

  it('GET /admin/waste/products/:id/pricing returns the current live prices', async () => {
    pricingRepo.find.mockResolvedValueOnce([
      {
        tier: 'INDIVIDUAL',
        price: '0.30',
        currency: 'JOD',
        effectiveFrom: new Date(Date.now() - 1000),
        effectiveUntil: null,
      },
    ]);

    const res = await request(app.getHttpServer())
      .get(`/admin/waste/products/${PRODUCT_ID}/pricing`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.pricing.individual).toMatchObject({ price: 0.3 });
    expect(res.body.data.pricing.company).toBeNull();
  });

  it('GET /admin/waste/products/:id/pricing/history returns archived prices per tier', async () => {
    historyRepo.find.mockResolvedValueOnce([
      {
        tier: 'FACTORY',
        price: '0.25',
        currency: 'JOD',
        effectiveFrom: new Date(Date.now() - 2000),
        archivedAt: new Date(Date.now() - 1000),
        archivedReason: 'UPDATED',
      },
    ]);

    const res = await request(app.getHttpServer())
      .get(`/admin/waste/products/${PRODUCT_ID}/pricing/history`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.tiers.factory).toHaveLength(1);
    expect(res.body.data.tiers.factory[0].archived_reason).toBe('UPDATED');
  });

  it('PATCH /admin/waste/products/:id/pricing/:tier edits a single tier', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/admin/waste/products/${PRODUCT_ID}/pricing/FACTORY`)
      .send({ price: 0.5, condition: 'EXCELLENT' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.tier).toBe('factory');
    expect(res.body.data.condition).toBe('EXCELLENT');
    expect(res.body.data.price).toBe(0.5);
  });

  it('PATCH rejects an unknown tier (400)', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/waste/products/${PRODUCT_ID}/pricing/PLATINUM`)
      .send({ price: 0.5 })
      .expect(400);
  });
});
