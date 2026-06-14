import { Controller, UseGuards, Post, Body, Req, UseInterceptors, BadRequestException, UploadedFile, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { MediaService } from '@src/media/media.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Account } from '@src/user/entities/account.entity';
import { MediaDto } from '../dto/media.dto';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { AccountStatusGuard } from '@src/auth/guards/account-status.guard';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { InformationCollectorDto, LocationCollectorDto } from '../dto/collector-onboarding.dto';
import { ProfileOwnerGuard } from '../gurads/profile-owner.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaType } from '@src/media/entities/media.entity';
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
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

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
    return { message: 'Collector information added successfully', status: data };
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
    @Body() dto: MediaDto,
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

    if (dto.fileType !== MediaType.ID_CARD_BACK && dto.fileType !== MediaType.ID_CARD_FRONT) {
      throw new ForbiddenException(`You cannot add image of a type ${dto.fileType}`);
    }
    const data = await this.mediaService.uploadImage(file, { ownerId: req.profile.id, ownerType: role, fileType: dto.fileType }, req.user.id);
    return { message: 'Upload image successfully', data };
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
    return { message: 'Location added successfully', status: data };
  }
}
