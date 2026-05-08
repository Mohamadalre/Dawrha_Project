/* eslint-disable @typescript-eslint/no-unused-expressions */
import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { AccountProgress } from './entities/account-progress.entity';
import { Account } from '@src/user/entities/account.entity';
import { ONBOARDING_STEPS } from './config/onboarding.config';
import { InjectRepository } from '@nestjs/typeorm';
import { Province } from '@src/user/entities/location/province.entity';
import { ProfileResolver } from '@src/user/providers/profile-resolver.privder';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
// import { AuthService } from '@src/auth/auth.service';
import { InformationInstitutionDTo, WasteInstitutionDTo } from './dto/institutions-onboarding.dto';
import { CommonService } from '@src/common/common.service';
import { InformationCollectorDTo } from './dto/collector-onboarding.dto';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { InstitutionProfile } from '@src/user/entities/profile/institution-profile.entity';
import { InstitutionMaterial } from '@src/user/entities/material/institution-material.entity';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { InstitutionType } from '@src/institution/entities/institution-type.entity';
import { InformationFactorynDTo, WasteFactoryDTo } from './dto/factory-onboarding.dto';
import { FactoryProfile } from '@src/user/entities/profile/factory-profile.entity';
import { FactoryMaterial } from '@src/user/entities/material/factory-material.entity';
import { InformationExternalPartnerDTo, WasteExternalPartnerDTo } from './dto/external-partner-onboarding.dto';
import { ExternalPartnerProfile } from '@src/user/entities/profile/external-partner-profile.entity';
import { ExternalPartnerMaterial } from '@src/user/entities/material/external-partner-material.entity';
import { ExternalPartnerWasteCategory } from '@src/waste-management/entities/external-partner-waste-category.entity';
import { FactoryWasteCategory } from '@src/waste-management/entities/factory-waste-category.entity';
import { InstitutionWasteCategory } from '@src/waste-management/entities/institution-waste-category.entity';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';


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
    @InjectRepository(InstitutionMaterial)
    private readonly institutionMaterialRepo: Repository<InstitutionMaterial>,
    @InjectRepository(CollectorProfile)
    private readonly collectorRepo: Repository<CollectorProfile>,
    @InjectRepository(FactoryMaterial)
    private readonly factoryMaterialRepo: Repository<FactoryMaterial>,
    @InjectRepository(WasteCategory)
    private readonly wasteCategoryRepo: Repository<WasteCategory>,
    @InjectRepository(InstitutionType)
    private readonly institutionTypeRepo: Repository<InstitutionType>,
    @InjectRepository(FactoryProfile)
    private readonly factoryRepo: Repository<FactoryProfile>,
    @InjectRepository(ExternalPartnerProfile)
    private readonly externalPartnerRepo: Repository<ExternalPartnerProfile>,
    @InjectRepository(ExternalPartnerMaterial)
    private readonly externalPartnerMaterialRepo: Repository<ExternalPartnerMaterial>,
    private readonly commonService: CommonService,
    private readonly cloudinaryService: CloudinaryService
  ) { }

  /**
   * Uploads a logo file to Cloudinary and returns the URL
   * Used for profile logos that are stored directly in the profile entity
   *
   * @param file - Multer file object
   * @param ownerType - Type of owner (institutions, factories, external_partners)
   * @param ownerId - Profile ID
   * @returns Cloudinary URL for the uploaded logo
   */
  private async uploadLogo(file: Express.Multer.File, ownerType: string, ownerId: string): Promise<string> {
    const folder = `logos/${ownerType}/${ownerId}`;
    return await this.cloudinaryService.uploadLogo(file, folder);
  }

  async findAll(page = 1, limit = 10) {
    return await this.provinceRepo.find({
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name_ar: true,
        name_en: true
      }
    });
  }

  async addLocation(dto:any, role: Role, profile: any, userId: string) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'location') {
      throw new ForbiddenException('You cannot add location data,you must add data from the previous');
    }

    const [lng, lat] = dto?.coordinates || [0, 0];
    const province = await this.provinceRepo.findOne({ where: { id: dto.provinceId } })
    if (!province) {
      throw new BadRequestException('province invalid')
    }
    profile.coordinates = { type: 'Point', coordinates: [lng, lat] };
    profile.address = dto.address;
    profile.DesscriptLocation = dto.descriptionAddress;
    profile.province = province;
    await this.resolver.getRepo(role).save(profile);
    await this.commonService.completeStep(account, 'location')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', id:profile.id,step:getnextStep }
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
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'information') {
      throw new ForbiddenException('You cannot add information data,you must add data from the previous');
    }
  
    const exist = await this.institutionRepo.findOne({ where: { account: account } })
    if (exist) {
      throw new ForbiddenException('You cannot add the information again,please move to the next stage');
    }

    // Check for unique fields
    const phoneExists = await this.institutionRepo.findOne({ where: { institutionPhone: dto.landlinePhone } });
    if (phoneExists) {
      throw new BadRequestException('Institution phone number already exists');
    }

    const licenseExists = await this.institutionRepo.findOne({ where: { licenseNumber: dto.licenseNumber } });
    if (licenseExists) {
      throw new BadRequestException('License number already exists');
    }

    if (dto.taxNumber) {
      const taxExists = await this.institutionRepo.findOne({ where: { taxNumber: dto.taxNumber } });
      if (taxExists) {
        throw new BadRequestException('Tax number already exists');
      }
    }

    if (!dto.institutionTypeId && !dto.otherInstitutionType) {
      throw new BadRequestException(
        'Either institutionTypeId or otherInstitutionType is required',
      );
    }

    let information = this.institutionRepo.create({
      institutionName: dto.institutionName,
      institutionPhone: dto.landlinePhone,
      institutionSlogo: '', 
      taxNumber: dto.taxNumber,
      licenseNumber: dto.licenseNumber,
      account: account
    })

    if (dto.institutionTypeId) {
      const isntitutionType = await this.institutionTypeRepo.findOne({ where: { id: dto.institutionTypeId } })
      if (!isntitutionType) throw new BadRequestException('Institution type is invalid');
      information.institutionType = isntitutionType
    }

    if (dto.otherInstitutionType) {
    
      information.otherInstitutionType = dto.otherInstitutionType;
    }
    const profile = await this.institutionRepo.save(information);

    // Upload logo if file provided
    if (file) {
      try {
        const logoUrl = await this.uploadLogo(file, 'institutions', profile.id);
        profile.institutionSlogo = logoUrl;
        await this.institutionRepo.save(profile);
      } catch (error) {
        // If upload fails, delete the profile and rethrow
        await this.institutionRepo.delete(profile.id);
        throw error;
      }
    }

    await this.commonService.completeStep(account, 'information')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved', id: profile.id }
    }
    return { status: 'Please enter the information in the following stage',id:profile.id,step:getnextStep }
  }

  async addMaterialInstitutionSer(dto: WasteInstitutionDTo, profile: any, userId: string) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'materials') {
      throw new ForbiddenException('You cannot add materials data,you must add data from the previous');
    }
    const wasteTypesEntities = await this.checkWasteType(dto.wasteCategoryId);

    const wasteTypes = wasteTypesEntities.map((wt) => {
      const pivot = new InstitutionWasteCategory();
      pivot.wasteType = wt;

      return pivot;
    });

    // Create InstitutionMaterial entity
    const materialInputs = this.institutionMaterialRepo.create({
      institutionProfile: profile,
      wasteTypes: wasteTypes,
      preferredCollectionTime: dto.preferredCollectionTime,
      estimatedWasteQuantity: dto.estimatedWasteQuantity,
      collectionFrequney:dto.collectionFrequney
    });

    // Save material inputs
    const savedMaterialInputs = await this.institutionMaterialRepo.save(materialInputs);

    // Attach to profile
    profile.materialInputs = savedMaterialInputs;
    await this.resolver.getRepo('INSITUTIONS').save(profile)

    await this.commonService.completeStep(account, 'materials')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage',id:profile.id,step:getnextStep }
  }

  ///api collector
  async addInformationCollectorSer(dto: InformationCollectorDTo, userId: string) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'information') {
      throw new ForbiddenException('You cannot add information data,you must add data from the previous');
    }
    const nationId = await this.collectorRepo.findOne({where:{NationalID:dto.NationalID}});
    if(nationId){
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
      await this.acccountRepo.update({ id: account.id }, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', id: profile.id,step:getnextStep }
  }

  //api factory

  async addInformationFactorySer(dto: InformationFactorynDTo, userId: string, file?: Express.Multer.File) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'information') {
      throw new ForbiddenException('You cannot add information data,you must add data from the previous');
    }
    const exist = await this.factoryRepo.findOne({ where: { account: account } })
    if (exist) {
      throw new ForbiddenException('You cannot add the information again,please move to the next stage');
    }

    // Check for unique fields
    const phoneExists = await this.factoryRepo.findOne({ where: { factoryPhone: dto.landlinePhone } });
    if (phoneExists) {
      throw new BadRequestException('Factory phone number already exists');
    }

    const commercialRecordExists = await this.factoryRepo.findOne({ where: { commercialRecord: dto.commercialRecord } });
    if (commercialRecordExists) {
      throw new BadRequestException('Commercial record already exists');
    }

    const industrialRecordExists = await this.factoryRepo.findOne({ where: { industrialRecord: dto.industrialRecord } });
    if (industrialRecordExists) {
      throw new BadRequestException('Industrial record already exists');
    }

    if (dto.taxNumber) {
      const taxExists = await this.factoryRepo.findOne({ where: { taxNumber: dto.taxNumber } });
      if (taxExists) {
        throw new BadRequestException('Tax number already exists');
      }
    }


    const information = this.factoryRepo.create({
      factoryName: dto.factoryName,
      factoryPhone: dto.landlinePhone,
      factorySlogo: '', // temporary
      taxNumber: dto.taxNumber,
      commercialRecord: dto.commercialRecord,
      industrialRecord: dto.industrialRecord,
      account: account
    })
    const profile = await this.factoryRepo.save(information);

    // Upload logo if file provided
    if (file) {
      try {
        const logoUrl = await this.uploadLogo(file, 'factories', profile.id);
        profile.factorySlogo = logoUrl;
        await this.factoryRepo.save(profile);
      } catch (error) {
        // If upload fails, delete the profile and rethrow
        await this.factoryRepo.delete(profile.id);
        throw error;
      }
    }

    await this.commonService.completeStep(account, 'information')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', id:profile.id,step:getnextStep}
  }


  async addMaterialFactorySer(dto: WasteFactoryDTo, profile: any, userId: string) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'materials') {
      throw new ForbiddenException('You cannot add materials data,you must add data from the previous');
    }
    const wasteTypesEntities = await this.checkWasteType(dto.wasteCategoryId);
    const wasteTypes = wasteTypesEntities.map((wt) => {
      const pivot = new FactoryWasteCategory();
      pivot.wasteType = wt;
      return pivot;
    });

    const factoryMaterial = this.factoryMaterialRepo.create({
      factoryProfile: profile,
      wasteTypes: wasteTypes,
      averageOrderQuantity: dto.averageOrderQuantity,
      estimationOrderSchedule: dto.estimationOrderSchedule,
      deliveryPreference: dto.deliveryPreference,
      perferredDeliverySchedule: dto.perferredDeliverySchedule,
    });

    const savedFactoryMaterial = await this.factoryMaterialRepo.save(factoryMaterial);
    profile.factoryMaterial = savedFactoryMaterial;
    await this.resolver.getRepo('FACTORY').save(profile);
    await this.commonService.completeStep(account, 'materials')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage',id:profile.id,step:getnextStep }
  }


  //api external_partner

  async addInformationExternalPartnerSer(dto: InformationExternalPartnerDTo, userId: string, file?: Express.Multer.File) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'information') {
      throw new ForbiddenException('You cannot add information data,you must add data from the previous');
    }
    const exist = await this.externalPartnerRepo.findOne({ where: { account: account } })
    if (exist) {
      throw new ForbiddenException('You cannot add the information again,please move to the next stage');
    }

        const phoneExists = await this.externalPartnerRepo.findOne({ where: { externalPartnerPhone: dto.landlinePhone } });
    if (phoneExists) {
      throw new BadRequestException('Institution phone number already exists');
    }


    const information = this.externalPartnerRepo.create({
      externalPartnerName: dto.externalPartnerName,
      externalPartnerPhone: dto.landlinePhone,
      externalPartnerSlogo: '', // temporary
      account: account
    })
    const profile = await this.externalPartnerRepo.save(information);

    // Upload logo if file provided
    if (file) {
      try {
        const logoUrl = await this.uploadLogo(file, 'external_partners', profile.id);
        information.externalPartnerSlogo = logoUrl;
        await this.externalPartnerRepo.save(information);
      } catch (error) {
        // If upload fails, delete the profile and rethrow
        await this.externalPartnerRepo.delete(profile.id);
        throw error;
      }
    }

    await this.commonService.completeStep(account, 'information')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage',id:profile.id,step:getnextStep }
  }


  async addMaterialExternalPartnerSer(dto: WasteExternalPartnerDTo, profile: any, userId: string) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'materials') {
      throw new ForbiddenException('You cannot add materials data,you must add data from the previous');
    }

    const wasteTypesEntities = await this.checkWasteType(dto.wasteCategoryId);


    const wasteTypes = wasteTypesEntities.map((wt) => {
      const pivot = new ExternalPartnerWasteCategory();
      pivot.wasteType = wt;
      return pivot;
    });

    const externalPartnerMaterial = this.externalPartnerMaterialRepo.create({
      externalPartnerProfile: profile,
      wasteTypes: wasteTypes,
      averageOrderQuantity: dto.averageOrderQuantity,
      estimationOrderSchedule: dto.estimationOrderSchedule,
      deliveryPreference: dto.deliveryPreference,
      perferredDeliverySchedule: dto.perferredDeliverySchedule,
    });

    const savedExternalPartnerMaterial = await this.externalPartnerMaterialRepo.save(externalPartnerMaterial);
    profile.externalPartnerMaterial = savedExternalPartnerMaterial;
    await this.resolver.getRepo('EXTERNAL_PARTNER').save(profile);
    await this.commonService.completeStep(account, 'materials')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', id:profile.id,step:getnextStep}
  }



  async checkWasteType(ids: string[]) {
    const uniqueIds = [...new Set(ids)];

    const wasteTypes = await this.wasteCategoryRepo.find({
      where: {
        id: In(uniqueIds),
      },
    });

    if (wasteTypes.length !== uniqueIds.length) {
      throw new BadRequestException('Some waste categories are invalid');
    }

    return wasteTypes;
  }


  
}
