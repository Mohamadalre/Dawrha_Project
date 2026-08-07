import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Role } from '@src/user/enums/role.enum';
import { OrderMinimumService } from './providers/order-minimum.service';
import { OrderSpendingCapService } from './providers/order-spending-cap.service';
import {
  UpsertOrderMinimumDto,
  UpsertSpendingCapDto,
} from './dto/order-constraints.dto';

/**
 * The admin's commercial guardrails on ordering — the FLOOR (minimum order
 * value) and the CEILING (spending cap) a buyer role is held to.
 *
 * Deliberately NOT a cart controller: the admin never sees, adds to, edits or
 * empties anyone's cart. They set the per-role rules; the buyer's own checkout
 * enforces them. Keyed by role because "the rule for factories" is one fact.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/order-constraints', version: '1' })
export class OrderConstraintsController {
  constructor(
    private readonly minimums: OrderMinimumService,
    private readonly caps: OrderSpendingCapService,
  ) {}

  // ── Minimum order value (the floor) ───────────────────────────────
  @Get('minimums')
  @Permissions('admin.pricing.manage')
  async listMinimums() {
    const result = await this.minimums.list();
    return { message: 'Order minimums fetched', result };
  }

  /** Upsert the minimum for a role — PUT because the role is the whole key. */
  @Put('minimums/:role')
  @Permissions('admin.pricing.manage')
  async setMinimum(
    @CurrentUser() user,
    @Param('role', new ParseEnumPipe(Role)) role: Role,
    @Body() dto: UpsertOrderMinimumDto,
  ) {
    const result = await this.minimums.upsert(
      role,
      {
        minOrderValue: dto.min_order_value,
        currency: dto.currency,
        isActive: dto.is_active,
      },
      user.id,
    );
    return { message: 'Order minimum saved', result };
  }

  @Delete('minimums/:role')
  @HttpCode(HttpStatus.OK)
  @Permissions('admin.pricing.manage')
  async removeMinimum(@Param('role', new ParseEnumPipe(Role)) role: Role) {
    await this.minimums.remove(role);
    return { message: 'Order minimum removed' };
  }

  // ── Spending cap (the ceiling) ────────────────────────────────────
  @Get('spending-caps')
  @Permissions('admin.pricing.manage')
  async listCaps() {
    const result = await this.caps.list();
    return { message: 'Spending caps fetched', result };
  }

  /** Upsert the daily/monthly spending cap for a role. */
  @Put('spending-caps/:role')
  @Permissions('admin.pricing.manage')
  async setCap(
    @CurrentUser() user,
    @Param('role', new ParseEnumPipe(Role)) role: Role,
    @Body() dto: UpsertSpendingCapDto,
  ) {
    const result = await this.caps.upsert(
      role,
      {
        maxAmount: dto.max_amount,
        period: dto.period,
        currency: dto.currency,
        isActive: dto.is_active,
      },
      user.id,
    );
    return { message: 'Spending cap saved', result };
  }

  @Delete('spending-caps/:role')
  @HttpCode(HttpStatus.OK)
  @Permissions('admin.pricing.manage')
  async removeCap(@Param('role', new ParseEnumPipe(Role)) role: Role) {
    await this.caps.remove(role);
    return { message: 'Spending cap removed' };
  }
}
