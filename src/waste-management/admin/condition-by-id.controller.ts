import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { ProductConditionsService } from './product-conditions.service';
import {
  ReorderConditionDto,
  UpdateProductConditionDto,
} from './dto/product-condition.dto';

/**
 * One grade, addressed by its own id.
 *
 * A grade belongs to exactly ONE material, so its id already identifies it
 * completely — the material in the path added nothing and, worse, was never
 * checked: `/products/A/conditions/x` cheerfully edited a grade of material B
 * while the URL in the log claimed otherwise. A path segment that can disagree
 * with the record and never be challenged is not context, it is a lie waiting
 * to be believed.
 *
 * So this is the canonical way to edit, reorder or delete a grade. The nested
 * routes still exist for callers already built against them, and there the
 * material segment is now ASSERTED rather than ignored — a mismatch is a 400
 * that names the problem.
 *
 * Creating and listing stay nested, and correctly so: a new grade has no id yet,
 * and "the grades" is only ever a question about a material.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/waste/conditions', version: '1' })
export class ConditionByIdController {
  constructor(private readonly conditions: ProductConditionsService) {}

  /** One grade, with the material it belongs to. */
  @Get(':conditionId')
  @Permissions('admin.waste.manage')
  async get(@Param('conditionId', ParseUUIDPipe) conditionId: string) {
    return this.conditions.getOne(conditionId);
  }

  @Patch(':conditionId')
  @Permissions('admin.waste.manage')
  async update(
    @CurrentUser() user,
    @Param('conditionId', ParseUUIDPipe) conditionId: string,
    @Body() dto: UpdateProductConditionDto,
  ) {
    return this.conditions.update(user.id, conditionId, dto);
  }

  /** Move it within its own material's ordering. */
  @Patch(':conditionId/position')
  @Permissions('admin.waste.manage')
  async reorder(
    @CurrentUser() user,
    @Param('conditionId', ParseUUIDPipe) conditionId: string,
    @Body() dto: ReorderConditionDto,
  ) {
    return this.conditions.reorder(user.id, conditionId, dto.position);
  }

  @Delete(':conditionId')
  @Permissions('admin.waste.manage')
  async remove(
    @CurrentUser() user,
    @Param('conditionId', ParseUUIDPipe) conditionId: string,
  ) {
    return this.conditions.remove(user.id, conditionId);
  }
}
