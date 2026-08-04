import { Controller, UseGuards, Post, Get, Patch, Param, ParseUUIDPipe, Body, Req, UseInterceptors, BadRequestException, UploadedFile, ForbiddenException } from '@nestjs/common';
import { UpdateLocationDto } from '../dto/update-location.dto';
import { UpdateInformationCollectorDto } from '../dto/update-information.dto';
import { OnboardingSubmissionService } from '../services/onboarding-submission.service';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { MediaService } from '@src/media/media.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Account } from '@src/user/entities/account.entity';
import { CollectorMediaDto } from '../dto/media.dto';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { AccountStatusGuard } from '@src/auth/guards/account-status.guard';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { InformationCollectorDto, LocationCollectorDto } from '../dto/collector-onboarding.dto';
import { ProfileOwnerGuard } from '../gurads/profile-owner.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';
import { Repository } from 'typeorm';
import { CommonService } from '@src/common/common.service';
import { CollectorOnboardingService } from '../services/collector-onboarding.service';

/**
 * Controller for handling collector onboarding processes
 * Manages collector information, location, and document uploads
 */
@AccountsStatus(AccountStatus.PENDING_PROFILE)
@UseGuards(JwtAuthGuard, AccountStatusGuard, RolesGuard)
@Controller({
  path: 'onboarding/collector',
  version: '1'
})
export class CollectorOnboardingController {
  constructor(
    private readonly collectoronboardingService: CollectorOnboardingService ,
    private readonly commonService: CommonService,
    private readonly mediaService: MediaService,
    private readonly submissionService: OnboardingSubmissionService,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // Submitted application: review + corrections (class-level
  // @AccountsStatus(PENDING_PROFILE) is overridden per handler).
  // A driver's application is decided in ODOO, so every correction here is
  // re-pushed there immediately by the service.
  // ─────────────────────────────────────────────────────────────────────

  /** The application as submitted, in step order (info → location → documents). */
  @Get('submission')
  @Roles(Role.COLLECTOR)
  @AccountsStatus(
    AccountStatus.PENDING_APPROVAL,
    AccountStatus.REJECTED,
    AccountStatus.NEED_CHANGES,
  )
  async getSubmissionCollector(@Req() req) {
    const result = await this.submissionService.getSubmission(req.user.id, Role.COLLECTOR);
    return { message: 'Application fetched successfully', result };
  }

  /** Correct the submitted information while the application is pending approval. */
  @Patch('information')
  @Roles(Role.COLLECTOR)
  @AccountsStatus(AccountStatus.PENDING_APPROVAL)
  async updateInformationCollector(@Body() dto: UpdateInformationCollectorDto, @Req() req) {
    const result = await this.submissionService.updateInformation(
      req.user.id, Role.COLLECTOR, dto);
    return { message: 'Information updated successfully', result };
  }

  /**
   * Correct the registered location while the application is pending approval.
   * NOTE: a driver may change the written address only — sending `coordinates`
   * is rejected (his GPS point is captured by the app and drives dispatch).
   */
  @Patch('location')
  @Roles(Role.COLLECTOR)
  @AccountsStatus(AccountStatus.PENDING_APPROVAL)
  async updateLocationCollector(@Body() dto: UpdateLocationDto, @Req() req) {
    const result = await this.submissionService.updateLocation(
      req.user.id, Role.COLLECTOR, dto);
    return { message: 'Location updated successfully', result };
  }

  /** Replace a still-pending document while the application is pending approval. */
  @Patch('documents/:mediaId')
  @Roles(Role.COLLECTOR)
  @AccountsStatus(AccountStatus.PENDING_APPROVAL)
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async replaceDocumentCollector(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
  ) {
    if (!file) throw new BadRequestException('file is required');
    const result = await this.submissionService.replaceDocument(
      req.user.id, Role.COLLECTOR, mediaId, file);
    return { message: 'Document replaced successfully', result };
  }

  /**
   * Adds collector information during onboarding
   * Handles collector profile creation with shift and national ID
   *
   * @param dto - Collector information data
   * @param req - Request object containing user information
   * @returns Success message with onboarding status
   */
  @Post('information')
  @Roles(Role.COLLECTOR)
  async addInformationCollector(
    @Body() dto: InformationCollectorDto,
    @Req() req,
  ) {
    const data = await this.collectoronboardingService.addCollectorInformation(dto, req.user.id);
    return {
      message: 'Collector information added successfully',
      // Named for what it is. It used to be `status: data`, which the envelope
      // surfaced as `data.status` — a key every client reads as an HTTP status.
      result: { accountDetails: data },
    };
  }

  /**
   * Uploads collector documents during onboarding
   * Handles ID card front and back document uploads
   * 
   * @param file - Document file to upload
   * @param dto - Media data with file type
   * @param req - Request object containing user and profile information
   * @returns Success message with upload data
   */
  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.COLLECTOR)
  @Post('upload-doc')
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async uploadFileCollector(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CollectorMediaDto,
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

    // fileType is restricted to the collector's document types by CollectorMediaDto.
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

  /**
   * Adds collector location during onboarding
   * Handles location data with coordinates and address
   *
   * @param dto - Location collector data
   * @param req - Request object containing user and profile information
   * @returns Success message with onboarding status
   */
  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.COLLECTOR)
  @Post('location')
  public async createLocationCollector( @Body() dto: LocationCollectorDto, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const role = req.user.role;

    const data = await this.collectoronboardingService.addLocation(dto, role, profile, account.id);
    return {
      message: 'Location added successfully',
      result: { locationDetails: data },
    };
  }
}
