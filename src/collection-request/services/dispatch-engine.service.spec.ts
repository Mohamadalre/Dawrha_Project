import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationService } from '@src/notification/notification.service';
import { ShipmentService } from './shipment.service';
import { CollectionStateService } from '../providers/collection-state.service';
import { DispatchEngineService } from './dispatch-engine.service';
import { DispatchCandidatesService } from './dispatch-candidates.service';
import { DispatchConfigProvider } from '../providers/dispatch-config.provider';
import { DispatchGatewayEvents } from '../gateways/dispatch.gateway';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectionRequestAssignment } from '../entities/collection-request-assignment.entity';
import { CollectionRoute } from '../entities/collection-route.entity';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import { CollectionRequestAssignmentStatus } from '../enums/collection-request-assignment-status.enum';
import { CollectionRouteStatus } from '../enums/collection-route-status.enum';
import { CollectionRequestType } from '../enums/collection-request-type.enum';
import {
  COLLECTION_DISPATCH_QUEUE,
  DISPATCH_JOB,
  DISPATCH_REDIS,
} from '../constants/dispatch.constants';
import {
  CollectionRequestInvalidTransitionException,
  CollectionDriverNotEligibleException,
} from '../exceptions/collection-request.exceptions';

describe('DispatchEngineService', () => {
  const requestSaves: string[] = [];
  const assignmentSaves: string[] = [];

  const config = {
    isEnabled: true,
    acceptWindowSec: 300,
    scheduledLeadMin: 60,
    weights: {
      proximity: 30,
      direction: 25,
      load: 20,
      vehicle: 15,
      deadline: 7,
      fairness: 3,
    },
  } as any;

  function makeRequest(overrides: Partial<CollectionRequest> = {}): CollectionRequest {
    return {
      id: 'req-1',
      requestNumber: 'CR-202608-00001',
      status: CollectionRequestStatus.QUEUED,
      type: CollectionRequestType.IMMEDIATE,
      accountId: 'acc-producer',
      addressText: 'Midan Al Tahrir, Cairo',
      lat: '33.5',
      lng: '36.2',
      estimatedWeightKg: '10',
      estimatedGrandTotal: '250.00',
      scheduledAt: null,
      routeId: null,
      routeSequence: null,
      ...overrides,
    } as CollectionRequest;
  }

  function makeCandidate(overrides: Partial<any> = {}) {
    return {
      driverId: 'dA',
      accountId: 'accA',
      truckId: 'truckA',
      maxPayloadKg: 2000,
      shiftStart: '08:00',
      shiftEnd: '16:00',
      activeTasks: 0,
      activeWeightKg: 0,
      completedToday: 1,
      fallbackLocation: { lat: 33.49, lng: 36.2 },
      passesCapacity: true,
      ...overrides,
    };
  }

  const mocks = () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    requestSaves.length = 0;
    assignmentSaves.length = 0;
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      mget: jest.fn().mockResolvedValue([]),
      set: jest.fn().mockResolvedValue('OK'),
      multi: jest.fn(() => {
        const chain: Record<string, jest.Mock> = {};
        const add = (name: string) => {
          chain[name] = jest.fn().mockReturnValue(chainProxy);
        };
        const chainProxy: any = new Proxy(
          {},
          {
            get: (_t, prop: string) => {
              if (prop === 'exec') return chain.exec;
              if (!chain[prop]) add(prop);
              return chain[prop];
            },
          },
        );
        chain.exec = jest.fn().mockResolvedValue([]);
        return chainProxy;
      }),
    };
    const requestRepo = {
      findOne: jest.fn(),
      save: jest.fn((r: CollectionRequest) => {
        requestSaves.push({ ...r }.status);
        return Promise.resolve(r);
      }),
      maximum: jest.fn().mockResolvedValue(null),
    };
    const savedRequestStatuses: string[] = requestSaves;
    const assignmentRepo = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((a: Partial<CollectionRequestAssignment>) => a),
      save: jest.fn((a: CollectionRequestAssignment) => {
        assignmentSaves.push({ ...a }.status);
        return Promise.resolve({ ...a, id: a.id ?? 'as-1' });
      }),
      find: jest.fn().mockResolvedValue([]),
    };
    const savedAssignmentStatuses: string[] = assignmentSaves;
    const routeRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((r: Partial<CollectionRoute>) => ({ id: 'rt-1', ...r })),
      save: jest.fn((r: CollectionRoute) => Promise.resolve(r)),
    };
    const truckAssignmentRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const profileRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const eventEmitter = { emit: jest.fn() };
    const configProvider = { get: jest.fn().mockResolvedValue(config) };
    const candidates = { findEligible: jest.fn().mockResolvedValue([]) };
    const events = {
      announceToDriver: jest.fn().mockResolvedValue(undefined),
      announceToRequest: jest.fn().mockResolvedValue(undefined),
      announceToAdmins: jest.fn().mockResolvedValue(undefined),
    };
    const notifications = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n-1' }),
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };
    const shipmentService = {
      autoCreateOrAddToShipment: jest.fn().mockResolvedValue(undefined),
    };
    return {
      queue,
      redis,
      requestRepo,
      assignmentRepo,
      routeRepo,
      truckAssignmentRepo,
      profileRepo,
      eventEmitter,
      configProvider,
      candidates,
      events,
      notifications,
      shipmentService,
      savedRequestStatuses,
      savedAssignmentStatuses,
    };
  };

  async function makeEngine(m = mocks()): Promise<DispatchEngineService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DispatchEngineService,
        CollectionStateService,
        { provide: getQueueToken(COLLECTION_DISPATCH_QUEUE), useValue: { add: m.queue.add } },
        { provide: 'REDIS_CLIENT', useValue: m.redis },
        { provide: getRepositoryToken(CollectionRequest), useValue: m.requestRepo },
        { provide: getRepositoryToken(CollectionRequestAssignment), useValue: m.assignmentRepo },
        { provide: getRepositoryToken(CollectionRoute), useValue: m.routeRepo },
        { provide: getRepositoryToken(TruckAssignmentEntity), useValue: m.truckAssignmentRepo },
        { provide: getRepositoryToken(CollectorProfile), useValue: m.profileRepo },
        { provide: EventEmitter2, useValue: m.eventEmitter },
        { provide: DispatchConfigProvider, useValue: m.configProvider },
        { provide: DispatchCandidatesService, useValue: m.candidates },
        { provide: DispatchGatewayEvents, useValue: m.events },
        { provide: NotificationService, useValue: m.notifications },
        { provide: ShipmentService, useValue: m.shipmentService },
        // The merge from main added an EventEmitter2 dependency to the engine
        // (it emits 'collection.request.assigned'); the real app provides it via
        // EventEmitterModule — the test supplies a stub so DI can resolve.
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    return moduleRef.get(DispatchEngineService);
  }

  afterEach(() => jest.clearAllMocks());

  describe('elect', () => {
    it('offers the highest-scoring candidate using live truck fixes', async () => {
      const m = mocks();
      const request = makeRequest();
      m.requestRepo.findOne.mockResolvedValue(request);
      m.candidates.findEligible.mockResolvedValue([
        makeCandidate({ driverId: 'dNear', accountId: 'accNear', truckId: 'truckNear' }),
        makeCandidate({
          driverId: 'dFar',
          accountId: 'accFar',
          truckId: 'truckFar',
          fallbackLocation: { lat: 34.5, lng: 37.5 },
        }),
      ]);
      // The near driver moved in the last minute; the far one has no fix.
      m.redis.mget.mockResolvedValue([
        JSON.stringify({ lat: 33.501, lng: 36.201, heading: 0 }),
        null,
      ]);

      const engine = await makeEngine(m);
      await engine.elect(request.id);

      expect(m.assignmentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: request.id,
          driverId: 'dNear',
          status: CollectionRequestAssignmentStatus.OFFERED,
        }),
      );
      // The accept-window keys are set for the winner only.
      expect(m.redis.multi).toHaveBeenCalled();
    });

    it('does not elect a scheduled request before its window opens', async () => {
      const m = mocks();
      m.requestRepo.findOne.mockResolvedValue(
        makeRequest({
          type: CollectionRequestType.SCHEDULED,
          scheduledAt: new Date(Date.now() + 2 * 3600_000),
        }),
      );

      const engine = await makeEngine(m);
      await engine.elect('req-1');

      expect(m.candidates.findEligible).not.toHaveBeenCalled();
      expect(m.assignmentRepo.save).not.toHaveBeenCalled();
    });

    it('skips electing when an offer is already outstanding', async () => {
      const m = mocks();
      m.requestRepo.findOne.mockResolvedValue(makeRequest());
      m.assignmentRepo.count.mockResolvedValue(1);

      const engine = await makeEngine(m);
      await engine.elect('req-1');

      expect(m.candidates.findEligible).not.toHaveBeenCalled();
      expect(m.assignmentRepo.save).not.toHaveBeenCalled();
    });

    it('flags NEEDS_ADMIN when the pool is empty and broadcasts to admins', async () => {
      const m = mocks();
      const request = makeRequest();
      m.requestRepo.findOne.mockResolvedValue(request);
      m.candidates.findEligible.mockResolvedValue([]);

      const engine = await makeEngine(m);
      await engine.elect('req-1');

      expect(m.requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CollectionRequestStatus.NEEDS_ADMIN }),
      );
      expect(m.events.announceToAdmins).toHaveBeenCalledWith(
        'request:needs_admin',
        expect.objectContaining({ request_id: 'req-1' }),
      );
    });

    it('ignores requests that are not QUEUED', async () => {
      const m = mocks();
      m.requestRepo.findOne.mockResolvedValue(
        makeRequest({ status: CollectionRequestStatus.CREATED }),
      );

      const engine = await makeEngine(m);
      await engine.elect('req-1');

      expect(m.candidates.findEligible).not.toHaveBeenCalled();
    });
  });

  describe('mid-round merging', () => {
    /** A tour running with its single stop already weighed (PICKING). */
    function runningRoute() {
      const pickedStop = makeRequest({
        id: 'req-1',
        requestNumber: 'CR-202608-00001',
        status: CollectionRequestStatus.PICKING,
        lat: '33.51',
        lng: '36.21',
        routeSequence: 1,
      }) as any;
      pickedStop.routeId = 'rt-live';
      return {
        id: 'rt-live',
        routeNumber: 'RTE-20260824-001',
        driverId: 'dTour',
        status: CollectionRouteStatus.IN_PROGRESS,
        requests: [pickedStop],
      };
    }

    it('merges a nearby queued request into a running tour anchored at the live GPS fix', async () => {
      const m = mocks();
      const incoming = makeRequest({
        id: 'req-2',
        requestNumber: 'CR-202608-00002',
      });
      m.requestRepo.findOne.mockResolvedValue(incoming);
      const route = runningRoute();
      m.routeRepo.find.mockResolvedValue([route]);
      // The touring driver passes the eligibility + capacity gates even busy.
      m.candidates.findEligible.mockResolvedValue([
        makeCandidate({ driverId: 'dTour', accountId: 'accTour', truckId: 'truckTour' }),
      ]);
      // His truck reports a live position right next to the incoming pickup.
      m.truckAssignmentRepo.findOne.mockResolvedValue({
        driverId: 'dTour',
        truckId: 'truckTour',
      });
      m.redis.get.mockResolvedValue(
        JSON.stringify({ lat: 33.502, lng: 36.201, heading: 10 }),
      );

      const engine = await makeEngine(m);
      await engine.elect('req-2');

      // Bound directly into the running tour — no offer, no queue job.
      expect(m.assignmentRepo.save).not.toHaveBeenCalled();
      expect(m.queue.add).not.toHaveBeenCalled();
      expect(m.requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'req-2',
          routeId: 'rt-live',
          routeSequence: 1,
          status: CollectionRequestStatus.ASSIGNED,
        }),
      );
      // The weighed stop shifted to sequence 2.
      expect(m.requestRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'req-1', routeSequence: 2 }),
        ]),
      );
      // Same shipment: the merged request joins the driver's active shipment.
      expect(m.shipmentService.autoCreateOrAddToShipment).toHaveBeenCalledWith(
        'dTour',
        expect.objectContaining({ id: 'req-2' }),
      );
      expect(m.events.announceToDriver).toHaveBeenCalledWith(
        'accTour',
        'request:assigned',
        expect.objectContaining({ event: 'MERGED', request_id: 'req-2' }),
      );
    });

    it('falls through to scoring when there is neither a served stop nor a live fix', async () => {
      const m = mocks();
      const incoming = makeRequest({
        id: 'req-2',
        requestNumber: 'CR-202608-00002',
      });
      m.requestRepo.findOne.mockResolvedValue(incoming);
      m.routeRepo.find.mockResolvedValue([runningRoute()]);
      // No truck fix anywhere: the merge cannot be anchored honestly.
      m.redis.get.mockResolvedValue(null);
      m.truckAssignmentRepo.findOne.mockResolvedValue({
        driverId: 'dTour',
        truckId: 'truckTour',
      });
      m.candidates.findEligible.mockResolvedValue([
        makeCandidate({ driverId: 'dNear', accountId: 'accNear', truckId: 'truckNear' }),
      ]);
      m.redis.mget.mockResolvedValue([]);

      const engine = await makeEngine(m);
      await engine.elect('req-2');

      // The anchor was honestly attempted, then refused — the election fell
      // through to the normal scored pool (no allowBusy pass happened).
      expect(m.redis.get).toHaveBeenCalledWith('truck:location:truckTour');
      expect(
        m.candidates.findEligible.mock.calls.every((c) => c.length === 2),
      ).toBe(true);
      expect(m.shipmentService.autoCreateOrAddToShipment).not.toHaveBeenCalled();
      expect(m.assignmentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-2',
          driverId: 'dNear',
          status: CollectionRequestAssignmentStatus.OFFERED,
        }),
      );
    });
  });

  describe('settleOffer', () => {
    it('binds an accepted offer to the driver (creating a route) and notifies the producer', async () => {
      const m = mocks();
      const request = makeRequest();
      m.routeRepo.findOne.mockResolvedValue(null);
      m.requestRepo.maximum.mockResolvedValue(3);
      m.profileRepo.findOne.mockResolvedValue({
        id: 'dA',
        account: { id: 'accA' },
      });
      const assignment = {
        id: 'as-1',
        requestId: request.id,
        driverId: 'dA',
        status: CollectionRequestAssignmentStatus.OFFERED,
        request,
      } as CollectionRequestAssignment;

      const engine = await makeEngine(m);
      await engine.settleOffer(assignment, CollectionRequestAssignmentStatus.ACCEPTED);

      expect(m.routeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          driverId: 'dA',
          status: CollectionRouteStatus.PLANNED,
        }),
      );
      expect(m.requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: request.id,
          routeId: 'rt-1',
          routeSequence: 4,
          status: CollectionRequestStatus.ASSIGNED,
        }),
      );
      expect(m.events.announceToRequest).toHaveBeenCalledWith(
        request.id,
        'request:status',
        expect.objectContaining({ status: CollectionRequestStatus.ASSIGNED }),
      );
      // The driver himself learns about the task in real time.
      expect(m.events.announceToDriver).toHaveBeenCalledWith(
        'accA',
        'request:assigned',
        expect.objectContaining({
          event: 'ASSIGNED',
          request_id: request.id,
          route_id: 'rt-1',
        }),
      );
      expect(m.notifications.createNotification).toHaveBeenCalled();
      expect(m.notifications.enqueueNotification).toHaveBeenCalledWith('n-1');
      // Offer keys cleaned up.
      expect(m.redis.multi).toHaveBeenCalled();
    });

    it('re-elects the next candidate when an offer is rejected and the request is still queued', async () => {
      const m = mocks();
      const request = makeRequest();
      const assignment = {
        id: 'as-1',
        requestId: request.id,
        driverId: 'dA',
        status: CollectionRequestAssignmentStatus.OFFERED,
        request,
      } as CollectionRequestAssignment;

      const engine = await makeEngine(m);
      await engine.settleOffer(assignment, CollectionRequestAssignmentStatus.REJECTED);

      expect(m.assignmentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'as-1',
          status: CollectionRequestAssignmentStatus.REJECTED,
        }),
      );
      expect(m.queue.add).toHaveBeenCalledWith(
        DISPATCH_JOB.ELECT,
        { requestId: request.id },
        expect.anything(),
      );
    });

    it('does nothing when the offer was already settled', async () => {
      const m = mocks();
      const assignment = {
        id: 'as-1',
        requestId: 'req-1',
        driverId: 'dA',
        status: CollectionRequestAssignmentStatus.ACCEPTED,
      } as CollectionRequestAssignment;

      const engine = await makeEngine(m);
      await engine.settleOffer(assignment, CollectionRequestAssignmentStatus.REJECTED);

      expect(m.assignmentRepo.save).not.toHaveBeenCalled();
      expect(m.queue.add).not.toHaveBeenCalled();
    });
  });

  describe('assignManually', () => {
    it('binds a QUEUED request to the chosen eligible driver like an accepted offer', async () => {
      const m = mocks();
      const request = makeRequest();
      m.requestRepo.findOne.mockResolvedValue(request);
      m.candidates.findEligible.mockResolvedValue([
        makeCandidate({ driverId: 'dA', accountId: 'accA' }),
      ]);
      m.routeRepo.findOne.mockResolvedValue(null);
      m.requestRepo.maximum.mockResolvedValue(2);

      const engine = await makeEngine(m);
      await engine.assignManually(request.id, 'dA');

      // The OFFERED->ACCEPTED pair is still written to the ledger.
      expect(m.savedAssignmentStatuses).toEqual([
        CollectionRequestAssignmentStatus.OFFERED,
        CollectionRequestAssignmentStatus.ACCEPTED,
      ]);
      // ... and the request binds like any accepted offer.
      expect(m.requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: request.id,
          routeId: 'rt-1',
          routeSequence: 3,
          status: CollectionRequestStatus.ASSIGNED,
        }),
      );
      expect(m.events.announceToRequest).toHaveBeenCalledWith(
        request.id,
        'request:status',
        expect.objectContaining({ status: CollectionRequestStatus.ASSIGNED }),
      );
    });

    it('rejects a driver the candidate filters do not allow', async () => {
      const m = mocks();
      m.requestRepo.findOne.mockResolvedValue(makeRequest());
      m.candidates.findEligible.mockResolvedValue([]);

      const engine = await makeEngine(m);
      await expect(engine.assignManually('req-1', 'dA')).rejects.toBeInstanceOf(
        CollectionDriverNotEligibleException,
      );
      expect(m.assignmentRepo.save).not.toHaveBeenCalled();
    });

    it('refuses a request that is already past the queue', async () => {
      const m = mocks();
      m.requestRepo.findOne.mockResolvedValue(
        makeRequest({ status: CollectionRequestStatus.ASSIGNED }),
      );

      const engine = await makeEngine(m);
      await expect(engine.assignManually('req-1', 'dA')).rejects.toBeInstanceOf(
        CollectionRequestInvalidTransitionException,
      );
      expect(m.candidates.findEligible).not.toHaveBeenCalled();
    });

    it('requeues a NEEDS_ADMIN request before binding', async () => {
      const m = mocks();
      const request = makeRequest({ status: CollectionRequestStatus.NEEDS_ADMIN });
      m.requestRepo.findOne.mockResolvedValue(request);
      m.candidates.findEligible.mockResolvedValue([
        makeCandidate({ driverId: 'dA' }),
      ]);
      m.routeRepo.findOne.mockResolvedValue(null);

      const engine = await makeEngine(m);
      await engine.assignManually(request.id, 'dA');

      expect(m.savedRequestStatuses).toEqual([
        CollectionRequestStatus.QUEUED,
        CollectionRequestStatus.ASSIGNED,
      ]);
    });
  });

  describe('window opening', () => {
    it('opens a CREATED request into the queue and elects', async () => {
      const m = mocks();
      m.requestRepo.findOne.mockResolvedValue(
        makeRequest({ status: CollectionRequestStatus.CREATED }),
      );

      const engine = await makeEngine(m);
      await engine.openWindow('req-1');

      expect(m.requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CollectionRequestStatus.QUEUED }),
      );
      expect(m.queue.add).toHaveBeenCalledWith(
        DISPATCH_JOB.ELECT,
        { requestId: 'req-1' },
        expect.anything(),
      );
    });

    it('schedules a delayed OPEN_WINDOW job for a future pickup', async () => {
      const m = mocks();
      const engine = await makeEngine(m);
      const scheduled = makeRequest({
        type: CollectionRequestType.SCHEDULED,
        status: CollectionRequestStatus.CREATED,
        scheduledAt: new Date(Date.now() + 2 * 3600_000),
      });

      await engine.scheduleWindow(scheduled);

      const [name, payload, opts] = m.queue.add.mock.calls[0];
      expect(name).toBe(DISPATCH_JOB.OPEN_WINDOW);
      expect(payload).toEqual({ requestId: scheduled.id });
      expect(opts.jobId).toBe(`open-window:${scheduled.id}`);
      expect(opts.delay).toBeGreaterThan(0);
    });

    it('opens the window immediately when the pickup is already close', async () => {
      const m = mocks();
      const scheduled = makeRequest({
        type: CollectionRequestType.SCHEDULED,
        status: CollectionRequestStatus.CREATED,
        scheduledAt: new Date(Date.now() + 60_000),
      });
      m.requestRepo.findOne.mockResolvedValue(scheduled);

      const engine = await makeEngine(m);
      await engine.scheduleWindow(scheduled);

      expect(m.requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CollectionRequestStatus.QUEUED }),
      );
    });
  });

  describe('event triggers', () => {
    it('enqueues ELECT for immediate requests on collection.request.queued', async () => {
      const m = mocks();
      m.requestRepo.findOne.mockResolvedValue(makeRequest());

      const engine = await makeEngine(m);
      await engine.handleQueued({ requestId: 'req-1' });

      expect(m.queue.add).toHaveBeenCalledWith(
        DISPATCH_JOB.ELECT,
        { requestId: 'req-1' },
        expect.anything(),
      );
    });

    it('enqueues OPEN_WINDOW for scheduled requests on collection.request.queued', async () => {
      const m = mocks();
      // Scheduled requests stay CREATED until their window opens.
      m.requestRepo.findOne.mockResolvedValue(
        makeRequest({
          type: CollectionRequestType.SCHEDULED,
          status: CollectionRequestStatus.CREATED,
          scheduledAt: new Date(Date.now() + 2 * 3600_000),
        }),
      );

      const engine = await makeEngine(m);
      await engine.handleQueued({ requestId: 'req-1' });

      expect(m.queue.add).toHaveBeenCalledWith(
        DISPATCH_JOB.OPEN_WINDOW,
        { requestId: 'req-1' },
        expect.anything(),
      );
    });

    it('throttles the location trigger: one election per driver per minute', async () => {
      const m = mocks();
      m.requestRepo.findOne.mockResolvedValue(null);
      m.redis.set
        .mockResolvedValueOnce('OK')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('OK');
      m.queue.add.mockResolvedValue(undefined);

      const engine = await makeEngine(m);
      const payload = {
        truckId: 'truckA',
        driverId: 'dA',
        lat: 33.5,
        lng: 36.2,
        heading: 90,
      };

      await engine.handleLocationUpdated(payload);
      await engine.handleLocationUpdated(payload);
      await engine.handleLocationUpdated(payload);

      expect(m.redis.set).toHaveBeenCalledWith(
        DISPATCH_REDIS.locationThrottleKey('dA'),
        '1',
        'EX',
        60,
        'NX',
      );
      const electionJobs = m.queue.add.mock.calls.filter(
        ([name]) => name === DISPATCH_JOB.ELECT_NEXT_FOR_DRIVER,
      );
      expect(electionJobs).toHaveLength(2);
    });
  });
});