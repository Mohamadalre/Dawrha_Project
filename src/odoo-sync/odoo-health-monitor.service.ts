import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OdooService } from '@src/odoo/odoo.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'ODOO_HEALTH', channel: 'sync' } as const;

/**
 * Watches the backend↔Odoo connection and RAISES AN ALERT when it drops.
 *
 * Every minute it makes one cheap, real call to Odoo. The alert is an EDGE
 * signal, not a repeat: it fires ONCE when the link goes down (an ERROR log
 * carrying the `ODOO_UNREACHABLE` marker that an external monitor turns into
 * email/Slack), and again — as a recovery notice — when it comes back. That
 * keeps a long outage from spamming one line every minute while still telling
 * operations the moment it breaks and the moment it heals.
 *
 * Deliberately no admin/in-app notification: a dropped infrastructure link is
 * an operations concern the app's business admin cannot act on. It belongs in
 * the ops log stream, where alerting lives.
 */
@Injectable()
export class OdooHealthMonitorService {
  /**
   * Optimistic start: assume healthy, so the first probe only speaks up if it
   * FAILS. A false→true edge on a truly-first-run would otherwise log a
   * "recovered" for a link that was never reported down.
   */
  private healthy = true;

  constructor(private readonly odoo: OdooService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async check(): Promise<void> {
    let reachable: boolean;
    try {
      reachable = await this.odoo.isReachable();
    } catch {
      // isReachable already swallows errors; this is a belt for the unexpected.
      reachable = false;
    }

    if (!reachable && this.healthy) {
      // Healthy -> DOWN : raise the alert once.
      this.healthy = false;
      winstonLogger.error(
        'Backend cannot reach Odoo — sync (webhooks, pushes, reconcile) is stalled until it recovers.',
        { ...LOG_META, alert: 'ODOO_UNREACHABLE' },
      );
    } else if (reachable && !this.healthy) {
      // DOWN -> healthy : recovery notice.
      this.healthy = true;
      winstonLogger.info('Odoo connection recovered — sync resumed.', {
        ...LOG_META,
        alert: 'ODOO_RECOVERED',
      });
    }
  }
}
