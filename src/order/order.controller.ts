import {
  BadRequestException,
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
import { DeliveryTripService } from './providers/delivery-trip.service';
import { BuyerProfileService } from '@src/waste-management/common/providers/buyer-profile.service';
import {
  CancelOrderDto,
  CheckoutDto,
  FileComplaintDto,
  ListOrdersQueryDto,
  PartialDecisionDto,
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
    private readonly trips: DeliveryTripService,
  ) {}

  /**
   * A delivery-cost RANGE (best and worst case) for this buyer, without placing
   * anything — so they can see what delivery will add before they commit.
   */
  @Get('delivery-estimate')
  async deliveryEstimate(@CurrentUser() user: any) {
    const profile = await this.buyerProfile.forAccount(user.id, user.role);
    if (!profile.provinceId) {
      throw new BadRequestException(
        'Set your location first — delivery is priced from your governorate',
      );
    }
    return this.trips.estimateDelivery(profile.profileId, profile.provinceId);
  }

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

  /**
   * The buyer's orders, newest first — optionally narrowed to one status
   * (`?status=REJECTED_AWAITING_BUYER`, `?status=PREPARING`, …) so a factory or
   * free facility can pull just the orders in a given state.
   */
  @Get()
  async myOrders(
    @CurrentUser() user: any,
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.view.listMine(user.id, query.page ?? 1, query.limit ?? 10, query.status);
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
   * The buyer's decision when the order could not be covered in full: ship what
   * is available, or cancel.
   *
   * 200, not 201: this resolves an existing order rather than creating one. A
   * 409 comes back if the order is no longer awaiting a decision — the buyer
   * raced their own cancel, or answered twice.
   */
  @Post(':orderId/partial-decision')
  @HttpCode(HttpStatus.OK)
  async decidePartial(
    @CurrentUser() user: any,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: PartialDecisionDto,
  ) {
    return this.checkout.respondToPartial(user.id, orderId, dto.accept);
  }

  /**
   * The buyer confirms that their split order — refused by the administrator —
   * is closed. Nothing to re-try: a split is one verdict for all its parts.
   *
   * 200: this closes an existing order rather than creating one. A 409 comes
   * back if the order is not awaiting this confirmation.
   */
  @Post(':orderId/confirm-rejection')
  @HttpCode(HttpStatus.OK)
  async confirmRejection(
    @CurrentUser() user: any,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.checkout.confirmRejection(user.id, orderId);
  }

  /**
   * The buyer chooses to CONSOLIDATE a split order: a delivery truck gathers the
   * far warehouses' parts into the one warehouse nearest them, so they collect
   * everything from a single place instead of driving to each.
   *
   * Offered only for a split, non-delivery order (a factory that chose delivery
   * is brought its goods; a single-warehouse order has nothing to gather). If
   * every warehouse has already prepared, gathering starts at once; otherwise it
   * begins the moment the last one finishes.
   */
  @Post(':orderId/consolidate')
  @HttpCode(HttpStatus.OK)
  async consolidate(
    @CurrentUser() user: any,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.trips.chooseConsolidation(user.id, orderId);
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
