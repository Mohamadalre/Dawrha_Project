import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Role } from '@src/user/enums/role.enum';
import { TruckProblemService } from './truck-problem.service';

class CreateTruckProblemDto {
  /** What is wrong with the truck (mandatory). */
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

/**
 * Driver-facing truck-problem reports (role: COLLECTOR): multipart form with
 * a mandatory `reason` field and up to 5 optional `images` files. Read by the
 * driver's warehouse manager in Odoo.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.COLLECTOR)
@Controller({ path: 'truck-problems', version: '1' })
export class TruckProblemController {
  constructor(private readonly service: TruckProblemService) {}

  /**
   * The reports this driver has filed (newest first, paginated).
   * Read-only: the warehouse manager reviews them in Odoo, nothing flows back.
   */
  @Get('mine')
  async mine(
    @CurrentUser() user: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    const result = await this.service.listMine(user.id, page, limit);
    return { message: 'Truck problems fetched successfully', result };
  }

  @Post()
  @UseInterceptors(FilesInterceptor('images', 5))
  async create(
    @CurrentUser() user: any,
    @Body() dto: CreateTruckProblemDto,
    @UploadedFiles() images: Express.Multer.File[],
  ) {
    return this.service.create(user.id, dto.reason, images ?? []);
  }
}
