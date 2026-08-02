import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { Cart } from '@src/waste-management/entities/cart.entity';
import { CartItem } from '@src/waste-management/entities/cart-item.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { SellabilityService } from '@src/waste-management/common/providers/sellability.service';
import { tierForRole } from '@src/waste-management/enums/pricing-tier.enum';
import { Order } from '../entities/order.entity';
import { OrderPart } from '../entities/order-part.entity';
import { OrderPartOffer } from '../entities/order-part-offer.entity';
import { OrderStatus, BUYER_CANCELLABLE_STATUSES } from '../enums/order-status.enum';
import {
  OrderPartStatus,
  RESERVING_PART_STATUSES,
} from '../enums/order-part-status.enum';
import { OrderOfferStatus } from '../enums/order-offer-status.enum';
import {
  FulfilmentMode,
  canUseDelivery,
  resolveFulfilmentMode,
} from '../enums/fulfilment-mode.enum';
import { OrderMinimumService } from './order-minimum.service';
import {
  OrderAllocationService,
  RequestedLine,
} from './order-allocation.service';

const LOG_META = { context: 'ORDER_CHECKOUT', channel: 'orders' } as const;

export interface CheckoutInput {
  accountId: string;
  role: Role;
  profileId: string;
  provinceId: string | null;
  fulfilmentMode?: FulfilmentMode;
  acceptPartialFulfilment?: boolean;
}

/**
 * Turns a cart into an order.
 *
 * Everything here is about the moment of commitment: the minimum is checked
 * against live prices, those prices are then FROZEN onto the order, the cart is
 * emptied, and allocation is handed the result.
 */
@Injectable()
export class OrderCheckoutService {
  constructor(
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderPart) private readonly partRepo: Repository<OrderPart>,
    @InjectRepository(OrderPartOffer)
    private readonly offerRepo: Repository<OrderPartOffer>,
    @InjectRepository(Cart) private readonly cartRepo: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepo: Repository<CartItem>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly minimums: OrderMinimumService,
    private readonly allocation: OrderAllocationService,
    private readonly odooSync: OdooSyncService,
    private readonly sellability: SellabilityService,
    private readonly dataSource: DataSource,
  ) {}

  async checkout(input: CheckoutInput) {
    if (!input.provinceId) {
      throw new BadRequestException(
        'Set your location before ordering — warehouses are matched to your governorate',
      );
    }

    const cart = await this.cartRepo.findOne({
      where: { accountId: input.accountId },
    });
    const items = cart
      ? await this.cartItemRepo.find({ where: { cartId: cart.id } })
      : [];
    if (!items.length) throw new BadRequestException('Your cart is empty');

    // Against the CURRENT prices: the cart re-prices itself whenever the admin
    // changes a price, so the figure the buyer is held to must be the one they
    // are actually about to pay.
    const goodsTotal = round3(
      items.reduce((sum, it) => sum + Number(it.subtotal), 0),
    );
    const check = await this.minimums.check(input.role, goodsTotal);
    if (!check.passed) {
      throw new BadRequestException(
        `Order value ${goodsTotal} ${check.currency} is below the ${check.required} ${check.currency} minimum — add ${check.shortfall} ${check.currency} more`,
      );
    }

    // A free facility asking for delivery is not an error to throw back at
    // them: the option simply does not apply, so it resolves to collection.
    const mode = resolveFulfilmentMode(input.role, input.fulfilmentMode);

    const lines = await this.toRequestedLines(items, input.role);
    const order = await this.orderRepo.save(
      this.orderRepo.create({
        orderNumber: await this.nextOrderNumber(),
        buyerAccountId: input.accountId,
        buyerRole: input.role,
        buyerProfileId: input.profileId,
        provinceId: input.provinceId,
        status: OrderStatus.PENDING_ALLOCATION,
        fulfilmentMode: mode,
        acceptPartialFulfilment: input.acceptPartialFulfilment ?? false,
        goodsTotal: String(goodsTotal),
        grandTotal: String(goodsTotal),
        currency: check.currency,
      }),
    );

    // The cart is emptied only once the order exists: a crash between the two
    // must lose the order, not the buyer's basket.
    await this.cartItemRepo.delete({ cartId: cart!.id });

    const outcome = await this.allocation.allocate(order.id, lines);
    winstonLogger.info(
      `Order ${order.orderNumber} placed by ${input.role} — ${outcome.result}`,
      LOG_META,
    );

    return {
      message: 'Order placed',
      order_id: order.id,
      order_number: order.orderNumber,
      status: (await this.orderRepo.findOne({ where: { id: order.id } }))!.status,
      goods_total: goodsTotal,
      currency: check.currency,
      fulfilment_mode: mode,
      delivery_available: canUseDelivery(input.role),
      allocation: outcome,
    };
  }

  /**
   * Cancels an order the buyer no longer wants.
   *
   * Allowed only before PREPARING — past that the stock has left the shelf and
   * the invoice exists. The whole thing runs in one transaction with the order
   * row locked, because the race is real: a buyer taps cancel at the instant
   * the last manager approves, and exactly one of those must win.
   */
  async cancel(accountId: string, orderId: string, reason?: string) {
    const partIds = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .getRepository(Order)
        .createQueryBuilder('o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();

      if (!order || order.buyerAccountId !== accountId) {
        throw new NotFoundException('Order not found');
      }
      if (!BUYER_CANCELLABLE_STATUSES.includes(order.status)) {
        throw new ConflictException(
          `This order can no longer be cancelled — it is already ${order.status}`,
        );
      }

      order.status = OrderStatus.CANCELLED;
      order.cancelledAt = new Date();
      order.cancelReason = reason ?? null as unknown as undefined;
      await manager.getRepository(Order).save(order);

      const parts = await manager
        .getRepository(OrderPart)
        .find({ where: { orderId } });
      const live = parts.filter((p) =>
        RESERVING_PART_STATUSES.includes(p.status),
      );
      for (const part of live) {
        part.status = OrderPartStatus.CANCELLED;
        part.stockReserved = false;
      }
      if (live.length) await manager.getRepository(OrderPart).save(live);

      // Withdraw the questions too, so no manager accepts a dead order.
      await manager
        .getRepository(OrderPartOffer)
        .update(
          { orderId, status: OrderOfferStatus.OFFERED },
          { status: OrderOfferStatus.WITHDRAWN, respondedAt: new Date() },
        );

      return live.map((p) => p.id);
    });

    // Outside the transaction: releasing the stock in Odoo is a remote call,
    // and holding a database lock across it would block other buyers.
    for (const partId of partIds) {
      await this.odooSync.enqueueCancelOrderPart({
        partId,
        reason: reason ?? 'Cancelled by the buyer',
      });
    }

    return { message: 'Order cancelled', cancelled_parts: partIds.length };
  }

  /**
   * Cart items, with everything Odoo and the planner need, RE-PRICED as of now.
   *
   * The basket is not a contract; the order is. A price can be withdrawn while a
   * basket sits open, so every line is re-checked here against the live list —
   * this is the last point at which an unbuyable material can be caught, and
   * catching it here turns a failure deep inside order creation into a clear
   * refusal naming the material.
   */
  private async toRequestedLines(
    items: CartItem[],
    role: Role,
  ): Promise<RequestedLine[]> {
    const tier = tierForRole(role);
    const products = await this.productRepo.find({
      where: { id: In(items.map((i) => i.productId)) },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines: RequestedLine[] = [];
    for (const item of items) {
      const product = byId.get(item.productId);
      if (!product?.odooProductId) {
        throw new BadRequestException(
          `"${product?.name ?? 'A material'}" is not available for ordering yet`,
        );
      }
      // Refuses by name if the price list was withdrawn since it was basketed.
      const unitPrice = await this.sellability.assertSellable(
        product.id,
        product.name,
        tier,
        item.conditionCode,
      );

      lines.push({
        productId: item.productId,
        odooProductId: product.odooProductId,
        productName: product.name,
        conditionCode: item.conditionCode ?? null,
        quantity: Number(item.quantity),
        unitType: item.unitType,
        unitPrice,
      });
    }
    return lines;
  }

  /**
   * A short, human reference. Derived from the count in the current month so it
   * stays readable and sortable; the unique index is the real guarantee.
   */
  private async nextOrderNumber(): Promise<string> {
    const now = new Date();
    const prefix = `ORD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const used = await this.orderRepo.count();
    return `${prefix}-${String(used + 1).padStart(5, '0')}`;
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
