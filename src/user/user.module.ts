import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { CollectorProfile } from './entities/profile/collector-profile.entity';
import { FactoryProfile } from './entities/profile/factory-profile.entity';
import { CitizenProfile } from './entities/profile/citizen-profile.entity';
import { Province } from './entities/location/province.entity';

import { InstitutionProfile } from './entities/profile/institution-profile.entity';
import { ExternalPartnerProfile } from './entities/profile/external-partner-profile.entity';
import { UserService } from './user.service';
import { Location } from './entities/location/location.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      CollectorProfile,
      FactoryProfile,
      CitizenProfile,
      Province,
      Location,
      InstitutionProfile,
      ExternalPartnerProfile,
    ]),
  ],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule { }
