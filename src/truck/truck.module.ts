import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '@src/core/core.module';
import { TruckEntity } from './entities/truck.entity';
import { TruckAssignmentEntity } from './entities/truck-assignment.entity';
import { TruckController } from './truck.controller';
import { TruckService } from './truck.service';

@Module({
  imports: [TypeOrmModule.forFeature([TruckEntity, TruckAssignmentEntity]), CoreModule],
  controllers: [TruckController],
  providers: [TruckService],
})
export class TruckModule {}
