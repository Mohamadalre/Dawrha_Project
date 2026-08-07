import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, Repository } from 'typeorm';
import { Offer } from '@src/waste-management/entities/offer.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { OdooSyncService } from './odoo-sync.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'OFFER_MIRROR_RECONCILE', channel: 'jobs' } as const;

/**
 * Safety net for the OFFER mirror on Odoo's price sheet.
 *
 * Every other exchange channel on this system has a reconciler — the fleet, the
 * governorates, the warehouses, the driver requests, the catalogue push. Offers
 * did not, and they are the one channel where the per-change push cannot be
 * retried by anything.
 *
 * The gap is specific. Creating or repricing an offer enqueues `UPDATE_PRICING`
 * for its material, and that job carries the offer onto
 * `recycle.product.condition.price`. But the existing catalogue sweep only
 * re-pushes materials whose OWN `odooSyncStatus` is not SYNCED — and an offer
 * change never touches that status. So a material that is perfectly synced, with
 * an offer whose push was lost because this backend was restarting, or the
 * worker was killed mid-flight, or the queue was flushed, is never revisited by
 * anything. The discount lives here and simply never appears in Odoo, with
 * nothing on either screen to say so.
 *
 * `UPDATE_PRICING` replaces the whole condition-price list for a material, so
 * re-running it is idempotent and converges regardless of what was missed —
 * including an offer that was DELETED here and is still shown there, which is
 * expressed by its absence from the fresh list.
 *
 * EXPIRY needs no help and deliberately gets none: `has_offer` and
 * `price_display` in Odoo are computed against the clock on read, so a discount
 * that simply runs out stops showing by itself.
 *
 * Scoped to materials that HAVE an offer row rather than the whole catalogue:
 * everything else has nothing an offer push could correct, and sweeping it would
 * re-push the entire price list on a timer for no reason.
 */
@Injectable()
export class OfferMirrorReconcileService implements OnModuleInit {
  constructor(
    private readonly odooSync: OdooSyncService,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  /** Catch up on boot — covers offers changed while we were offline. */
  async onModuleInit(): Promise<void> {
    await this.reconcile('startup');
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduledReconcile(): Promise<void> {
    await this.reconcile('cron');
  }

  private async reconcile(trigger: 'startup' | 'cron'): Promise<void> {
    try {
      // Distinct materials carrying an offer — one push per material, not one
      // per offer row: a graded material may hold several, and they all travel
      // in the same list.
      const rows = await this.offerRepo
        .createQueryBuilder('o')
        .select('DISTINCT o.productId', 'productId')
        .getRawMany<{ productId: string }>();

      let queued = 0;
      for (const { productId } of rows) {
        // Only a material Odoo actually has. One that was never mirrored has
        // no price sheet for the offer to land on, and the job would fail on
        // every run for as long as the offer exists.
        const product = await this.productRepo.findOne({
          where: { id: productId, odooProductId: Not(IsNull()) },
        });
        if (!product) continue;
        await this.odooSync.enqueueUpdatePricing({ productId });
        queued++;
      }

      winstonLogger.info(
        `Offer mirror reconciliation queued for ${queued} material(s) (${trigger})`,
        LOG_META,
      );
    } catch (err) {
      // Never let a queue hiccup crash boot or kill the cron: the next tick
      // retries anyway, which is the whole point of a reconciliation loop.
      winstonLogger.warn(
        `Offer mirror reconciliation could not be queued (${trigger}): ${(err as Error).message}`,
        LOG_META,
      );
    }
  }
}
