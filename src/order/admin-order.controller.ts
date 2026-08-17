import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { BuyerProfileService } from '@src/waste-management/common/providers/buyer-profile.service';
import { OrderCheckoutService } from './providers/order-checkout.service';
import { OrderViewService } from './providers/order-view.service';
import { OrderAllocationService } from './providers/order-allocation.service';
import {
  AdminCreateOrderDto,
  AdminListOrdersQueryDto,
  ApplyModificationDto,
} from './dto/order.dto';
import { Param, ParseUUIDPipe } from '@nestjs/common';

/**
 * The admin's order desk.
 *
 * Two things the buyer-facing routes cannot do: see EVERY buyer's orders (with a
 * status filter, so the rejected ones or the ones needing attention come back on
 * their own), and PLACE an order on a buyer's behalf — the recovery path when a
 * factory or free facility's own order fell short and the admin makes it right.
 *
 * Orders are a backend concern end to end (pricing, allocation, caps, distance),
 * so they are created HERE, never in Odoo, which only fulfils them.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/orders', version: '1' })
export class AdminOrderController {
  constructor(
    private readonly checkout: OrderCheckoutService,
    private readonly view: OrderViewService,
    private readonly buyerProfile: BuyerProfileService,
    private readonly allocation: OrderAllocationService,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

  /**
   * The alternative warehouse sets the admin may swap a SPLIT order to — every
   * set of the SAME number of warehouses that together cover it, nearest first,
   * the current set excluded. Shown when the admin chooses to MODIFY the split
   * instead of accepting or rejecting it.
   */
  @Get(':orderId/modification-options')
  @Permissions('admin.orders.view')
  async modificationOptions(@Param('orderId', ParseUUIDPipe) orderId: string) {
    const result = await this.allocation.modificationOptions(orderId);
    return { message: 'Modification options fetched successfully', result };
  }

  /**
   * Applies a MODIFY: re-routes the split order onto the warehouse set the admin
   * picked from the options above. Only while the split is still awaiting
   * approval; the set must be the same size as the split and cover the order.
   */
  @Post(':orderId/modify')
  @HttpCode(HttpStatus.OK)
  @Permissions('admin.orders.manage')
  async modify(
    @CurrentUser() admin: any,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: ApplyModificationDto,
  ) {
    return this.allocation.applyModification(orderId, dto.warehouseIds, admin.id);
  }

  /** Every buyer's orders, newest first, optionally narrowed to one status. */
  @Get()
  @Permissions('admin.orders.view')
  async list(@Query() query: AdminListOrdersQueryDto) {
    return this.view.listAll(query.page ?? 1, query.limit ?? 10, query.status);
  }

  /**
   * Places an order for a buyer whose own order fell short. The buyer must be a
   * factory or free facility (the only ordering roles) with a set location.
   */
  @Post()
  @Permissions('admin.orders.manage')
  async create(@CurrentUser() admin: any, @Body() dto: AdminCreateOrderDto) {
    const buyer = await this.accountRepo.findOne({ where: { id: dto.buyerAccountId } });
    if (!buyer) throw new NotFoundException('Buyer account not found');
    if (buyer.role !== Role.FACTORY && buyer.role !== Role.EXTERNAL_PARTNER) {
      throw new NotFoundException('That account cannot place orders');
    }

    const profile = await this.buyerProfile.forAccount(buyer.id, buyer.role);
    return this.checkout.adminCheckout({
      adminId: admin.id,
      buyerAccountId: buyer.id,
      buyerRole: buyer.role,
      profileId: profile.profileId,
      provinceId: profile.provinceId,
      items: dto.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        conditionCode: i.conditionCode ?? null,
      })),
      fulfilmentMode: dto.fulfilmentMode,
      acceptPartialFulfilment: dto.acceptPartialFulfilment,
    });
  }
}
