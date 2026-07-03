import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Notification } from '@src/notification/entities/notification.entity';
import { Account } from '@src/user/entities/account.entity';
import { Cart } from '@src/waste-management/entities/cart.entity';
import { CartItem } from '@src/waste-management/entities/cart-item.entity';
import { winstonLogger } from '@src/core/logger-config/winston.config';

/** Unified logging context/channel for all maintenance cron output. */
const LOG_META = { context: 'MAINTENANCE', channel: 'jobs' } as const;

/**
 * Scheduled maintenance / cleanup jobs.
 *
 * Implemented with @nestjs/schedule but executed ONLY inside the dedicated
 * maintenance worker process (`npm run start:worker`), never in the API
 * instances — see {@link isEnabled}. This keeps destructive deletes off the
 * request-serving processes and lets them run in a single, isolated process.
 *
 * Only two jobs are kept:
 *   1) Permanently purge notifications a user has deleted (soft-deleted) once
 *      they are older than 30 days.
 *   2) Remove unverified "ghost" accounts older than 24h.
 */
@Injectable()
export class MaintenanceService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(Cart)
    private readonly cartRepo: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepo: Repository<CartItem>,
  ) {}

  /**
   * Cleanup runs ONLY in the dedicated maintenance worker process, which sets
   * MAINTENANCE_WORKER=true on startup. API instances leave it unset, so they
   * never execute these deletes.
   */
  private isEnabled(): boolean {
    return process.env.MAINTENANCE_WORKER === 'true';
  }

  private daysAgo(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }

  /**
   * 1) Permanently delete notifications the user has deleted (soft-deleted,
   *    `deletedAt` is set) once they are older than 30 days — daily 02:00.
   *
   *    This is a hard SQL DELETE (QueryBuilder bypasses soft-delete) that only
   *    targets already soft-deleted rows; notifications the user still sees are
   *    never touched.
   */
  @Cron('0 2 * * *')
  async purgeUserDeletedNotifications(): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      const result = await this.notificationRepo
        .createQueryBuilder()
        .delete()
        .from(Notification)
        .where('deleted_at IS NOT NULL')
        .andWhere('deleted_at < :cutoff', { cutoff: this.daysAgo(30) })
        .execute();
      winstonLogger.info(`Purged ${result.affected ?? 0} user-deleted notification(s)`, LOG_META);
    } catch (error) {
      winstonLogger.error(`purgeUserDeletedNotifications failed: ${(error as Error).message}`, {
        ...LOG_META,
        stack: (error as Error).stack,
      });
    }
  }

  /**
   * 2) Delete unverified "ghost" accounts older than 24h that have no cart
   *    items — daily 03:00. An empty cart (if one exists) is removed with the
   *    account.
   */
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
      winstonLogger.info(`Deleted ${deleted} ghost account(s)`, LOG_META);
    } catch (error) {
      winstonLogger.error(`cleanupGhostAccounts failed: ${(error as Error).message}`, {
        ...LOG_META,
        stack: (error as Error).stack,
      });
    }
  }
}
