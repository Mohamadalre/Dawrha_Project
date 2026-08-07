import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Offer } from '../../entities/offer.entity';
import { ProductPricing } from '../../entities/product-pricing.entity';
import { PricingTier } from '../../enums/pricing-tier.enum';
import { OfferBasis, amountFromPercentage } from '@src/waste-management/enums/offer-basis.enum';
import {
  AUDIENCE_ROLES,
  OfferAudience,
  offerPercentage,
  tiersForAudience,
} from '../../enums/offer-audience.enum';
import { Role } from '@src/user/enums/role.enum';
import { AuditService } from './audit.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'OFFER_SETTLEMENT', channel: 'jobs' } as const;

/**
 * Re-settle a material's offers after its PRICE moves.
 *
 * An offer stores an amount, and an amount only means something against the
 * price it is applied to. So changing a price silently changes every offer on
 * that material — in two ways, one cosmetic and one dangerous:
 *
 *   the stored PERCENTAGE goes stale. "20% off" was computed against the old
 *   price and is simply wrong against the new one, and it is what every
 *   "biggest offers" list ranks by;
 *
 *   the AMOUNT may no longer fit. Drop a price from 10 to 3 while a buyer offer
 *   takes 4 off it, and the price is not small — it is NEGATIVE, which means
 *   paying the buyer to take the material away.
 *
 * The price is the primary fact and is never refused: an administrator setting
 * a price should not be blocked by an offer they may have forgotten. The offer
 * gives way instead — suspended, with the reason recorded, so somebody can see
 * what happened and decide rather than discovering it as a negative invoice.
 */
@Injectable()
export class OfferSettlementService {
  constructor(
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(ProductPricing)
    private readonly pricingRepo: Repository<ProductPricing>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Bring every offer on this material back into agreement with its prices.
   *
   * Returns what changed, so the caller can report it — an admin who has just
   * cut a price needs to know it took an offer down with it.
   */
  async resettle(
    productId: string,
    adminId?: string,
  ): Promise<{ repriced: number; suspended: number }> {
    const offers = await this.offerRepo.find({ where: { productId } });
    let repriced = 0;
    let suspended = 0;

    for (const offer of offers) {
      const roles = (offer.targetRoles as Role[] | null)?.length
        ? (offer.targetRoles as Role[])
        : [...AUDIENCE_ROLES[offer.audience]];
      const tiers = tiersForAudience(offer.audience, roles);

      /**
       * A PERCENTAGE offer's amount is recomputed; an AMOUNT offer's is kept.
       *
       * This is the whole reason the basis is stored. "25% off" and "5 off"
       * produce the same row the day they are written and mean different things
       * the day the price moves: the first promised a ratio, so its amount has
       * to follow the price; the second promised a number, so it must not.
       *
       * Derived against the CHEAPEST price the row faces, matching creation —
       * it is the only choice that cannot drive one of the tiers below zero.
       */
      let amount = Number(offer.amount);
      if (offer.basis === OfferBasis.PERCENTAGE && offer.basisPercentage != null) {
        let cheapest: number | null = null;
        for (const tier of tiers) {
          const base = await this.livePrice(productId, tier, offer.conditionCode ?? null);
          if (base == null) continue;
          cheapest = cheapest == null ? base : Math.min(cheapest, base);
        }
        if (cheapest != null) {
          amount = amountFromPercentage(cheapest, Number(offer.basisPercentage));
        }
      }

      let dearestBase: number | null = null;
      let breaks: { tier: PricingTier; base: number } | null = null;

      for (const tier of tiers) {
        const base = await this.livePrice(productId, tier, offer.conditionCode ?? null);
        // A tier with no price at all is not a break — the material simply is
        // not sold to it, and the catalogue already hides it from those buyers.
        if (base == null) continue;
        if (offer.audience === OfferAudience.BUYERS && amount >= base) {
          breaks = { tier, base };
          break;
        }
        dearestBase = dearestBase == null ? base : Math.max(dearestBase, base);
      }

      if (breaks) {
        // Suspended, not deleted and not silently clamped. Clamping would quote
        // a discount nobody authorised; deleting would destroy the record of an
        // offer the admin may want back once the price is right.
        if (!offer.isActive) continue;
        offer.isActive = false;
        await this.offerRepo.save(offer);
        suspended++;
        await this.audit.record({
          userId: adminId ?? 'system',
          action: 'SUSPEND_OFFER_PRICE_TOO_LOW',
          entityType: 'offer',
          entityId: offer.id,
          newValues: {
            productId,
            amount,
            tier: breaks.tier,
            newBasePrice: breaks.base,
            reason:
              'The new price is at or below the offer amount — applying it would take the price to zero or below',
          },
        });
        winstonLogger.warn(
          `Offer ${offer.id} suspended: amount ${amount} no longer fits the ${breaks.tier} price ${breaks.base}`,
          LOG_META,
        );
        continue;
      }

      // Still honourable — re-derive the percentage against the NEW base. The
      // DEAREST one the row faces, exactly as on creation: the percentage is
      // amount ÷ base, so the dearest tier gives the smallest figure, which is
      // the one every targeted role is guaranteed to get at least.
      const percentage = offerPercentage(dearestBase ?? 0, amount);

      // BOTH are compared, not just the percentage.
      //
      // A percentage offer's amount is the thing that moved — and on a price
      // change that leaves the ratio intact, the derived percentage does NOT
      // move. Saving only when the percentage differs would compute the new
      // amount, log nothing, and throw it away: the offer would go on applying
      // the old reduction while claiming the promised share.
      const amountMoved = String(amount) !== String(Number(offer.amount));
      const percentageMoved =
        String(percentage) !== String(Number(offer.discountPercentage));

      if (amountMoved || percentageMoved) {
        offer.amount = String(amount);
        offer.discountPercentage = String(percentage);
        await this.offerRepo.save(offer);
        repriced++;
      }
    }

    if (repriced || suspended) {
      winstonLogger.info(
        `Offers re-settled for material ${productId}: ${repriced} repriced, ${suspended} suspended`,
        LOG_META,
      );
    }
    return { repriced, suspended };
  }

  /** The price in force right now for one tier (and grade, when graded). */
  private async livePrice(
    productId: string,
    tier: PricingTier,
    conditionCode: string | null,
  ): Promise<number | null> {
    const row = await this.pricingRepo.findOne({
      where: {
        productId,
        tier,
        ...(conditionCode ? { conditionCode } : { conditionCode: IsNull() }),
      },
      order: { effectiveFrom: 'DESC' },
    });
    if (!row) return null;
    const from = new Date(row.effectiveFrom).getTime();
    const until = row.effectiveUntil ? new Date(row.effectiveUntil).getTime() : null;
    const now = Date.now();
    if (from > now || (until != null && until <= now)) return null;
    return Number(row.price);
  }
}
