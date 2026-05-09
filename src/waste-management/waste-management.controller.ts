import { Controller, Post, Body, Get,UseGuards,Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { WasteManagementService } from './waste-management.service';
import { CreateWasteCategory } from './dto/waste-category.dto';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';

/**
 * Controller for waste management operations
 * Handles waste category creation and retrieval
 */
@UseGuards(JwtAuthGuard,RolesGuard)
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
  @Roles(Role.ADMIN)
  @Post('waste-category')
  async create(@Body() dto: CreateWasteCategory) {
    const data = await this.wasteManagementService.create(dto)
    return { message: 'Add waste category successfully', result: { id: data.id, name: data.name, createdAt: data.createdAt } }
  }

  /**
   * Gets a paginated list of waste categories
   *
   * @param page - Page number (default 1)
   * @returns Success message with waste categories list
   */
@Roles(Role.ADMIN,Role.EXTERNAL_PARTNER,Role.FACTORY,Role.INSTITUTIONS)
  @Get('waste-categories')
  async findAll(@Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number ) {
    const result = await this.wasteManagementService.findAll(page);
    return { message: 'Fetch waste categories successfully',result };
  }
}
