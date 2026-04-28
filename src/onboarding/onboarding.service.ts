import { Injectable,BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AccountProgress } from './entities/account-progress.entity';
import { Account } from '@src/user/entities/account.entity';
import { ONBOARDING_STEPS } from './config/onboarding.config';
import { InjectRepository } from '@nestjs/typeorm';
import { Location } from '@src/user/entities/location/location.entity';
import { LocationDto } from './dto/location.dto';
import { Province } from '@src/user/entities/location/province.entity';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(AccountProgress)
    private progressRepo: Repository<AccountProgress>,
    // @InjectRepository(Location)
    // private readonly locationRepo: Repository<Location>,
    // @InjectRepository(Province)
    // private readonly provinceRepo: Repository<Province>
  ) { }

  async getCurrentStep(account: Account, profileId: string) {
    const steps = ONBOARDING_STEPS[account.role] || [];


    if (!steps.length) return null;

    const progress = await this.progressRepo.findOne({
      where: { accountId: account.id },
    });


    if (!progress) {
      return steps[0] || null;
    }

    const nextStep = steps.find(
      (step) => !progress.completedSteps.includes(step),
    );

    return nextStep || null;
  }

  // async create(dto: LocationDto,profileId:string) {
  //   const [lng, lat] = dto.coordinates;
  //   const province = await this.provinceRepo.findOne({where:{id:dto.provinceId}})
  //   if(!province){
  //     throw new BadRequestException('province invaild')
  //   }
  //   let location = this.locationRepo.create({
  //     coordinates:{
  //       type:'Point',
  //       coordinates:[lng,lat]
  //     },
  //     address:dto.address,
  //     DesscriptLocation:dto.descriptionAddress,
  //     province:province
  //   });

  
  //     location =await this.locationRepo.save(location);


  //    return
  // }

  //   async addInformaInstitut()
}
