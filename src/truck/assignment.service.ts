import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { Shift } from '@src/shift/entities/shift.entity';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { TruckEntity } from './entities/truck.entity';
import { TruckAssignmentEntity } from './entities/truck-assignment.entity';
import { TruckStatus } from './enums/truck-status.enum';
import { AssignDriverDto } from './dto/assign-driver.dto';
import {
  AssignmentShiftNotFoundException,
  DriverAlreadyAssignedException,
  DriverNotFoundException,
  NoAssignmentException,
  TruckDisabledException,
  TruckFullyBusyException,
  TruckNotFoundException,
  TruckShiftTakenException,
} from './exceptions/truck.exceptions';

/**
 * Owns the driver↔truck assignment table ("kasr") and keeps each truck's derived
 * status in sync (active / busy_one_driver / fully_busy). A truck has one driver
 * per shift, so its capacity equals the number of shifts.
 */
@Injectable()
export class AssignmentService {
  constructor(
    @InjectRepository(TruckEntity)
    private readonly truckRepo: Repository<TruckEntity>,
    @InjectRepository(TruckAssignmentEntity)
    private readonly assignmentRepo: Repository<TruckAssignmentEntity>,
    @InjectRepository(CollectorProfile)
    private readonly driverRepo: Repository<CollectorProfile>,
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    private readonly notifications: NotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Assign
  // ---------------------------------------------------------------------------
  async assign(dto: AssignDriverDto) {
    const { truckId, driverId } = dto;

    const truck = await this.truckRepo.findOne({ where: { id: truckId } });
    if (!truck) throw new TruckNotFoundException();
    if (truck.status === TruckStatus.DISABLED) {
      throw new TruckDisabledException();
    }
    if (truck.status === TruckStatus.FULLY_BUSY) {
      throw new TruckFullyBusyException();
    }



    const driver = await this.driverRepo.findOne({
      where: { id: driverId },
      relations: ['account', 'assignment'],
    });
    if (!driver) throw new DriverNotFoundException();
    if (driver.assignment) {
      throw new DriverAlreadyAssignedException();
    }
    const shift = await this.shiftRepo.findOne({ where: { id: driver.shiftId } });
    if (!shift) throw new AssignmentShiftNotFoundException();
    const shiftId = shift.id;
    const taken = await this.assignmentRepo.findOne({ where: { truckId, shiftId } });
    if (taken) {
      throw new TruckShiftTakenException();
    }

    const assignment = this.assignmentRepo.create({
      truckId,
      driverId,
      shiftId,
      assignedAt: new Date(),
    });
    await this.assignmentRepo.save(assignment);
    await this.recomputeStatus(truckId);

    if (driver.account?.id) {
      await this.notifyAssigned(driver.account.id, truck.plateNumber);
    }

    return {
      assignment_id: assignment.id,
      truck_id: truckId,
      driver_id: driverId,
      shift_id: shiftId,
      message: 'Driver assigned to truck successfully',
    };
  }

  // ---------------------------------------------------------------------------
  // Unassign
  // ---------------------------------------------------------------------------
  async unassign(driverId: string) {
    const driver = await this.driverRepo.findOne({ where: { id: driverId } });
    if (!driver) throw new DriverNotFoundException();
    const assignment = await this.assignmentRepo.findOne({ where: { driverId } });
    if (!assignment) throw new NoAssignmentException();

    const { truckId } = assignment;
    await this.assignmentRepo.delete(assignment.id);
    await this.recomputeStatus(truckId);

    return { driver_id: driverId, message: 'Driver assignment removed successfully' };
  }

  // ---------------------------------------------------------------------------
  // Driver's own assignment (no images)
  // ---------------------------------------------------------------------------
  async getMyAssignment(accountId: string) {
    const driver = await this.driverRepo.findOne({
      where: { account: { id: accountId } },
      relations: [
        'assignment',
        'assignment.truck',
        'assignment.truck.warehouse',
        'assignment.shift',
      ],
    });
    if (!driver) throw new DriverNotFoundException('Driver profile not found');

    if (!driver.assignment) {
      return { assigned: false, message: 'You will be assigned to a truck soon' };
    }

    const t = driver.assignment.truck;
    const s = driver.assignment.shift;
    const w = t.warehouse ?? null;
    return {
      assigned: true,
      message: 'Assignment fetched successfully',
      truck: {
        truck_id: t.id,
        plate_number: t.plateNumber,
        model: t.model,
        year: t.year,
        max_payload_kg: t.maxPayloadKg != null ? Number(t.maxPayloadKg) : null,
      },
      // The warehouse the TRUCK serves (assigned in Odoo) — id + name so the
      // app can show where the driver reports to.
      warehouse: w
        ? { warehouse_id: w.id, odoo_warehouse_id: w.odooWarehouseId ?? null, name: w.name }
        : null,
      shift: { shift_id: s.id, name: s.name, start_time: s.startTime, end_time: s.endTime },
      assigned_at: driver.assignment.assignedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals (also used by the shift-change processor in phase 4)
  // ---------------------------------------------------------------------------
  /** Recomputes a truck's derived status from its current assignment count. */
  async recomputeStatus(truckId: string): Promise<void> {
    const truck = await this.truckRepo.findOne({ where: { id: truckId } });
    if (!truck) return;
    if (truck.status === TruckStatus.DISABLED) return; // never override a manual disable

    const count = await this.assignmentRepo.count({ where: { truckId } });
    const capacity = await this.shiftRepo.count();

    truck.status =
      count === 0
        ? TruckStatus.ACTIVE
        : count >= capacity
          ? TruckStatus.FULLY_BUSY
          : TruckStatus.BUSY_ONE_DRIVER;
    await this.truckRepo.save(truck);
  }

  private async notifyAssigned(accountId: string, plate: string): Promise<void> {
    try {
      const n = await this.notifications.createNotification({
        userId: accountId,
        title: 'Truck assigned',
        body: `You have been assigned to truck "${plate}".`,
        titleKey: 'notifications.truckAssigned.title',
        bodyKey: 'notifications.truckAssigned.body',
        args: { plate },
        type: NotificationType.GENERAL,
      });
      await this.notifications.enqueueNotification(n.id);
    } catch (error) {
      // A notification failure must not roll back the assignment.
      winstonLogger.error(`Failed to notify driver of truck assignment: ${(error as Error).message}`, {
        context: 'AssignmentService',
        channel: 'jobs',
      });
    }
  }
}
