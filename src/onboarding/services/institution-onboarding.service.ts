import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { OnboardingService } from '../onboarding.service';
import { Account } from '@src/user/entities/account.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { InformationInstitutionDto, WasteInstitutionDto } from '../dto/institutions-onboarding.dto';
import { InstitutionProfile } from '@src/user/entities/profile/institution-profile.entity';
import { InstitutionMaterial } from '@src/user/entities/material/institution-material.entity';
import { InstitutionType } from '@src/institution/entities/institution-type.entity';
import { InstitutionWasteCategory } from '@src/waste-management/entities/institution-waste-category.entity';
import { AccountProgress } from '../entities/account-progress.entity';
import { Province } from '@src/user/entities/location/province.entity';
import { ProfileResolver } from '@src/user/providers/profile-resolver.privder';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { CommonService } from '@src/common/common.service';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { AccountStatusNotifier } from '@src/notification/account-status.notifier';

@Injectable()
export class InstitutionOnboardingService extends OnboardingService {
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
    @InjectRepository(InstitutionProfile)
    private readonly institutionRepo: Repository<InstitutionProfile>,
    @InjectRepository(InstitutionMaterial)
    private readonly institutionMaterialRepo: Repository<InstitutionMaterial>,
    @InjectRepository(InstitutionType)
    private readonly institutionTypeRepo: Repository<InstitutionType>
  ) {
    super(progressRepo, resolver, provinceRepo, acccountRepo, wasteCategoryRepo, commonService, cloudinaryService, statusNotifier);
  }

  /**
   * Adds institution information during onboarding
   *
   * @param dto - Institution information data
   * @param userId - User ID
   * @param file - Optional logo file
   * @returns Onboarding status and next step
   */
  async addInstitutionInformation(dto: InformationInstitutionDto, userId: string, file?: Express.Multer.File) {
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
      await this.markPendingApproval(account.id);
      return { status: 'Your request has been sent,wait for it to be approved', id: profile.id }
    }
    return { status: 'Please enter the information in the following stage', id: profile.id, step: getnextStep }
  }

  /**
   * Adds institution materials during onboarding
   *
   * @param dto - Waste institution data
   * @param profile - Institution profile
   * @param userId - User ID
   * @returns Onboarding status and next step
   */
  async addInstitutionMaterials(dto: WasteInstitutionDto, profile: any, userId: string) {
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
      collectionFrequney: dto.collectionFrequney
    });

    // Save material inputs
    const savedMaterialInputs = await this.institutionMaterialRepo.save(materialInputs);

    // Attach to profile
    profile.materialInputs = savedMaterialInputs;
    await this.resolver.getRepo('INSTITUTIONS').save(profile)

    await this.commonService.completeStep(account, 'materials')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.markPendingApproval(account.id);
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', id: profile.id, step: getnextStep }
  }
}