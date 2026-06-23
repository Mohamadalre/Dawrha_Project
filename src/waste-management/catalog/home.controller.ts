import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { HomeService } from './home.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'waste/home', version: '1' })
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get()
  @Permissions('waste.categories.view')
  async getHome(@CurrentUser() user) {
    const result = await this.homeService.getHome(user);
    return { message: 'Home screen fetched successfully', result };
  }
}
