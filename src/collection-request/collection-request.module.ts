import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Product } from '@src/waste-management/entities/product.entity';
import { WasteCommonModule } from '@src/waste-management/common/waste-common.module';
import { NotificationModule } from '@src/notification/notification.module';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { Account } from '@src/user/entities/account.entity';
import { Shift } from '@src/shift/entities/shift.entity';
import { TruckEntity } from '@src/truck/entities/truck.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { OdooSyncModule } from '@src/odoo-sync/odoo-sync.module';
import { PointsWalletModule } from '@src/points-wallet/points-wallet.module';
import { TruckModule } from '@src/truck/truck.module';
import { PermissionsModule } from '@src/permission/permissions.module';
import { CollectionRequest } from './entities/collection-request.entity';
import { CollectionRequestLine } from './entities/collection-request-line.entity';
import { CollectionRequestAssignment } from './entities/collection-request-assignment.entity';
import { CollectionRoute } from './entities/collection-route.entity';
import { CollectionPlan } from './entities/collection-plan.entity';
import { CollectionPlanLine } from './entities/collection-plan-line.entity';
import { CoveragePoint } from './entities/coverage-point.entity';
import { DriverCoverageAssignment } from './entities/driver-coverage-assignment.entity';
import { DispatchConfig } from './entities/dispatch-config.entity';
import { CollectionStateService } from './providers/collection-state.service';
import { DispatchConfigProvider } from './providers/dispatch-config.provider';
import { CollectionRequestService } from './services/collection-request.service';
import { CollectionPlanService } from './services/collection-plan.service';
import { PlanRequestGenerator } from './crons/plan-request-generator.cron';
import { DispatchCandidatesService } from './services/dispatch-candidates.service';
import { DispatchEngineService } from './services/dispatch-engine.service';
import { DriverOfferService } from './services/driver-offer.service';
import { CoverageService } from './services/coverage.service';
import { DispatchProcessor } from './dispatch.processor';
import { OfferAcceptanceSweeper } from './crons/offer-acceptance-sweeper.cron';
import { CoverageRebalanceCron } from './crons/coverage-rebalance.cron';
import { DispatchGatewayEvents } from './gateways/dispatch.gateway';
import { RouteExecutionService } from './services/route-execution.service';
import { DriverExecutionController } from './controllers/driver-execution.controller';
import { ShiftSwapperCron } from './crons/shift-swapper.cron';
import { CoveragePointsService } from './services/coverage-points.service';
import { CollectionReportsService } from './services/collection-reports.service';
import { AdminCollectionService } from './services/admin-collection.service';
import { AdminCollectionController } from './controllers/admin-collection.controller';
import { CoveragePointsController } from './controllers/coverage-points.controller';
import { DispatchConfigController } from './controllers/dispatch-config.controller';
import { CollectionReportsController } from './controllers/collection-reports.controller';
import { CollectionRequestController } from './controllers/collection-request.controller';
import { CollectionPlanController } from './controllers/collection-plan.controller';
import { DriverOfferController } from './controllers/driver-offer.controller';
import { COLLECTION_DISPATCH_QUEUE } from './constants/dispatch.constants';

/**
 * The collection domain: citizen/institution recycling pickups, recurrence
 * plans, and the dispatch engine that elects drivers for every queued request.
 *
 * WasteCommonModule supplies the single price resolver and the unit catalogue;
 * NotificationModule the FCM pushes; the collection-dispatch queue runs the
 * elections durably (a restart never loses a pending election).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CollectionRequest,
      CollectionRequestLine,
      CollectionRequestAssignment,
      CollectionRoute,
      CollectionPlan,
      CollectionPlanLine,
      CoveragePoint,
      DriverCoverageAssignment,
      DispatchConfig,
      Product,
      // Dispatch engine inputs: drivers, their trucks/shifts and open handovers.
      CollectorProfile,
      Account,
      Shift,
      TruckEntity,
      TruckAssignmentEntity,
      TruckHandover,
      Warehouse,
    ]),
    WasteCommonModule,
    NotificationModule,
    OdooSyncModule,
    PointsWalletModule,
    TruckModule,
    PermissionsModule,
    BullModule.registerQueue({ name: COLLECTION_DISPATCH_QUEUE }),
  ],
  providers: [
    CollectionStateService,
    CollectionRequestService,
    CollectionPlanService,
    PlanRequestGenerator,
    DispatchConfigProvider,
    DispatchCandidatesService,
    DispatchEngineService,
    DispatchProcessor,
    OfferAcceptanceSweeper,
    DriverOfferService,
    CoverageService,
    CoverageRebalanceCron,
    RouteExecutionService,
    ShiftSwapperCron,
    CoveragePointsService,
    CollectionReportsService,
    AdminCollectionService,
    DispatchGatewayEvents,
  ],
  controllers: [
    CollectionRequestController,
    CollectionPlanController,
    DriverOfferController,
    DriverExecutionController,
    AdminCollectionController,
    CoveragePointsController,
    DispatchConfigController,
    CollectionReportsController,
  ],
  exports: [
    CollectionStateService,
    CollectionRequestService,
    DispatchEngineService,
    DispatchConfigProvider,
    CoverageService,
  ],
})
export class CollectionRequestModule {}
