import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { Cart } from '../entities/cart.entity';
import { CartItem } from '../entities/cart-item.entity';
import { Product } from '../entities/product.entity';
import { UnitsService } from '../common/providers/units.service';
import { ConditionsService } from '../common/providers/conditions.service';
import { EffectivePriceService } from '../common/providers/effective-price.service';
import {
  ConditionRequiredException,
  ProductNotFoundException,
} from '../exceptions/waste.exceptions';
import { AddToCartDto, UpdateCartItemDto } from './dto/cart.dto';

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
    private readonly units: UnitsService,
    private readonly conditionsService: ConditionsService,
    // The single resolver for "what does THIS role pay for THIS grade right
    // now" — list price with any live offer already applied in the right
    // direction. The basket must not compute that itself: a second copy of the
    // sign is how a catalogue that subtracts ends up beside a basket that adds.
    private readonly effectivePrice: EffectivePriceService,
  ) {}

  // ---------------------------------------------------------------------------
  // Add product
  // ---------------------------------------------------------------------------
  async addItem(caller: Caller, dto: AddToCartDto) {
    const product = await this.productRepo.findOne({
      where: { id: dto.product_id, isActive: true },
    });
    if (!product) throw new ProductNotFoundException();

    // Which grade is being bought depends on WHO is buying, not only on the
    // material:
    //
    //   Factories and free facilities are priced PER GRADE, so on a graded
    //   material they must name one — BY ID — and it is asked for only when the
    //   material actually has grades. On an ungraded material there is no grade
    //   to send. Each grade is its own line (add the material again with another
    //   grade to buy more than one).
    //
    //   Citizens and institutions are priced FLAT — they do not deal in grades
    //   at all — so a grade is neither required nor used, even when the material
    //   happens to be graded.
    const buysPerGrade =
      caller.role === Role.FACTORY || caller.role === Role.EXTERNAL_PARTNER;
    let conditionCode: string | null = null;
    if (buysPerGrade && (await this.conditionsService.hasConditions(product.id))) {
      if (!dto.condition_id) {
        throw new ConditionRequiredException();
      }
      // Resolve BY ID against this material, and take the code from the resolved
      // row so a mismatched pair can never slip through.
      conditionCode = (
        await this.conditionsService.resolveActiveById(product.id, dto.condition_id)
      ).code;
    }

    // The price comes from the MATERIAL ID: the one resolver returns the list
    // price with any live offer already applied FOR THIS ROLE AND GRADE — an
    // offer that does not target the caller's role, or targets a different
    // grade, is not applied. The buyer opts into nothing; if an offer is
    // running for them it simply IS the price, exactly as the catalogue shows.
    const effective = await this.effectivePrice.effectivePrice(
      product.id,
      caller.role,
      conditionCode,
    );
    if (!effective) {
      throw new BadRequestException('This material has no price for your account type');
    }
    const unitPrice = effective.price;
    const offer = effective.offer;
    const isOffer = !!offer;

    const cart = await this.getOrCreateCart(caller.id);

    // One line per (material, grade). Adding the SAME material again is not a
    // second line — it is an edit of the one already there:
    //   • flat buyers (citizen/institution): the material has no grade, so the
    //     material alone identifies the line — a repeat is a duplicate.
    //   • graded buyers (factory/free-facility): the grade is part of the
    //     identity, so the SAME material with a DIFFERENT grade is a new line,
    //     but the same material+grade already in the basket is a duplicate.
    // A duplicate is refused with a pointer to edit the quantity instead.
    const duplicate = await this.itemRepo.findOne({
      where: {
        cartId: cart.id,
        productId: product.id,
        conditionCode: conditionCode ?? IsNull(),
      },
    });
    if (duplicate) {
      throw new ConflictException(
        conditionCode
          ? 'This material with this grade is already in your cart — edit its quantity instead'
          : 'This material is already in your cart — edit its quantity instead',
      );
    }

    const subtotal = +(unitPrice * dto.quantity).toFixed(3);

    const item = await this.itemRepo.save(
      this.itemRepo.create({
        cartId: cart.id,
        productId: product.id,
        offerId: offer?.id,
        quantity: String(dto.quantity),
        conditionCode,
        // The unit is the material's own, never entered by the buyer.
        unitType: product.unitType,
        unitPrice: String(unitPrice),
        subtotal: String(subtotal),
        isOffer,
      }),
    );

    const summary = await this.buildSummary(cart.id, caller.role);
    return {
      cart_id: cart.id,
      item_id: item.id,
      // Surfaced so the caller can see, per line, whether an offer was applied
      // and at what unit — the same figures the invoice will carry.
      item: {
        product_id: product.id,
        condition_id: dto.condition_id ?? '',
        quantity: dto.quantity,
        unit_type: product.unitType,
        unit_price: unitPrice,
        subtotal,
        is_offer: isOffer,
        offer_id: offer?.id ?? '',
        currency: 'SYP',
      },
      cart_summary: {
        total_items: summary.total_items,
        total_price: summary.total,
        currency: 'SYP',
        can_proceed_to_checkout: summary.can_checkout,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Update item
  // ---------------------------------------------------------------------------
  async updateItem(caller: Caller, itemId: string, dto: UpdateCartItemDto) {
    const item = await this.loadOwnedItem(caller.id, itemId);

    // Quantity only: the unit is the material's, and the price is the frozen
    // basket figure — changing how much re-totals the line, nothing else.
    const unitPrice = Number(item.unitPrice);
    item.quantity = String(dto.quantity);
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
        condition: it.conditionCode ?? null,
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

  private async buildSummary(cartId: string, role: Role, preloaded?: CartItem[]) {
    const items = preloaded ?? (await this.itemRepo.find({ where: { cartId } }));

    const subtotal = items.reduce((s, it) => s + Number(it.subtotal), 0);

    // Total quantity PER UNIT OF MEASURE — the sum of quantities of every item
    // that shares a unit. Kilograms and pieces are different physical things, so
    // one flat "total quantity" would add 30 kg to 10 pieces and mean nothing;
    // grouping by unit keeps each figure a real amount ("40 kg", "10 pieces").
    const quantityByUnit = new Map<string, number>();
    for (const it of items) {
      const unit = it.unitType || '';
      quantityByUnit.set(unit, (quantityByUnit.get(unit) ?? 0) + Number(it.quantity));
    }
    const totals_by_unit = [...quantityByUnit.entries()].map(([unit, qty]) => ({
      unit,
      total_quantity: +qty.toFixed(3),
    }));

    // Weight total kept for the clients that show it — but as a derived figure,
    // never a constraint. The commercial guardrails are VALUE-based and
    // admin-managed (minimum order value + spending cap) and are enforced at
    // CHECKOUT on the goods PRICE, whatever the unit; the cart is just a basket.
    const weightCodes = await this.units.weightCodes();
    const totalWeight = items
      .filter((it) => weightCodes.has(it.unitType))
      .reduce((s, it) => s + Number(it.quantity), 0);

    return {
      total_items: items.length,
      // Sum of quantities grouped by unit of measure.
      totals_by_unit,
      total_weight: +totalWeight.toFixed(3),
      subtotal: +subtotal.toFixed(3),
      discount: 0,
      tax: 0,
      total: +subtotal.toFixed(3),
      currency: 'SYP',
      can_checkout: items.length > 0,
    };
  }
}
