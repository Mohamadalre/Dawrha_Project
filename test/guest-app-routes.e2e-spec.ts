import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  FactoryAppGuestController,
  UserAppGuestController,
} from '@src/waste-management/catalog/guest-app.controller';
import { GuestAppService } from '@src/waste-management/catalog/guest-app.service';
import { GuestAudience } from '@src/waste-management/enums/guest-audience.enum';

/**
 * The visitor catalogues of both apps, over real HTTP.
 *
 * The property worth testing is not that the routes answer — it is WHICH
 * audience each one answers as. That decision reveals a commercial price sheet,
 * so it must be bound to the path and unreachable from anything the caller
 * sends. Every request below asserts the audience the service was actually
 * called with.
 *
 * The service is mocked deliberately: what the shaping does with real rows is
 * asserted directly in `guest-app.service.spec.ts` against a pure function, and
 * mixing the two would need a database to prove a routing fact.
 */
describe('Guest app catalogues (integration/e2e)', () => {
  let app: INestApplication;
  let guest: Record<keyof GuestAppService, jest.Mock>;

  const emptyList = { products: [], categories: [], offers: [], pagination: {} };

  beforeAll(async () => {
    guest = {
      categories: jest.fn().mockResolvedValue(emptyList),
      products: jest.fn().mockResolvedValue(emptyList),
      productDetail: jest.fn().mockResolvedValue({ product: {} }),
      offers: jest.fn().mockResolvedValue(emptyList),
      search: jest.fn().mockResolvedValue(emptyList),
    } as any;

    const moduleRef = await Test.createTestingModule({
      controllers: [UserAppGuestController, FactoryAppGuestController],
      providers: [{ provide: GuestAppService, useValue: guest }],
    }).compile();

    app = moduleRef.createNestApplication();
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

  beforeEach(() => {
    Object.values(guest).forEach((m) => m.mockClear());
  });

  const USER = '/api/v1/user-app/guest';
  const FACTORY = '/api/v1/factory-app/guest';

  describe.each([
    ['user app', USER, GuestAudience.USER],
    ['factory app', FACTORY, GuestAudience.FACTORY],
  ])('%s', (_label, base, audience) => {
    it('serves categories as its own audience', async () => {
      await request(app.getHttpServer()).get(`${base}/categories`).expect(200);

      expect(guest.categories).toHaveBeenCalledWith(audience, expect.anything());
    });

    it('serves materials as its own audience', async () => {
      await request(app.getHttpServer()).get(`${base}/products`).expect(200);

      expect(guest.products).toHaveBeenCalledWith(audience, expect.anything());
    });

    it('serves one material as its own audience', async () => {
      const id = '11111111-2222-4333-8444-555555555555';
      await request(app.getHttpServer()).get(`${base}/products/${id}`).expect(200);

      expect(guest.productDetail).toHaveBeenCalledWith(audience, id);
    });

    it('serves the materials of one category as its own audience', async () => {
      const id = '11111111-2222-4333-8444-555555555555';
      await request(app.getHttpServer())
        .get(`${base}/categories/${id}/products`)
        .expect(200);

      expect(guest.products).toHaveBeenCalledWith(
        audience,
        expect.objectContaining({ category_id: id }),
      );
    });

    it('serves offers as its own audience', async () => {
      await request(app.getHttpServer()).get(`${base}/offers`).expect(200);

      expect(guest.offers).toHaveBeenCalledWith(audience, expect.anything());
    });

    it('searches categories AND materials in one call', async () => {
      await request(app.getHttpServer())
        .get(`${base}/search`)
        .query({ query: 'plastic' })
        .expect(200);

      expect(guest.search).toHaveBeenCalledWith(
        audience,
        expect.objectContaining({ query: 'plastic' }),
      );
    });

    it('needs no token — a visitor has no account', async () => {
      // No Authorization header anywhere in this file. A 401 here would mean the
      // routes had quietly been put behind a guard.
      await request(app.getHttpServer()).get(`${base}/categories`).expect(200);
    });

    it('refuses a search with no text rather than listing everything', async () => {
      await request(app.getHttpServer()).get(`${base}/search`).expect(400);

      expect(guest.search).not.toHaveBeenCalled();
    });

    it('rejects an attempt to smuggle the other audience in the query', async () => {
      // The audience is bound to the CLASS. An `audience`/`tier` parameter is
      // not merely ignored — it is refused, so an attempt is visible rather than
      // silently treated as a normal request.
      await request(app.getHttpServer())
        .get(`${base}/products`)
        .query({ audience: 'FACTORY', tier: 'FACTORY' })
        .expect(400);

      expect(guest.products).not.toHaveBeenCalled();
    });
  });

  it('has no write route: a visitor cannot build a cart or place an order', async () => {
    for (const base of [USER, FACTORY]) {
      await request(app.getHttpServer()).post(`${base}/cart`).expect(404);
      await request(app.getHttpServer()).post(`${base}/orders`).expect(404);
      await request(app.getHttpServer()).post(`${base}/checkout`).expect(404);
    }
  });

  it('keeps the two apps on genuinely separate paths', async () => {
    await request(app.getHttpServer()).get(`${USER}/products`).expect(200);
    expect(guest.products).toHaveBeenCalledWith(GuestAudience.USER, expect.anything());

    guest.products.mockClear();

    await request(app.getHttpServer()).get(`${FACTORY}/products`).expect(200);
    expect(guest.products).toHaveBeenCalledWith(GuestAudience.FACTORY, expect.anything());
    expect(guest.products).not.toHaveBeenCalledWith(
      GuestAudience.USER,
      expect.anything(),
    );
  });
});
