import { CatalogService } from './catalog.service';
import { Role } from '@src/user/enums/role.enum';

/**
 * WHO an offer is shown to.
 *
 * A factory offer is priced for a factory. Showing it to a citizen quotes them
 * a number they cannot be sold at, and — because factory sheets are graded —
 * often a number for a grade their price list does not even have. So targeting
 * is not decoration: it is the difference between a price and a false quote.
 *
 * The rule is asserted on the SQL the readers build, because that is where it
 * is enforced. Both readers must carry it: the offers list and the per-material
 * enrichment are separate queries, and an audience rule applied to one of them
 * leaks through the other.
 */
describe('offer audience filtering', () => {
  let service: CatalogService;
  let offerRepo: any;
  let calls: Array<{ sql: string; params: any }>;

  const qb = () => {
    const self: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn((sql: string, params: any) => {
        calls.push({ sql, params });
        return self;
      }),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    return self;
  };

  beforeEach(() => {
    calls = [];
    offerRepo = { createQueryBuilder: jest.fn(() => qb()) };
    service = new (CatalogService as any)();
    (service as any).offerRepo = offerRepo;
  });

  const audienceClause = () =>
    calls.find((c) => c.sql.includes('targetRoles'));

  // ── the per-material enrichment ─────────────────────────────────────────
  it('limits a citizen to offers that reach citizens', async () => {
    await (service as any).activeOffersForProducts(['p1'], Role.CITIZEN);

    const clause = audienceClause();
    expect(clause).toBeDefined();
    expect(clause!.sql).toContain('o.targetRoles IS NULL');
    expect(clause!.sql).toContain(':callerRole = ANY(o.targetRoles)');
    // The role actually bound is the caller's own — a factory offer carries
    // ['FACTORY'] and cannot match.
    expect(clause!.params).toEqual({ callerRole: Role.CITIZEN });
  });

  it('binds the factory role for a factory', async () => {
    await (service as any).activeOffersForProducts(['p1'], Role.FACTORY);

    expect(audienceClause()!.params).toEqual({ callerRole: Role.FACTORY });
  });

  it('shows a guest UNTARGETED offers only', async () => {
    // A guest has no tier, so a targeted price is one they could not be sold
    // at under any role they might later register as.
    await (service as any).activeOffersForProducts(['p1'], null);

    const clause = audienceClause();
    expect(clause!.sql).toBe('o.targetRoles IS NULL');
    expect(clause!.sql).not.toContain('ANY(');
  });

  // ── the offers list ─────────────────────────────────────────────────────
  it('applies the same rule on the offers LIST, not just the enrichment', async () => {
    // Two separate queries; a rule on one of them leaks through the other.
    (service as any).baseOfferQuery(null, true, Role.INSTITUTIONS);

    const clause = audienceClause();
    expect(clause!.params).toEqual({ callerRole: Role.INSTITUTIONS });
  });

  it('shows a guest untargeted offers only on the list too', async () => {
    (service as any).baseOfferQuery(null, true, null);

    expect(audienceClause()!.sql).toBe('o.targetRoles IS NULL');
  });

  // ── expiry is part of "live" ────────────────────────────────────────────
  it('excludes an offer whose window has passed', async () => {
    // This is what makes the price revert on its own, with no cron: an expired
    // offer stops matching and the list price is what remains.
    await (service as any).activeOffersForProducts(['p1'], Role.FACTORY);

    const sql = calls.map((c) => c.sql).join(' | ');
    expect(sql).toContain('o.validFrom <= NOW()');
    expect(sql).toContain('o.validUntil IS NULL OR o.validUntil > NOW()');
    expect(sql).toContain('o.isActive = true');
  });
});

/**
 * What Odoo is told about a discounted material.
 *
 * The administrator's price sheet in Odoo showed the LIST price while the apps
 * were selling at another number, and nothing on that screen said so. The
 * offer now travels beside the list price — not instead of it, because an offer
 * is a *change*, and the question the sheet is opened with is what it was as
 * much as what it is.
 */
describe('offer mirror pushed to Odoo', () => {
  const { OdooSyncProcessor } = jest.requireActual('@src/odoo-sync/odoo-sync.processor');

  const build = (offers: any[]) => {
    const proc: any = Object.create(OdooSyncProcessor.prototype);
    proc.offerRepo = {
      createQueryBuilder: () => {
        const self: any = {
          where: () => self,
          andWhere: () => self,
          orderBy: () => self,
          getMany: async () => offers,
        };
        return self;
      },
    };
    return proc;
  };

  const PricingTier = jest.requireActual(
    '@src/waste-management/enums/pricing-tier.enum',
  ).PricingTier;

  it('keys live offers by the grade each one names', async () => {
    const proc = build([
      { conditionCode: 'GOOD', offerPrice: '40', validUntil: null },
      { conditionCode: null, offerPrice: '10', validUntil: null },
    ]);

    const map = await proc.liveOffersByCondition('p1', PricingTier.FACTORY);

    expect(map.get('GOOD').offerPrice).toBe('40');
    // A flat offer is keyed on '' — the plain-price line.
    expect(map.get('').offerPrice).toBe('10');
  });

  it('keeps the cheapest when two offers land on the same grade', async () => {
    const proc = build([
      { conditionCode: 'GOOD', offerPrice: '30', validUntil: null },
      { conditionCode: 'GOOD', offerPrice: '45', validUntil: null },
    ]);

    const map = await proc.liveOffersByCondition('p1', PricingTier.FACTORY);

    expect(map.get('GOOD').offerPrice).toBe('30');
  });

  it('returns nothing when the material carries no live offer', async () => {
    const proc = build([]);

    const map = await proc.liveOffersByCondition('p1', PricingTier.FREE_FACILITY);

    expect(map.size).toBe(0);
  });
});
