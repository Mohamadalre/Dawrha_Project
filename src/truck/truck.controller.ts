import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';
import { TruckService } from './truck.service';
import { AssignmentService } from './assignment.service';
import { CreateTruckDto } from './dto/create-truck.dto';
import { UpdateTruckDto } from './dto/update-truck.dto';
import { ListTrucksQueryDto } from './dto/list-trucks.query.dto';
import { UpdateTruckStatusDto } from './dto/update-truck-status.dto';
import { AssignDriverDto } from './dto/assign-driver.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'trucks', version: '1' })
export class TruckController {
  constructor(
    private readonly truckService: TruckService,
    private readonly assignment: AssignmentService,
  ) {}

  /** Assign a driver to a truck on a shift. */
  @Post('assign')
  @Permissions('admin.trucks.manage')
  async assign(@Body() dto: AssignDriverDto) {
    const result = await this.assignment.assign(dto);
    return { message: result.message, result };
  }

  /** Remove a driver's truck assignment. */
  @Delete('assign/:driverId')
  @Permissions('admin.trucks.manage')
  async unassign(@Param('driverId', ParseUUIDPipe) driverId: string) {
    const result = await this.assignment.unassign(driverId);
    return { message: result.message, result };
  }

  /** Create a truck — only the mechanics image is accepted. */
  @Post()
  @Permissions('admin.trucks.manage')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'mechanicsImage', maxCount: 1 }], imageMemoryStorage))
  async create(
    @Body() dto: CreateTruckDto,
    @UploadedFiles() files: { mechanicsImage?: Express.Multer.File[] },
  ) {
    const result = await this.truckService.create(dto, files);
    return { message: result.message, result };
  }

  /** List trucks filtered by status and/or shift (paginated). */
  @Get()
  @Permissions('admin.trucks.view')
  async list(@Query() query: ListTrucksQueryDto) {
    const result = await this.truckService.list(query);
    return { message: 'Trucks fetched successfully', result };
  }

  /** List drivers grouped by whether they are linked to a truck. */
  @Get('drivers')
  @Permissions('admin.trucks.view')
  async drivers(@Query('assigned') assigned?: string,@Query('shiftId') shiftId?: string) {
    const flag = assigned === 'true' ? true : assigned === 'false' ? false : undefined;
    const result = await this.truckService.getDrivers(flag, shiftId);
    return { message: 'Drivers fetched successfully', result };
  }

  /** Single truck details. */
  @Get(':id')
  @Permissions('admin.trucks.view')
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.truckService.getById(id);
    return { message: 'Truck fetched successfully', result };
  }

  /** Edit a truck's information (does not change status). */
  @Patch(':id')
  @Permissions('admin.trucks.manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTruckDto) {
    const result = await this.truckService.update(id, dto);
    return { message: result.message, result };
  }

  /** Toggle a truck between ACTIVE and DISABLED only. */
  @Patch(':id/status')
  @Permissions('admin.trucks.manage')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTruckStatusDto) {
    const result = await this.truckService.setStatus(id, dto);
    return { message: result.message, result };
  }
}
