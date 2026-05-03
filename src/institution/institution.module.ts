import { Module } from '@nestjs/common';
import { InstitutionService } from './institution.service';
import { InstitutionController } from './institution.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstitutionType } from './entities/institution-type.entity';

@Module({
  imports:[TypeOrmModule.forFeature([InstitutionType])],
  controllers: [InstitutionController],
  providers: [InstitutionService],
})
export class InstitutionModule {}
