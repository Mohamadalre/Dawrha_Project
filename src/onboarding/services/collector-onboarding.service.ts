import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { OnboardingService } from '../onboarding.service';

import { AccountStatus } from '@src/user/enums/account-status.enum';
import { InformationCollectorDto } from '../dto/collector-onboarding.dto';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { AccountProgress } from '../entities/account-progress.entity';
import { Province } from '@src/user/entities/location/province.entity';
import { ProfileResolver } from '@src/user/providers/profile-resolver.privder';
import { Account } from '@src/user/entities/account.entity';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { CommonService } from '@src/common/common.service';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { AccountStatusNotifier } from '@src/notification/account-status.notifier';

@Injectable()
export class CollectorOnboardingService extends OnboardingService {
  constructor(
    @InjectRepository(AccountProgress)
    progressRepo: Repository<AccountProgress>,
    resolver: ProfileResolver,
    @InjectRepository(Province)
    provinceRepo: Repository<Province>,
    @InjectRepository(Account)
    acccountRepo: Repository<Account>,
    @InjectRepository(WasteCategory)
    wasteCategoryRepo: Repository<WasteCategory>,
    commonService: CommonService,
    cloudinaryService: CloudinaryService,
    statusNotifier: AccountStatusNotifier,
    @InjectRepository(CollectorProfile)
    private readonly collectorRepo: Repository<CollectorProfile>
  ) {
    super(progressRepo, resolver, provinceRepo, acccountRepo, wasteCategoryRepo, commonService, cloudinaryService, statusNotifier);
  }

  /**
   * Adds collector information during onboarding
   *
   * @param dto - Collector information data
   * @param userId - User ID
   * @returns Onboarding status and next step
   */
  async addCollectorInformation(dto: InformationCollectorDto, userId: string) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'information') {
      throw new ForbiddenException('You cannot add information data,you must add data from the previous');
    }
    const nationId = await this.collectorRepo.findOne({ where: { NationalID: dto.NationalID } });
    if (nationId) {
      throw new BadRequestException('This National Id is already used by another collector')
    }
    const exist = await this.collectorRepo.findOne({ where: { account: account } })
    if (exist) {
      throw new ForbiddenException('You cannot add the information again,please move to the next stage')
    }
    const information = this.collectorRepo.create({
      shift: dto.shift,
      NationalID: dto.NationalID,
      account: account
    })
    const profile = await this.collectorRepo.save(information);
    await this.commonService.completeStep(account, 'information')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.markPendingApproval(account.id);
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', id: profile.id, step: getnextStep }
  }
}