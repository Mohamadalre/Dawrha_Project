import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { Shift, ShiftType } from '@src/shift/entities/shift.entity';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { ShiftChangeRequest } from './entities/shift-change-request.entity';
import { TruckAssignmentEntity } from './entities/truck-assignment.entity';
import { ShiftChangeRequestStatus } from './enums/shift-change-request-status.enum';
import { CreateShiftChangeRequestDto } from './dto/shift-change-request.dto';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import {
  ActiveShiftChangeExistsException,
  AssignmentShiftNotFoundException,
  DriverHasNoTruckException,
  DriverInactiveException,
  DriverNotFoundException,
  NotYourRequestException,
  SameShiftRequestException,
  ShiftChangeRequestNotFoundException,
  ShiftChangeStateException,
  ShiftNotInYourWarehouseException,
} from './exceptions/truck.exceptions';

const ACTIVE_STATES = [ShiftChangeRequestStatus.PENDING, ShiftChangeRequestStatus.PROCESSING];

/**
 * Driver-facing shift-change requests (v2 — the WAREHOUSE MANAGER decides in
 * Odoo, not the admin):
 *
 * - Submit: only an ACTIVE driver who ALREADY HAS a truck may ask to move to
 *   a DIFFERENT driver shift OF HIS OWN WAREHOUSE, with a mandatory reason.
 * - The request is mirrored to Odoo (queued push) where his manager moves it
 *   pending → processing → accepted-with-a-truck / rejected; every move
 *   returns through the shift-change-decision webhook.
 * - The driver may list his requests (newest first) and cancel one ONLY
 *   while it is still PENDING — cancelling deletes it on BOTH sides.
 */
@Injectable()
export class ShiftChangeRequestService {
  constructor(
    @InjectRepository(ShiftChangeRequest)
    private readonly requestRepo: Repository<ShiftChangeRequest>,
    @InjectRepository(CollectorProfile)
    private readonly driverRepo: Repository<CollectorProfile>,
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(TruckAssignmentEntity)
    private readonly assignmentRepo: Repository<TruckAssignmentEntity>,
    private readonly odooSync: OdooSyncService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private async getProfile(accountId: string): Promise<CollectorProfile> {
    const profile = await this.driverRepo.findOne({
      where: { account: { id: accountId } },
      relations: ['account', 'warehouse'],
    });
    if (!profile) throw new DriverNotFoundException('Driver profile not found');
    return profile;
  }

  private assertActive(profile: CollectorProfile): void {
    if (profile.account?.accountStatus !== AccountStatus.ACTIVE) {
      throw new DriverInactiveException();
    }
  }

  private toResponse(r: ShiftChangeRequest) {
    return {
      request_id: r.id,
      status: r.status,
      reason: r.reason ?? null,
      requested_shift: r.shift
        ? {
            shift_id: r.shift.id,
            name: r.shift.name,
            start_time: r.shift.startTime,
            end_time: r.shift.endTime,
          }
        : null,
      truck: r.truck ? { truck_id: r.truck.id, plate_number: r.truck.plateNumber } : null,
      rejection_reason: r.rejectionReason ?? null,
      created_at: r.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // The shifts a driver may request (his warehouse's driver shifts, not his own)
  // ---------------------------------------------------------------------------
  async availableShifts(accountId: string) {
    const profile = await this.getProfile(accountId);
    this.assertActive(profile);

    const all = await this.shiftRepo.find({
      where: { shiftType: ShiftType.DRIVER, isActive: true },
      order: { name: 'ASC' },
    });
    const myWarehouseOdooId = profile.warehouse?.odooWarehouseId ?? null;
    const shifts = all.filter(
      (s) =>
        s.id !== profile.shiftId &&
        // Global shifts + the ones scoped to his own warehouse.
        (s.isGlobal ||
          (myWarehouseOdooId != null &&
            (s.odooWarehouseIds ?? []).includes(myWarehouseOdooId))),
    );

    return {
      message: 'Shifts fetched successfully',
      shifts: shifts.map((s) => ({
        shift_id: s.id,
        name: s.name,
        start_time: s.startTime,
        end_time: s.endTime,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  async create(accountId: string, dto: CreateShiftChangeRequestDto) {
    const profile = await this.getProfile(accountId);
    this.assertActive(profile);

    // Must already be assigned to a truck (truckless drivers get their first
    // truck through the manager's assign-driver-to-truck screen instead).
    const assignment = await this.assignmentRepo.findOne({
      where: { driverId: profile.id },
    });
    if (!assignment) throw new DriverHasNoTruckException();

    const existing = await this.requestRepo.findOne({
      where: { driverId: profile.id, status: In(ACTIVE_STATES) },
    });
    if (existing) throw new ActiveShiftChangeExistsException();

    const shift = await this.shiftRepo.findOne({ where: { id: dto.shiftId } });
    if (!shift || shift.shiftType !== ShiftType.DRIVER || !shift.isActive) {
      throw new AssignmentShiftNotFoundException();
    }
    if (shift.id === profile.shiftId) throw new SameShiftRequestException();

    const myWarehouseOdooId = profile.warehouse?.odooWarehouseId ?? null;
    const inMyWarehouse =
      myWarehouseOdooId != null &&
      (shift.odooWarehouseIds ?? []).includes(myWarehouseOdooId);
    if (!shift.isGlobal && !inMyWarehouse) {
      throw new ShiftNotInYourWarehouseException();
    }

    const request = this.requestRepo.create({
      driverId: profile.id,
      shiftId: shift.id,
      reason: dto.reason.trim(),
      status: ShiftChangeRequestStatus.PENDING,
    });
    await this.requestRepo.save(request);

    // Mirror it to Odoo where the driver's warehouse manager decides.
    await this.odooSync.enqueuePushShiftChange({ requestId: request.id });

    return {
      message: 'Shift-change request submitted successfully',
      request_id: request.id,
      status: request.status,
    };
  }

  // ---------------------------------------------------------------------------
  // My requests (newest first)
  // ---------------------------------------------------------------------------
  /**
   * EVERY shift-change request this driver has ever filed — any status —
   * newest first and paginated, so his history screen can scroll without
   * pulling years of rows at once.
   */
  async listMine(accountId: string, page = 1, limit = 10) {
    const profile = await this.getProfile(accountId);
    const [requests, total] = await this.requestRepo.findAndCount({
      where: { driverId: profile.id },
      relations: ['shift', 'truck'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      message: 'Requests fetched successfully',
      requests: requests.map((r) => this.toResponse(r)),
      pagination: buildPagination(total, page, limit),
    };
  }

  // ---------------------------------------------------------------------------
  // Cancel (PENDING only — deletes the Odoo mirror too)
  // ---------------------------------------------------------------------------
  async cancel(accountId: string, requestId: string) {
    const profile = await this.getProfile(accountId);
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new ShiftChangeRequestNotFoundException();
    if (request.driverId !== profile.id) throw new NotYourRequestException();
    if (request.status !== ShiftChangeRequestStatus.PENDING) {
      throw new ShiftChangeStateException(
        'Only pending requests can be cancelled',
      );
    }

    // Remove the Odoo mirror first (queued; Odoo's cancel action is
    // idempotent and unlinks only still-pending rows), then the local row.
    await this.odooSync.enqueueCancelShiftChange({ backendRequestId: request.id });
    await this.requestRepo.delete(request.id);

    return { message: 'Request cancelled successfully', request_id: requestId };
  }
}
