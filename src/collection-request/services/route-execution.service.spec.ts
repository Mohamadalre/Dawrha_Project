import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { PointsWalletService } from '@src/points-wallet/points-wallet.service';
import { NotificationService } from '@src/notification/notification.service';
import { Role } from '@src/user/enums/role.enum';
import { CollectionStateService } from '../providers/collection-state.service';
import { DispatchConfigProvider } from '../providers/dispatch-config.provider';
import { DispatchEngineService } from './dispatch-engine.service';
import { DispatchGatewayEvents } from '../gateways/dispatch.gateway';
import { RouteExecutionService } from './route-execution.service';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectionRequestLine } from '../entities/collection-request-line.entity';
import { CollectionRoute } from '../entities/collection-route.entity';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import { CollectionRouteStatus } from '../enums/collection-route-status.enum';
import { CollectionRequestType } from '../enums/collection-request-type.enum';
import {
  CollectionActualWeightRequiredException,
  CollectionDriverProfileNotFoundException,
  CollectionStopNotOnTourException,
  CollectionWarehouseNotFoundException,
} from '../exceptions/collection-request.exceptions';

const CALLER = { id: 'acc-driver', role: Role.COLLECTOR };

function makeRoute(overrides: Partial<CollectionRoute> = {}): CollectionRoute {
  return {
    id: 'rt-1',
    routeNumber: 'RTE-2026-08-17-001',
    driverId: 'dA',
    status: CollectionRouteStatus.PLANNED,
    requests: [],
    ...overrides,
  } as CollectionRoute;
}

function makeStop(overrides: Partial<CollectionRequest> = {}): CollectionRequest {
  return {
    id: 'req-1',
    requestNumber: 'CR-2026-08-00001',
    status: CollectionRequestStatus.ASSIGNED,
    type: CollectionRequestType.IMMEDIATE,
    accountId: 'acc-producer',
    contactName: 'Ali',
    addressText: 'Midan Al Tahrir, Cairo',
    lat: '33.5',
    lng: '36.2',
    estimatedWeightKg: '10',
    estimatedGrandTotal: '250.00',
    actualWeightKg: null,
    actualGrandTotal: null,
    scheduledAt: null,
    routeId: 'rt-1',
    routeSequence: 1,
    ...overrides,
  } as CollectionRequest;
}

describe('RouteExecutionService', () => {
  const config = {
    routeMergeMaxMin: 15,
    routeMergeMaxKm: '2.00',
    institutionToleranceMin: 20,
  } as any;

  const mocks = () => {
    const requestRepo = {
      findOne: jest.fn(),
      save: jest.fn((r: CollectionRequest) => Promise.resolve(r)),
    };
    const routeRepo = {
      findOne: jest.fn(),
      save: jest.fn((r: CollectionRoute) => Promise.resolve(r)),
    };
    const lineRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    const profileRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'dA' } as CollectorProfile),
    };
    const handoverRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const warehouseRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'wh-1', odooWarehouseId: 5 } as Warehouse),
    };
    const productRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    const configProvider = { get: jest.fn().mockResolvedValue(config) };
    const engine = {} as DispatchEngineService;
    const odooSync = { enqueueRegisterIntake: jest.fn().mockResolvedValue(undefined) };
    const wallet = { awardForCollection: jest.fn().mockResolvedValue({ points: 1, balance: 1 }) };
    const notifications = { createNotification: jest.fn().mockResolvedValue({ id: 'n-1' }) };
    const events = { announceToRequest: jest.fn().mockResolvedValue(undefined) };
    const eventEmitter = { emit: jest.fn() };
    return {
      requestRepo,
      routeRepo,
      lineRepo,
      profileRepo,
      handoverRepo,
      warehouseRepo,
      productRepo,
      configProvider,
      engine,
      odooSync,
      wallet,
      notifications,
      events,
      eventEmitter,
    };
  };

  async function makeService(m = mocks()): Promise<RouteExecutionService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RouteExecutionService,
        CollectionStateService,
        { provide: getRepositoryToken(CollectionRequest), useValue: m.requestRepo },
        { provide: getRepositoryToken(CollectionRoute), useValue: m.routeRepo },
        { provide: getRepositoryToken(CollectionRequestLine), useValue: m.lineRepo },
        { provide: getRepositoryToken(CollectorProfile), useValue: m.profileRepo },
        { provide: getRepositoryToken(TruckHandover), useValue: m.handoverRepo },
        { provide: getRepositoryToken(Warehouse), useValue: m.warehouseRepo },
        { provide: getRepositoryToken(Product), useValue: m.productRepo },
        { provide: DispatchConfigProvider, useValue: m.configProvider },
        { provide: DispatchEngineService, useValue: m.engine },
        { provide: OdooSyncService, useValue: m.odooSync },
        { provide: PointsWalletService, useValue: m.wallet },
        { provide: NotificationService, useValue: m.notifications },
        { provide: DispatchGatewayEvents, useValue: m.events },
        { provide: EventEmitter2, useValue: m.eventEmitter },
      ],
    }).compile();

    return moduleRef.get(RouteExecutionService);
  }

  afterEach(() => jest.clearAllMocks());

  describe('myTour', () => {
    it('returns the ordered tour view with the next stop flagged', async () => {
      const m = mocks();
      const route = makeRoute({
        status: CollectionRouteStatus.IN_PROGRESS,
        requests: [
          makeStop({ id: 's2', requestNumber: 'CR-2', status: CollectionRequestStatus.DELIVERED, routeSequence: 2 }),
          makeStop({ id: 's1', requestNumber: 'CR-1', routeSequence: 1 }),
        ],
      });
      m.routeRepo.findOne.mockResolvedValue(route);

      const service = await makeService(m);
      const tour = await service.myTour(CALLER);

      expect(tour.route?.route_id).toBe('rt-1');
      expect(tour.stops.map((s) => s.request_id)).toEqual(['s1', 's2']);
      expect(tour.next_request_id).toBe('s1');
      expect(tour.stops[0].is_next).toBe(true);
    });

    it('returns an empty view when the driver has no active route', async () => {
      const m = mocks();
      m.routeRepo.findOne.mockResolvedValue(null);

      const service = await makeService(m);
      await expect(service.myTour(CALLER)).resolves.toEqual({
        route: null,
        stops: [],
        next_request_id: null,
      });
    });
  });

  describe('arrived', () => {
    it('starts the tour and records the arrival stamps', async () => {
      const m = mocks();
      const stop = makeStop();
      const route = makeRoute({ requests: [stop] });
      m.routeRepo.findOne.mockResolvedValue(route);

      const service = await makeService(m);
      await service.arrived(CALLER, 'req-1');

      expect(stop.status).toBe(CollectionRequestStatus.ARRIVED);
      expect(stop.enRouteAt).toBeInstanceOf(Date);
      expect(stop.arrivedAt).toBeInstanceOf(Date);
      expect(route.status).toBe(CollectionRouteStatus.IN_PROGRESS);
      expect(m.routeRepo.save).toHaveBeenCalledWith(route);
      expect(m.events.announceToRequest).toHaveBeenCalledWith(
        'req-1',
        'request:status',
        expect.objectContaining({ status: CollectionRequestStatus.ARRIVED }),
      );
    });

    it('is idempotent for a repeated arrival', async () => {
      const m = mocks();
      const stop = makeStop({ status: CollectionRequestStatus.ARRIVED });
      const route = makeRoute({
        status: CollectionRouteStatus.IN_PROGRESS,
        requests: [stop],
      });
      m.routeRepo.findOne.mockResolvedValue(route);

      const service = await makeService(m);
      await service.arrived(CALLER, 'req-1');

      expect(m.routeRepo.save).not.toHaveBeenCalled();
      expect(stop.status).toBe(CollectionRequestStatus.ARRIVED);
    });
  });

  describe('collected', () => {
    it('records the actuals proportionally and moves the stop to PICKING', async () => {
      const m = mocks();
      const stop = makeStop({ status: CollectionRequestStatus.ARRIVED });
      const route = makeRoute({
        status: CollectionRouteStatus.IN_PROGRESS,
        requests: [stop],
      });
      m.routeRepo.findOne.mockResolvedValue(route);

      const service = await makeService(m);
      await service.collected(CALLER, 'req-1', { actualWeightKg: 12 });

      expect(stop.actualWeightKg).toBe('12');
      expect(stop.actualGrandTotal).toBe(String(+(250 * 1.2).toFixed(2)));
      expect(stop.pickedAt).toBeInstanceOf(Date);
      expect(stop.status).toBe(CollectionRequestStatus.PICKING);
      expect(m.events.announceToRequest).toHaveBeenCalledWith(
        'req-1',
        'request:status',
        expect.objectContaining({ status: CollectionRequestStatus.PICKING }),
      );
    });

    it('rejects a non-positive actual weight', async () => {
      const m = mocks();
      const stop = makeStop({ status: CollectionRequestStatus.ARRIVED });
      m.routeRepo.findOne.mockResolvedValue(makeRoute({ requests: [stop] }));

      const service = await makeService(m);
      await expect(
        service.collected(CALLER, 'req-1', { actualWeightKg: 0 }),
      ).rejects.toBeInstanceOf(CollectionActualWeightRequiredException);
    });
  });

  describe('delivered', () => {
    it('closes the tour, ships the intake and rewards the producer', async () => {
      const m = mocks();
      const stop = makeStop({
        status: CollectionRequestStatus.PICKING,
        actualWeightKg: '12',
        actualGrandTotal: '300.00',
      });
      const route = makeRoute({
        status: CollectionRouteStatus.IN_PROGRESS,
        requests: [stop],
      });
      m.routeRepo.findOne.mockResolvedValue(route);
      m.lineRepo.find.mockResolvedValue([
        { id: 'l1', requestId: 'req-1', productId: 'p1', quantity: '4' },
      ] as CollectionRequestLine[]);
      m.productRepo.find.mockResolvedValue([
        { id: 'p1', odooProductId: 7 },
      ] as Product[]);
      m.requestRepo.findOne.mockResolvedValue({
        ...stop,
        actualGrandTotal: '300.00',
        account: { id: 'acc-producer', role: Role.CITIZEN },
      } as CollectionRequest);

      const service = await makeService(m);
      await service.delivered(CALLER, 'req-1', { warehouseId: 'wh-1' });

      expect(stop.deliveredAt).toBeInstanceOf(Date);
      expect(stop.status).toBe(CollectionRequestStatus.COMPLETED);
      expect(m.odooSync.enqueueRegisterIntake).toHaveBeenCalledWith({
        requestId: 'req-1',
        odooWarehouseId: 5,
        producerName: 'Ali',
        receivedAt: stop.deliveredAt.toISOString(),
        lines: [{ odooProductId: 7, quantity: 4.8 }],
      });

      expect(route.status).toBe(CollectionRouteStatus.COMPLETED);
      expect(m.wallet.awardForCollection).toHaveBeenCalledWith(
        'acc-producer',
        Role.CITIZEN,
        300,
        'CR-2026-08-00001',
      );
      expect(m.eventEmitter.emit).toHaveBeenCalledWith('collection.driver.freed', {
        driverId: 'dA',
      });
    });

    it('rejects an unknown delivery warehouse', async () => {
      const m = mocks();
      const stop = makeStop({ status: CollectionRequestStatus.PICKING });
      m.routeRepo.findOne.mockResolvedValue(makeRoute({ requests: [stop] }));
      m.warehouseRepo.findOne.mockResolvedValue(null);

      const service = await makeService(m);
      await expect(
        service.delivered(CALLER, 'req-1', { warehouseId: 'nope' }),
      ).rejects.toBeInstanceOf(CollectionWarehouseNotFoundException);
    });
  });

  describe('guards', () => {
    it('rejects a stop that is not on the driver tour', async () => {
      const m = mocks();
      const other = makeStop({ id: 'other' });
      m.routeRepo.findOne.mockResolvedValue(makeRoute({ requests: [other] }));

      const service = await makeService(m);
      await expect(service.arrived(CALLER, 'req-1')).rejects.toBeInstanceOf(
        CollectionStopNotOnTourException,
      );
    });

    it('rejects a driver without a collector profile', async () => {
      const m = mocks();
      m.profileRepo.findOne.mockResolvedValue(null);

      const service = await makeService(m);
      await expect(service.myTour(CALLER)).rejects.toBeInstanceOf(
        CollectionDriverProfileNotFoundException,
      );
    });
  });
});
