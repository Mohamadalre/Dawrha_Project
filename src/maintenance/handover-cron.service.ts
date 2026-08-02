import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { HandoverStatus } from '@src/truck/enums/handover-status.enum';
import { resolveShiftWindow } from '@src/truck/shift-window.util';
import { ShiftType } from '@src/shift/entities/shift.entity';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { OdooService } from '@src/odoo/odoo.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'HANDOVER_CRON', channel: 'jobs' } as const;

/**
 * Watches the handover state and fires the two shift alerts (worker-only):
 *
 *  - Shift STARTED (+ tolerance) and the driver has NOT picked up his truck →
 *    notify the driver AND his warehouse manager.
 *  - Shift ENDED (+ tolerance) and he has NOT handed it back → notify both,
 *    with the delay minutes computed from the shift's tolerance margin.
 *
 * Each alert fires ONCE — the (driver, shift, day) handover row carries the
 * notification guards. The driver is notified over FCM here; the manager is
 * notified in Odoo (fire-and-forget) since managers live there.
 */
@Injectable()
export class HandoverCronService {
  constructor(
    @InjectRepository(TruckHandover)
    private readonly handoverRepo: Repository<TruckHandover>,
    @InjectRepository(TruckAssignmentEntity)
    private readonly assignmentRepo: Repository<TruckAssignmentEntity>,
    private readonly notifications: NotificationService,
    private readonly odoo: OdooService,
  ) {}

  private isEnabled(): boolean {
    return process.env.MAINTENANCE_WORKER === 'true';
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkHandovers(): Promise<void> {
    if (!this.isEnabled()) return;
    const now = new Date();
    try {
      // Every driver who currently holds a truck assignment on a driver shift.
      const assignments = await this.assignmentRepo.find({
        relations: ['driver', 'driver.account', 'shift'],
      });
      for (const a of assignments) {
        const driver = a.driver;
        const shift = a.shift;
        if (!driver?.account || !shift || shift.shiftType !== ShiftType.DRIVER) continue;
        if (shift.isActive === false) continue;

        const win = resolveShiftWindow(shift, now);
        const row = await this.handoverRepo.findOne({
          where: { driverId: driver.id, shiftId: shift.id, workDate: win.workDate },
        });

        const started = now.getTime() >= win.start.getTime() + win.toleranceMs;
        const beforeEnd = now.getTime() <= win.end.getTime();
        const ended = now.getTime() > win.end.getTime() + win.toleranceMs;

        // 1) Missed pickup: shift running, never picked up, not yet alerted.
        const noPickup = !row || (!row.pickedUpAt && row.status !== HandoverStatus.OPEN);
        const alreadyMissAlerted = row?.missedPickupNotifiedAt != null;
        if (started && beforeEnd && noPickup && !alreadyMissAlerted) {
          await this.markMissedPickup(driver, shift, win.workDate, a.truckId);
          continue;
        }

        // 2) Late dropoff: still holding after shift end + tolerance, not alerted.
        if (row && row.status === HandoverStatus.OPEN && ended && row.lateDropoffNotifiedAt == null) {
          const lateMinutes = Math.round(
            (now.getTime() - (win.end.getTime() + win.toleranceMs)) / 60000,
          );
          await this.markLateDropoff(row, shift.name, lateMinutes, driver.account.id, driver.id);
        }
      }
    } catch (error) {
      winstonLogger.error(`checkHandovers failed: ${(error as Error).message}`, {
        ...LOG_META,
        stack: (error as Error).stack,
      });
    }
  }

  private async markMissedPickup(
    driver: TruckAssignmentEntity['driver'],
    shift: TruckAssignmentEntity['shift'],
    workDate: string,
    truckId: string,
  ): Promise<void> {
    // Persist a MISSED_PICKUP marker (idempotency guard) then notify both sides.
    let row = await this.handoverRepo.findOne({
      where: { driverId: driver.id, shiftId: shift.id, workDate },
    });
    if (!row) {
      row = this.handoverRepo.create({
        driverId: driver.id,
        truckId,
        shiftId: shift.id,
        warehouseId: driver.warehouseId ?? null,
        workDate,
        status: HandoverStatus.MISSED_PICKUP,
        pickedUpAt: null,
      });
    }
    row.missedPickupNotifiedAt = new Date();
    await this.handoverRepo.save(row);

    await this.notifyDriver(
      driver.account.id,
      'You have not picked up your truck',
      `Your shift "${shift.name}" has started but you have not picked up your truck yet.`,
      'notifications.handoverMissedPickup.title',
      'notifications.handoverMissedPickup.body',
      { shift: shift.name },
    );
    await this.notifyManager(driver.id, 'MISSED_PICKUP', shift.name, 0);
  }

  private async markLateDropoff(
    row: TruckHandover,
    shiftName: string,
    lateMinutes: number,
    accountId: string,
    driverId: string,
  ): Promise<void> {
    row.lateDropoffNotifiedAt = new Date();
    await this.handoverRepo.save(row);

    await this.notifyDriver(
      accountId,
      'You have not handed your truck back',
      `Your shift "${shiftName}" ended ${lateMinutes} minute(s) ago and you have not handed the truck back.`,
      'notifications.handoverLateDropoff.title',
      'notifications.handoverLateDropoff.body',
      { shift: shiftName, minutes: lateMinutes },
    );
    await this.notifyManager(driverId, 'LATE_DROPOFF', shiftName, lateMinutes);
  }

  private async notifyDriver(
    accountId: string,
    title: string,
    body: string,
    titleKey: string,
    bodyKey: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    try {
      const n = await this.notifications.createNotification({
        userId: accountId,
        title,
        body,
        titleKey,
        bodyKey,
        args,
        type: NotificationType.GENERAL,
      });
      await this.notifications.enqueueNotification(n.id);
    } catch (error) {
      winstonLogger.warn(`Handover driver notify failed: ${(error as Error).message}`, LOG_META);
    }
  }

  private async notifyManager(
    backendDriverId: string,
    kind: 'MISSED_PICKUP' | 'LATE_DROPOFF',
    shiftName: string,
    lateMinutes: number,
  ): Promise<void> {
    try {
      await this.odoo.notifyHandoverAlertManager({
        backendDriverId,
        kind,
        shiftName,
        lateMinutes,
      });
    } catch (error) {
      // Fire-and-forget: an unreachable Odoo must not break the cron.
      winstonLogger.warn(`Handover manager notify failed: ${(error as Error).message}`, LOG_META);
    }
  }
}
