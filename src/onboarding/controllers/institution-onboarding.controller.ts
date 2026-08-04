import { Controller, UseGuards, Post, Get, Patch, Param, ParseUUIDPipe, Body, Req, UseInterceptors, BadRequestException, UploadedFile, ForbiddenException } from '@nestjs/common';
import { UpdateLocationDto } from '../dto/update-location.dto';
 import { UpdateMaterialsInstitutionDto } from '../dto/update-materials.dto';
import { UpdateInformationInstitutionDto } from '../dto/update-information.dto';
import { OnboardingSubmissionService } from '../services/onboarding-submission.service';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { MediaService } from '@src/media/media.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Account } from '@src/user/entities/account.entity';
import { InstitutionMediaDto } from '../dto/media.dto';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { AccountStatusGuard } from '@src/auth/guards/account-status.guard';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { InformationInstitutionDto, WasteInstitutionDto } from '../dto/institutions-onboarding.dto';
import { ProfileOwnerGuard } from '../gurads/profile-owner.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';
import { Repository } from 'typeorm';
import { CommonService } from '@src/common/common.service';
import { InstitutionOnboardingService } from '../services/institution-onboarding.service';

/**
 * Controller for handling institution onboarding processes
 * Manages institution information, materials, and document uploads
 */
@AccountsStatus(AccountStatus.PENDING_PROFILE)
@UseGuards(JwtAuthGuard, AccountStatusGuard, RolesGuard)
@Controller({
  path: 'onboarding/institution',
  version: '1'
})
export class InstitutionOnboardingController {
  constructor(
    private readonly institutionOnboardingService: InstitutionOnboardingService,
    private readonly commonService: CommonService,
    private readonly mediaService: MediaService,
    private readonly submissionService: OnboardingSubmissionService,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // Submitted application: review + corrections.
  // The class-level @AccountsStatus(PENDING_PROFILE) is overridden per
  // handler below — these endpoints only make sense AFTER submission.
  // ─────────────────────────────────────────────────────────────────────

  /** The application as submitted, in step order (info → location → docs → materials). */
  @Get('submission')
  @Roles(Role.INSTITUTIONS)
  @AccountsStatus(
    AccountStatus.PENDING_APPROVAL,
    AccountStatus.REJECTED,
    AccountStatus.NEED_CHANGES,
  )
  async getSubmissionInstitution(@Req() req) {
    const result = await this.submissionService.getSubmission(req.user.id, Role.INSTITUTIONS);
    return { message: 'Application fetched successfully', result };
  }

  /** Correct the submitted information while the application is pending approval. */
  @Patch('information')
  @Roles(Role.INSTITUTIONS)
  @AccountsStatus(AccountStatus.PENDING_APPROVAL)
  async updateInformationInstitution(
    @Body() dto: UpdateInformationInstitutionDto,
    @Req() req,
  ) {
    const result = await this.submissionService.updateInformation(
      req.user.id, Role.INSTITUTIONS, dto);
    return { message: 'Information updated successfully', result };
  }


  /** Correct the submitted materials while the application is pending approval. */
  @Patch('materials')
  @Roles(Role.INSTITUTIONS)
  @AccountsStatus(AccountStatus.PENDING_APPROVAL)
  async updateMaterialsInstitution(@Body() dto: UpdateMaterialsInstitutionDto, @Req() req) {
    const result = await this.submissionService.updateMaterials(
      req.user.id, Role.INSTITUTIONS, dto);
    return { message: 'Materials updated successfully', result };
  }
  /** Correct the registered location while the application is pending approval. */
  @Patch('location')
  @Roles(Role.INSTITUTIONS)
  @AccountsStatus(AccountStatus.PENDING_APPROVAL)
  async updateLocationInstitution(@Body() dto: UpdateLocationDto, @Req() req) {
    const result = await this.submissionService.updateLocation(
      req.user.id, Role.INSTITUTIONS, dto);
    return { message: 'Location updated successfully', result };
  }

  /** Replace a still-pending document while the application is pending approval. */
  @Patch('documents/:mediaId')
  @Roles(Role.INSTITUTIONS)
  @AccountsStatus(AccountStatus.PENDING_APPROVAL)
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async replaceDocumentInstitution(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
  ) {
    if (!file) throw new BadRequestException('file is required');
    const result = await this.submissionService.replaceDocument(
      req.user.id, Role.INSTITUTIONS, mediaId, file);
    return { message: 'Document replaced successfully', result };
  }

  /**
   * Adds institution information during onboarding
   * Handles institution profile creation with optional logo upload
   *
   * @param file - Optional logo file for the institution
   * @param dto - Institution information data
   * @param req - Request object containing user information
   * @returns Success message with onboarding status
   */
  @Post('information')
  @Roles(Role.INSTITUTIONS)
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async addInformationInstitution(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: InformationInstitutionDto,
    @Req() req,
  ) {
    const data = await this.institutionOnboardingService.addInstitutionInformation(dto, req.user.id, file);
    return {
      message: 'Institution information added successfully',
      // Named for what it is. It used to be `status: data`, which the envelope
      // surfaced as `data.status` — a key every client reads as an HTTP status.
      result: { accountDetails: data },
    };
  }

  /**
   * Adds institution materials during onboarding
   * Handles waste category selection and collection preferences
   *
   * @param dto - Waste institution data
   * @param req - Request object containing user and profile information
   * @returns Success message with onboarding status
   */
  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.INSTITUTIONS)
  @Post('material')
  public async addMaterialInstitution( @Body() dto: WasteInstitutionDto, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const data = await this.institutionOnboardingService.addInstitutionMaterials(dto, profile, account.id);
    return {
      message: 'Institution materials added successfully',
      result: { materialDetails: data },
    };
  }

  /**
   * Uploads institution documents during onboarding
   * Handles license document uploads for institutions
   *
   * @param file - Document file to upload
   * @param dto - Media data with file type
   * @param req - Request object containing user and profile information
   * @returns Success message with upload data
   */
  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.INSTITUTIONS)
  @Post('upload-doc')
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async uploadFileInstitution(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: InstitutionMediaDto,
    @Req() req,
  ) {
    const role = req.user.role;
    const account = await this.accountRepo.findOne({ where: { id: req.user.id } });
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const step = await this.commonService.getCurrentStep(account);
    if (step !== 'documents') {
      throw new ForbiddenException('You cannot add documents data, you must complete the previous stage');
    }
    // fileType is restricted to LICENSE by InstitutionMediaDto.
    const data = await this.mediaService.uploadImage(file, { ownerId: req.profile.id, ownerType: role, fileType: dto.fileType }, req.user.id);
    return {
      message: 'Document uploaded successfully',
      // Was `{ message, data }`, which the envelope turned into `data.data` —
      // the caller had to unwrap the word "data" twice to reach a URL. The
      // service's own `status` string is dropped: the envelope already carries
      // a translated `message`, so a second one said nothing.
      result: { mediaDetails: { id: data.mediaId, image: data.image } },
    };
  }
}
