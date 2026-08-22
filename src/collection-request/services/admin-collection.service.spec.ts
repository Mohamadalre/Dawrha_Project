import { Test } from '@nestjs/testing';
import { DispatchEngineService } from './dispatch-engine.service';
import { CollectionRequestService } from './collection-request.service';
import { CollectionReportsService } from './collection-reports.service';
import { AdminCollectionService } from './admin-collection.service';

describe('AdminCollectionService', () => {
  const mocks = () => {
    const requestsService = {
      adminCancel: jest.fn().mockResolvedValue({ id: 'req-1', status: 'CANCELLED' }),
    };
    const engine = { assignManually: jest.fn().mockResolvedValue(undefined) };
    const reports = { requests: jest.fn().mockResolvedValue({ requests: [] }) };
    return { requestsService, engine, reports };
  };

  async function makeService(m = mocks()): Promise<AdminCollectionService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminCollectionService,
        { provide: CollectionRequestService, useValue: m.requestsService },
        { provide: DispatchEngineService, useValue: m.engine },
        { provide: CollectionReportsService, useValue: m.reports },
      ],
    }).compile();
    return moduleRef.get(AdminCollectionService);
  }

  afterEach(() => jest.clearAllMocks());

  it('lists requests through the reports ledger', async () => {
    const m = mocks();
    const service = await makeService(m);
    const query = { page: 1, limit: 20 } as any;

    await service.listRequests(query);

    expect(m.reports.requests).toHaveBeenCalledWith(query);
  });

  it('delegates manual assignment to the engine', async () => {
    const m = mocks();
    const service = await makeService(m);

    await service.assign('req-1', 'dA');

    expect(m.engine.assignManually).toHaveBeenCalledWith('req-1', 'dA');
  });

  it('delegates admin cancellation with the admin identity', async () => {
    const m = mocks();
    const service = await makeService(m);

    const result = await service.cancel('admin-1', 'req-1', 'duplicate');

    expect(m.requestsService.adminCancel).toHaveBeenCalledWith(
      'admin-1',
      'req-1',
      'duplicate',
    );
    expect(result).toEqual({ id: 'req-1', status: 'CANCELLED' });
  });
});
