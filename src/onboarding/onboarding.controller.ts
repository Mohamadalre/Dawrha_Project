import { Controller, UseGuards, Post, Body, Req, Get, Query, ForbiddenException, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { ProfileOwnerGuard } from './gurads/profile-owner.guard';
import { LocationDto } from './dto/location.dto';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { MediaService } from '@src/media/media.service';
import { Account } from '@src/user/entities/account.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { CommonService } from '@src/common/common.service';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { AccountStatusGuard } from '@src/auth/guards/account-status.guard';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { Repository } from 'typeorm';

/**
 * Base controller for shared onboarding functionality
 * Handles common operations like location and provinces
 */
@AccountsStatus(AccountStatus.PENDING_PROFILE)
@UseGuards(JwtAuthGuard, AccountStatusGuard, RolesGuard)
@Controller({
  path: 'onboarding',
  version: '1'
})
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly commomService: CommonService,
    private readonly mediaService: MediaService,
    @InjectRepository(Account)
    private readonly acccountRepo: Repository<Account>,
  ) { }


  /**
   * Adds location information for non-collector roles during onboarding
   * Handles location data with coordinates, address, and province
   *
   * @param dto - Location data
   * @param req - Request object containing user and profile information
   * @returns Success message with onboarding status
   */
  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.EXTERNAL_PARTNER, Role.FACTORY, Role.INSTITUTIONS)
  @Post('location')
  public async createLocation( @Body() dto: LocationDto, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const role = req.user.role;
    if (role === Role.CITIZEN || role === Role.COLLECTOR) {
      throw new ForbiddenException('You cannot add location')
    }
    const data = await this.onboardingService.addLocation(dto, role, profile, account.id)
    return { message: "add Location successfully", status: data }
  }






  /**
   * Gets a paginated list of provinces
   * Used for location selection during onboarding
   *
   * @param page - Page number for pagination (default 1)
   * @returns Success message with provinces data
   */
  @Get('provinces')
  async getProvinces(@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {

    const result = await this.onboardingService.findAll(page);
    return { message: 'Fetch provinces successfully', result };

  }


}