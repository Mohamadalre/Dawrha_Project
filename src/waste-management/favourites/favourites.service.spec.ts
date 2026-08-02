import { ConflictException, NotFoundException } from '@nestjs/common';
import { FavouritesService } from './favourites.service';
import { Role } from '@src/user/enums/role.enum';
import { PricingTier } from '../enums/pricing-tier.enum';

/**
 * A buyer's shortlist, and the two things that decide whether it is safe.
 *
 * It is scoped to the CALLER's account id, taken from the token and never from
 * the request — a favourites list keyed on anything the client sends is a list
 * anyone can read by changing a number.
 *
 * And it is priced at the caller's OWN tier, because a shortlist with no prices
 * sends the buyer back to the catalogue to look each one up, which is the trip
 * the list exists to save.
 */
describe('FavouritesService', () => {
  let service: FavouritesService;
  let favouriteRepo: any;
  let productRepo: any;
  let pricingRepo: any;
  let units: any;

  const ME = { id: 'acc-me', role: Role.CITIZEN };
  const PRODUCT = {
    id: 'p-1',
    name: 'PET Bottles',
    unitType: 'KG',
    isActive: true,
    categoryId: 'c-1',
  };

  const priceRow = (over: Partial<any> = {}) => ({
    productId: 'p-1',
    tier: PricingTier.INDIVIDUAL,
    price: '0.30',
    conditionCode: null,
    effectiveFrom: '2020-01-01',
    effectiveUntil: null,
    ...over,
  });

  beforeEach(() => {
    favouriteRepo = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'f-1', ...x })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    productRepo = { findOne: jest.fn().mockResolvedValue(PRODUCT) };
    pricingRepo = { find: jest.fn().mockResolvedValue([priceRow()]) };
    units = {
      byCode: jest.fn(async () => new Map([['KG', { id: 'u-kg', code: 'KG' }]])),
    };

    service = new FavouritesService(favouriteRepo, productRepo, pricingRepo, units);
  });

  // ------------------------------------------------------------------
  describe('adding', () => {
    it('adds a material to the caller’s own list', async () => {
      const res: any = await service.add(ME, 'p-1');

      expect(res.favourite_id).toBe('f-1');
      expect(favouriteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'acc-me', productId: 'p-1' }),
      );
    });

    it('refuses a material that does not exist', async () => {
      productRepo.findOne.mockResolvedValue(null);
      await expect(service.add(ME, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a material that has been switched off', async () => {
      // A favourite is a shortcut back to something buyable, and a shortcut to
      // nothing is worse than no shortcut.
      productRepo.findOne.mockResolvedValue({ ...PRODUCT, isActive: false });
      await expect(service.add(ME, 'p-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not add the same material twice', async () => {
      // Tapping a heart twice on a slow connection must leave ONE row — the
      // count on the screen cannot depend on how many times a button was
      // pressed while it looked unresponsive.
      favouriteRepo.findOne.mockResolvedValue({ id: 'f-existing' });

      const err: any = await service.add(ME, 'p-1').catch((e) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.response.favourite_id).toBe('f-existing');
      expect(favouriteRepo.save).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  describe('ownership', () => {
    it('will not edit somebody else’s favourite', async () => {
      favouriteRepo.findOne.mockResolvedValue({ id: 'f-1', accountId: 'acc-someone-else' });

      await expect(service.update(ME, 'f-1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('will not delete somebody else’s favourite', async () => {
      favouriteRepo.findOne.mockResolvedValue({ id: 'f-1', accountId: 'acc-someone-else' });

      await expect(service.remove(ME, 'f-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(favouriteRepo.delete).not.toHaveBeenCalled();
    });

    it('answers 404 rather than 403 for another buyer’s id', async () => {
      // A 403 confirms the id is real and belongs to somebody, which is
      // exactly what an enumeration attempt is looking for.
      favouriteRepo.findOne.mockResolvedValue({ id: 'f-1', accountId: 'other' });
      const err = await service.remove(ME, 'f-1').catch((e) => e);
      expect(err.getStatus()).toBe(404);
    });

    it('scopes the listing to the caller and nothing else', async () => {
      await service.list(ME);

      expect(favouriteRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { accountId: 'acc-me' } }),
      );
    });
  });

  // ------------------------------------------------------------------
  describe('the note', () => {
    it('is what "edit" means here', async () => {
      favouriteRepo.findOne.mockResolvedValue({ id: 'f-1', accountId: ME.id });

      const res: any = await service.update(ME, 'f-1', '  ask for pre-baled  ');

      expect(res.note).toBe('ask for pre-baled');
    });

    it('clears on an empty string rather than storing ""', async () => {
      // The two are the same thing to a reader, and only one of them sorts and
      // renders predictably.
      favouriteRepo.findOne.mockResolvedValue({ id: 'f-1', accountId: ME.id, note: 'old' });

      const res: any = await service.update(ME, 'f-1', '   ');

      expect(res.note).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  describe('pricing', () => {
    const listOne = () => {
      favouriteRepo.findAndCount.mockResolvedValue([
        [{ id: 'f-1', productId: 'p-1', product: PRODUCT, createdAt: new Date() }],
        1,
      ]);
      return service.list(ME);
    };

    it('quotes the CALLER’s tier', async () => {
      const res: any = await listOne();

      expect(pricingRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tier: PricingTier.INDIVIDUAL }),
        }),
      );
      expect(res.favourites[0].price).toBe(0.3);
      expect(res.favourites[0].available).toBe(true);
    });

    it('quotes a factory at the FACTORY tier from the same endpoint', async () => {
      // One set of routes for four roles: the role changes the numbers without
      // changing the endpoint.
      //
      // A row has to exist for pricing to be reached at all — an empty list
      // short-circuits before the lookup, so asserting on an empty one would
      // have proved nothing either way.
      favouriteRepo.findAndCount.mockResolvedValue([
        [{ id: 'f-1', productId: 'p-1', product: PRODUCT, createdAt: new Date() }],
        1,
      ]);

      await service.list({ id: 'acc-f', role: Role.FACTORY });

      expect(pricingRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tier: PricingTier.FACTORY }),
        }),
      );
    });

    it('keeps a material whose price has been withdrawn, and says so', async () => {
      // Dropping it silently is the worse answer: the buyer put it there
      // deliberately, and "it vanished" is not something they can act on,
      // whereas "not currently priced for you" is.
      pricingRepo.find.mockResolvedValue([]);

      const res: any = await listOne();

      expect(res.favourites).toHaveLength(1);
      expect(res.favourites[0].price).toBeNull();
      expect(res.favourites[0].available).toBe(false);
    });

    it('ignores a price whose window has closed', async () => {
      pricingRepo.find.mockResolvedValue([
        priceRow({ effectiveUntil: '2020-06-01' }),
      ]);

      const res: any = await listOne();

      expect(res.favourites[0].price).toBeNull();
    });

    it('shows the cheapest grade as the headline for a graded tier', async () => {
      pricingRepo.find.mockResolvedValue([
        priceRow({ price: '0.90', conditionCode: 'EXCELLENT' }),
        priceRow({ price: '0.55', conditionCode: 'FAIR' }),
      ]);

      const res: any = await listOne();

      expect(res.favourites[0].price).toBe(0.55);
    });

    it('carries the unit as id and code', async () => {
      const res: any = await listOne();

      expect(res.favourites[0].unit).toEqual({ id: 'u-kg', code: 'KG' });
    });
  });
});
