import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { TruckProblem } from './entities/truck-problem.entity';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import {
  DriverInactiveException,
  DriverNotFoundException,
} from './exceptions/truck.exceptions';

/**
 * Driver truck-problem reports: a mandatory reason + optional photos. Stored
 * here and mirrored to Odoo (queued push) where the driver's warehouse
 * manager READS them — nothing flows back.
 */
@Injectable()
export class TruckProblemService {
  constructor(
    @InjectRepository(TruckProblem)
    private readonly problemRepo: Repository<TruckProblem>,
    @InjectRepository(CollectorProfile)
    private readonly driverRepo: Repository<CollectorProfile>,
    private readonly cloudinary: CloudinaryService,
    private readonly odooSync: OdooSyncService,
  ) {}

  async create(accountId: string, reason: string, files: Express.Multer.File[]) {
    const profile = await this.driverRepo.findOne({
      where: { account: { id: accountId } },
      relations: ['account'],
    });
    if (!profile) throw new DriverNotFoundException('Driver profile not found');
    if (profile.account?.accountStatus !== AccountStatus.ACTIVE) {
      throw new DriverInactiveException();
    }

    // Photos are optional; each is validated (size/type) by CloudinaryService.
    const images: string[] = [];
    for (const file of files ?? []) {
      images.push(await this.cloudinary.uploadLogo(file, 'truck-problems'));
    }

    const problem = this.problemRepo.create({
      driverId: profile.id,
      reason: reason.trim(),
      images,
    });
    await this.problemRepo.save(problem);

    // Mirror it for the warehouse manager's read-only screen in Odoo.
    await this.odooSync.enqueuePushTruckProblem({ problemId: problem.id });

    return {
      message: 'Truck problem submitted successfully',
      problem_id: problem.id,
      images,
    };
  }

  /**
   * The reports THIS driver filed, newest first, paginated.
   *
   * Scoped to his own profile id — a driver can never read another driver's
   * reports. The Odoo mirror id is exposed so support can correlate a report
   * with what the warehouse manager sees on his side.
   */
  async listMine(accountId: string, page = 1, limit = 10) {
    const profile = await this.driverRepo.findOne({
      where: { account: { id: accountId } },
      relations: ['account'],
    });
    if (!profile) throw new DriverNotFoundException('Driver profile not found');

    const [rows, total] = await this.problemRepo.findAndCount({
      where: { driverId: profile.id },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      problems: rows.map((p) => ({
        problem_id: p.id,
        reason: p.reason,
        images: p.images ?? [],
        synced_with_odoo: !!p.odooProblemId,
        created_at: p.createdAt,
      })),
      pagination: buildPagination(total, page, limit),
    };
  }
}
