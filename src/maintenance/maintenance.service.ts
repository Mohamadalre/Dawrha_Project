import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Notification } from '@src/notification/entities/notification.entity';
import { Account } from '@src/user/entities/account.entity';
import { Cart } from '@src/waste-management/entities/cart.entity';
import { CartItem } from '@src/waste-management/entities/cart-item.entity';
import { ProductSuggestion } from '@src/waste-management/entities/product-suggestion.entity';
import { SuggestionStatus } from '@src/waste-management/enums/suggestion-status.enum';

/**
 * Scheduled maintenance / cleanup jobs.
 *
 * These are implemented with @nestjs/schedule. In production they should run in a
 * dedicated worker process (set MAINTENANCE_WORKER=true and start a worker-only
 * bootstrap) rather than every API instance — guarded here by `isEnabled()`.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger('MAINTENANCE');

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(Cart)
    private readonly cartRepo: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepo: Repository<CartItem>,
    @InjectRepository(ProductSuggestion)
    private readonly suggestionRepo: Repository<ProductSuggestion>,
  ) {}

  private isEnabled(): boolean {
    // Only the designated worker process runs cleanup; defaults to enabled so the
    // jobs are active out of the box in single-process deployments.
    return process.env.MAINTENANCE_WORKER !== 'false';
  }

  private daysAgo(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }

  /** 1) Delete notifications older than 30 days — daily 02:00. */
  @Cron('0 2 * * *')
  async cleanupExpiredNotifications(): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      const result = await this.notificationRepo
        .createQueryBuilder()
        .delete()
        .from(Notification)
        .where('created_at < :cutoff', { cutoff: this.daysAgo(30) })
        .execute();
      this.logger.log(`Deleted ${result.affected ?? 0} expired notification(s)`);
    } catch (error) {
      this.logger.error('cleanupExpiredNotifications failed', error as Error);
    }
  }

  /** 2) Delete unverified ghost accounts older than 24h with no cart — daily 03:00. */
  @Cron('0 3 * * *')
  async cleanupGhostAccounts(): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      const candidates = await this.accountRepo.find({
        where: { isEmailVerified: false, createdAt: LessThan(this.daysAgo(1)) },
      });

      let deleted = 0;
      for (const account of candidates) {
        const cart = await this.cartRepo.findOne({ where: { accountId: account.id } });
        const itemCount = cart
          ? await this.cartItemRepo.count({ where: { cartId: cart.id } })
          : 0;
        if (itemCount === 0) {
          if (cart) await this.cartRepo.delete(cart.id);
          await this.accountRepo.delete(account.id);
          deleted++;
        }
      }
      this.logger.log(`Deleted ${deleted} ghost account(s)`);
    } catch (error) {
      this.logger.error('cleanupGhostAccounts failed', error as Error);
    }
  }

  /** 3) Delete carts not modified for 7 days — every 6 hours. */
  @Cron(CronExpression.EVERY_6_HOURS)
  async cleanupExpiredCarts(): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      const stale = await this.cartRepo.find({
        where: { updatedAt: LessThan(this.daysAgo(7)) },
      });
      for (const cart of stale) {
        // Items cascade-delete with the cart (onDelete: CASCADE).
        await this.cartRepo.delete(cart.id);
      }
      this.logger.log(`Archived & removed ${stale.length} expired cart(s)`);
    } catch (error) {
      this.logger.error('cleanupExpiredCarts failed', error as Error);
    }
  }

  /** 4) Auto-reject suggestions older than 30 days without review — daily 04:00. */
  @Cron('0 4 * * *')
  async cleanupPendingSuggestions(): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      const result = await this.suggestionRepo
        .createQueryBuilder()
        .update(ProductSuggestion)
        .set({
          status: SuggestionStatus.REJECTED,
          adminNotes: 'Auto-rejected: not reviewed within 30 days',
          reviewedAt: () => 'NOW()',
        })
        .where('status = :status', { status: SuggestionStatus.PENDING_REVIEW })
        .andWhere('created_at < :cutoff', { cutoff: this.daysAgo(30) })
        .execute();
      this.logger.log(`Auto-rejected ${result.affected ?? 0} stale suggestion(s)`);
    } catch (error) {
      this.logger.error('cleanupPendingSuggestions failed', error as Error);
    }
  }
}
