import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { MyCategoriesService } from './my-categories.service';
import { AddMyCategoriesDto } from './dto/add-my-categories.dto';

/**
 * A buyer's OWN selected categories (institution / factory / free facility).
 *
 * ACTIVE-only by default (the global AccountStatusGuard), which is the rule the
 * requirement states: a live buyer manages their own shortlist. The list no
 * longer restricts the catalogue — everyone sees every active category — so
 * this is purely the buyer's personal list, viewable and extendable here.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'waste', version: '1' })
export class MyCategoriesController {
  constructor(private readonly service: MyCategoriesService) {}

  /** The caller's own selected categories (id + name). */
  @Get('my-categories/list')
  @Permissions('waste.materials.view')
  async list(@CurrentUser() user) {
    const result = await this.service.list(user);
    return { message: 'My categories fetched successfully', result };
  }

  /** Add one or more categories to the caller's own list. */
  @Post('my-categories')
  @Permissions('waste.materials.view')
  async add(@CurrentUser() user, @Body() dto: AddMyCategoriesDto) {
    const result = await this.service.addCategories(user, dto.categoryIds);
    return { message: 'Categories added to your list successfully', result };
  }
}
