import { Injectable } from '@nestjs/common';
import { DispatchEngineService } from './dispatch-engine.service';
import { CollectionRequestService } from './collection-request.service';
import { CollectionReportsService } from './collection-reports.service';
import { AdminListRequestsQueryDto } from '../dto/admin-collection.dto';

/**
 * The admin's collection-request surface: the full ledger with filters, the
 * manual assign override (engine) and the admin cancel (same flow as the
 * producer's, minus the ownership check).
 */
@Injectable()
export class AdminCollectionService {
  constructor(
    private readonly requestsService: CollectionRequestService,
    private readonly engine: DispatchEngineService,
    private readonly reports: CollectionReportsService,
  ) {}

  listRequests(query: AdminListRequestsQueryDto) {
    return this.reports.requests({
      ...query,
      driverId: query.driver_id,
    });
  }

  assign(requestId: string, driverId: string) {
    return this.engine.assignManually(requestId, driverId);
  }

  cancel(adminId: string, requestId: string, reason?: string) {
    return this.requestsService.adminCancel(adminId, requestId, reason);
  }
}