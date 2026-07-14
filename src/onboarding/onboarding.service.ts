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
import { CommonService } from '@src/common/common.service';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { AccountStatusNotifier } from '@src/notification/account-status.notifier';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(AccountProgress)
    protected progressRepo: Repository<AccountProgress>,
    protected readonly resolver: ProfileResolver,
    @InjectRepository(Province)
    protected readonly provinceRepo: Repository<Province>,
    @InjectRepository(Account)
    protected readonly acccountRepo: Repository<Account>,
    @InjectRepository(WasteCategory)
    protected readonly wasteCategoryRepo: Repository<WasteCategory>,
    protected readonly commonService: CommonService,
    protected readonly cloudinaryService: CloudinaryService,
    protected readonly statusNotifier: AccountStatusNotifier,
    protected readonly odooSync: OdooSyncService,
  ) { }

  /**
   * Marks an account as submitted for review (PENDING_APPROVAL) and notifies the
   * user. Centralised so every onboarding flow behaves identically.
   */
  protected async markPendingApproval(accountId: string): Promise<void> {
    await this.acccountRepo.update(accountId, { accountStatus: AccountStatus.PENDING_APPROVAL });
    await this.statusNotifier.notifyPendingApproval(accountId);

    // Driver (collector) requests are reviewed by the ODOO admin, not here:
    // push the request so it appears in Odoo; the decision comes back through
    // the driver-decision webhook (approval + optional truck assignment).
    const account = await this.acccountRepo.findOne({ where: { id: accountId } });
    if (account?.role === Role.COLLECTOR) {
      await this.odooSync.enqueuePushDriverRequest({ accountId });
    }
  }

  /**
   * Uploads a logo file to Cloudinary and returns the URL
   * Used for profile logos that are stored directly in the profile entity
   *
   * @param file - Multer file object
   * @param ownerType - Type of owner (institutions, factories, external_partners)
   * @param ownerId - Profile ID
   * @returns Cloudinary URL for the uploaded logo
   */
  protected async uploadLogo(file: Express.Multer.File, ownerType: string, ownerId: string): Promise<string> {
    const folder = `logos/${ownerType}/${ownerId}`;
    return await this.cloudinaryService.uploadLogo(file, folder);
  }

  /**
   * Gets a paginated list of provinces
   *
   * @param page - Page number (default 1)
   * @param limit - Number of items per page (default 10)
   * @returns List of provinces with Arabic and English names
   */
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

  /**
   * Adds location information to the user's profile
   *
   * @param dto - Location data (coordinates, address, description, province ID)
   * @param role - User's role (e.g., INSTITUTIONS, FACTORY, etc.)
   * @param profile - User's profile entity
   * @param userId - User ID
   * @returns Operation status and next step in onboarding
   */
  async addLocation(dto: any, role: Role, profile: any, userId: string) {
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
      await this.markPendingApproval(account.id);
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', id: profile.id, step: getnextStep }
  }

  /**
   * Gets the next step in the onboarding process
   *
   * @param account - User account
   * @param stepInp - Input step
   * @returns Next step
   */
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

      stepInp === steps[0] ? newprog.completedSteps.push(stepInp) : newprog.completedSteps = [];
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

  /**
   * Validates waste category IDs and returns the entities
   *
   * @param ids - Array of waste category IDs
   * @returns Array of WasteCategory entities
   */
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