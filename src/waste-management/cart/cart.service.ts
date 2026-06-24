import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { Cart } from '../entities/cart.entity';
import { CartItem } from '../entities/cart-item.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { Offer } from '../entities/offer.entity';
import { tierForRole } from '../enums/pricing-tier.enum';
import { UnitType } from '../enums/unit-type.enum';
import { cartLimitsFor } from './cart.config';
import { AddOfferToCartDto, AddToCartDto, UpdateCartItemDto } from './dto/cart.dto';

interface Caller {
  id: string;
  role: Role;
}

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepo: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly itemRepo: Repository<CartItem>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductPricing)
    private readonly pricingRepo: Repository<ProductPricing>,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
  ) {}

  // ---------------------------------------------------------------------------
  // Add product
  // ---------------------------------------------------------------------------
  async addItem(caller: Caller, dto: AddToCartDto) {
    const product = await this.productRepo.findOne({
      where: { id: dto.product_id, isActive: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    await this.enforceDailyMax(caller, dto.quantity);

    let unitPrice: number;
    let offer: Offer | null = null;
    let isOffer = false;

    if (dto.add_offer) {
      offer = await this.currentOfferForProduct(product.id);
      if (!offer) throw new BadRequestException('No active offer for this product');
      unitPrice = Number(offer.offerPrice);
      isOffer = true;
    } else {
      unitPrice = await this.tierPrice(product.id, caller.role);
    }

    const cart = await this.getOrCreateCart(caller.id);
    const subtotal = +(unitPrice * dto.quantity).toFixed(3);

    const item = await this.itemRepo.save(
      this.itemRepo.create({
        cartId: cart.id,
        productId: product.id,
        offerId: offer?.id,
        quantity: String(dto.quantity),
        unitType: dto.unit_type,
        unitPrice: String(unitPrice),
        subtotal: String(subtotal),
        isOffer,
      }),
    );

    const summary = await this.buildSummary(cart.id, caller.role);
    return {
      cart_id: cart.id,
      item_id: item.id,
      cart_summary: {
        total_items: summary.total_items,
        total_price: summary.total,
        currency: 'JOD',
        minimum_requirement_met: summary.meets_minimum,
        can_proceed_to_checkout: summary.can_checkout,
        min_required: summary.minimum_required,
        max_allowed: summary.daily_limit,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Add offer
  // ---------------------------------------------------------------------------
  async addOffer(caller: Caller, dto: AddOfferToCartDto) {
    const offer = await this.offerRepo.findOne({
      where: { id: dto.offer_id },
      relations: ['product'],
    });
    if (!offer || !offer.isActive) throw new NotFoundException('Offer not found');
    if (offer.validUntil && new Date(offer.validUntil).getTime() < Date.now()) {
      throw new BadRequestException('Offer has expired');
    }

    await this.enforceDailyMax(caller, dto.quantity);

    const cart = await this.getOrCreateCart(caller.id);
    const unitPrice = Number(offer.offerPrice);
    const subtotal = +(unitPrice * dto.quantity).toFixed(3);

    const item = await this.itemRepo.save(
      this.itemRepo.create({
        cartId: cart.id,
        productId: offer.productId,
        offerId: offer.id,
        quantity: String(dto.quantity),
        unitType: dto.unit_type,
        unitPrice: String(unitPrice),
        subtotal: String(subtotal),
        isOffer: true,
      }),
    );

    const summary = await this.buildSummary(cart.id, caller.role);
    return { cart_id: cart.id, item_id: item.id, cart_summary: summary };
  }

  // ---------------------------------------------------------------------------
  // Update item
  // ---------------------------------------------------------------------------
  async updateItem(caller: Caller, itemId: string, dto: UpdateCartItemDto) {
    const item = await this.loadOwnedItem(caller.id, itemId);

    const unitPrice = Number(item.unitPrice);
    item.quantity = String(dto.quantity);
    if (dto.unit_type) item.unitType = dto.unit_type;
    item.subtotal = String(+(unitPrice * dto.quantity).toFixed(3));
    await this.itemRepo.save(item);

    return this.getCart(caller);
  }

  // ---------------------------------------------------------------------------
  // Remove item
  // ---------------------------------------------------------------------------
  async removeItem(caller: Caller, itemId: string) {
    const item = await this.loadOwnedItem(caller.id, itemId);
    await this.itemRepo.delete(item.id);
    return { message: 'Item removed from cart' };
  }

  // ---------------------------------------------------------------------------
  // Clear / delete the whole cart
  // ---------------------------------------------------------------------------
  async clearCart(caller: Caller) {
    const cart = await this.cartRepo.findOne({ where: { accountId: caller.id } });
    if (!cart) return { message: 'Cart is already empty' };
    // CartItem rows cascade-delete with the cart (onDelete: CASCADE).
    await this.cartRepo.delete(cart.id);
    return { message: 'Cart cleared successfully' };
  }

  // ---------------------------------------------------------------------------
  // Get cart
  // ---------------------------------------------------------------------------
  async getCart(caller: Caller) {
    const cart = await this.getOrCreateCart(caller.id);
    const items = await this.itemRepo.find({
      where: { cartId: cart.id },
      relations: ['product'],
      order: { createdAt: 'ASC' },
    });

    const summary = await this.buildSummary(cart.id, caller.role, items);

    return {
      cart_id: cart.id,
      items: items.map((it) => ({
        item_id: it.id,
        product_id: it.productId,
        product_name: it.product?.name ?? null,
        product_image: it.product?.imageURL ?? null,
        quantity: Number(it.quantity),
        unit_type: it.unitType,
        unit_price: Number(it.unitPrice),
        subtotal: Number(it.subtotal),
        is_offer: it.isOffer,
      })),
      summary,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private async getOrCreateCart(accountId: string): Promise<Cart> {
    let cart = await this.cartRepo.findOne({ where: { accountId } });
    if (!cart) {
      cart = await this.cartRepo.save(this.cartRepo.create({ accountId }));
    }
    return cart;
  }

  private async loadOwnedItem(accountId: string, itemId: string): Promise<CartItem> {
    const item = await this.itemRepo.findOne({
      where: { id: itemId },
      relations: ['cart'],
    });
    if (!item) throw new NotFoundException('Cart item not found');
    if (item.cart.accountId !== accountId) {
      throw new ForbiddenException('Cart item does not belong to this account');
    }
    return item;
  }

  private async tierPrice(productId: string, role: Role): Promise<number> {
    const tier = tierForRole(role);
    const price = await this.pricingRepo
      .createQueryBuilder('pp')
      .where('pp.productId = :productId', { productId })
      .andWhere('pp.tier = :tier', { tier })
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .orderBy('pp.effectiveFrom', 'DESC')
      .getOne();

    if (!price) {
      throw new BadRequestException('Product is not priced for your account type');
    }
    return Number(price.price);
  }

  private async currentOfferForProduct(productId: string): Promise<Offer | null> {
    return this.offerRepo
      .createQueryBuilder('o')
      .where('o.productId = :productId', { productId })
      .andWhere('o.isActive = true')
      .andWhere('o.validFrom <= NOW()')
      .andWhere('(o.validUntil IS NULL OR o.validUntil > NOW())')
      .orderBy('o.discountPercentage', 'DESC')
      .getOne();
  }

  /** Citizens have a per-day unit cap; companies/factories do not. */
  private async enforceDailyMax(caller: Caller, addingQty: number): Promise<void> {
    const limits = cartLimitsFor(caller.role);
    if (limits.dailyMax == null) return;

    const cart = await this.cartRepo.findOne({ where: { accountId: caller.id } });
    if (!cart) return;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const todays = await this.itemRepo.find({
      where: { cartId: cart.id, createdAt: Between(start, end) },
    });
    const todayTotal = todays.reduce((sum, it) => sum + Number(it.quantity), 0);

    if (todayTotal + addingQty > limits.dailyMax) {
      throw new BadRequestException(
        `Daily limit exceeded. Maximum ${limits.dailyMax} units per day.`,
      );
    }
  }

  private async buildSummary(cartId: string, role: Role, preloaded?: CartItem[]) {
    const items = preloaded ?? (await this.itemRepo.find({ where: { cartId } }));
    const limits = cartLimitsFor(role);

    const subtotal = items.reduce((s, it) => s + Number(it.subtotal), 0);
    const totalUnits = items.reduce((s, it) => s + Number(it.quantity), 0);
    const totalWeight = items
      .filter((it) => it.unitType === UnitType.KG)
      .reduce((s, it) => s + Number(it.quantity), 0);

    const meetsMinimum = totalUnits >= limits.minQuantity;

    return {
      total_items: items.length,
      total_weight: +totalWeight.toFixed(3),
      subtotal: +subtotal.toFixed(3),
      discount: 0,
      tax: 0,
      total: +subtotal.toFixed(3),
      currency: 'JOD',
      meets_minimum: meetsMinimum,
      minimum_required: limits.minQuantity,
      daily_limit: limits.dailyMax,
      can_checkout: meetsMinimum && items.length > 0,
    };
  }
}
