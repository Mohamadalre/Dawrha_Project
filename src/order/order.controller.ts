import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { AccountStatusGuard } from '@src/auth/guards/account-status.guard';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { OrderCheckoutService } from './providers/order-checkout.service';
import { OrderViewService } from './providers/order-view.service';
import { BuyerProfileService } from '@src/waste-management/common/providers/buyer-profile.service';
import {
  CancelOrderDto,
  CheckoutDto,
  FileComplaintDto,
  RatePartDto,
} from './dto/order.dto';

/**
 * Ordering for factories and free facilities.
 *
 * One controller for both: they behave identically apart from delivery, and the
 * difference is settled inside the flow rather than by duplicating every route.
 * Both must be ACTIVE — an account still in onboarding has no confirmed location,
 * and location is what warehouses are matched on.
 */
@UseGuards(JwtAuthGuard, RolesGuard, AccountStatusGuard)
@Roles(Role.FACTORY, Role.EXTERNAL_PARTNER)
@AccountsStatus(AccountStatus.ACTIVE)
@Controller({ path: 'orders', version: '1' })
export class OrderController {
  constructor(
    private readonly checkout: OrderCheckoutService,
    private readonly view: OrderViewService,
    private readonly buyerProfile: BuyerProfileService,
  ) {}

  /**
   * Places the order: checks the minimum, freezes the prices, empties the cart
   * and hands the result to allocation.
   *
   * 201 — this genuinely creates an order at a new address.
   */
  @Post('checkout')
  async placeOrder(@CurrentUser() user: any, @Body() dto: CheckoutDto) {
    const profile = await this.buyerProfile.forAccount(user.id, user.role);
    return this.checkout.checkout({
      accountId: user.id,
      role: user.role,
      profileId: profile.profileId,
      provinceId: profile.provinceId,
      fulfilmentMode: dto.fulfilment_mode,
      acceptPartialFulfilment: dto.accept_partial_fulfilment,
    });
  }

  /** The buyer's orders, newest first. */
  @Get()
  async myOrders(
    @CurrentUser() user: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.view.listMine(user.id, page, limit);
  }

  /** One order with every part shown separately — this is where a split is legible. */
  @Get(':orderId')
  async orderDetail(
    @CurrentUser() user: any,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.view.detail(user.id, orderId);
  }

  /**
   * Cancels, while that is still possible.
   *
   * 200, not 201: nothing is created. A 409 comes back if preparation already
   * started — which is exactly what a buyer racing the last manager's approval
   * needs to be told.
   */
  @Post(':orderId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelOrder(
    @CurrentUser() user: any,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.checkout.cancel(user.id, orderId, dto.reason);
  }

  /**
   * The buyer confirms the goods arrived — the last word on the order, and the
   * only one the seller cannot give on their behalf.
   */
  @Post(':orderId/confirm-receipt')
  @HttpCode(HttpStatus.OK)
  async confirmReceipt(
    @CurrentUser() user: any,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.view.confirmReceipt(user.id, orderId);
  }

  /**
   * Rates ONE warehouse's share.
   *
   * Per part, because in a split order one warehouse may have been excellent
   * and another poor — a single score for the order blames nobody.
   * 200: re-rating replaces the previous verdict rather than adding a second.
   */
  @Post('parts/:partId/rating')
  @HttpCode(HttpStatus.OK)
  async ratePart(
    @CurrentUser() user: any,
    @Param('partId', ParseUUIDPipe) partId: string,
    @Body() dto: RatePartDto,
  ) {
    return this.view.ratePart(user.id, partId, dto.stars, dto.note);
  }

  /**
   * Reports a problem with one part. The kind decides who answers: a shortage
   * or a quality dispute goes to the warehouse, where the deduction log is;
   * delivery and billing go to the admin.
   */
  @Post('parts/:partId/complaints')
  async fileComplaint(
    @CurrentUser() user: any,
    @Param('partId', ParseUUIDPipe) partId: string,
    @Body() dto: FileComplaintDto,
  ) {
    return this.view.fileComplaint(user.id, partId, {
      kind: dto.kind,
      description: dto.description,
      claimedShortfall: dto.claimed_shortfall,
    });
  }
}
