import { Module } from '@nestjs/common';
import { InstitutionService } from './institution.service';
import { InstitutionController } from './institution.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstitutionType } from './entities/institution-type.entity';
import { InstitutionProfile } from '@src/user/entities/profile/institution-profile.entity';

@Module({
  // InstitutionProfile is needed so deleting a type can refuse when any
  // institution still references it.
  imports: [TypeOrmModule.forFeature([InstitutionType, InstitutionProfile])],
  controllers: [InstitutionController],
  providers: [InstitutionService],
})
export class InstitutionModule {}
