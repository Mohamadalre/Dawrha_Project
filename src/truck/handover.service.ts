import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import { TruckHandover } from './entities/truck-handover.entity';
import { TruckAssignmentEntity } from './entities/truck-assignment.entity';
import { HandoverStatus } from './enums/handover-status.enum';
import { TruckStatus } from './enums/truck-status.enum';
import { resolveShiftWindow } from './shift-window.util';
import { TruckTrackingGateway } from './tracking/truck-tracking.gateway';
import { StopReason } from './tracking/enums/stop-reason.enum';
import {
  DriverHasNoTruckException,
  DriverInactiveException,
  DriverNotFoundException,
  DropoffBeforeShiftEndException,
  DropoffReasonRequiredException,
  NoOpenHandoverException,
  PickupAfterShiftException,
  PickupBeforeShiftException,
  TruckAlreadyHeldException,
  TruckDisabledException,
  TruckHeldByOtherException,
} from './exceptions/truck.exceptions';

/** GPS the app captures when the driver presses pick up / hand over. */
export interface HandoverCoords {
  lat?: number;
  lng?: number;
}

/**
 * A pair is stored only when BOTH halves are present — a lone latitude is not a
 * location. Decimals as strings, matching the entity's `decimal` columns.
 */
function normalizeCoords(coords?: HandoverCoords): { lat: string | null; lng: string | null } {
  if (coords?.lat != null && coords?.lng != null) {
    return { lat: String(coords.lat), lng: String(coords.lng) };
  }
  return { lat: null, lng: null };
}

/** Shapes a stored decimal pair back into a response object, or null. */
function coordsOf(lat?: string | null, lng?: string | null): { lat: number; lng: number } | null {
  if (lat == null || lng == null) return null;
  return { lat: Number(lat), lng: Number(lng) };
}

/**
 * Driver truck-handover (pickup / dropoff). Two timestamped buttons, guarded by
 * the driver's shift window — no QR, no GPS:
 *
 * - Pickup: only from shift start (not before), account ACTIVE, assigned to a
 *   truck, truck in service, and not still held by the previous driver.
 * - Dropoff: only AFTER shift end — EXCEPT when the truck is out of service
 *   (then any time). A note about the truck is mandatory before handing it back.
 *
 * Each action mirrors to Odoo where the warehouse manager reads it in the
 * read-only "Driver Attendance" screen.
 */
@Injectable()
export class HandoverService {
  constructor(
    @InjectRepository(TruckHandover)
    private readonly handoverRepo: Repository<TruckHandover>,
    @InjectRepository(CollectorProfile)
    private readonly driverRepo: Repository<CollectorProfile>,
    @InjectRepository(TruckAssignmentEntity)
    private readonly assignmentRepo: Repository<TruckAssignmentEntity>,
    private readonly odooSync: OdooSyncService,
    // Live tracking turns ON at pickup and OFF at dropoff — the handover is the
    // single source of truth for whether a truck is "in operation".
    private readonly tracking: TruckTrackingGateway,
  ) {}

  private async getDriver(accountId: string): Promise<CollectorProfile> {
    const driver = await this.driverRepo.findOne({
      where: { account: { id: accountId } },
      relations: ['account', 'shift', 'warehouse'],
    });
    if (!driver) throw new DriverNotFoundException('Driver profile not found');
    if (driver.account?.accountStatus !== AccountStatus.ACTIVE) {
      throw new DriverInactiveException();
    }
    return driver;
  }

  private serialize(h: TruckHandover, truckPlate?: string) {
    return {
      handover_id: h.id,
      status: h.status,
      truck: h.truckId ? { truck_id: h.truckId, plate_number: truckPlate ?? null } : null,
      shift_id: h.shiftId,
      work_date: h.workDate,
      picked_up_at: h.pickedUpAt ?? null,
      pickup_location: coordsOf(h.pickupLat, h.pickupLng),
      dropped_off_at: h.droppedOffAt ?? null,
      dropoff_location: coordsOf(h.dropoffLat, h.dropoffLng),
      dropoff_reason: h.dropoffReason ?? null,
      late_dropoff_minutes: h.lateDropoffMinutes ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Current status (what the app shows on the pickup/dropoff screen)
  // ---------------------------------------------------------------------------
  async status(accountId: string) {
    const driver = await this.getDriver(accountId);
    const open = await this.handoverRepo.findOne({
      where: { driverId: driver.id, status: HandoverStatus.OPEN },
      relations: ['truck'],
      order: { createdAt: 'DESC' },
    });
    const assignment = await this.assignmentRepo.findOne({
      where: { driverId: driver.id },
      relations: ['truck'],
    });
    return {
      message: 'Handover status fetched successfully',
      holding: !!open,
      current: open ? this.serialize(open, open.truck?.plateNumber) : null,
      assigned_truck: assignment?.truck
        ? { truck_id: assignment.truck.id, plate_number: assignment.truck.plateNumber }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Admin: a truck's handover sessions (its trips) — start + end points
  // ---------------------------------------------------------------------------
  /**
   * The completed and in-progress trips of one truck, newest first, for the
   * admin tracking dashboard. Each session carries WHO drove it and the trip's
   * START (pickup point + time) and END (dropoff point + time + note) — the two
   * ends the live position and last-stop views do not, on their own, tell.
   */
  async listForTruck(truckId: string, page: number, limit: number) {
    const [rows, total] = await this.handoverRepo.findAndCount({
      where: { truckId },
      relations: ['driver', 'driver.account', 'shift'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      handovers: rows.map((h) => this.serializeForAdmin(h)),
      pagination: buildPagination(total, page, limit),
    };
  }

  /** One trip as the admin reads it: driver + start point + end point. */
  private serializeForAdmin(h: TruckHandover) {
    const driverAccount = (h as any).driver?.account;
    return {
      handover_id: h.id,
      status: h.status,
      driver: (h as any).driver
        ? { driver_id: h.driverId, name: driverAccount?.name ?? null }
        : { driver_id: h.driverId, name: null },
      shift_id: h.shiftId,
      work_date: h.workDate,
      // The trip's two ends, each as one object (or null when it hasn't happened).
      start: h.pickedUpAt
        ? { at: h.pickedUpAt, location: coordsOf(h.pickupLat, h.pickupLng) }
        : null,
      end: h.droppedOffAt
        ? {
            at: h.droppedOffAt,
            location: coordsOf(h.dropoffLat, h.dropoffLng),
            reason: h.dropoffReason ?? null,
          }
        : null,
      late_dropoff_minutes: h.lateDropoffMinutes ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Pickup
  // ---------------------------------------------------------------------------
  async pickup(accountId: string, coords?: HandoverCoords) {
    const driver = await this.getDriver(accountId);

    const assignment = await this.assignmentRepo.findOne({
      where: { driverId: driver.id },
      relations: ['truck', 'shift'],
    });
    if (!assignment?.truck) throw new DriverHasNoTruckException();
    const truck = assignment.truck;
    const shift = assignment.shift ?? driver.shift;

    // Cannot pick up a truck that is out of service.
    if (truck.status === TruckStatus.DISABLED) {
      throw new TruckDisabledException('This truck is out of service and cannot be picked up');
    }

    const now = new Date();
    const win = resolveShiftWindow(shift, now);
    // Not before shift start; not after shift end (his window is over).
    if (now.getTime() < win.start.getTime()) throw new PickupBeforeShiftException();
    if (now.getTime() > win.end.getTime() + win.toleranceMs) throw new PickupAfterShiftException();

    // He may not already hold a truck.
    const alreadyOpen = await this.handoverRepo.findOne({
      where: { driverId: driver.id, status: HandoverStatus.OPEN },
    });
    if (alreadyOpen) throw new TruckAlreadyHeldException();

    // The physical truck must not still be held by the previous shift's driver.
    const heldByOther = await this.handoverRepo.findOne({
      where: { truckId: truck.id, status: HandoverStatus.OPEN, driverId: Not(driver.id) },
    });
    if (heldByOther) throw new TruckHeldByOtherException();

    // Convert a MISSED_PICKUP marker for today into an OPEN session, else create.
    let h = await this.handoverRepo.findOne({
      where: { driverId: driver.id, shiftId: shift.id, workDate: win.workDate },
    });
    if (h && h.status === HandoverStatus.CLOSED) {
      // Already completed a session for this shift/day.
      throw new TruckAlreadyHeldException();
    }
    const pickup = normalizeCoords(coords);
    if (h) {
      h.status = HandoverStatus.OPEN;
      h.pickedUpAt = now;
      h.pickupLat = pickup.lat;
      h.pickupLng = pickup.lng;
      h.truckId = truck.id;
      h.warehouseId = truck.warehouseId ?? driver.warehouseId ?? null;
    } else {
      h = this.handoverRepo.create({
        driverId: driver.id,
        truckId: truck.id,
        shiftId: shift.id,
        warehouseId: truck.warehouseId ?? driver.warehouseId ?? null,
        workDate: win.workDate,
        pickedUpAt: now,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        status: HandoverStatus.OPEN,
      });
    }
    await this.handoverRepo.save(h);
    await this.odooSync.enqueuePushHandoverPickup({ handoverId: h.id });

    // Tracking becomes live now: the admin map may show this truck the moment
    // its session opens, even before the first coordinate arrives. Best-effort —
    // the handover is already saved, so a socket hiccup must not fail the pickup.
    try {
      this.tracking.announceSessionStarted({
        truckId: truck.id,
        driverId: driver.id,
        plateNumber: truck.plateNumber ?? null,
      });
    } catch {
      /* the truck is picked up regardless; its first ping will surface it */
    }

    return {
      message: 'Truck picked up successfully',
      handover_id: h.id,
      picked_up_at: h.pickedUpAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Dropoff
  // ---------------------------------------------------------------------------
  async dropoff(accountId: string, reason: string, coords?: HandoverCoords) {
    const driver = await this.getDriver(accountId);

    const note = (reason || '').trim();
    if (!note) throw new DropoffReasonRequiredException();

    const h = await this.handoverRepo.findOne({
      where: { driverId: driver.id, status: HandoverStatus.OPEN },
      relations: ['truck', 'shift'],
      order: { createdAt: 'DESC' },
    });
    if (!h) throw new NoOpenHandoverException();

    const now = new Date();
    const win = resolveShiftWindow(h.shift, now);
    const truckDisabled = h.truck?.status === TruckStatus.DISABLED;

    // Only after shift end — unless the truck is out of service (then any time).
    if (!truckDisabled && now.getTime() < win.end.getTime()) {
      throw new DropoffBeforeShiftEndException();
    }

    const overdueMs = now.getTime() - (win.end.getTime() + win.toleranceMs);
    const lateMinutes = overdueMs > 0 ? Math.round(overdueMs / 60000) : 0;

    const dropoff = normalizeCoords(coords);
    h.droppedOffAt = now;
    h.dropoffLat = dropoff.lat;
    h.dropoffLng = dropoff.lng;
    h.dropoffReason = note;
    h.lateDropoffMinutes = lateMinutes;
    h.status = HandoverStatus.CLOSED;
    await this.handoverRepo.save(h);
    await this.odooSync.enqueuePushHandoverDropoff({ handoverId: h.id });

    // The session is over: stop tracking this truck, persist its last position
    // as a stop, and tell subscribers it is no longer live. Best-effort — the
    // handover is already CLOSED, and the inactivity cron finalises the stop as a
    // backstop, so a Redis blip here must not fail the truck handback.
    try {
      await this.tracking.endSession(h.truckId, StopReason.HANDOVER_DROPOFF);
    } catch {
      /* the truck is handed back regardless; the inactivity cron retires it */
    }

    return {
      message: 'Truck handed back successfully',
      handover_id: h.id,
      dropped_off_at: h.droppedOffAt,
      late_dropoff_minutes: lateMinutes,
    };
  }
}
