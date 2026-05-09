import { Controller, UseGuards, Post, Body, Req,Param, UseInterceptors, UploadedFile } from '@nestjs/common';
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
  constructor(private readonly externalPartnerOnboardingService: ExternalPartnerOnboardingService) {}

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
    return { message: 'External partner information added successfully', status: data };
  }

  /**
   * Adds external partner materials during onboarding
   * Handles waste category selection and delivery preferences
   *
   * @param profileId - External partner profile ID
   * @param dto - Waste external partner data
   * @param req - Request object containing user and profile information
   * @returns Success message with onboarding status
   */
  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.EXTERNAL_PARTNER)
  @Post('material/:profileId')
  public async addMaterialExternalPartner(@Param('profileId') profileId: string, @Body() dto: WasteExternalPartnerDto, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const data = await this.externalPartnerOnboardingService.addExternalPartnerMaterials(dto, profile, account.id);
    return { message: 'External partner materials added successfully', status: data };
  }
}
