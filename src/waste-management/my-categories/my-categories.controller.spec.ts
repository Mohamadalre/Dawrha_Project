import { MyCategoriesController } from './my-categories.controller';

/**
 * The remaining "my categories" route (the GET `/list` was removed): adding
 * categories delegates to the service with the caller and the id list.
 */
describe('MyCategoriesController', () => {
  it('add → service.addCategories(user, categoryIds) inside the envelope', async () => {
    const service = { addCategories: jest.fn().mockResolvedValue({ categories: [], added: 2 }) };
    const ctrl = new MyCategoriesController(service as any);
    const user = { id: 'u1', role: 'FACTORY' };

    const res = await ctrl.add(user, { categoryIds: ['a', 'b'] } as any);

    expect(service.addCategories).toHaveBeenCalledWith(user, ['a', 'b']);
    expect(res).toMatchObject({ message: expect.any(String), result: { added: 2 } });
  });
});
