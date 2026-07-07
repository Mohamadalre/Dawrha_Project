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
  // Create (mechanics image only)
  // ---------------------------------------------------------------------------
  async create(dto: CreateTruckDto, files: { mechanicsImage?: Express.Multer.File[] }) {
    const existing = await this.truckRepository.findOne({ where: { plateNumber: dto.plateNumber } });
    if (existing) {
      throw new ConflictException(`Truck with plate number "${dto.plateNumber}" already exists`);
    }

    let mechanicsUrl: string | null = null;
    const mechanicsFile = files?.mechanicsImage?.[0];
    if (mechanicsFile) {
      try {
        mechanicsUrl = await this.cloudinaryService.uploadLogo(
          mechanicsFile,
          `trucks/${dto.plateNumber}/mechanics`,
        );
      } catch {
        throw new BadRequestException('Failed to upload the mechanics image');
      }
    }

    const truck = this.truckRepository.create({
      model: dto.model,
      year: dto.year,
      plateNumber: dto.plateNumber,
      maxPayloadKg: dto.maxPayloadKg ?? null,
      lengthM: dto.lengthM ?? null,
      widthM: dto.widthM ?? null,
      mechanicsImageUrl: mechanicsUrl,
      status: TruckStatus.ACTIVE,
    });
    const saved = await this.truckRepository.save(truck);

    return {
      truck_id: saved.id,
      plate_number: saved.plateNumber,
      model: saved.model,
      year: saved.year,
      status: saved.status,
      message: 'Truck created successfully',
    };
  }

  // ---------------------------------------------------------------------------
  // Update info (never touches status)
  // ---------------------------------------------------------------------------
  async update(id: string, dto: UpdateTruckDto) {
    const truck = await this.truckRepository.findOne({ where: { id } });
    if (!truck) throw new NotFoundException('Truck not found');

    if (dto.plateNumber && dto.plateNumber !== truck.plateNumber) {
      const dup = await this.truckRepository.findOne({ where: { plateNumber: dto.plateNumber } });
      if (dup) throw new ConflictException('Truck plate number already exists');
    }

    truck.model = dto.model ?? truck.model;
    truck.year = dto.year ?? truck.year;
    truck.plateNumber = dto.plateNumber ?? truck.plateNumber;
    truck.maxPayloadKg = dto.maxPayloadKg ?? truck.maxPayloadKg;
    truck.lengthM = dto.lengthM ?? truck.lengthM;
    truck.widthM = dto.widthM ?? truck.widthM;

    await this.truckRepository.save(truck);
    return { truck_id: truck.id, message: 'Truck updated successfully' };
  }

  // ---------------------------------------------------------------------------
  // List (by status / shift / both) — paginated summary
  // ---------------------------------------------------------------------------
  async list(query: ListTrucksQueryDto) {
    const qb = this.truckRepository.createQueryBuilder('t');

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
      })),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  // ---------------------------------------------------------------------------
  // Single truck detail
  // ---------------------------------------------------------------------------
  async getById(id: string) {
    const truck = await this.truckRepository.findOne({ where: { id } });
    if (!truck) throw new NotFoundException('Truck not found');

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
      created_at: truck.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Toggle status (active <-> disabled only)
  // ---------------------------------------------------------------------------
  async setStatus(id: string, dto: UpdateTruckStatusDto) {
    const truck = await this.truckRepository.findOne({ where: { id } });
    if (!truck) throw new NotFoundException('Truck not found');

    // Busy statuses are derived from assignments and can't be toggled here.
    if (truck.status === TruckStatus.BUSY_ONE_DRIVER || truck.status === TruckStatus.FULLY_BUSY) {
      throw new BadRequestException(
        'A truck with assigned drivers cannot change status; remove the assignment(s) first',
      );
    }

    truck.status = dto.status;
    await this.truckRepository.save(truck);
    return { truck_id: truck.id, status: truck.status, message: 'Truck status updated successfully' };
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
