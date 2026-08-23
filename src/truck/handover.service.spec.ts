import { HandoverService } from './handover.service';
import { HandoverStatus } from './enums/handover-status.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { TruckStatus } from './enums/truck-status.enum';
import {
  DropoffBeforeShiftEndException,
  DropoffReasonRequiredException,
  PickupBeforeShiftException,
  TruckDisabledException,
} from './exceptions/truck.exceptions';

/**
 * Core handover guards: the shift window (no pickup before start, no dropoff
 * before end) and the out-of-service exception (disabled truck can't be picked
 * up, but can be handed back any time).
 */
describe('HandoverService', () => {
  let service: HandoverService;
  let handoverRepo: any;
  let driverRepo: any;
  let assignmentRepo: any;
  let odooSync: any;
  let tracking: any;

  // Pin the clock to a fixed noon DAMASCUS time so shift-window math is
  // deterministic regardless of the test runner's timezone (the window is
  // resolved in Asia/Damascus, so the anchor must be too). Shift times below are
  // Damascus wall-clock, so noon sits inside the 11:00–13:00 active window.
  const FIXED = new Date('2026-06-15T12:00:00+03:00');

  const activeShift = { id: 's1', name: 'Test', tolerance: 0, startTime: '11:00:00', endTime: '13:00:00' };
  const futureShift = { ...activeShift, startTime: '13:00:00', endTime: '14:00:00' };

  const driver = {
    id: 'd1',
    account: { id: 'acc1', accountStatus: AccountStatus.ACTIVE },
    shift: activeShift,
    warehouseId: 'w1',
  };

  const mkRepo = () => ({
    findOne: jest.fn(),
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ id: 'h1', ...x })),
  });

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED);
  });
  afterAll(() => jest.useRealTimers());

  beforeEach(() => {
    handoverRepo = mkRepo();
    driverRepo = { findOne: jest.fn().mockResolvedValue(driver) };
    assignmentRepo = mkRepo();
    odooSync = {
      enqueuePushHandoverPickup: jest.fn().mockResolvedValue(undefined),
      enqueuePushHandoverDropoff: jest.fn().mockResolvedValue(undefined),
    };
    tracking = {
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    service = new HandoverService(handoverRepo, driverRepo, assignmentRepo, odooSync, tracking);
  });

  describe('pickup', () => {
    it('rejects pickup before the shift starts', async () => {
      driverRepo.findOne.mockResolvedValue({ ...driver, shift: futureShift });
      assignmentRepo.findOne.mockResolvedValue({
        truck: { id: 't1', status: TruckStatus.ACTIVE, warehouseId: 'w1' },
        shift: futureShift,
      });
      await expect(service.pickup('acc1')).rejects.toBeInstanceOf(PickupBeforeShiftException);
    });

    it('rejects picking up an out-of-service truck', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        truck: { id: 't1', status: TruckStatus.DISABLED, warehouseId: 'w1' },
        shift: activeShift,
      });
      await expect(service.pickup('acc1')).rejects.toBeInstanceOf(TruckDisabledException);
    });

    it('creates an OPEN handover during the shift window', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        truck: { id: 't1', status: TruckStatus.ACTIVE, warehouseId: 'w1' },
        shift: activeShift,
      });
      handoverRepo.findOne.mockResolvedValue(null); // no existing / no held
      const res = await service.pickup('acc1', { lat: 31.9, lng: 35.9 });
      expect(res.message).toMatch(/picked up/i);
      expect(odooSync.enqueuePushHandoverPickup).toHaveBeenCalled();
      // The pickup GPS is persisted on the session row (as decimal strings).
      expect(handoverRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: HandoverStatus.OPEN,
          truckId: 't1',
          pickupLat: '31.9',
          pickupLng: '35.9',
        }),
      );
    });

    it('stores no pickup location when the app sends only half a coordinate', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        truck: { id: 't1', status: TruckStatus.ACTIVE, warehouseId: 'w1' },
        shift: activeShift,
      });
      handoverRepo.findOne.mockResolvedValue(null);
      // Only a latitude — a lone half is not a location, so neither is stored.
      await service.pickup('acc1', { lat: 31.9 });
      expect(handoverRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ pickupLat: null, pickupLng: null }),
      );
    });
  });

  describe('dropoff', () => {
    it('requires a note', async () => {
      await expect(service.dropoff('acc1', '   ')).rejects.toBeInstanceOf(
        DropoffReasonRequiredException,
      );
    });

    it('rejects dropoff before shift end (truck in service)', async () => {
      handoverRepo.findOne.mockResolvedValue({
        id: 'h1',
        status: HandoverStatus.OPEN,
        truck: { status: TruckStatus.ACTIVE },
        shift: activeShift,
      });
      await expect(service.dropoff('acc1', 'ok')).rejects.toBeInstanceOf(
        DropoffBeforeShiftEndException,
      );
    });

    it('allows dropoff any time when the truck is out of service', async () => {
      handoverRepo.findOne.mockResolvedValue({
        id: 'h1',
        truckId: 't1',
        status: HandoverStatus.OPEN,
        truck: { status: TruckStatus.DISABLED },
        shift: activeShift,
      });
      const res = await service.dropoff('acc1', 'engine died', { lat: 32.1, lng: 36.2 });
      expect(res.message).toMatch(/handed back/i);
      expect(odooSync.enqueuePushHandoverDropoff).toHaveBeenCalled();
      // The dropoff GPS is persisted on the session row.
      expect(handoverRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ dropoffLat: '32.1', dropoffLng: '36.2' }),
      );
      // Handing the truck back stops its live tracking session.
      expect(tracking.endSession).toHaveBeenCalledWith('t1', 'HANDOVER_DROPOFF');
    });
  });
});
