import { Controller, UseGuards, Post, Body, Req, UseInterceptors, BadRequestException, UploadedFile, ForbiddenException } from '@nestjs/common';
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
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

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
    return { message: 'Institution information added successfully', status: data };
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
    return { message: 'Institution materials added successfully', status: data };
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
    return { message: 'Upload image successfully', data };
  }
}
