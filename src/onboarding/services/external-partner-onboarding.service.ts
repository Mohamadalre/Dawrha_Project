import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { OnboardingService } from '../onboarding.service';
import { InformationExternalPartnerDto, WasteExternalPartnerDto } from '../dto/external-partner-onboarding.dto';
import { ExternalPartnerProfile } from '@src/user/entities/profile/external-partner-profile.entity';
import { ExternalPartnerMaterial } from '@src/user/entities/material/external-partner-material.entity';
import { ExternalPartnerWasteCategory } from '@src/waste-management/entities/external-partner-waste-category.entity';
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
export class ExternalPartnerOnboardingService extends OnboardingService {
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
    @InjectRepository(ExternalPartnerProfile)
    private readonly externalPartnerRepo: Repository<ExternalPartnerProfile>,
    @InjectRepository(ExternalPartnerMaterial)
    private readonly externalPartnerMaterialRepo: Repository<ExternalPartnerMaterial>
  ) {
    super(progressRepo, resolver, provinceRepo, acccountRepo, wasteCategoryRepo, commonService, cloudinaryService, statusNotifier, odooSync);
  }

  /**
   * Adds external partner information during onboarding
   *
   * @param dto - External partner information data
   * @param userId - User ID
   * @param file - Optional logo file
   * @returns Onboarding status and next step
   */
  async addExternalPartnerInformation(dto: InformationExternalPartnerDto, userId: string, file?: Express.Multer.File) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.commonService.getCurrentStep(account)
    if (step !== 'information') {
      throw new ForbiddenException('You cannot add information data,you must add data from the previous');
    }
    const exist = await this.externalPartnerRepo.findOne({ where: { account: account } })
    if (exist) {
      throw new ForbiddenException('You cannot add the information again,please move to the next stage');
    }

    // Checked before the insert, so a collision is a message the applicant can
    // act on rather than a unique-violation surfacing as a 500.
    const phoneExists = await this.externalPartnerRepo.findOne({ where: { externalPartnerPhone: dto.phoneNumber } });
    if (phoneExists) {
      throw new BadRequestException('Phone number already exists');
    }

    const information = this.externalPartnerRepo.create({
      externalPartnerName: dto.externalPartnerName,
      // The mobile IS the facility's number now — the landline it replaced
      // reached the premises, not a person.
      externalPartnerPhone: dto.phoneNumber,
      externalPartnerSlogo: '', // temporary
      account: account
    })
    const profile = await this.externalPartnerRepo.save(information);

    // The facility's number stays on the profile only
    // (`externalPartnerPhone`) and is deliberately NOT copied onto
    // `accounts.phone`: an account that signed up without a personal number
    // keeps an empty account phone until its owner sets one from the profile
    // edit.

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
      await this.markPendingApproval(account.id);
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', id: profile.id, step: getnextStep }
  }

  /**
   * Adds external partner materials during onboarding
   *
   * @param dto - Waste external partner data
   * @param profile - External partner profile
   * @param userId - User ID
   * @returns Onboarding status and next step
   */
  async addExternalPartnerMaterials(dto: WasteExternalPartnerDto, profile: any, userId: string) {
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
      // A free facility gives only its categories and this positive quantity.
      averageOrderQuantity: String(dto.averageOrderQuantity),
    });

    const savedExternalPartnerMaterial = await this.externalPartnerMaterialRepo.save(externalPartnerMaterial);
    profile.externalPartnerMaterial = savedExternalPartnerMaterial;
    await this.resolver.getRepo('EXTERNAL_PARTNER').save(profile);
    await this.commonService.completeStep(account, 'materials')
    const getnextStep = await this.commonService.getCurrentStep(account)
    if (getnextStep === null) {
      await this.markPendingApproval(account.id);
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', id: profile.id, step: getnextStep }
  }
}