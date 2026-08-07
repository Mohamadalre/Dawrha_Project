import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';
import { LocationDto } from '@src/onboarding/dto/location.dto';
import { I18nContext } from 'nestjs-i18n';
import { UserService } from './user.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * Self-service account endpoints. The role is resolved from the JWT, so a single
 * profile route serves every role (citizen, institution, factory, free facility,
 * collector, admin).
 */
@UseGuards(JwtAuthGuard)
@Controller({ path: 'user', version: '1' })
export class UserController {
  constructor(private readonly userService: UserService) {}

  // Readable in every status that holds a token: an applicant waiting on a
  // decision, or refused one, must still be able to see the account the
  // decision is about. Editing it (PATCH below) stays ACTIVE-only — the
  // submitted application is corrected through the onboarding routes, which
  // re-push the change to the reviewer, and not behind their back here.
  @AccountsStatus(
    AccountStatus.ACTIVE,
    AccountStatus.PENDING_APPROVAL,
    AccountStatus.NEED_CHANGES,
    AccountStatus.REJECTED,
  )
  @Get('profile')
  async getProfile(@CurrentUser() user) {
    const result = await this.userService.getProfile(user.id, user.role);
    return { message: 'Profile fetched successfully', result };
  }

  /** Edit basic account info (name/phone/description) — ACTIVE accounts only, any role. */
  @Patch('profile')
  async updateProfile(@CurrentUser() user, @Body() dto: UpdateProfileDto) {
    return this.userService.updateProfile(user.id, dto);
  }

  @Patch('password')
  async changePassword(@CurrentUser() user, @Body() dto: ChangePasswordDto) {
    return this.userService.changePassword(user.id, dto);
  }

  // --- Profile image (ACTIVE accounts only) --------------------------------
  // Upload and replace share one service method: setting an image when one
  // already exists IS a replacement, so POST and PATCH behave identically
  // rather than duplicating the logic behind two verbs.

  @Post('profile/image')
  @AccountsStatus(AccountStatus.ACTIVE)
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async uploadProfileImage(
    @CurrentUser() user,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.userService.setProfileImage(user.id, file, user.role);
  }

  @Patch('profile/image')
  @AccountsStatus(AccountStatus.ACTIVE)
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async updateProfileImage(
    @CurrentUser() user,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.userService.setProfileImage(user.id, file, user.role);
  }

  @Delete('profile/image')
  @AccountsStatus(AccountStatus.ACTIVE)
  async deleteProfileImage(@CurrentUser() user) {
    return this.userService.deleteProfileImage(user.id);
  }

  // --- App settings & active sessions --------------------------------------

  /**
   * App settings: the active language and the ones it can switch to. Available
   * in every status that holds a token.
   */
  @AccountsStatus(
    AccountStatus.ACTIVE,
    AccountStatus.PENDING_APPROVAL,
    AccountStatus.NEED_CHANGES,
    AccountStatus.REJECTED,
  )
  @Get('settings')
  async getSettings(@CurrentUser() user) {
    const lang = I18nContext.current()?.lang;
    const result = await this.userService.getAppSettings(user.id, lang);
    return { message: 'Settings fetched successfully', result };
  }

  /** The devices currently signed in to this account (no secrets). */
  @AccountsStatus(
    AccountStatus.ACTIVE,
    AccountStatus.PENDING_APPROVAL,
    AccountStatus.NEED_CHANGES,
    AccountStatus.REJECTED,
  )
  @Get('settings/sessions')
  async getActiveSessions(@CurrentUser() user) {
    const result = await this.userService.listActiveSessions(user.id);
    return { message: 'Active sessions fetched successfully', result };
  }

  // --- Governorates (provinces) --------------------------------------------

  /**
   * The governorate list for the app — ACTIVE accounts only, paginated, cached.
   * Returns each province's id and both-language names.
   */
  @Get('provinces')
  @AccountsStatus(AccountStatus.ACTIVE)
  async listProvinces(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const result = await this.userService.listProvinces(page, limit);
    return { message: 'Provinces fetched successfully', result };
  }

  // --- Citizen locations (multiple) ----------------------------------------

  @Get('locations')
  async listLocations(
    @CurrentUser() user,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const result = await this.userService.listLocations(user.id, user.role, page, limit);
    return { message: 'Locations fetched successfully', result };
  }

  /** One saved location, in full, with its province name. Ownership-checked. */
  @Get('locations/:locationId')
  async getLocation(
    @CurrentUser() user,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    const result = await this.userService.getLocationById(user.id, user.role, locationId);
    return { message: 'Location fetched successfully', result };
  }

  @Post('locations')
  async addLocation(@CurrentUser() user, @Body() dto: LocationDto) {
    return this.userService.addLocation(user.id, user.role, dto);
  }

  @Delete('locations/:locationId')
  async removeLocation(
    @CurrentUser() user,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    return this.userService.removeLocation(user.id, user.role, locationId);
  }
}
