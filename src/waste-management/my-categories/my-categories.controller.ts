import { Body, Controller, Post, UseGuards } from '@nestjs/common';
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

  // The GET `my-categories/list` route was removed — it duplicated
  // `GET /v1/waste/my-categories` (CatalogController.getMyCategories), which is
  // the single route for viewing the caller's selected categories. The service's
  // `list()` stays: the add route below returns it.

  /** Add one or more categories to the caller's own list. */
  @Post('my-categories')
  @Permissions('waste.materials.view')
  async add(@CurrentUser() user, @Body() dto: AddMyCategoriesDto) {
    const result = await this.service.addCategories(user, dto.categoryIds);
    return { message: 'Categories added to your list successfully', result };
  }
}
