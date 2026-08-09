import { Controller, UseGuards, Post, Get, Patch, Body, Req,UseInterceptors, UploadedFile } from '@nestjs/common';
import { UpdateLocationDto } from '../dto/update-location.dto';
 import { UpdateMaterialsOrderDto } from '../dto/update-materials.dto';
import { UpdateInformationExternalPartnerDto } from '../dto/update-information.dto';
import { OnboardingSubmissionService } from '../services/onboarding-submission.service';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { AccountStatusGuard } from '@src/auth/guards/account-status.guard';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { InformationExternalPartnerDto, WasteExternalPartnerDto } from '../dto/external-partner-onboarding.dto';
import { ProfileOwnerGuard } from '../gurads/profile-owner.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';
import { ExternalPartnerOnboardingService } from '../services/external-partner-onboarding.service';

/**
 * Controller for handling external partner onboarding processes
 * Manages external partner information and materials
 */
@AccountsStatus(AccountStatus.PENDING_PROFILE)
@UseGuards(JwtAuthGuard, AccountStatusGuard, RolesGuard)
@Controller({
  path: 'onboarding/external-partner',
  version: '1'
})
export class ExternalPartnerOnboardingController {
  constructor(
    private readonly externalPartnerOnboardingService: ExternalPartnerOnboardingService,
    private readonly submissionService: OnboardingSubmissionService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // Submitted application: review + corrections (class-level
  // @AccountsStatus(PENDING_PROFILE) is overridden per handler).
  // This role has NO documents step (see ONBOARDING_STEPS), so there is no
  // document-replacement endpoint here.
  // ─────────────────────────────────────────────────────────────────────

  /** The application as submitted, in step order (info → location → materials). */
  @Get('submission')
  @Roles(Role.EXTERNAL_PARTNER)
  @AccountsStatus(
    AccountStatus.PENDING_APPROVAL,
    AccountStatus.REJECTED,
    AccountStatus.NEED_CHANGES,
  )
  async getSubmissionExternalPartner(@Req() req) {
    const result = await this.submissionService.getSubmission(req.user.id, Role.EXTERNAL_PARTNER);
    return { message: 'Application fetched successfully', result };
  }

  /** Correct the submitted information while the application is pending approval. */
  @Patch('information')
  @Roles(Role.EXTERNAL_PARTNER)
  @AccountsStatus(AccountStatus.PENDING_PROFILE, AccountStatus.PENDING_APPROVAL)
  async updateInformationExternalPartner(
    @Body() dto: UpdateInformationExternalPartnerDto,
    @Req() req,
  ) {
    const result = await this.submissionService.updateExternalPartnerInformation(
      req.user.id, dto);
    return { message: 'Information updated successfully', result };
  }


  /** Correct the submitted materials while the application is pending approval. */
  @Patch('materials')
  @Roles(Role.EXTERNAL_PARTNER)
  @AccountsStatus(AccountStatus.PENDING_PROFILE, AccountStatus.PENDING_APPROVAL)
  async updateMaterialsExternalPartner(@Body() dto: UpdateMaterialsOrderDto, @Req() req) {
    const result = await this.submissionService.updateMaterials(
      req.user.id, Role.EXTERNAL_PARTNER, dto);
    return { message: 'Materials updated successfully', result };
  }
  /** Correct the registered location while the application is pending approval. */
  @Patch('location')
  @Roles(Role.EXTERNAL_PARTNER)
  @AccountsStatus(AccountStatus.PENDING_PROFILE, AccountStatus.PENDING_APPROVAL)
  async updateLocationExternalPartner(@Body() dto: UpdateLocationDto, @Req() req) {
    const result = await this.submissionService.updateLocation(
      req.user.id, Role.EXTERNAL_PARTNER, dto);
    return { message: 'Location updated successfully', result };
  }

  /**
   * Adds external partner information during onboarding
   * Handles external partner profile creation with optional logo upload
   *
   * @param file - Optional logo file for the external partner
   * @param dto - External partner information data
   * @param req - Request object containing user information
   * @returns Success message with onboarding status
   */
  @Post('information')
  @Roles(Role.EXTERNAL_PARTNER)
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async addInformationExternalPartner(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: InformationExternalPartnerDto,
    @Req() req,
  ) {
    const data = await this.externalPartnerOnboardingService.addExternalPartnerInformation(dto, req.user.id, file);
    return {
      message: 'External partner information added successfully',
      // Named for what it is. It used to be `status: data`, which the envelope
      // surfaced as `data.status` — a key every client reads as an HTTP status.
      result: { accountDetails: data },
    };
  }

  /**
   * Adds external partner materials during onboarding
   * Handles waste category selection and delivery preferences
   *
   * @param dto - Waste external partner data
   * @param req - Request object containing user and profile information
   * @returns Success message with onboarding status
   */
  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.EXTERNAL_PARTNER)
  @Post('materials')
  public async addMaterialExternalPartner(@Body() dto: WasteExternalPartnerDto, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const data = await this.externalPartnerOnboardingService.addExternalPartnerMaterials(dto, profile, account.id);
    return {
      message: 'External partner materials added successfully',
      result: { materialDetails: data },
    };
  }
}
