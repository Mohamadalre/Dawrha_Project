import { PlatformSettingsService } from './platform-settings.service';

/**
 * The single-row settings service: it always resolves ONE row, caches the
 * default currency, and an edit both persists and refreshes the cache.
 */
describe('PlatformSettingsService', () => {
  const build = (existing: any = null) => {
    const store = { row: existing };
    const repo = {
      findOne: jest.fn(async () => store.row),
      create: jest.fn((v: any) => ({ singleton: true, defaultCurrency: 'SYP', ...v })),
      save: jest.fn(async (v: any) => {
        store.row = { id: 's1', ...v };
        return store.row;
      }),
    };
    return { svc: new PlatformSettingsService(repo as any), repo, store };
  };

  it('creates the single row on first use and reports its currency', async () => {
    const { svc, repo } = build(null);
    const cur = await svc.defaultCurrency();
    expect(cur).toBe('SYP');
    expect(repo.save).toHaveBeenCalled();
  });

  it('caches the currency — a second read does not hit the repo again', async () => {
    const { svc, repo } = build({ id: 's1', singleton: true, defaultCurrency: 'SYP' });
    await svc.defaultCurrency();
    const calls = repo.findOne.mock.calls.length;
    await svc.defaultCurrency();
    expect(repo.findOne.mock.calls.length).toBe(calls); // served from cache
  });

  it('edits the currency in place, uppercases it, and refreshes the cache', async () => {
    const { svc, repo } = build({ id: 's1', singleton: true, defaultCurrency: 'SYP' });
    const res = await svc.update({ defaultCurrency: 'usd' }, 'admin1');
    expect(res.result.default_currency).toBe('USD');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ defaultCurrency: 'USD', updatedBy: 'admin1' }));
    // The cache now serves the new value without another read.
    await expect(svc.defaultCurrency()).resolves.toBe('USD');
  });

  it('resolves a creation race by reading the winner row back', async () => {
    const { svc, repo, store } = build(null);
    // First lookup: none. Save loses the unique race. Second lookup: the winner.
    repo.save.mockRejectedValueOnce(new Error('duplicate key'));
    repo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'winner', singleton: true, defaultCurrency: 'SYP' });
    const row = await svc.ensure();
    expect(row).toMatchObject({ id: 'winner' });
    void store;
  });
});
