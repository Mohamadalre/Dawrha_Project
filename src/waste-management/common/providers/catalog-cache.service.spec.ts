import { Logger } from '@nestjs/common';
import { CatalogCacheService } from './catalog-cache.service';

/**
 * Unit tests for CatalogCacheService — version-based keys + fail-open behaviour.
 */
describe('CatalogCacheService', () => {
  let service: CatalogCacheService;
  let redis: any;

  beforeEach(() => {
    redis = { get: jest.fn(), set: jest.fn().mockResolvedValue('OK'), incr: jest.fn().mockResolvedValue(1) };
    service = new CatalogCacheService(redis);
  });

  it('reads a value using the current version in the key', async () => {
    redis.get
      .mockResolvedValueOnce('3') // version lookup
      .mockResolvedValueOnce(JSON.stringify({ x: 1 })); // value lookup

    const res = await service.get('categories', 'all:1:10');

    expect(res).toEqual({ x: 1 });
    expect(redis.get.mock.calls[1][0]).toBe('catalog:categories:v3:all:1:10');
  });

  it('returns null on a cache miss', async () => {
    redis.get.mockResolvedValueOnce('0').mockResolvedValueOnce(null);
    expect(await service.get('products', 'all')).toBeNull();
  });

  it('writes a value with the resource TTL', async () => {
    redis.get.mockResolvedValueOnce('0'); // version
    await service.set('offers', 'all', { a: 1 });
    expect(redis.set).toHaveBeenCalledWith(
      'catalog:offers:v0:all',
      JSON.stringify({ a: 1 }),
      'EX',
      6 * 60 * 60,
    );
  });

  it('invalidate bumps the version counter for each resource', async () => {
    await service.invalidate('categories', 'products');
    expect(redis.incr).toHaveBeenCalledWith('catalog:ver:categories');
    expect(redis.incr).toHaveBeenCalledWith('catalog:ver:products');
  });

  it('is fail-open: a Redis error returns null instead of throwing', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    redis.get.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.get('categories', 'all')).resolves.toBeNull();
  });
});
