import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { LocationDto } from '@src/onboarding/dto/location.dto';
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

  // --- Citizen locations (multiple) ----------------------------------------

  @Get('locations')
  async listLocations(@CurrentUser() user) {
    const result = await this.userService.listLocations(user.id, user.role);
    return { message: 'Locations fetched successfully', result };
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
