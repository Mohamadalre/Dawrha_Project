import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { OnboardingService } from '../onboarding.service';
import { InformationFactoryDto, WasteFactoryDto } from '../dto/factory-onboarding.dto';
import { FactoryProfile } from '@src/user/entities/profile/factory-profile.entity';
import { FactoryMaterial } from '@src/user/entities/material/factory-material.entity';
import { FactoryWasteCategory } from '@src/waste-management/entities/factory-waste-category.entity';
import { AccountProgress } from '../entities/account-progress.entity';
import { Province } from '@src/user/entities/location/province.entity';
import { ProfileResolver } from '@src/user/providers/profile-resolver.privder';
import { Account } from '@src/user/entities/account.entity';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { CommonService } from '@src/common/common.service';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { AccountStatusNotifier } from '@src/notification/account-status.notifier';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';

@Injectable()
export class FactoryOnboardingService extends OnboardingService {
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
    odooSync: OdooSyncService,
    @InjectRepository(FactoryProfile)
    private readonly factoryRepo: Repository<FactoryProfile>,
    @InjectRepository(FactoryMaterial)
    private readonly factoryMaterialRepo: Repository<FactoryMaterial>
  ) {
    super(progressRepo, resolver, provinceRepo, acccountRepo, wasteCategoryRepo, commonService, cloudinaryService, statusNotifier, odooSync);
  }

  /**
   * Adds factory information during onboarding
   *
   * @param dto - Factory information data
   * @param userId - User ID
   * @param file - Optional logo file
   * @returns Onboarding status and next step
   */
  async addFactoryInformation(dto: InformationFactoryDto, userId: string, file?: Express.Multer.File) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    if (!account) {
    throw new NotFoundException('Account not found');
}
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'information') {
      throw new ForbiddenException('You cannot add information data,you must add data from the previous');
    }
    const exist = await this.factoryRepo.findOne({ where: { account: account } })
    if (exist) {
      throw new ForbiddenException('You cannot add the information again,please move to the next stage');
    }

    // Check for unique fields
    const phoneExists = await this.factoryRepo.findOne({ where: { factoryPhone: dto.phoneNumber } });
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
      factoryPhone: dto.phoneNumber,
      factorySlogo: '', // temporary
      taxNumber: dto.taxNumber,
      commercialRecord: dto.commercialRecord,
      industrialRecord: dto.industrialRecord,
      account:account
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
      await this.markPendingApproval(account.id);
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', id: profile.id, step: getnextStep }
  }

  /**
   * Adds factory materials during onboarding
   *
   * @param dto - Waste factory data
   * @param profile - Factory profile
   * @param userId - User ID
   * @returns Onboarding status and next step
   */
  async addFactoryMaterials(dto: WasteFactoryDto, profile: any, userId: string) {
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
      await this.markPendingApproval(account.id);
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', id: profile.id, step: getnextStep }
  }
}