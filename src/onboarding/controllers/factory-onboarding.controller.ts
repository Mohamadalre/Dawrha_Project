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
import { InformationFactoryDto, WasteFactoryDto } from '../dto/factory-onboarding.dto';
import { ProfileOwnerGuard } from '../gurads/profile-owner.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaType } from '@src/media/entities/media.entity';
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
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

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
    const data = await this.factoryOnboardingService.addFactoryInformation(dto, req.user, file);
    return { message: 'Factory information added successfully', status: data };
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
  @Post('material')
  public async addMaterialFactory( @Body() dto: WasteFactoryDto, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const data = await this.factoryOnboardingService.addFactoryMaterials(dto, profile, account.id);
    return { message: 'Factory materials added successfully', status: data };
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
    if (role === Role.FACTORY && dto.fileType !== MediaType.INDUSTRIAL_REG && dto.fileType !== MediaType.LICENSE) {
      throw new ForbiddenException(`You cannot add image of a type ${dto.fileType}`);
    }
    const data = await this.mediaService.uploadImage(file, { ownerId: req.profile.id, ownerType: role, fileType: dto.fileType }, req.user.id);
    return { message: 'Upload image successfully', data };
  }
}
