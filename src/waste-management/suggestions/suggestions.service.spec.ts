import { SuggestionsService } from './suggestions.service';
import { Role } from '@src/user/enums/role.enum';
import { SuggestionStatus } from '../enums/suggestion-status.enum';


describe('SuggestionsService', () => {
  let service: SuggestionsService;
  let suggestionRepo: any;
  let accountRepo: any;
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
    service = new SuggestionsService(suggestionRepo, accountRepo, notifications, audit, units);
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
});
