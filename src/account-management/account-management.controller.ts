import { Controller, Get, Patch, Param, Body, Query, UseGuards, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { AccountManagementService } from './account-management.service';
import { BlockedAccountStatusDto, UpdateAccountStatusDto } from './dto/update-account-status.dto';
import { UpdateMediaStatusDto } from './dto/update-media-status.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller({
  path: 'account-management',
  version: '1',
})
export class AccountManagementController {
  constructor(
    private readonly accountManagementService: AccountManagementService,
  ) {}

  @Patch('media/:mediaId/status')
  async updateMediaStatus(
    @Param('mediaId') mediaId: string,
    @Body() dto: UpdateMediaStatusDto,
  ) {
    return this.accountManagementService.updateMediaStatus(mediaId, dto);
  }

  @Get(':profileId/media')
  async getProfileMedia(@Param('profileId') profileId: string) {
    return this.accountManagementService.getProfileMedia(profileId);
  }

  @Patch(':accountId/status')
  async updateAccountStatus(
    @Param('accountId') accountId: string,
    @Body() dto: UpdateAccountStatusDto,
  ) {
    return this.accountManagementService.updateStatus(accountId, dto);
  }

  @Patch(':accountId/block-status')
  async blockAccountStatus(
    @Param('accountId') accountId: string,
    @Body() dto: BlockedAccountStatusDto,
  ) {
    return this.accountManagementService.blockStatus(accountId, dto);
  }

  @Get('factory')
  async getFactories(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.accountManagementService.getProfiles(Role.FACTORY, page, limit);
  }

  @Get('institution')
  async getInstitutions(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.accountManagementService.getProfiles(Role.INSTITUTIONS, page, limit);
  }

  @Get('collector')
  async getCollectors(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.accountManagementService.getProfiles(Role.COLLECTOR, page, limit);
  }

  @Get('external-partner')
  async getExternalPartners(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.accountManagementService.getProfiles(Role.EXTERNAL_PARTNER, page, limit);
  }
}
