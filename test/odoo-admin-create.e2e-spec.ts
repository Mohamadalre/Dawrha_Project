import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OdooAdminAccountController } from '@src/account-management/odoo-admin-account.controller';
import { OdooService } from '@src/odoo/odoo.service';
import { Account } from '@src/user/entities/account.entity';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';

/**
 * Creating an ADDITIONAL Odoo admin, over real HTTP.
 *
 * The property under test is the one that changed: the route now takes ONE
 * email and nothing else for identity — that email is the Odoo sign-in login
 * AND the contact address. So the old `login` field must be refused by the
 * whitelist, a missing/!email must be refused, and a lone email must reach the
 * service mapped to BOTH `login` and `email`.
 *
 * The Odoo service is mocked: what Odoo does with the values is proven in the
 * live path, and a routing/validation fact needs no Odoo here.
 */
describe('Create Odoo admin — email is the login (integration/e2e)', () => {
  let app: INestApplication;
  let odoo: { createAdminUser: jest.Mock; getConnectedAdminUser: jest.Mock };

  beforeAll(async () => {
    odoo = {
      createAdminUser: jest.fn().mockResolvedValue({ id: 7, login: 'x@y.com' }),
      getConnectedAdminUser: jest.fn().mockResolvedValue({}),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [OdooAdminAccountController],
      providers: [
        { provide: OdooService, useValue: odoo },
        { provide: getRepositoryToken(Account), useValue: { findOne: jest.fn(), save: jest.fn() } },
      ],
    })
      // Auth/permission are asserted elsewhere; here we test routing + validation.
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard).useValue({ canActivate: () => true })
      .compile();

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

  beforeEach(() => odoo.createAdminUser.mockClear());

  const url = '/api/v1/account-management/odoo-account/admins';

  it('refuses the old `login` field (whitelist)', async () => {
    const res = await request(app.getHttpServer())
      .post(url)
      .send({ name: 'Old Way', login: 'oldlogin', email: 'a@b.com' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/login should not exist/i);
    expect(odoo.createAdminUser).not.toHaveBeenCalled();
  });

  it('refuses a missing or non-email value', async () => {
    await request(app.getHttpServer()).post(url).send({ name: 'No Email' }).expect(400);
    await request(app.getHttpServer())
      .post(url)
      .send({ name: 'Bad', email: 'not-an-email' })
      .expect(400);
    expect(odoo.createAdminUser).not.toHaveBeenCalled();
  });

  it('accepts a lone email and uses it as BOTH login and email', async () => {
    const res = await request(app.getHttpServer())
      .post(url)
      .send({ name: 'Live Email Admin', email: 'admin2@dawrha.com' });
    expect(res.status).toBe(201);
    expect(odoo.createAdminUser).toHaveBeenCalledWith({
      name: 'Live Email Admin',
      login: 'admin2@dawrha.com',
      email: 'admin2@dawrha.com',
      phone: undefined,
    });
  });
});
