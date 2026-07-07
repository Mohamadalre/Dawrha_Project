import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { CoreModule } from '@src/core/core.module';
import { PermissionsModule } from '@src/permission/permissions.module';
import { NotificationModule } from '@src/notification/notification.module';
import { TruckEntity } from './entities/truck.entity';
import { TruckAssignmentEntity } from './entities/truck-assignment.entity';
import { TruckLocationLog } from './entities/truck-location-log.entity';
import { ShiftChangeRequest } from './entities/shift-change-request.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { Shift } from '@src/shift/entities/shift.entity';
import { TruckController } from './truck.controller';
import { DriverController } from './driver.controller';
import {
  AdminShiftRequestController,
  ShiftRequestController,
} from './shift-change-request.controller';
import { TruckService } from './truck.service';
import { AssignmentService } from './assignment.service';
import { ShiftChangeRequestService } from './shift-change-request.service';
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
      CollectorProfile,
      Shift,
    ]),
    CoreModule,
    JwtModule.register({}),
    PermissionsModule,
    NotificationModule,
  ],
  controllers: [
    TruckController,
    DriverController,
    ShiftRequestController,
    AdminShiftRequestController,
    TruckTrackingController,
  ],
  providers: [
    TruckService,
    AssignmentService,
    ShiftChangeRequestService,
    TruckTrackingService,
    TruckTrackingGateway,
  ],
})
export class TruckModule {}
