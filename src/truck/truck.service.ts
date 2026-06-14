import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { TruckEntity } from './entities/truck.entity';
import { CreateTruckDto } from './dto/create-truck.dto';

@Injectable()
export class TruckService {
  constructor(
    @InjectRepository(TruckEntity)
    private readonly truckRepository: Repository<TruckEntity>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async create(
    createTruckDto: CreateTruckDto,
    files: {
      drivingLicenseImage?: Express.Multer.File[];
      mechanicsImage?: Express.Multer.File[];
      truckWithPlateImage?: Express.Multer.File[];
    },
  ) {
    const { plateNumber } = createTruckDto;

    const existing = await this.truckRepository.findOne({ where: { plateNumber } });
    if (existing) {
      throw new BadRequestException(`Truck with plate number "${plateNumber}" already exists`);
    }

    const folder = `trucks/${plateNumber}`;

    const uploadImage = async (file: Express.Multer.File | undefined, subfolder: string) => {
      if (!file) return null;
      return this.cloudinaryService.uploadLogo(file, `${folder}/${subfolder}`);
    };

    let drivingUrl: string | null = null;
    let mechanicsUrl: string | null = null;
    let plateUrl: string | null = null;

    try {
      [drivingUrl, mechanicsUrl, plateUrl] = await Promise.all([
        uploadImage(files.drivingLicenseImage?.[0], 'driving-license'),
        uploadImage(files.mechanicsImage?.[0], 'mechanics'),
        uploadImage(files.truckWithPlateImage?.[0], 'with-plate'),
      ]);
    } catch {
      throw new BadRequestException('Failed to upload one or more images to Cloudinary');
    }

    const truck = this.truckRepository.create({
      model: createTruckDto.model,
      year: createTruckDto.year,
      plateNumber: createTruckDto.plateNumber,
      maxPayloadKg: createTruckDto.maxPayloadKg ?? null,
      lengthM: createTruckDto.lengthM ?? null,
      widthM: createTruckDto.widthM ?? null,
      status: createTruckDto.status ?? 'active',
      drivingLicenseImageUrl: drivingUrl,
      mechanicsImageUrl: mechanicsUrl,
      truckWithPlateImageUrl: plateUrl,
    });

    const saved = await this.truckRepository.save(truck);
    return saved;
  }
}
