import { TruckTrackingGateway } from './truck-tracking.gateway';
import { StopReason } from './enums/stop-reason.enum';
import { Role } from '@src/user/enums/role.enum';

/**
 * The tracking gate: a collector's coordinates are accepted ONLY while he is
 * actively operating the truck (an OPEN handover). A truck that is merely
 * assigned — not picked up — is not tracked. This is the whole feature: tracking
 * runs only for collection trucks a driver has received/started.
 */
describe('TruckTrackingGateway', () => {
  let gateway: TruckTrackingGateway;
  let tracking: any;
  let emitted: Array<{ room: string; event: string; payload: any }>;

  const mkServer = () => ({
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
  });

  const collectorSocket = (data: any = {}) => ({
    data: { user: { id: 'acc1', role: Role.COLLECTOR }, ...data },
  });

  const validLocation = { truckId: '11111111-1111-4111-8111-111111111111', lat: 31.9, lng: 35.9 };

  beforeEach(() => {
    emitted = [];
    tracking = {
      hasActiveHandover: jest.fn(),
      isDriverOfTruck: jest.fn(),
      saveLocation: jest.fn(async (dto: any, driverId: string) => ({ ...dto, driverId })),
      finalizeStop: jest.fn().mockResolvedValue({ id: 'log1' }),
      getLocation: jest.fn(),
      getActiveTrucks: jest.fn(),
    };
    gateway = new TruckTrackingGateway(tracking, {} as any, {} as any, {} as any);
    (gateway as any).server = mkServer();
  });

  it('rejects a location when the driver has NOT picked up the truck', async () => {
    tracking.hasActiveHandover.mockResolvedValue(false);

    const res: any = await gateway.onLocation(collectorSocket() as any, validLocation);

    expect(res.status).toBe('error');
    expect(res.message).toMatch(/pick up/i);
    expect(tracking.saveLocation).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);
  });

  it('accepts and broadcasts a location while the truck is picked up', async () => {
    tracking.hasActiveHandover.mockResolvedValue(true);

    const res: any = await gateway.onLocation(collectorSocket() as any, validLocation);

    expect(res.status).toBe('ok');
    expect(tracking.saveLocation).toHaveBeenCalled();
    // Broadcast to the truck's room and the admins channel.
    const events = emitted.map((e) => `${e.room}:${e.event}`);
    expect(events).toEqual(
      expect.arrayContaining([
        `truck:${validLocation.truckId}:truck:location`,
        'admins:truck:location',
      ]),
    );
  });

  it('rejects a malformed location payload outright', async () => {
    tracking.hasActiveHandover.mockResolvedValue(true);

    const res: any = await gateway.onLocation(collectorSocket() as any, { truckId: 'not-a-uuid' });

    expect(res.status).toBe('error');
    expect(tracking.saveLocation).not.toHaveBeenCalled();
  });

  it('announceSessionStarted tells the admins channel a truck went live', () => {
    gateway.announceSessionStarted({ truckId: 't1', driverId: 'd1', plateNumber: 'ABC-1' });

    expect(emitted).toEqual([
      {
        room: 'admins',
        event: 'truck:session',
        payload: { truckId: 't1', driverId: 'd1', plateNumber: 'ABC-1', status: 'started' },
      },
    ]);
  });

  it('endSession finalises the stop and notifies subscribers', async () => {
    await gateway.endSession('t1', StopReason.HANDOVER_DROPOFF);

    expect(tracking.finalizeStop).toHaveBeenCalledWith('t1', StopReason.HANDOVER_DROPOFF);
    const events = emitted.map((e) => `${e.room}:${e.event}`);
    expect(events).toEqual(
      expect.arrayContaining(['truck:t1:truck:stopped', 'admins:truck:stopped']),
    );
  });
});
