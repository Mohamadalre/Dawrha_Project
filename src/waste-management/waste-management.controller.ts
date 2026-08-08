import { Controller, Post, Body, Get, UseGuards, Query, ParseIntPipe, DefaultValuePipe, UseInterceptors, UploadedFile } from '@nestjs/common';
import { WasteManagementService } from './waste-management.service';
import { CreateWasteCategory } from './dto/waste-category.dto';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';

/**
 * Controller for waste management operations
 * Handles waste category creation and retrieval
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller({
  path: 'waste-management',
  version: '1'
})
export class WasteManagementController {
  constructor(private readonly wasteManagementService: WasteManagementService) { }

  /**
   * Creates a new waste category (Admin only)
   *
   * @param dto - Waste category data
   * @returns Success message with created category data
   */
  @Permissions('admin.waste.create')
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  @Post('waste-category')
  async create(@Body() dto: CreateWasteCategory,@UploadedFile() file: Express.Multer.File,) {
    const data = await this.wasteManagementService.create(dto, file)
    return { message: 'Add waste category successfully', result: { id: data.id, name: data.name, createdAt: data.createdAt } }
  }

  /**
   * Gets a paginated list of waste categories
   *
   * @param page - Page number (default 1)
   * @returns Success message with waste categories list
   */
  // Reachable while still onboarding: a factory / free facility / institution
  // picks the categories it deals in DURING profile completion (PENDING_PROFILE)
  // and again when asked to revise it (NEED_CHANGES), not only once ACTIVE.
  // Without this the global guard would lock the list to ACTIVE accounts and the
  // onboarding step could never load it.
  @AccountsStatus(
    AccountStatus.ACTIVE,
    AccountStatus.PENDING_PROFILE,
    AccountStatus.NEED_CHANGES,
  )
  @Roles(Role.ADMIN, Role.EXTERNAL_PARTNER, Role.FACTORY, Role.INSTITUTIONS)
  @Get('waste-categories')
  async findAll(@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {
    const result = await this.wasteManagementService.findAllName(page);
    return { message: 'Fetch waste categories successfully', result };
  }
}
