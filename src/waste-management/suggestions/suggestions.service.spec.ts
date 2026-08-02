import { SuggestionsService } from './suggestions.service';
import { Role } from '@src/user/enums/role.enum';
import { SuggestionStatus } from '../enums/suggestion-status.enum';


describe('SuggestionsService', () => {
  let service: SuggestionsService;
  let suggestionRepo: any;
  let accountRepo: any;
  let categoryRepo: any;
  let notifications: any;
  let audit: any;
  let units: any;

  beforeEach(() => {
    suggestionRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) =>
        Promise.resolve({ id: 's1', status: SuggestionStatus.PENDING_REVIEW, createdAt: new Date(), ...x }),
      ),
    };
    accountRepo = { find: jest.fn().mockResolvedValue([{ id: 'admin1' }]) };
    notifications = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n1' }),
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    units = {
      validateActiveCode: jest.fn(async (code: string) => String(code).toUpperCase()),
    };
    categoryRepo = { findOne: jest.fn().mockResolvedValue(null) };
    service = new SuggestionsService(
      suggestionRepo,
      accountRepo,
      categoryRepo,
      notifications,
      audit,
      units,
    );
  });

  it('creates a PENDING suggestion, writes an audit log and notifies admins', async () => {
    const res = await service.create(
      { id: 'u1', role: Role.CITIZEN },
      { product_name: 'Cardboard', category_id: 'c1', unit_type: 'KG' } as any,
    );

    expect(res.suggestion_id).toBe('s1');
    expect(res.status).toBe(SuggestionStatus.PENDING_REVIEW);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUGGEST_PRODUCT', entityId: 's1' }),
    );
    expect(notifications.createNotification).toHaveBeenCalled();
    expect(notifications.enqueueNotification).toHaveBeenCalledWith('n1');
  });

  describe('ingestFromOdoo', () => {
    const payload = {
      odoo_suggestion_id: 77,
      product_name: 'Copper Wire',
      unit_type: 'kg',
      category_name: 'Metals',
      suggested_by: 'Odoo Admin',
    } as any;

    it('files an Odoo proposal with no account behind it', async () => {
      suggestionRepo.findOne = jest.fn().mockResolvedValue(null);
      categoryRepo.findOne.mockResolvedValue({ id: 'cat-1', name: 'Metals' });

      const res = await service.ingestFromOdoo(payload);

      expect(res.suggestion_id).toBe('s1');
      expect(suggestionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'ODOO',
          accountId: undefined,
          odooSuggestionId: 77,
          categoryId: 'cat-1',
          unitType: 'KG',
        }),
      );
    });

    it('keeps an unmatched category name as text instead of dropping it', async () => {
      suggestionRepo.findOne = jest.fn().mockResolvedValue(null);
      categoryRepo.findOne.mockResolvedValue(null);

      await service.ingestFromOdoo(payload);

      const created = suggestionRepo.create.mock.calls[0][0];
      expect(created.categoryId).toBeUndefined();
      expect(created.description).toContain('Metals');
    });

    it('is idempotent — a retried push refreshes the same row', async () => {
      const existing = {
        id: 's-old',
        status: SuggestionStatus.PENDING_REVIEW,
        productName: 'old',
      };
      suggestionRepo.findOne = jest.fn().mockResolvedValue(existing);

      const res = await service.ingestFromOdoo(payload);

      expect(res.suggestion_id).toBe('s-old');
      expect(suggestionRepo.create).not.toHaveBeenCalled();
      expect(existing.productName).toBe('Copper Wire');
    });

    it('refuses to rewrite a proposal the admin has already ruled on', async () => {
      suggestionRepo.findOne = jest.fn().mockResolvedValue({
        id: 's-old',
        status: SuggestionStatus.REJECTED,
        productName: 'old',
      });

      const res = await service.ingestFromOdoo(payload);

      expect(res.status).toBe(SuggestionStatus.REJECTED);
      expect(suggestionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('review', () => {
    const pending = () => ({
      id: 's1',
      accountId: 'u1',
      productName: 'Cardboard',
      status: SuggestionStatus.PENDING_REVIEW,
    });

    it('approving records the decision and creates NO product', async () => {
      const row = pending();
      suggestionRepo.findOne = jest.fn().mockResolvedValue(row);

      const res = await service.review('admin1', 's1', {
        status: SuggestionStatus.APPROVED,
      } as any);

      expect(res.status).toBe(SuggestionStatus.APPROVED);
      expect(res.product_created).toBe(false);
      expect(row.status).toBe(SuggestionStatus.APPROVED);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REVIEW_PRODUCT_SUGGESTION' }),
      );
    });

    it('tells the proposer the idea was accepted for study, not that it is on sale', async () => {
      suggestionRepo.findOne = jest.fn().mockResolvedValue(pending());

      await service.review('admin1', 's1', {
        status: SuggestionStatus.APPROVED,
      } as any);

      const sent = notifications.createNotification.mock.calls.at(-1)[0];
      expect(sent.userId).toBe('u1');
      expect(sent.body).toContain('سيُدرَس');
    });

    it('refuses a rejection with no reason', async () => {
      suggestionRepo.findOne = jest.fn().mockResolvedValue(pending());

      await expect(
        service.review('admin1', 's1', {
          status: SuggestionStatus.REJECTED,
          admin_notes: '   ',
        } as any),
      ).rejects.toThrow('A rejection must say why');
    });

    it('refuses to review the same proposal twice', async () => {
      suggestionRepo.findOne = jest.fn().mockResolvedValue({
        ...pending(),
        status: SuggestionStatus.APPROVED,
      });

      await expect(
        service.review('admin1', 's1', {
          status: SuggestionStatus.REJECTED,
          admin_notes: 'no',
        } as any),
      ).rejects.toThrow('already approved');
    });

    it('sends no notification for an Odoo proposal — there is no account to tell', async () => {
      suggestionRepo.findOne = jest
        .fn()
        .mockResolvedValue({ ...pending(), accountId: undefined });
      notifications.createNotification.mockClear();

      await service.review('admin1', 's1', {
        status: SuggestionStatus.APPROVED,
      } as any);

      expect(notifications.createNotification).not.toHaveBeenCalled();
    });
  });
});
