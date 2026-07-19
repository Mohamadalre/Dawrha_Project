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
import { Shift, ShiftType } from '@src/shift/entities/shift.entity';
import { buildPagination, PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { TruckEntity } from './entities/truck.entity';
import { TruckAssignmentEntity } from './entities/truck-assignment.entity';
import { ShiftChangeRequest } from './entities/shift-change-request.entity';
import { ShiftChangeRequestStatus } from './enums/shift-change-request-status.enum';
import {
  ActiveShiftChangeExistsException,
  AssignmentShiftNotFoundException,
  DriverInactiveException,
  DriverNotFoundException,
  NotYourRequestException,
  ShiftChangeRequestNotFoundException,
  ShiftChangeStateException,
  TruckDisabledException,
  TruckNotFoundException,
} from './exceptions/truck.exceptions';
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
    private readonly odooSync: OdooSyncService,
  ) {}

  // ---------------------------------------------------------------------------
  // Driver
  // ---------------------------------------------------------------------------
  async create(accountId: string, dto: CreateShiftChangeRequestDto) {
    const driver = await this.driverRepo.findOne({
      where: { account: { id: accountId } },
      relations: ['account'],
    });
    if (!driver) throw new DriverNotFoundException('Driver profile not found');
    if (driver.account.accountStatus !== AccountStatus.ACTIVE) {
      throw new DriverInactiveException();
    }

    const active = await this.requestRepo.findOne({
      where: { driverId: driver.id, status: In(ACTIVE_STATES) },
    });
    if (active) throw new ActiveShiftChangeExistsException();

    const truck = await this.truckRepo.findOne({ where: { id: dto.truckId } });
    if (!truck) throw new TruckNotFoundException();
    // Drivers may only request DRIVER shifts that still exist in Odoo.
    const shift = await this.shiftRepo.findOne({ where: { id: dto.shiftId } });
    if (!shift || shift.shiftType !== ShiftType.DRIVER || !shift.isActive) {
      throw new AssignmentShiftNotFoundException();
    }

    const request = await this.requestRepo.save(
      this.requestRepo.create({
        driverId: driver.id,
        truckId: dto.truckId,
        shiftId: dto.shiftId,
        status: ShiftChangeRequestStatus.PENDING,
      }),
    );

    // The DECISION is made by the Odoo admin — mirror the request there.
    await this.odooSync.enqueuePushShiftChange({ requestId: request.id });
    return { request_id: request.id, status: request.status, message: 'Shift-change request submitted' };
  }

  async cancel(accountId: string, requestId: string) {
    const request = await this.requestRepo.findOne({
      where: { id: requestId },
      relations: ['driver', 'driver.account'],
    });
    if (!request) throw new ShiftChangeRequestNotFoundException();
    if (request.driver.account.id !== accountId) {
      throw new NotYourRequestException();
    }
    if (request.status !== ShiftChangeRequestStatus.PENDING) {
      throw new ShiftChangeStateException('Only a pending request can be cancelled');
    }
    await this.requestRepo.delete(request.id);
    return { message: 'Shift-change request cancelled' };
  }

  async listMine(accountId: string) {
    const driver = await this.driverRepo.findOne({ where: { account: { id: accountId } } });
    if (!driver) throw new DriverNotFoundException('Driver profile not found');

    const rows = await this.requestRepo.find({
      where: { driverId: driver.id },
      relations: ['truck', 'shift'],
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => this.mapRequest(r));
  }



  // ---------------------------------------------------------------------------
  // Backend READ view (the decision itself is made in Odoo)
  // ---------------------------------------------------------------------------
  async listAll(query: { page: number; limit: number }) {
    const [rows, total] = await this.requestRepo.findAndCount({
      relations: ['driver', 'driver.account', 'truck', 'shift'],
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      requests: rows.map((r) => ({
        ...this.mapRequest(r),
        driver: r.driver?.account
          ? { driver_id: r.driverId, name: r.driver.account.name, email: r.driver.account.email }
          : { driver_id: r.driverId },
        odoo_request_id: r.odooRequestId ?? null,
      })),
      pagination: {
        total_count: total,
        page: query.page,
        limit: query.limit,
      },
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
