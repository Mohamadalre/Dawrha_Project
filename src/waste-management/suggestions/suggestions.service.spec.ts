import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SuggestionsService } from './suggestions.service';
import { Role } from '@src/user/enums/role.enum';

describe('SuggestionsService', () => {
  let service: SuggestionsService;
  let suggestionRepo: any;
  let categoryRepo: any;
  let notifications: any;
  let audit: any;

  beforeEach(() => {
    suggestionRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 's1', createdAt: new Date(), ...x })),
      findOne: jest.fn(),
    };
    notifications = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n1' }),
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    categoryRepo = { findOne: jest.fn().mockResolvedValue({ id: 'c1', name: 'Paper' }) };
    service = new SuggestionsService(
      suggestionRepo,
      categoryRepo,
      notifications,
      audit,
    );
  });

  describe('create', () => {
    it('stores name+category+description+images, audits, and notifies the SUBMITTER', async () => {
      const res = await service.create(
        { id: 'u1', role: Role.CITIZEN },
        { product_name: 'Cardboard', category_id: 'c1', description: '  thick brown card  ' } as any,
        ['https://img/1.jpg', 'https://img/2.jpg'],
      );

      expect(res.suggestion_id).toBe('s1');
      expect((res as any).status).toBeUndefined();
      const created = suggestionRepo.create.mock.calls[0][0];
      expect(created.imageUrls).toEqual(['https://img/1.jpg', 'https://img/2.jpg']);
      expect(created.description).toBe('thick brown card');
      expect(created.status).toBeUndefined();
      expect(created.unitType).toBeUndefined();
      expect(created.estimatedPrice).toBeUndefined();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SUGGEST_PRODUCT', entityId: 's1' }),
      );
      // The proposer is the one notified.
      const sent = notifications.createNotification.mock.calls.at(-1)[0];
      expect(sent.userId).toBe('u1');
      expect(notifications.enqueueNotification).toHaveBeenCalledWith('n1');
    });

    it('refuses when the category does not exist', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.create({ id: 'u1', role: Role.CITIZEN }, { product_name: 'x', category_id: 'nope' } as any, ['i']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses when no image is supplied', async () => {
      await expect(
        service.create({ id: 'u1', role: Role.CITIZEN }, { product_name: 'x', category_id: 'c1' } as any, []),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('ingestFromOdoo', () => {
    const payload = {
      odoo_suggestion_id: 77,
      product_name: 'Copper Wire',
      category_name: 'Metals',
      suggested_by: 'Odoo Admin',
      image_urls: ['https://img/odoo.jpg'],
    } as any;

    it('files an Odoo proposal with no account and no unit', async () => {
      suggestionRepo.findOne.mockResolvedValue(null);
      categoryRepo.findOne.mockResolvedValue({ id: 'cat-1', name: 'Metals' });

      const res = await service.ingestFromOdoo(payload);

      expect(res.suggestion_id).toBe('s1');
      const created = suggestionRepo.create.mock.calls[0][0];
      expect(created).toEqual(
        expect.objectContaining({ source: 'ODOO', accountId: undefined, odooSuggestionId: 77, categoryId: 'cat-1' }),
      );
      expect(created.unitType).toBeUndefined();
      expect(created.imageUrls).toEqual(['https://img/odoo.jpg']);
    });

    it('keeps an unmatched category name as text instead of dropping it', async () => {
      suggestionRepo.findOne.mockResolvedValue(null);
      categoryRepo.findOne.mockResolvedValue(null);

      await service.ingestFromOdoo(payload);

      const created = suggestionRepo.create.mock.calls[0][0];
      expect(created.categoryId).toBeUndefined();
      expect(created.description).toContain('Metals');
    });

    it('is idempotent — a retried push refreshes the same row', async () => {
      const existing = { id: 's-old', productName: 'old' };
      suggestionRepo.findOne.mockResolvedValue(existing);

      const res = await service.ingestFromOdoo(payload);

      expect(res.suggestion_id).toBe('s-old');
      expect(suggestionRepo.create).not.toHaveBeenCalled();
      expect(existing.productName).toBe('Copper Wire');
    });
  });

  describe('reply', () => {
    const withAccount = () => ({ id: 's1', accountId: 'u1', productName: 'Cardboard' });

    it('records the reply and notifies the submitter', async () => {
      const row: any = withAccount();
      suggestionRepo.findOne.mockResolvedValue(row);

      const res = await service.reply('admin1', 's1', '  سنضيفها قريباً  ');

      expect(res.suggestion_id).toBe('s1');
      expect(row.adminReply).toBe('سنضيفها قريباً');
      expect(row.repliedBy).toBe('admin1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REPLY_PRODUCT_SUGGESTION' }),
      );
      const sent = notifications.createNotification.mock.calls.at(-1)[0];
      expect(sent.userId).toBe('u1');
      expect(sent.body).toContain('سنضيفها قريباً');
    });

    it('refuses to reply to an Odoo proposal — no app account to tell', async () => {
      suggestionRepo.findOne.mockResolvedValue({ id: 's1', accountId: undefined, productName: 'x' });
      await expect(service.reply('admin1', 's1', 'hi')).rejects.toBeInstanceOf(BadRequestException);
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('404s an unknown suggestion', async () => {
      suggestionRepo.findOne.mockResolvedValue(null);
      await expect(service.reply('admin1', 'gone', 'hi')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listForAdmin', () => {
    it('orders oldest-first and filters app proposals by submitter role', async () => {
      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      suggestionRepo.createQueryBuilder = jest.fn(() => qb);

      await service.listForAdmin({ submitted_by: Role.FACTORY, page: 1, limit: 10 } as any);

      expect(qb.orderBy).toHaveBeenCalledWith('s.createdAt', 'ASC');
      expect(qb.andWhere).toHaveBeenCalledWith('account.role = :role', { role: Role.FACTORY });
    });

    it('filters ODOO proposals by source', async () => {
      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      suggestionRepo.createQueryBuilder = jest.fn(() => qb);

      await service.listForAdmin({ submitted_by: 'ODOO', page: 1, limit: 10 } as any);

      expect(qb.andWhere).toHaveBeenCalledWith('s.source = :src', { src: 'ODOO' });
    });
  });
});
