import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { Favourite } from '../entities/favourite.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { UnitsService } from '../common/providers/units.service';
import { tierForRole } from '../enums/pricing-tier.enum';
import { buildPagination } from '../common/dto/pagination.dto';

interface Caller {
  id: string;
  role: Role;
}

/**
 * A buyer's own shortlist of materials.
 *
 * Everything here is scoped to the CALLER's account id, taken from the token
 * and never from the request. A favourites list keyed on anything the client
 * sends is a list anyone can read by changing a number.
 */
@Injectable()
export class FavouritesService {
  constructor(
    @InjectRepository(Favourite)
    private readonly favouriteRepo: Repository<Favourite>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductPricing)
    private readonly pricingRepo: Repository<ProductPricing>,
    private readonly units: UnitsService,
  ) {}

  /**
   * The buyer's list, priced at THEIR tier.
   *
   * The price is resolved here rather than left to the client, because a
   * favourites screen that showed no price would send the buyer back to the
   * catalogue to look each one up — which is the trip the list exists to save.
   *
   * A material whose price has since been withdrawn for this tier stays on the
   * list with `price: null` and `available: false`. Dropping it silently would
   * be the worse answer: the buyer put it there deliberately, and "it vanished"
   * is not something they can act on, whereas "not currently priced for you" is.
   */
  async list(caller: Caller, page = 1, limit = 20) {
    const [rows, total] = await this.favouriteRepo.findAndCount({
      where: { accountId: caller.id },
      relations: ['product', 'product.category'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const productIds = rows.map((r) => r.productId);
    const [prices, unitLabels] = await Promise.all([
      this.livePricesFor(productIds, caller.role),
      this.units.byCode(),
    ]);

    return {
      favourites: rows.map((row) => {
        const price = prices.get(row.productId) ?? null;
        const unit = row.product?.unitType
          ? unitLabels.get(row.product.unitType)
          : undefined;
        return {
          favourite_id: row.id,
          product_id: row.productId,
          product_name: row.product?.name ?? null,
          product_image: row.product?.imageURL ?? null,
          category_id: row.product?.categoryId ?? null,
          category_name: row.product?.category?.name ?? null,
          unit: {
            id: unit?.id ?? null,
            code: unit?.code ?? row.product?.unitType ?? null,
          },
          price,
          // Says WHY there is no number, so the buyer is not left guessing
          // whether the material is gone or merely not for them today.
          available: price != null && row.product?.isActive === true,
          note: row.note ?? null,
          added_at: row.createdAt,
        };
      }),
      pagination: buildPagination(total, page, limit),
    };
  }

  /**
   * Add a material to the list.
   *
   * Refuses a material that does not exist or has been switched off — a
   * favourite is a shortcut back to something buyable, and a shortcut to
   * nothing is worse than no shortcut.
   */
  async add(caller: Caller, productId: string, note?: string) {
    const product = await this.productRepo.findOne({
      where: { id: productId },
    });
    if (!product || !product.isActive) {
      throw new NotFoundException('Material not found');
    }

    const existing = await this.favouriteRepo.findOne({
      where: { accountId: caller.id, productId },
    });
    if (existing) {
      throw new ConflictException({
        message: 'This material is already in your favourites',
        errorCode: 'ALREADY_FAVOURITE',
        favourite_id: existing.id,
      });
    }

    const saved = await this.favouriteRepo.save(
      this.favouriteRepo.create({
        accountId: caller.id,
        productId,
        note: note?.trim() || null,
      }),
    );

    return {
      message: 'Added to favourites',
      favourite_id: saved.id,
      product_id: productId,
    };
  }

  /** Edit the buyer's own note. The material itself is not editable. */
  async update(caller: Caller, favouriteId: string, note?: string) {
    const row = await this.ownedOrThrow(caller, favouriteId);
    // An empty string CLEARS the note rather than being stored as "". The two
    // are the same thing to a reader and only one of them sorts and renders
    // predictably.
    row.note = note?.trim() || null;
    await this.favouriteRepo.save(row);
    return {
      message: 'Favourite updated',
      favourite_id: row.id,
      note: row.note,
    };
  }

  async remove(caller: Caller, favouriteId: string) {
    const row = await this.ownedOrThrow(caller, favouriteId);
    await this.favouriteRepo.delete(row.id);
    return { message: 'Removed from favourites', favourite_id: favouriteId };
  }

  /**
   * Someone else's favourite answers 404, not 403.
   *
   * A 403 confirms the id is real and belongs to somebody — which is exactly
   * what an enumeration attempt is looking for.
   */
  private async ownedOrThrow(caller: Caller, favouriteId: string) {
    const row = await this.favouriteRepo.findOne({
      where: { id: favouriteId },
    });
    if (!row || row.accountId !== caller.id) {
      throw new NotFoundException('Favourite not found');
    }
    return row;
  }

  /** The caller's tier price per material, for the ones currently effective. */
  private async livePricesFor(
    productIds: string[],
    role: Role,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!productIds.length) return map;

    const rows = await this.pricingRepo.find({
      where: { productId: In(productIds), tier: tierForRole(role) },
    });
    const now = Date.now();
    for (const row of rows) {
      const from = new Date(row.effectiveFrom).getTime();
      const until = row.effectiveUntil
        ? new Date(row.effectiveUntil).getTime()
        : null;
      if (from > now || (until != null && until <= now)) continue;
      // Graded tiers carry one row per grade; the headline is the cheapest,
      // which is what a shortlist shows — the full matrix is on the material.
      const current = map.get(row.productId);
      const price = Number(row.price);
      if (current == null || price < current) map.set(row.productId, price);
    }
    return map;
  }
}
