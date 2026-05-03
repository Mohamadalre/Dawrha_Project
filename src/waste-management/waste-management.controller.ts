import { Controller, Post, Body, Get,UseGuards } from '@nestjs/common';
import { WasteManagementService } from './waste-management.service';
import { CreateWasteCategory } from './dto/waste-category.dto';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';


@UseGuards(JwtAuthGuard,RolesGuard)
@Controller({
  path: 'waste-management',
  version: '1'
})
export class WasteManagementController {
  constructor(private readonly wasteManagementService: WasteManagementService) { }

  @Roles(Role.ADMIN)
  @Post('waste-category')
  async create(@Body() dto: CreateWasteCategory) {
    const data = await this.wasteManagementService.create(dto)
    return { message: 'Add waste category successfully', result: { id: data.id, name: data.name, createdAt: data.createdAt } }
  }
@Roles(Role.ADMIN,Role.EXTERNAL_PARTNER,Role.FACTORY,Role.INSITUTIONS)
  @Get('waste-category')
  async findAll() {
    const result = await this.wasteManagementService.findAll();
    return { message: 'Fetch waste category successfully',result };
  }
}
