import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { ProductConditionsService } from './product-conditions.service';
import {
  AddProductConditionDto,
  ReorderConditionDto,
  UpdateProductConditionDto,
} from './dto/product-condition.dto';

/**
 * The grades of ONE material.
 *
 * Nested under the product on purpose: a grade has no meaning on its own, and a
 * flat `/conditions` collection is what made them global in the first place —
 * forcing every material to borrow another's vocabulary.
 *
 * A material starts with none, and staying ungraded is a valid final state.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/waste/products/:productId/conditions', version: '1' })
export class ProductConditionsController {
  constructor(private readonly conditions: ProductConditionsService) {}

  /** This material's grades, in the admin's chosen order. */
  @Get()
  @Permissions('admin.waste.manage')
  async list(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.conditions.list(productId);
  }

  /**
   * Adds a grade. The position is assigned automatically as last + 1 — it is
   * not accepted in the body, because an order the caller picks is an order two
   * callers can collide on.
   */
  @Post()
  @Permissions('admin.waste.create')
  async add(
    @CurrentUser() user: any,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: AddProductConditionDto,
  ) {
    return this.conditions.add(user.id, productId, dto);
  }

  /**
   * Moves a grade to an explicit position, shifting the rest to make room.
   *
   * 200: nothing is created — the material's existing grades are renumbered.
   */
  @Patch(':conditionId/position')
  @HttpCode(HttpStatus.OK)
  @Permissions('admin.waste.manage')
  async reorder(
    @CurrentUser() user: any,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('conditionId', ParseUUIDPipe) conditionId: string,
    @Body() dto: ReorderConditionDto,
  ) {
    // The material segment is checked, not decorated: a grade belongs to one
    // material, and a URL that pairs it with another is describing something
    // that does not exist.
    return this.conditions.reorder(user.id, conditionId, dto.position, productId);
  }

  @Patch(':conditionId')
  @Permissions('admin.waste.manage')
  async update(
    @CurrentUser() user: any,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('conditionId', ParseUUIDPipe) conditionId: string,
    @Body() dto: UpdateProductConditionDto,
  ) {
    return this.conditions.update(user.id, conditionId, dto, productId);
  }

  @Delete(':conditionId')
  @Permissions('admin.waste.delete')
  async remove(
    @CurrentUser() user: any,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('conditionId', ParseUUIDPipe) conditionId: string,
  ) {
    return this.conditions.remove(user.id, conditionId, productId);
  }
}
