import { CatalogService } from './catalog.service';

/**
 * The read-time override: within one material + grade, a role-SPECIFIC offer
 * hides the GENERAL one, so the buyer is shown the specific. This is the
 * in-memory twin of the NOT EXISTS clause in `baseOfferQuery`.
 */
describe('CatalogService.preferRoleSpecificOffers', () => {
  // The method is pure (touches no instance state), so it is exercised straight
  // off the prototype without standing the whole service up.
  const collapse = (offers: any[]): any[] =>
    (CatalogService.prototype as any).preferRoleSpecificOffers.call(null, offers);

  const offer = (over: any) => ({
    id: 'o', productId: 'p1', conditionCode: null, roleSpecific: false, ...over,
  });

  it('drops the general offer when a specific one exists for the same material+grade', () => {
    const general = offer({ id: 'gen', roleSpecific: false });
    const specific = offer({ id: 'spec', roleSpecific: true });

    const kept = collapse([general, specific]);

    expect(kept.map((o) => o.id)).toEqual(['spec']);
  });

  it('keeps the general offer when no specific one exists', () => {
    const general = offer({ id: 'gen', roleSpecific: false });
    expect(collapse([general]).map((o) => o.id)).toEqual(['gen']);
  });

  it('overrides per grade — a specific on GOOD does not hide a general on EXCELLENT', () => {
    const genExcellent = offer({ id: 'gen-x', conditionCode: 'EXCELLENT', roleSpecific: false });
    const genGood = offer({ id: 'gen-g', conditionCode: 'GOOD', roleSpecific: false });
    const specGood = offer({ id: 'spec-g', conditionCode: 'GOOD', roleSpecific: true });

    const kept = collapse([genExcellent, genGood, specGood]);

    // EXCELLENT keeps its general (no specific there); GOOD collapses to specific.
    expect(kept.map((o) => o.id).sort()).toEqual(['gen-x', 'spec-g']);
  });

  it('overrides per material — a specific on p1 does not hide a general on p2', () => {
    const genP1 = offer({ id: 'gen-1', productId: 'p1', roleSpecific: false });
    const specP1 = offer({ id: 'spec-1', productId: 'p1', roleSpecific: true });
    const genP2 = offer({ id: 'gen-2', productId: 'p2', roleSpecific: false });

    const kept = collapse([genP1, specP1, genP2]);

    expect(kept.map((o) => o.id).sort()).toEqual(['gen-2', 'spec-1']);
  });
});
