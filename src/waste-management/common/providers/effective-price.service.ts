import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Offer } from '../../entities/offer.entity';
import { PricingTier, tierForRole } from '../../enums/pricing-tier.enum';
import {
  audienceForRole,
  priceAfterOffer,
} from '../../enums/offer-audience.enum';
import { Role } from '@src/user/enums/role.enum';
import { SellabilityService } from './sellability.service';

/** What one buyer is charged for one material right now, and why. */
export interface EffectivePrice {
  /** The list price for this buyer's tier, before any offer. */
  basePrice: number;
  /** The offer in force for them, if any. */
  offer: Offer | null;
  /** What they actually pay: the base with the offer applied. */
  price: number;
}

/**
 * The price a buyer is charged AT THIS MOMENT, offer included.
 *
 * This exists because the offer was being applied in some places and not
 * others, and the place it was missing was the one that takes money. The
 * catalogue applied it, the basket applied it, and then checkout re-read the
 * list price and charged that — so a buyer was shown a discount on every
 * screen, agreed to it, and was invoiced the full amount. Nothing looked
 * broken: each screen was individually correct.
 *
 * The rule is therefore in ONE place, and the direction of the move — up for
 * sellers, down for buyers — comes from the shared `priceAfterOffer`, so no
 * reader can disagree with another about which way a price went.
 *
 * The price is read fresh rather than taken from the basket line: an admin can
 * withdraw a price list or end an offer while a basket sits open, and what is
 * charged has to be what is true when the order is placed. Once the order
 * EXISTS its lines are frozen — the snapshot lives on the order, which is the
 * only place a later edit must not reach.
 */
@Injectable()
export class EffectivePriceService {
  constructor(
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    private readonly sellability: SellabilityService,
  ) {}

  /**
   * The live offer reaching this role for this material and grade.
   *
   * Matched on the AUDIENCE first: a seller offer must never be applied to a
   * buyer's price, and the roles column alone does not say which side an offer
   * is on when it names no role.
   */
  async liveOfferFor(
    productId: string,
    role: Role,
    conditionCode?: string | null,
  ): Promise<Offer | null> {
    const audience = audienceForRole(role);
    if (!audience) return null;

    const qb = this.offerRepo
      .createQueryBuilder('o')
      .where('o.productId = :productId', { productId })
      .andWhere('o.audience = :audience', { audience })
      .andWhere('(o.targetRoles IS NULL OR :role = ANY(o.targetRoles))', { role })
      .andWhere('o.isActive = true')
      .andWhere('o.validFrom <= NOW()')
      .andWhere('(o.validUntil IS NULL OR o.validUntil > NOW())');

    // A graded offer applies to ITS grade only. An offer on the plain price of
    // an ungraded material names none, and matching the two together would let
    // a discount on "excellent" quietly price "poor".
    if (conditionCode) {
      qb.andWhere('o.conditionCode = :conditionCode', { conditionCode });
    } else {
      qb.andWhere('o.conditionCode IS NULL');
    }

    // Biggest move wins when two offers somehow reach the same buyer.
    return qb.orderBy('o.amount', 'DESC').getOne();
  }

  /**
   * The full picture: list price, offer, and the figure to charge.
   *
   * Returns null when this buyer has no live price for the material at all —
   * the caller decides whether that is a refusal or simply nothing to show.
   */
  async effectivePrice(
    productId: string,
    role: Role,
    conditionCode?: string | null,
  ): Promise<EffectivePrice | null> {
    const tier: PricingTier = tierForRole(role);
    const basePrice = await this.sellability.priceFor(productId, tier, conditionCode);
    if (basePrice == null) return null;

    const offer = await this.liveOfferFor(productId, role, conditionCode);
    return {
      basePrice,
      offer,
      price: offer
        ? priceAfterOffer(basePrice, Number(offer.amount), offer.audience)
        : basePrice,
    };
  }
}
