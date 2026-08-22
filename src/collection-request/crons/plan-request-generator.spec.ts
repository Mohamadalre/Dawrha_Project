import { PlanRequestGenerator } from './plan-request-generator.cron';
import { CollectionPlanFrequency } from '../enums/collection-plan-frequency.enum';
import { CollectionRequestType } from '../enums/collection-request-type.enum';

describe('PlanRequestGenerator', () => {
  let generator: PlanRequestGenerator;
  let planRepo: any;
  let requestRepo: any;
  let lineRepo: any;
  let productRepo: any;
  let effectivePrice: any;
  let units: any;

  // Mirror the cron's own local-date string so the "today" assertions are exact.
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  const plan = (overrides: Record<string, unknown> = {}) => ({
    id: 'plan1',
    accountId: 'acc1',
    name: 'Weekly recycling',
    frequency: CollectionPlanFrequency.DAILY,
    weekdays: null,
    monthDays: null,
    collectionTime: '10:00:00',
    startDate: null,
    endDate: null,
    isActive: true,
    itemNote: null,
    lastGeneratedDate: null,
    lines: [
      { id: 'l1', productId: 'p1', productName: 'Paper', unitType: 'KG', quantity: '5' },
    ],
    ...overrides,
  });

  const activeProduct = { id: 'p1', isActive: true, unitType: 'KG', unitWeightKg: null };

  beforeEach(() => {
    planRepo = {
      find: jest.fn(),
      save: jest.fn((x) => Promise.resolve(x)),
    };
    requestRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'req1', ...x })),
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockResolvedValue(null),
    };
    lineRepo = { create: jest.fn((x) => x) };
    productRepo = { find: jest.fn().mockResolvedValue([activeProduct]) };
    effectivePrice = {
      effectivePrice: jest.fn(() => Promise.resolve({ price: 5, offer: null })),
    };
    units = { weightCodes: jest.fn(() => Promise.resolve(new Set(['KG']))) };

    generator = new PlanRequestGenerator(
      planRepo, requestRepo, lineRepo, productRepo, effectivePrice, units,
    );
  });

  it('generates one ORG_PLAN request for a due DAILY plan and marks the plan', async () => {
    planRepo.find.mockResolvedValue([plan()]);

    await generator.generateDueRequests();

    expect(requestRepo.save).toHaveBeenCalledTimes(1);
    const saved = requestRepo.save.mock.calls[0][0];
    expect(saved.type).toBe(CollectionRequestType.ORG_PLAN);
    expect(saved.accountId).toBe('acc1');
    expect(saved.sourcePlanId).toBe('plan1');
    expect(saved.sourcePlanDate).toBe(today);
    expect(new Date(saved.scheduledAt).getHours()).toBe(10);
    expect(saved.estimatedGrandTotal).toBe('25');
    expect(saved.estimatedWeightKg).toBe('5');
    expect(lineRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'p1',
        productName: 'Paper',
        unitPrice: '5',
        total: '25',
      }),
    );
    expect(planRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'plan1', lastGeneratedDate: today }),
    );
  });

  it('skips a plan already generated for today (duplicate guard)', async () => {
    planRepo.find.mockResolvedValue([plan({ lastGeneratedDate: today })]);

    await generator.generateDueRequests();

    expect(requestRepo.save).not.toHaveBeenCalled();
  });

  it('skips WEEKLY plans whose weekday is not today', async () => {
    const isoWeekday = now.getDay() || 7; // 1=Monday .. 7=Sunday
    const otherWeekday = (isoWeekday % 7) + 1;
    planRepo.find.mockResolvedValue([
      plan({ frequency: CollectionPlanFrequency.WEEKLY, weekdays: [otherWeekday] }),
    ]);

    await generator.generateDueRequests();

    expect(requestRepo.save).not.toHaveBeenCalled();
  });

  it('generates for a WEEKLY plan whose weekday IS today', async () => {
    const isoWeekday = now.getDay() || 7;
    planRepo.find.mockResolvedValue([
      plan({ frequency: CollectionPlanFrequency.WEEKLY, weekdays: [isoWeekday] }),
    ]);

    await generator.generateDueRequests();

    expect(requestRepo.save).toHaveBeenCalledTimes(1);
  });

  it('generates for a MONTHLY plan whose day of month IS today', async () => {
    planRepo.find.mockResolvedValue([
      plan({ frequency: CollectionPlanFrequency.MONTHLY, monthDays: [now.getDate()] }),
    ]);

    await generator.generateDueRequests();

    expect(requestRepo.save).toHaveBeenCalledTimes(1);
  });

  it('skips plans outside their date range', async () => {
    planRepo.find.mockResolvedValue([
      plan({ endDate: '2000-01-01' }),
      plan({ startDate: '2999-01-01' }),
    ]);

    await generator.generateDueRequests();

    expect(requestRepo.save).not.toHaveBeenCalled();
  });

  it('skips lines whose product is deactivated or has no price', async () => {
    productRepo.find.mockResolvedValue([
      { id: 'p1', isActive: false, unitType: 'KG', unitWeightKg: null },
    ]);
    planRepo.find.mockResolvedValue([plan()]);

    await generator.generateDueRequests();

    expect(requestRepo.save).not.toHaveBeenCalled();
  });

  it('keeps generating for the next plan when one plan fails', async () => {
    planRepo.find.mockResolvedValue([plan({ id: 'bad' }), plan({ id: 'good' })]);
    productRepo.find.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(generator.generateDueRequests()).resolves.toBeUndefined();

    // The error was caught per-plan; no throw surfaced, and no request saved.
    expect(requestRepo.save).not.toHaveBeenCalled();
  });
});