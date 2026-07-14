import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import { TruckEntity } from './entities/truck.entity';
import { TruckStatus } from './enums/truck-status.enum';
import {
  MechanicsImageUploadException,
  TruckHasDriversStatusException,
  TruckNotFoundException,
  TruckPlateExistsException,
} from './exceptions/truck.exceptions';
import { CreateTruckDto } from './dto/create-truck.dto';
import { UpdateTruckDto } from './dto/update-truck.dto';
import { ListTrucksQueryDto } from './dto/list-trucks.query.dto';
import { UpdateTruckStatusDto } from './dto/update-truck-status.dto';

@Injectable()
export class TruckService {
  constructor(
    @InjectRepository(TruckEntity)
    private readonly truckRepository: Repository<TruckEntity>,
    @InjectRepository(CollectorProfile)
    private readonly driverRepo: Repository<CollectorProfile>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}



  // ---------------------------------------------------------------------------
  // List (by status / shift / both) — paginated summary
  // ---------------------------------------------------------------------------
  async list(query: ListTrucksQueryDto) {
    const qb = this.truckRepository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.warehouse', 'w');

    if (query.warehouseId) {
      qb.andWhere('t.warehouseId = :warehouseId', { warehouseId: query.warehouseId });
    }
    if (query.status) {
      qb.andWhere('t.status = :status', { status: query.status });
    }
    if (query.shiftId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM truck_assignments a WHERE a.truck_id = t.id AND a.shift_id = :shiftId)`,
        { shiftId: query.shiftId },
      );
    }

    qb.orderBy('t.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();

    return {
      trucks: rows.map((t) => ({
        truck_id: t.id,
        plate_number: t.plateNumber,
        model: t.model,
        year: t.year,
        status: t.status,
        warehouse: t.warehouse
          ? { id: t.warehouse.id, name: t.warehouse.name, code: t.warehouse.code }
          : null,
      })),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  // ---------------------------------------------------------------------------
  // Single truck detail
  // ---------------------------------------------------------------------------
  async getById(id: string) {
    const truck = await this.truckRepository.findOne({ where: { id }, relations: ['warehouse'] });
    if (!truck) throw new TruckNotFoundException();

    return {
      truck_id: truck.id,
      plate_number: truck.plateNumber,
      model: truck.model,
      year: truck.year,
      max_payload_kg: truck.maxPayloadKg != null ? Number(truck.maxPayloadKg) : null,
      length_m: truck.lengthM != null ? Number(truck.lengthM) : null,
      width_m: truck.widthM != null ? Number(truck.widthM) : null,
      mechanics_image: truck.mechanicsImageUrl ?? null,
      status: truck.status,
      warehouse: truck.warehouse
        ? { id: truck.warehouse.id, name: truck.warehouse.name, code: truck.warehouse.code }
        : null,
      created_at: truck.createdAt,
    };
  }


  // ---------------------------------------------------------------------------
  // Drivers grouped by whether they are linked to a truck
  // ---------------------------------------------------------------------------
  async getDrivers(assigned?: boolean, shiftId?: string) {
    const qb = this.driverRepo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.account', 'account')
      .leftJoinAndSelect('d.assignment', 'assignment')
      .leftJoinAndSelect('assignment.truck', 'truck')
      .leftJoinAndSelect('assignment.shift', 'shift')
      .orderBy('account.name', 'ASC');

    if (assigned === true) qb.andWhere('assignment.id IS NOT NULL');
    if (assigned === false) qb.andWhere('assignment.id IS NULL');
    if (shiftId) qb.andWhere('assignment.shift_id = :shiftId', { shiftId });

    const drivers = await qb.getMany();

    return drivers.map((d) => ({
      driver_id: d.id,
      name: d.account?.name ?? null,
      phone: d.account?.phone ?? null,
      national_id: d.NationalID,
      is_assigned: !!d.assignment,
      assigned_truck: d.assignment?.truck
        ? { truck_id: d.assignment.truck.id, plate_number: d.assignment.truck.plateNumber }
        : null,
      shift: d.assignment?.shift
        ? { shift_id: d.assignment.shift.id, name: d.assignment.shift.name }
        : null,
    }));
  }
}
