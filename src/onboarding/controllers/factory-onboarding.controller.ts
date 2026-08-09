import { Controller, UseGuards, Post, Get, Patch, Param, ParseUUIDPipe, Body, Req, UseInterceptors, BadRequestException, UploadedFile, ForbiddenException } from '@nestjs/common';
import { UpdateLocationDto } from '../dto/update-location.dto';
 import { UpdateMaterialsOrderDto } from '../dto/update-materials.dto';
import { UpdateInformationFactoryDto } from '../dto/update-information.dto';
import { OnboardingSubmissionService } from '../services/onboarding-submission.service';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { MediaService } from '@src/media/media.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Account } from '@src/user/entities/account.entity';
import { FactoryMediaDto } from '../dto/media.dto';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { AccountStatusGuard } from '@src/auth/guards/account-status.guard';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { InformationFactoryDto, WasteFactoryDto } from '../dto/factory-onboarding.dto';
import { ProfileOwnerGuard } from '../gurads/profile-owner.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';
import { Repository } from 'typeorm';
import { CommonService } from '@src/common/common.service';
import { FactoryOnboardingService } from '../services/factory-onboarding.service';

/**
 * Controller for handling factory onboarding processes
 * Manages factory information, materials, and document uploads
 */
@AccountsStatus(AccountStatus.PENDING_PROFILE)
@UseGuards(JwtAuthGuard, AccountStatusGuard, RolesGuard)
@Controller({
  path: 'onboarding/factory',
  version: '1'
})
export class FactoryOnboardingController {
  constructor(
    private readonly factoryOnboardingService: FactoryOnboardingService ,
    private readonly commonService: CommonService,
    private readonly mediaService: MediaService,
    private readonly submissionService: OnboardingSubmissionService,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // Submitted application: review + corrections (class-level
  // @AccountsStatus(PENDING_PROFILE) is overridden per handler).
  // ─────────────────────────────────────────────────────────────────────

  /** The application as submitted, in step order (info → location → docs → materials). */
  @Get('submission')
  @Roles(Role.FACTORY)
  @AccountsStatus(
    AccountStatus.PENDING_APPROVAL,
    AccountStatus.REJECTED,
    AccountStatus.NEED_CHANGES,
  )
  async getSubmissionFactory(@Req() req) {
    const result = await this.submissionService.getSubmission(req.user.id, Role.FACTORY);
    return { message: 'Application fetched successfully', result };
  }

  /** Correct the submitted information while the application is pending approval. */
  @Patch('information')
  @Roles(Role.FACTORY)
  @AccountsStatus(AccountStatus.PENDING_PROFILE, AccountStatus.PENDING_APPROVAL)
  async updateInformationFactory(@Body() dto: UpdateInformationFactoryDto, @Req() req) {
    const result = await this.submissionService.updateFactoryInformation(
      req.user.id, dto);
    return { message: 'Information updated successfully', result };
  }


  /** Correct the submitted materials while the application is pending approval. */
  @Patch('materials')
  @Roles(Role.FACTORY)
  @AccountsStatus(AccountStatus.PENDING_PROFILE, AccountStatus.PENDING_APPROVAL)
  async updateMaterialsFactory(@Body() dto: UpdateMaterialsOrderDto, @Req() req) {
    const result = await this.submissionService.updateMaterials(
      req.user.id, Role.FACTORY, dto);
    return { message: 'Materials updated successfully', result };
  }
  /** Correct the registered location while the application is pending approval. */
  @Patch('location')
  @Roles(Role.FACTORY)
  @AccountsStatus(AccountStatus.PENDING_PROFILE, AccountStatus.PENDING_APPROVAL)
  async updateLocationFactory(@Body() dto: UpdateLocationDto, @Req() req) {
    const result = await this.submissionService.updateLocation(
      req.user.id, Role.FACTORY, dto);
    return { message: 'Location updated successfully', result };
  }

  /** Replace a still-pending document while the application is pending approval. */
  @Patch('documents/:mediaId')
  @Roles(Role.FACTORY)
  @AccountsStatus(AccountStatus.PENDING_PROFILE, AccountStatus.PENDING_APPROVAL)
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async replaceDocumentFactory(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
  ) {
    if (!file) throw new BadRequestException('file is required');
    const result = await this.submissionService.replaceDocument(
      req.user.id, Role.FACTORY, mediaId, file);
    return { message: 'Document replaced successfully', result };
  }

  /**
   * Adds factory information during onboarding
   * Handles factory profile creation with optional logo upload
   *
   * @param file - Optional logo file for the factory
   * @param dto - Factory information data
   * @param req - Request object containing user information
   * @returns Success message with onboarding status
   */
  @Post('information')
  @Roles(Role.FACTORY)
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async addInformationFactory(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: InformationFactoryDto,
    @Req() req,
  ) {
    const data = await this.factoryOnboardingService.addFactoryInformation(dto, req.user.id, file);
    return {
      message: 'Factory information added successfully',
      // Named for what it is. It used to be `status: data`, which the envelope
      // surfaced as `data.status` — a key every client reads as an HTTP status.
      result: { accountDetails: data },
    };
  }

  /**
   * Adds factory materials during onboarding
   * Handles waste category selection and delivery preferences
   *
   * @param dto - Waste factory data
   * @param req - Request object containing user and profile information
   * @returns Success message with onboarding status
   */
  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.FACTORY)
  @Post('materials')
  public async addMaterialFactory( @Body() dto: WasteFactoryDto, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const data = await this.factoryOnboardingService.addFactoryMaterials(dto, profile, account.id);
    return {
      message: 'Factory materials added successfully',
      result: { materialDetails: data },
    };
  }

  /**
   * Uploads factory documents during onboarding
   * Handles industrial registration and license document uploads
   *
   * @param file - Document file to upload
   * @param dto - Media data with file type
   * @param req - Request object containing user and profile information
   * @returns Success message with upload data
   */
  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.FACTORY)
  @Post('upload-doc')
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async uploadFileFactory(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: FactoryMediaDto,
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
    // fileType is restricted to LICENSE + INDUSTRIAL_REG by FactoryMediaDto.
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
