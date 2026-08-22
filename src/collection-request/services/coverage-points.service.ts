import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoveragePoint } from '../entities/coverage-point.entity';
import { DriverCoverageAssignment } from '../entities/driver-coverage-assignment.entity';
import {
  CollectionCoveragePointNotFoundException,
} from '../exceptions/collection-request.exceptions';

/**
 * Admin CRUD over coverage points (schools, markets, hospitals where idle
 * drivers park). Deletion is a soft one — the point stops receiving drivers
 * but the parking rows keep their history. The list carries each point's
 * current parked-driver count so the admin sees the load the rebalancer
 * actually balances.
 */
@Injectable()
export class CoveragePointsService {
  constructor(
    @InjectRepository(CoveragePoint)
    private readonly pointRepo: Repository<CoveragePoint>,
    @InjectRepository(DriverCoverageAssignment)
    private readonly assignmentRepo: Repository<DriverCoverageAssignment>,
  ) {}

  async list() {
    const [points, assignments] = await Promise.all([
      this.pointRepo.find({ order: { priority: 'DESC', createdAt: 'ASC' } }),
      this.assignmentRepo.find({ where: { isActive: true } }),
    ]);

    const parked = new Map<string, number>();
    for (const row of assignments) {
      parked.set(row.coveragePointId, (parked.get(row.coveragePointId) ?? 0) + 1);
    }

    return points.map((p) => ({
      ...this.toView(p),
      parked_drivers: parked.get(p.id) ?? 0,
    }));
  }

  async create(dto: {
    name: string;
    point_type?: string;
    lat: number;
    lng: number;
    radius_m?: number;
    priority?: number;
    warehouseId?: string;
  }) {
    const point = await this.pointRepo.save(
      this.pointRepo.create({
        name: dto.name,
        pointType: dto.point_type ?? 'GENERAL',
        lat: String(dto.lat),
        lng: String(dto.lng),
        radiusM: dto.radius_m ?? 1000,
        priority: dto.priority ?? 0,
        warehouseId: dto.warehouseId,
      }),
    );
    return this.toView(point);
  }

  async update(
    id: string,
    dto: Partial<{
      name: string;
      point_type: string;
      lat: number;
      lng: number;
      radius_m: number;
      priority: number;
      is_active: boolean;
      warehouseId?: string;
    }>,
  ) {
    const point = await this.load(id);
    if (dto.name != null) point.name = dto.name;
    if (dto.point_type != null) point.pointType = dto.point_type;
    if (dto.lat != null) point.lat = String(dto.lat);
    if (dto.lng != null) point.lng = String(dto.lng);
    if (dto.radius_m != null) point.radiusM = dto.radius_m;
    if (dto.priority != null) point.priority = dto.priority;
    if (dto.is_active != null) point.isActive = dto.is_active;
    if (dto.warehouseId != null) point.warehouseId = dto.warehouseId;
    return this.toView(await this.pointRepo.save(point));
  }

  /** Soft-removal: parked drivers keep their rows, the point stops receiving. */
  async remove(id: string): Promise<void> {
    const point = await this.load(id);
    point.isActive = false;
    await this.pointRepo.save(point);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private async load(id: string): Promise<CoveragePoint> {
    const point = await this.pointRepo.findOne({ where: { id } });
    if (!point) throw new CollectionCoveragePointNotFoundException();
    return point;
  }

  private toView(point: CoveragePoint) {
    return {
      id: point.id,
      name: point.name,
      point_type: point.pointType,
      lat: Number(point.lat),
      lng: Number(point.lng),
      radius_m: point.radiusM,
      priority: point.priority,
      is_active: point.isActive,
      warehouseId: point.warehouseId,
      created_at: point.createdAt,
      updated_at: point.updatedAt,
    };
  }
}