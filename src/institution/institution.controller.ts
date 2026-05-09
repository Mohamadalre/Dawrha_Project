import { Controller,Post,Body,Get,UseGuards,Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { InstitutionService } from './institution.service';
import { CreateInstitutionTypeDto } from './dto/Institution-type.dto';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';

/**
 * Controller for institution type operations
 * Handles institution type creation and retrieval
 */
@UseGuards(JwtAuthGuard,RolesGuard)
@Controller({
  path:'institution',
  version:'1'
})
export class InstitutionController {
  constructor(private readonly institutionService: InstitutionService) {}

    /**
     * Creates a new institution type (Admin only)
     *
     * @param dto - Institution type data
     * @returns Success message with created institution type data
     */
    @Roles(Role.ADMIN)
    @Post('institution-type')
    async create(@Body() dto: CreateInstitutionTypeDto) {
      const data = await this.institutionService.create(dto)
      return { message: 'Add institution type successfully', result: { id: data.id, name: data.name, createdAt: data.createdAt } }
    }

  /**
   * Gets a paginated list of institution types
   *
   * @param page - Page number (default 1)
   * @returns Success message with institution types list
   */
  @Roles(Role.ADMIN,Role.INSTITUTIONS)
    @Get('institution-type')
    async findAll(@Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number ){
      const result = await this.institutionService.findAll(page);
      return { message: 'Fetch institution type  successfully',result };
    }
}
