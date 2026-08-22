import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { HandoverService } from '@src/truck/handover.service';
import { HandoverStatus } from '@src/truck/enums/handover-status.enum';
import { resolveShiftWindow } from '@src/truck/shift-window.util';

/**
 * Turnover between a driver's shifts: when his shift window is over but he
 * still holds the truck (no one dropped off), close the session FOR him and
 * try to open the next shift's session immediately — so the truck never idles
 * between morning and evening rounds.
 *
 * Purely a swapper: the fleet and its assignments are Odoo's to author, and the
 * mirror follows SYNC_FLEET pings. If the mirror still shows the old shift,
 * the pickup attempt below fails with the usual window errors and the driver
 * simply starts the next shift himself when the app shows it — closing the
 * stale handover is the part that MUST happen here.
 */
@Injectable()
export class ShiftSwapperCron {
  private readonly logger = new Logger('SHIFT_SWAPPER');

  constructor(
    @InjectRepository(TruckHandover)
    private readonly handoverRepo: Repository<TruckHandover>,
    private readonly handovers: HandoverService,
  ) {}

  @Cron('0 */15 * * * *')
  async swap(): Promise<void> {
    const now = new Date();
    const rows = await this.handoverRepo.find({
      where: { status: HandoverStatus.OPEN },
      relations: ['driver', 'driver.account', 'shift'],
    });

    for (const h of rows) {
      const shift = h.shift;
      const driver = h.driver;
      if (!shift || !driver) continue;

      const win = resolveShiftWindow(shift, now);
      // Still inside the window (tolerance included): the driver may simply be
      // finishing the round late — do not cut him off.
      if (now.getTime() <= win.end.getTime() + win.toleranceMs) continue;

      try {
        h.status = HandoverStatus.CLOSED;
        h.droppedOffAt = now;
        h.dropoffReason = 'SHIFT_ROTATION';
        await this.handoverRepo.save(h);
        this.logger.log(
          `Shift of driver ${driver.id} ended: handover ${h.id} closed (rotation)`,
        );

        // Open the next shift's session the moment it is due; failures here
        // (next shift not started, truck already held, ...) are expected.
        const account = driver.account;
        if (account) {
          await this.handovers.pickup(account.id).catch((e) => {
            this.logger.log(
              `Next-shift pickup for driver ${driver.id} deferred: ${e instanceof Error ? e.message : e}`,
            );
          });
        }
      } catch (error) {
        this.logger.warn(
          `Could not rotate handover ${h.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }
}