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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { StagesService } from './stages.service';
import { CreateStageDto, ListStagesQueryDto, ReorderStageDto, UpdateStageDto } from './dto/stage.dto';

/**
 * Points stages, managed by the admin. Full CRUD plus a dedicated reorder route;
 * the service keeps the order a contiguous sequence and the ranges non-overlapping.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'admin/stages', version: '1' })
export class AdminStagesController {
  constructor(
    private readonly stages: StagesService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private async imageUrl(file?: Express.Multer.File): Promise<string | undefined> {
    if (!file) return undefined;
    return this.cloudinary.uploadLogo(file, 'stages/');
  }

  @Get()
  @Roles(Role.ADMIN)
  async list(@Query() query: ListStagesQueryDto) {
    const result = await this.stages.list(query);
    return { message: 'Stages fetched successfully', result };
  }

  @Post()
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async create(@Body() dto: CreateStageDto, @UploadedFile() file?: Express.Multer.File) {
    return this.stages.create(dto, await this.imageUrl(file));
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStageDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.stages.update(id, dto, await this.imageUrl(file));
  }

  /** Change ONLY the order — moving the stage shifts the others to make room. */
  @Patch(':id/order')
  @Roles(Role.ADMIN)
  async reorder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReorderStageDto) {
    return this.stages.reorder(id, dto.order);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.stages.remove(id);
  }
}

/**
 * Stages as the USER sees them. This is a CITIZEN feature — the points ladder a
 * recycler climbs — so only citizens reach it; they can look, never edit.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CITIZEN)
@Controller({ path: 'stages', version: '1' })
export class StagesController {
  constructor(private readonly stages: StagesService) {}

  /** The whole ladder (active stages, in order), with the caller's own flagged. */
  @Get()
  async list(@CurrentUser() user) {
    const result = await this.stages.listForUser(user.id);
    return { message: 'Stages fetched successfully', result };
  }

  /** Just the caller's current stage and points. */
  @Get('me')
  async myStage(@CurrentUser() user) {
    const result = await this.stages.myStage(user.id);
    return { message: 'Your stage fetched successfully', result };
  }
}
