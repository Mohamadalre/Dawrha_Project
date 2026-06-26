import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { Product } from '@src/waste-management/entities/product.entity';
import { ProductPricing } from '@src/waste-management/entities/product-pricing.entity';
import { CartItem } from '@src/waste-management/entities/cart-item.entity';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { AuditService } from '@src/waste-management/common/providers/audit.service';
import { CatalogCacheService } from '@src/waste-management/common/providers/catalog-cache.service';
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

  const productRepo = { findOne: jest.fn().mockResolvedValue({ id: PRODUCT_ID }) };
  const pricingRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(updateQb),
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
        { provide: getRepositoryToken(CartItem), useValue: cartItemRepo },
        { provide: OdooSyncService, useValue: odooSync },
        { provide: AuditService, useValue: audit },
        { provide: CatalogCacheService, useValue: { invalidate: jest.fn() } },
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

  it('POST /admin/waste/products/:id/pricing sets all four tiers (201 + envelope)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/admin/waste/products/${PRODUCT_ID}/pricing`)
      .send({ individual: 0.3, company: 0.27, factory: 0.25, free_facility: 0.26 })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.pricing).toEqual({
      individual: 0.3,
      company: 0.27,
      factory: 0.25,
      free_facility: 0.26,
    });
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: PRODUCT_ID });
  });

  it('rejects a body missing the free_facility tier (400)', async () => {
    await request(app.getHttpServer())
      .post(`/admin/waste/products/${PRODUCT_ID}/pricing`)
      .send({ individual: 0.3, company: 0.27, factory: 0.25 })
      .expect(400);
  });

  it('rejects an invalid (non-UUID) product id (400)', async () => {
    await request(app.getHttpServer())
      .post('/admin/waste/products/not-a-uuid/pricing')
      .send({ individual: 0.3, company: 0.27, factory: 0.25, free_facility: 0.26 })
      .expect(400);
  });

  it('GET /admin/waste/products/:id/pricing returns the grouped history', async () => {
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
    expect(res.body.data.tiers.individual.current).toBe(0.3);
  });
});
