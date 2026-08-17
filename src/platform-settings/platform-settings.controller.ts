import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length } from 'class-validator';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Role } from '@src/user/enums/role.enum';
import { PlatformSettingsService } from './platform-settings.service';

class UpdatePlatformSettingsDto {
  /** e.g. 'SYP'. Applied (uppercased) to new priced rows. */
  @IsOptional()
  @IsString()
  @Length(3, 8)
  default_currency?: string;
}

/**
 * The admin's single place to configure platform-wide settings — currently the
 * default pricing currency used for new priced rows.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller({ path: 'admin/platform-settings', version: '1' })
export class PlatformSettingsController {
  constructor(private readonly service: PlatformSettingsService) {}

  @Get()
  view() {
    return this.service.view();
  }

  @Patch()
  update(@CurrentUser() admin: any, @Body() dto: UpdatePlatformSettingsDto) {
    return this.service.update({ defaultCurrency: dto.default_currency }, admin.id);
  }
}
