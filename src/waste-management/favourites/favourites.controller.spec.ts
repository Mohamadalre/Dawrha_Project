import { FavouritesController } from './favourites.controller';

/**
 * The favourites HTTP surface — thin: every route delegates to the service with
 * the caller's identity and the parsed params, and wraps the result in the
 * standard envelope for the read routes.
 */
describe('FavouritesController', () => {
  const build = () => {
    const favourites = {
      list: jest.fn().mockResolvedValue({ items: [] }),
      listForAccount: jest.fn().mockResolvedValue({ items: [] }),
      add: jest.fn().mockResolvedValue({ id: 'f1' }),
      update: jest.fn().mockResolvedValue({ id: 'f1' }),
      remove: jest.fn().mockResolvedValue({ id: 'f1' }),
    };
    return { ctrl: new FavouritesController(favourites as any), favourites };
  };

  const USER = { id: 'u1', role: 'CITIZEN' };

  it('list → service.list(user, page, limit) inside the envelope', async () => {
    const { ctrl, favourites } = build();
    const res = await ctrl.list(USER, 2, 10);
    expect(favourites.list).toHaveBeenCalledWith(USER, 2, 10);
    expect(res).toMatchObject({ message: expect.any(String), result: { items: [] } });
  });

  it('listForAccount → the admin window onto ONE account', async () => {
    const { ctrl, favourites } = build();
    await ctrl.listForAccount('acc9', 1, 20);
    expect(favourites.listForAccount).toHaveBeenCalledWith('acc9', 1, 20);
  });

  it('add → service.add(user, product_id, note)', async () => {
    const { ctrl, favourites } = build();
    await ctrl.add(USER, { product_id: 'p1', note: 'good grade' } as any);
    expect(favourites.add).toHaveBeenCalledWith(USER, 'p1', 'good grade');
  });

  it('update → service.update(user, favouriteId, note)', async () => {
    const { ctrl, favourites } = build();
    await ctrl.update(USER, 'f1', { note: 'new' } as any);
    expect(favourites.update).toHaveBeenCalledWith(USER, 'f1', 'new');
  });

  it('remove → service.remove(user, favouriteId)', async () => {
    const { ctrl, favourites } = build();
    await ctrl.remove(USER, 'f1');
    expect(favourites.remove).toHaveBeenCalledWith(USER, 'f1');
  });
});
