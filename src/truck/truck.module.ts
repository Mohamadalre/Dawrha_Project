import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { CoreModule } from '@src/core/core.module';
import { TruckEntity } from './entities/truck.entity';
import { TruckAssignmentEntity } from './entities/truck-assignment.entity';
import { TruckLocationLog } from './entities/truck-location-log.entity';
import { TruckController } from './truck.controller';
import { TruckService } from './truck.service';
import { TruckTrackingService } from './tracking/truck-tracking.service';
import { TruckTrackingGateway } from './tracking/truck-tracking.gateway';
import { TruckTrackingController } from './tracking/truck-tracking.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TruckEntity, TruckAssignmentEntity, TruckLocationLog]),
    CoreModule,
    JwtModule.register({}),
  ],
  controllers: [TruckController, TruckTrackingController],
  providers: [TruckService, TruckTrackingService, TruckTrackingGateway],
})
export class TruckModule {}
