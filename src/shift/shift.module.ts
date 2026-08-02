import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '@src/permission/permissions.module';
import { Shift } from './entities/shift.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { ShiftService } from './shift.service';
import { ShiftController } from './shift.controller';

/**
 * Work shifts (Morning / Evening). Seeded; admins edit times only. Exported so
 * onboarding and truck modules can resolve/validate shift ids.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Shift, CollectorProfile]), PermissionsModule],
  controllers: [ShiftController],
  providers: [ShiftService],
  exports: [ShiftService, TypeOrmModule],
})
export class ShiftModule {}
