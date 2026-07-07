import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { Shift } from '@src/shift/entities/shift.entity';
import { buildPagination, PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { TruckEntity } from './entities/truck.entity';
import { TruckAssignmentEntity } from './entities/truck-assignment.entity';
import { ShiftChangeRequest } from './entities/shift-change-request.entity';
import { ShiftChangeRequestStatus } from './enums/shift-change-request-status.enum';
import { TruckStatus } from './enums/truck-status.enum';
import { AssignmentService } from './assignment.service';
import {
  CreateShiftChangeRequestDto,
  ProcessRequestDto,
  UpdateRequestStatusDto,
} from './dto/shift-change-request.dto';

const ACTIVE_STATES = [ShiftChangeRequestStatus.PENDING, ShiftChangeRequestStatus.PROCESSING];

@Injectable()
export class ShiftChangeRequestService {
  constructor(
    @InjectRepository(ShiftChangeRequest)
    private readonly requestRepo: Repository<ShiftChangeRequest>,
    @InjectRepository(CollectorProfile)
    private readonly driverRepo: Repository<CollectorProfile>,
    @InjectRepository(TruckEntity)
    private readonly truckRepo: Repository<TruckEntity>,
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(TruckAssignmentEntity)
    private readonly assignmentRepo: Repository<TruckAssignmentEntity>,
    private readonly assignmentService: AssignmentService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Driver
  // ---------------------------------------------------------------------------
  async create(accountId: string, dto: CreateShiftChangeRequestDto) {
    const driver = await this.driverRepo.findOne({
      where: { account: { id: accountId } },
      relations: ['account'],
    });
    if (!driver) throw new NotFoundException('Driver profile not found');
    if (driver.account.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException('Your account must be active to request a shift change');
    }

    const active = await this.requestRepo.findOne({
      where: { driverId: driver.id, status: In(ACTIVE_STATES) },
    });
    if (active) throw new ConflictException('You already have an active shift-change request');

    const truck = await this.truckRepo.findOne({ where: { id: dto.truckId } });
    if (!truck) throw new NotFoundException('Truck not found');
    const shift = await this.shiftRepo.findOne({ where: { id: dto.shiftId } });
    if (!shift) throw new BadRequestException('Shift not found');

    const request = await this.requestRepo.save(
      this.requestRepo.create({
        driverId: driver.id,
        truckId: dto.truckId,
        shiftId: dto.shiftId,
        status: ShiftChangeRequestStatus.PENDING,
      }),
    );
    return { request_id: request.id, status: request.status, message: 'Shift-change request submitted' };
  }

  async cancel(accountId: string, requestId: string) {
    const request = await this.requestRepo.findOne({
      where: { id: requestId },
      relations: ['driver', 'driver.account'],
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.driver.account.id !== accountId) {
      throw new ForbiddenException('This request does not belong to you');
    }
    if (request.status !== ShiftChangeRequestStatus.PENDING) {
      throw new BadRequestException('Only a pending request can be cancelled');
    }
    await this.requestRepo.delete(request.id);
    return { message: 'Shift-change request cancelled' };
  }

  async listMine(accountId: string) {
    const driver = await this.driverRepo.findOne({ where: { account: { id: accountId } } });
    if (!driver) throw new NotFoundException('Driver profile not found');

    const rows = await this.requestRepo.find({
      where: { driverId: driver.id },
      relations: ['truck', 'shift'],
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => this.mapRequest(r));
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------
  async listAll(query: PaginationQueryDto) {
    const [rows, total] = await this.requestRepo.findAndCount({
      relations: ['driver', 'driver.account', 'truck', 'shift'],
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return {
      requests: rows.map((r) => ({
        ...this.mapRequest(r),
        driver: { driver_id: r.driverId, name: r.driver?.account?.name ?? null },
      })),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  /** Admin moves a request to PROCESSING, or REJECTS it (reason required). */
  async setStatus(id: string, dto: UpdateRequestStatusDto) {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: ['driver', 'driver.account'],
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status === ShiftChangeRequestStatus.ACCEPTED) {
      throw new BadRequestException('A processed request cannot change status');
    }
    if (request.status === ShiftChangeRequestStatus.REJECTED) {
      throw new BadRequestException('A rejected request cannot change status');
    }

    if (dto.status === ShiftChangeRequestStatus.PROCESSING) {
      if (request.status !== ShiftChangeRequestStatus.PENDING) {
        throw new BadRequestException('Only a pending request can move to processing');
      }
      request.status = ShiftChangeRequestStatus.PROCESSING;
      await this.requestRepo.save(request);
    } else {
      // REJECTED
      if (!dto.rejectionReason) {
        throw new BadRequestException('A rejection reason is required when rejecting a request');
      }
      request.status = ShiftChangeRequestStatus.REJECTED;
      request.rejectionReason = dto.rejectionReason;
      await this.requestRepo.save(request);
      await this.notifyRejected(request.driver.account.id, dto.rejectionReason);
    }

    return { request_id: request.id, status: request.status, message: 'Request status updated' };
  }

  /**
   * Processes a driver's PROCESSING request: verifies the requested truck is
   * free on the requested shift, swaps the driver's assignment, marks the
   * request ACCEPTED and notifies the driver.
   */
  async process(dto: ProcessRequestDto) {
    const request = await this.requestRepo.findOne({
      where: { driverId: dto.driverId, status: In(ACTIVE_STATES) },
      relations: ['truck', 'shift', 'driver', 'driver.account'],
      order: { createdAt: 'DESC' },
    });
    if (!request) throw new NotFoundException('This driver has no active shift-change request');
    if (request.status === ShiftChangeRequestStatus.PENDING) {
      throw new BadRequestException('Move the request to PROCESSING before processing it');
    }

    // status is PROCESSING — check the requested truck is available on the shift.
    if (request.truck.status === TruckStatus.DISABLED) {
      throw new BadRequestException('The requested truck is disabled');
    }
    const taken = await this.assignmentRepo.findOne({
      where: { truckId: request.truckId, shiftId: request.shiftId },
    });
    if (taken) {
      throw new BadRequestException('The requested truck already has a driver on the selected shift');
    }

    // Swap: drop the driver's current assignment, then create the new one.
    const current = await this.assignmentRepo.findOne({ where: { driverId: dto.driverId } });
    const previousTruckId = current?.truckId;
    if (current) await this.assignmentRepo.delete(current.id);

    await this.assignmentRepo.save(
      this.assignmentRepo.create({
        truckId: request.truckId,
        driverId: dto.driverId,
        shiftId: request.shiftId,
        assignedAt: new Date(),
      }),
    );

    request.status = ShiftChangeRequestStatus.ACCEPTED;
    await this.requestRepo.save(request);

    if (previousTruckId && previousTruckId !== request.truckId) {
      await this.assignmentService.recomputeStatus(previousTruckId);
    }
    await this.assignmentService.recomputeStatus(request.truckId);

    await this.notifyAccepted(request.driver.account.id, request.truck.plateNumber);

    return {
      request_id: request.id,
      driver_id: dto.driverId,
      truck_id: request.truckId,
      shift_id: request.shiftId,
      status: request.status,
      message: 'Shift change processed; driver reassigned',
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private mapRequest(r: ShiftChangeRequest) {
    return {
      request_id: r.id,
      truck: r.truck ? { truck_id: r.truck.id, plate_number: r.truck.plateNumber } : { truck_id: r.truckId },
      shift: r.shift ? { shift_id: r.shift.id, name: r.shift.name } : { shift_id: r.shiftId },
      status: r.status,
      rejection_reason: r.rejectionReason ?? null,
      created_at: r.createdAt,
    };
  }

  private async notifyAccepted(accountId: string, plate: string): Promise<void> {
    await this.notify(accountId, {
      title: 'Shift change accepted',
      body: `Your shift-change request was accepted; you are now on truck "${plate}".`,
      titleKey: 'notifications.shiftChangeAccepted.title',
      bodyKey: 'notifications.shiftChangeAccepted.body',
      args: { plate },
    });
  }

  private async notifyRejected(accountId: string, reason: string): Promise<void> {
    await this.notify(accountId, {
      title: 'Shift change rejected',
      body: `Your shift-change request was rejected. Reason: ${reason}`,
      titleKey: 'notifications.shiftChangeRejected.title',
      bodyKey: 'notifications.shiftChangeRejected.body',
      args: { reason },
    });
  }

  private async notify(
    accountId: string,
    payload: { title: string; body: string; titleKey: string; bodyKey: string; args: Record<string, unknown> },
  ): Promise<void> {
    try {
      const n = await this.notifications.createNotification({
        userId: accountId,
        type: NotificationType.GENERAL,
        ...payload,
      });
      await this.notifications.enqueueNotification(n.id);
    } catch (error) {
      winstonLogger.error(`Failed to notify driver of shift-change update: ${(error as Error).message}`, {
        context: 'ShiftChangeRequestService',
        channel: 'jobs',
      });
    }
  }
}
