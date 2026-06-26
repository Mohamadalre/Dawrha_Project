import { HomeService } from './home.service';
import { Role } from '@src/user/enums/role.enum';

describe('HomeService', () => {
  it('aggregates categories + offers for the caller', async () => {
    const catalog = {
      getCategories: jest.fn().mockResolvedValue({ categories: [{ id: 'c1' }], pagination: {} }),
      getOffers: jest.fn().mockResolvedValue({ offers: [{ offer_id: 'o1' }], pagination: {} }),
    };
    const service = new HomeService(catalog as any);

    const res = await service.getHome({ id: 'u1', role: Role.CITIZEN });

    expect(res.role).toBe(Role.CITIZEN);
    expect(res.categories).toEqual([{ id: 'c1' }]);
    expect(res.offers).toEqual([{ offer_id: 'o1' }]);
    expect(catalog.getCategories).toHaveBeenCalled();
    expect(catalog.getOffers).toHaveBeenCalled();
  });
});
