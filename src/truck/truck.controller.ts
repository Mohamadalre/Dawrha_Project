import { Controller, Post, UseInterceptors, UploadedFiles, Body, UseGuards } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';
import { TruckService } from './truck.service';
import { CreateTruckDto } from './dto/create-truck.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller({
  path: 'trucks',
  version: '1',
})
export class TruckController {
  constructor(private readonly truckService: TruckService) {}

  @Post()
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'drivingLicenseImage', maxCount: 1 },
    { name: 'mechanicsImage', maxCount: 1 },
    { name: 'truckWithPlateImage', maxCount: 1 },
  ], imageMemoryStorage))
  async create(
    @Body() createTruckDto: CreateTruckDto,
    @UploadedFiles() files: {
      drivingLicenseImage?: Express.Multer.File[];
      mechanicsImage?: Express.Multer.File[];
      truckWithPlateImage?: Express.Multer.File[];
    },
  ) {
    return this.truckService.create(createTruckDto, files);
  }
}
