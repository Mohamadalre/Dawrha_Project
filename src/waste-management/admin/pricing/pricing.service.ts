import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '@src/waste-management/entities/product.entity';
import { ProductPricing } from '@src/waste-management/entities/product-pricing.entity';
import { CartItem } from '@src/waste-management/entities/cart-item.entity';
import { PricingTier, tierForRole } from '@src/waste-management/enums/pricing-tier.enum';
import { AuditService } from '@src/waste-management/common/providers/audit.service';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { SetPricingDto } from './dto/set-pricing.dto';

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductPricing)
    private readonly pricingRepo: Repository<ProductPricing>,
    @InjectRepository(CartItem)
    private readonly cartItemRepo: Repository<CartItem>,
    private readonly odooSync: OdooSyncService,
    private readonly audit: AuditService,
  ) {}

  async setPricing(adminId: string, productId: string, dto: SetPricingDto) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const effectiveFrom = dto.effective_from ? new Date(dto.effective_from) : new Date();
    const effectiveUntil = dto.effective_until ? new Date(dto.effective_until) : null;

    const tierValues: Record<PricingTier, number> = {
      [PricingTier.INDIVIDUAL]: dto.individual,
      [PricingTier.COMPANY]: dto.company,
      [PricingTier.FACTORY]: dto.factory,
    };

    // Close out the currently-effective price rows for each tier, then insert new.
    for (const tier of Object.values(PricingTier)) {
      await this.pricingRepo
        .createQueryBuilder()
        .update(ProductPricing)
        .set({ effectiveUntil: effectiveFrom })
        .where('product_id = :productId', { productId })
        .andWhere('tier = :tier', { tier })
        .andWhere('(effective_until IS NULL OR effective_until > :now)', { now: effectiveFrom })
        .execute();

      await this.pricingRepo.save(
        this.pricingRepo.create({
          productId,
          tier: tier as PricingTier,
          price: String(tierValues[tier as PricingTier]),
          currency: 'JOD',
          effectiveFrom,
          effectiveUntil: effectiveUntil ?? undefined,
        }),
      );
    }

    const updatedCarts = await this.repriceActiveCarts(productId, tierValues);
    await this.odooSync.enqueueUpdatePricing({ productId });
    await this.audit.record({
      userId: adminId,
      action: 'SET_PRICING',
      entityType: 'product_pricing',
      entityId: productId,
      newValues: { ...tierValues, effectiveFrom },
    });

    return {
      product_id: productId,
      pricing: {
        individual: dto.individual,
        company: dto.company,
        factory: dto.factory,
      },
      effective_from: effectiveFrom,
      updated_cart_items: updatedCarts,
      message: 'تم تحديث الأسعار بنجاح',
    };
  }

  /** Re-prices non-offer cart lines for this product using each owner's tier. */
  private async repriceActiveCarts(
    productId: string,
    tierValues: Record<PricingTier, number>,
  ): Promise<number> {
    const items = await this.cartItemRepo.find({
      where: { productId, isOffer: false },
      relations: ['cart', 'cart.account'],
    });

    let updated = 0;
    for (const item of items) {
      const role = item.cart?.account?.role;
      if (!role) continue;
      const tier = tierForRole(role);
      const newPrice = tierValues[tier];
      item.unitPrice = String(newPrice);
      item.subtotal = String(+(newPrice * Number(item.quantity)).toFixed(3));
      await this.cartItemRepo.save(item);
      updated++;
    }
    return updated;
  }
}
