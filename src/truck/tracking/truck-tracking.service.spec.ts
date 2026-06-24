import { TruckTrackingService } from './truck-tracking.service';
import { StopReason } from './enums/stop-reason.enum';

/**
 * Unit tests for TruckTrackingService — Redis storage + stop persistence.
 */
describe('TruckTrackingService', () => {
  let service: TruckTrackingService;
  let redis: any;
  let multi: any;
  let assignmentRepo: any;
  let locationLogRepo: any;

  beforeEach(() => {
    multi = {
      set: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      lpush: jest.fn().mockReturnThis(),
      ltrim: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    redis = {
      multi: jest.fn().mockReturnValue(multi),
      get: jest.fn(),
      mget: jest.fn(),
      zrangebyscore: jest.fn(),
      zrem: jest.fn().mockResolvedValue(1),
      zremrangebyscore: jest.fn().mockResolvedValue(0),
      lrange: jest.fn(),
    };
    assignmentRepo = { createQueryBuilder: jest.fn() };
    locationLogRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'log1', ...x })),
      findOne: jest.fn(),
    };

    service = new TruckTrackingService(redis, assignmentRepo, locationLogRepo);
  });

  it('saveLocation stores the position in Redis and returns the payload', async () => {
    const payload = await service.saveLocation(
      { truckId: 't1', lat: 31.9, lng: 35.9, speed: 40 },
      'driver1',
    );

    expect(payload.truckId).toBe('t1');
    expect(payload.lat).toBe(31.9);
    expect(payload.driverId).toBe('driver1');
    expect(redis.multi).toHaveBeenCalledTimes(1);
    expect(multi.set).toHaveBeenCalled();
    expect(multi.zadd).toHaveBeenCalled();
    expect(multi.exec).toHaveBeenCalled();
  });

  it('finalizeStop persists the last position to the DB and clears the active set', async () => {
    redis.get.mockResolvedValueOnce(
      JSON.stringify({ truckId: 't1', lat: 1, lng: 2, updatedAt: new Date().toISOString() }),
    );

    const log: any = await service.finalizeStop('t1', StopReason.MANUAL_STOP);

    expect(locationLogRepo.save).toHaveBeenCalledTimes(1);
    expect(redis.zrem).toHaveBeenCalledWith('truck:active', 't1');
    expect(log.reason).toBe(StopReason.MANUAL_STOP);
  });

  it('finalizeStop returns null (but still de-activates) when no position is stored', async () => {
    redis.get.mockResolvedValueOnce(null);
    const log = await service.finalizeStop('t1', StopReason.INACTIVITY);

    expect(log).toBeNull();
    expect(locationLogRepo.save).not.toHaveBeenCalled();
    expect(redis.zrem).toHaveBeenCalledWith('truck:active', 't1');
  });

  it('getActiveTrucks reads the active set and hydrates positions', async () => {
    redis.zrangebyscore.mockResolvedValueOnce(['t1']);
    redis.mget.mockResolvedValueOnce([JSON.stringify({ truckId: 't1', lat: 1, lng: 2 })]);

    const active = await service.getActiveTrucks();
    expect(active).toHaveLength(1);
    expect(active[0].truckId).toBe('t1');
  });

  it('isDriverOfTruck returns true when an assignment exists', async () => {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
    };
    assignmentRepo.createQueryBuilder.mockReturnValue(qb);

    await expect(service.isDriverOfTruck('acc1', 't1')).resolves.toBe(true);
  });
});
