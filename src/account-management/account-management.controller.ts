import { Controller, Get, Patch, Param, Body, Query, UseGuards, DefaultValuePipe, ParseIntPipe, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { AccountManagementService } from './account-management.service';
import { BlockedAccountStatusDto, UpdateAccountStatusDto } from './dto/update-account-status.dto';
import { UpdateMediaStatusDto } from './dto/update-media-status.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({
  path: 'account-management',
  version: '1',
})
export class AccountManagementController {
  constructor(
    private readonly accountManagementService: AccountManagementService,
  ) {}

  @Patch('media/:mediaId/status')
  @Permissions('admin.accounts.manage')
  async updateMediaStatus(
    @Param('mediaId') mediaId: string,
    @Body() dto: UpdateMediaStatusDto,
  ) {
    return this.accountManagementService.updateMediaStatus(mediaId, dto);
  }

  @Get(':profileId/media')
  @Permissions('admin.accounts.view')
  async getProfileMedia(@Param('profileId') profileId: string) {
    return this.accountManagementService.getProfileMedia(profileId);
  }

  /** Full profile detail (profile + materials + image ids only). */
  @Get('profile/:profileId')
  @Permissions('admin.accounts.view')
  async getProfileDetails(@Param('profileId', ParseUUIDPipe) profileId: string) {
    const result = await this.accountManagementService.getProfileDetails(profileId);
    return { message: 'Profile fetched successfully', result };
  }

  /** Full details of a single image. */
  @Get('media/:mediaId')
  @Permissions('admin.accounts.view')
  async getMediaDetails(@Param('mediaId', ParseUUIDPipe) mediaId: string) {
    const result = await this.accountManagementService.getMediaDetails(mediaId);
    return { message: 'Media fetched successfully', result };
  }

  @Patch(':accountId/status')
  @Permissions('admin.accounts.manage')
  async updateAccountStatus(
    @Param('accountId') accountId: string,
    @Body() dto: UpdateAccountStatusDto,
  ) {
    return this.accountManagementService.updateStatus(accountId, dto);
  }

  @Patch(':accountId/block-status')
  @Permissions('admin.accounts.manage')
  async blockAccountStatus(
    @Param('accountId') accountId: string,
    @Body() dto: BlockedAccountStatusDto,
  ) {
    return this.accountManagementService.blockStatus(accountId, dto);
  }

  @Get('factory')
  @Permissions('admin.accounts.view')
  async getFactories(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status') status?: AccountStatus,
  ) {
    const data = await this.accountManagementService.getProfiles(Role.FACTORY, page, limit, status);
    return { message: 'Factories fetched successfully', result: data };
  }

  @Get('institution')
  @Permissions('admin.accounts.view')
  async getInstitutions(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status') status?: AccountStatus,
  ) {
    const data = await this.accountManagementService.getProfiles(Role.INSTITUTIONS, page, limit, status);
    return { message: 'Institutions fetched successfully', result: data };
  }

  // NOTE: the collector (driver) requests listing was removed — driver requests
  // are pushed to ODOO (PUSH_DRIVER_REQUEST) and reviewed by the Odoo admin.

  @Get('external-partner')
  @Permissions('admin.accounts.view')
  async getExternalPartners(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status') status?: AccountStatus,
  ) {
    const data = await this.accountManagementService.getProfiles(Role.EXTERNAL_PARTNER, page, limit, status);
    return { message:'External-partner fetch successfully',result:data}
  }
}
