import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AccountProgress } from './entities/account-progress.entity';
import { Account } from '@src/user/entities/account.entity';
import { ONBOARDING_STEPS } from './config/onboarding.config';
import { InjectRepository } from '@nestjs/typeorm';
import { LocationDto } from './dto/location.dto';
import { Province } from '@src/user/entities/location/province.entity';
import { ProfileResolver } from '@src/user/providers/profile-resolver.privder';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { AuthService } from '@src/auth/auth.service';
import { InformationInstitutionDTo, WasteInstitutionDTo } from './dto/institutions-onboarding.dto';
import { CommonService } from '@src/common/common.service';
import { InformationCollectorDTo } from './dto/collector-onboarding.dto';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { InstitutionProfile } from '@src/user/entities/profile/institution-profile.entity';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { InstitutionType } from '@src/institution/entities/institution-type.entity';
import { InformationFactorynDTo, WasteFactoryDTo } from './dto/factory-onboarding.dto';
import { FactoryProfile } from '@src/user/entities/profile/factory-profile.entity';
import { InformationExternalPartnerDTo, WasteExternalPartnerDTo } from './dto/external-partner-onboarding.dto';
import { ExternalPartnerProfile } from '@src/user/entities/profile/external-partner-profile.entity';


@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(AccountProgress)
    private progressRepo: Repository<AccountProgress>,
    private readonly resolver: ProfileResolver,
    @InjectRepository(Province)
    private readonly provinceRepo: Repository<Province>,
    @InjectRepository(Account)
    private readonly acccountRepo: Repository<Account>,
    @InjectRepository(InstitutionProfile)
    private readonly institutionRepo: Repository<InstitutionProfile>,
    @InjectRepository(CollectorProfile)
    private readonly collectorRepo: Repository<CollectorProfile>,
    @InjectRepository(WasteCategory)
    private readonly wasteCategoryRepo: Repository<WasteCategory>,
    @InjectRepository(InstitutionType)
    private readonly institutionTypeRepo: Repository<InstitutionType>,
    @InjectRepository(FactoryProfile)
    private readonly factoryRepo: Repository<FactoryProfile>,
    @InjectRepository(ExternalPartnerProfile)
    private readonly externalPartnerRepo: Repository<ExternalPartnerProfile>,
    private readonly commonService: CommonService
  ) { }

  // async getCurrentStep(account: Account) {
  //   const steps = ONBOARDING_STEPS[account.role] || [];


  //   if (!steps.length) return null;

  //   const progress = await this.progressRepo.findOne({
  //     where: { accountId: account.id },
  //   });


  //   if (!progress) {
  //     return steps[0] || null;
  //   }

  //   const nextStep = steps.find(
  //     (step) => !progress.completedSteps.includes(step),
  //   );

  //   return nextStep || null;
  // }

  async addLocation(dto: LocationDto, profile: any, role: Role, account: any) {
    const step = await this.commonService.getCurrentStep(account!)
    if (step !== 'location') {
      throw new ForbiddenException('You cannot add location data,you must add data from the previous');
    }
    const [lng, lat] = dto.coordinates;
    const province = await this.provinceRepo.findOne({ where: { id: dto.provinceId } })
    if (!province) {
      throw new BadRequestException('province invalid')
    }

    profile.coordinates = { type: 'Point', coordinates: [lng, lat] };
    profile.address = dto.address;
    profile.DesscriptLocation = dto.descriptionAddress;
    profile.province = province;
    await this.resolver.getRepo(role).save(profile);
    await this.completeStep(account, 'location')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', }
  }

async completeStep(account: Account, stepInp: string) {
  const steps = ONBOARDING_STEPS[account.role] || [];

  let progress = await this.progressRepo.findOne({
    where: { accountId: account.id },
  });

  if (!progress) {
    let newprog = this.progressRepo.create({
      account: account,
      accountId: account.id,
      completedSteps: []
    });

    if (stepInp === steps[0]) {
      newprog.completedSteps.push(stepInp);
    }

    await this.progressRepo.save(newprog);
    return steps[0];
  }

  progress.completedSteps = progress.completedSteps || [];

  const nextStep = steps.find(
    (step) => !progress.completedSteps.includes(step),
  );

  if (nextStep === stepInp) {
    progress.completedSteps.push(stepInp);
  }

  await this.progressRepo.save(progress);

  return nextStep;
}


  async getStep(account: Account, stepInp: string) {
    const steps = ONBOARDING_STEPS[account.role] || [];

    let progress = await this.progressRepo.findOne({
      where: { accountId: account.id },
    });


    if (!progress) {
      let newprog = this.progressRepo.create({
        account: account,
        accountId: account.id
      })

      stepInp === steps[0] ? newprog.completedSteps.push[stepInp] : newprog.completedSteps = [];
      await this.progressRepo.save(newprog);
      return steps[0];
    }

    const nextStep = steps.find(
      (step) => !progress.completedSteps.includes(step),
    );
    nextStep === stepInp ? progress.completedSteps.push(stepInp) : nextStep
    await this.progressRepo.save(progress)

    return nextStep;
  }
  /// api Institution
  async addInformationInstitutionSer(dto: InformationInstitutionDTo, userId: string, file?: Express.Multer.File) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account!)
    if (step !== 'information') {
      throw new ForbiddenException('You cannot add information data,you must add data from the previous');
    }
    const exist = await this.institutionRepo.findOne({ where: { account: account! } })
    if (exist) {
      throw new ForbiddenException('You cannot add the information again,please move to the next stage');
    }
    const isntitutionType = await this.institutionTypeRepo.findOne({ where: { id: dto.institutionTypeId } })
    if (!isntitutionType) throw new BadRequestException('Institution type is invalid');

    const information = this.institutionRepo.create({
      institutionName: dto.institutionName,
      institutionPhone: dto.landlinePhone,
      institutionType: isntitutionType,
      institutionSlogo: `image/uploads/logos/${file?.filename}` || ``,
      taxNumber: dto.taxNumber,
      licenseNumber: dto.licenseNumber,
      account: account!
    })
    await this.institutionRepo.save(information);
    await this.completeStep(account!, 'information')
    const getnextStep = await this.commonService.getCurrentStep(account!)
    if (getnextStep === null) {
      await this.acccountRepo.update(account!.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', }
  }

  async addMaterialInstitutionSer(dto: WasteInstitutionDTo, profile: any, account: any) {
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'materials') {
      throw new ForbiddenException('You cannot add materials data,you must add data from the previous');
    }
    const wasteType = await this.checkWasteType(dto.wasteCategoryId);
    profile.wasteTypes = wasteType;
    profile.preferredCollectionTime = dto.preferredCollectionTime;
    profile.estimatedWasteQuantity = dto.estimatedWasteQuantity;
    profile.collectionFrequney = dto.collectionFrequney;
    await this.resolver.getRepo('INSITUTIONS').save(profile)
    await this.completeStep(account, 'materials')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account!.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', }
  }

  ///api collector
  async addInformationCollectorSer(dto: InformationCollectorDTo, userId: string) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account!)
    if (step !== 'information') {
      throw new ForbiddenException('You cannot add information data,you must add data from the previous');
    }
    const exist = await this.collectorRepo.findOne({ where: { account: account! } })
    if (exist) {
      throw new ForbiddenException('You cannot add the information again,please move to the next stage')
    }
    const information = this.collectorRepo.create({
      shift: dto.shift,
      NationalID: dto.NationalID,
      account: account!

    })
    await this.collectorRepo.save(information);
    await this.completeStep(account!, 'information')
    const getnextStep = await this.commonService.getCurrentStep(account!)
    if (getnextStep === null) {
      await this.acccountRepo.update({id:account!.id}, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', }
  }

  //api factory

  async addInformationFactorySer(dto: InformationFactorynDTo, userId: string, file?: Express.Multer.File) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account!)
    if (step !== 'information') {
      throw new ForbiddenException('You cannot add information data,you must add data from the previous');
    }
    const exist = await this.factoryRepo.findOne({ where: { account: account! } })
    if (exist) {
      throw new ForbiddenException('You cannot add the information again,please move to the next stage');
    }


    const information = this.factoryRepo.create({
      factoryName: dto.factoryName,
      factoryPhone: dto.landlinePhone,
      factorySlogo: `image/uploads/logos/${file?.filename}` || ``,
      taxNumber: dto.taxNumber,
      commercialRecord: dto.commercialRecord,
      industrialRecord: dto.industrialRecord,
      account: account!
    })
    await this.factoryRepo.save(information);
    await this.completeStep(account!, 'information')
    const getnextStep = await this.commonService.getCurrentStep(account!)
    if (getnextStep === null) {
      await this.acccountRepo.update(account!.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', }
  }


  async addMaterialFactorySer(dto: WasteFactoryDTo, profile: any, account: any) {
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'materials') {
      throw new ForbiddenException('You cannot add materials data,you must add data from the previous');
    }
    const wasteType = await this.checkWasteType(dto.wasteCategoryId);
  
    profile.wasteTypes = wasteType;
    profile.averageOrderQuantity = dto.averageOrderQuantity;
    profile.estimationOrderSchedule = dto.estimationOrderSchedule;
    profile.deliveryPreference = dto.deliveryPreference;
    profile.perferredDeliverySchedule = dto.perferredDeliverySchedule
    await this.resolver.getRepo('FACTORY').save(profile)
    await this.completeStep(account, 'materials')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account!.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', }
  }


  //api external_partner

  async addInformationExternalPartnerSer(dto: InformationExternalPartnerDTo, userId: string, file?: Express.Multer.File) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account!)
    if (step !== 'information') {
      throw new ForbiddenException('You cannot add information data,you must add data from the previous');
    }
    const exist = await this.factoryRepo.findOne({ where: { account: account! } })
    if (exist) {
      throw new ForbiddenException('You cannot add the information again,please move to the next stage');
    }


    const information = this.externalPartnerRepo.create({
      externalPartnerName: dto.externalPartnerName,
      externalPartnerPhone: dto.landlinePhone,
      externalPartnerSlogo: `image/uploads/logos/${file?.filename}` || '',
      account: account!
    })
    await this.externalPartnerRepo.save(information);
    await this.completeStep(account!, 'information')
    const getnextStep = await this.commonService.getCurrentStep(account!)
    if (getnextStep === null) {
      await this.acccountRepo.update(account!.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', }
  }


  async addMaterialExternalPartnerSer(dto: WasteExternalPartnerDTo, profile: any, account: any) {
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'materials') {
      throw new ForbiddenException('You cannot add materials data,you must add data from the previous');
    }
    const wasteType = await this.checkWasteType(dto.wasteCategoryId);
  
    profile.wasteTypes = wasteType;
    profile.averageOrderQuantity = dto.averageOrderQuantity;
    profile.estimationOrderSchedule = dto.estimationOrderSchedule;
    profile.deliveryPreference = dto.deliveryPreference;
    profile.perferredDeliverySchedule = dto.perferredDeliverySchedule
    await this.resolver.getRepo('EXTERNAL_PARTNER').save(profile)
    await this.completeStep(account, 'materials')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account!.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', }
  }

  private async checkWasteType(wasteCategoryId: string[]) {
    let id: string;
    let wasteType: WasteCategory[] = [];
    for (id in wasteCategoryId) {
      const exist = await this.wasteCategoryRepo.findOne({ where: { id: id } })
      if (!exist) throw new BadRequestException('waste Category is invalid')
      wasteType.push(exist);
    }

    return wasteType;
  }
}
