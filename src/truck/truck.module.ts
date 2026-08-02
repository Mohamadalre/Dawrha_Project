import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { CoreModule } from '@src/core/core.module';
import { PermissionsModule } from '@src/permission/permissions.module';
import { NotificationModule } from '@src/notification/notification.module';
import { OdooSyncModule } from '@src/odoo-sync/odoo-sync.module';
import { TruckEntity } from './entities/truck.entity';
import { TruckAssignmentEntity } from './entities/truck-assignment.entity';
import { TruckLocationLog } from './entities/truck-location-log.entity';
import { ShiftChangeRequest } from './entities/shift-change-request.entity';
import { TruckProblem } from './entities/truck-problem.entity';
import { TruckHandover } from './entities/truck-handover.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { Shift } from '@src/shift/entities/shift.entity';
import { TruckController } from './truck.controller';
import { DriverController } from './driver.controller';
import { ShiftChangeRequestController } from './shift-change-request.controller';
import { TruckProblemController } from './truck-problem.controller';
import { TruckService } from './truck.service';
import { AssignmentService } from './assignment.service';
import { ShiftChangeRequestService } from './shift-change-request.service';
import { TruckProblemService } from './truck-problem.service';
import { HandoverService } from './handover.service';
import { TruckTrackingService } from './tracking/truck-tracking.service';
import { TruckTrackingGateway } from './tracking/truck-tracking.gateway';
import { TruckTrackingController } from './tracking/truck-tracking.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TruckEntity,
      TruckAssignmentEntity,
      TruckLocationLog,
      ShiftChangeRequest,
      TruckProblem,
      TruckHandover,
      CollectorProfile,
      Shift,
    ]),
    CoreModule,
    JwtModule.register({}),
    PermissionsModule,
    NotificationModule,
    OdooSyncModule,
  ],
  // Driver-facing only: shift-change requests v2 (the WAREHOUSE MANAGER
  // decides in Odoo — submit / list mine / cancel-while-pending) and
  // truck-problem reports (read-only for the manager in Odoo).
  controllers: [
    TruckController,
    DriverController,
    ShiftChangeRequestController,
    TruckProblemController,
    TruckTrackingController,
  ],
  providers: [
    TruckService,
    AssignmentService,
    ShiftChangeRequestService,
    TruckProblemService,
    HandoverService,
    TruckTrackingService,
    TruckTrackingGateway,
  ],
})
export class TruckModule {}
