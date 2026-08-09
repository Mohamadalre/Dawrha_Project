import { Controller, Post, Body, Get, Patch, Delete, Param, ParseUUIDPipe, UseGuards, Query, DefaultValuePipe, ParseIntPipe, ForbiddenException } from '@nestjs/common';
import { InstitutionService } from './institution.service';
import { CreateInstitutionTypeDto, UpdateInstitutionTypeDto } from './dto/Institution-type.dto';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';

/**
 * Controller for institution type operations.
 *
 * Admin: full CRUD (create / update / delete / list). Institutions: list only,
 * and readable while still onboarding so a type can be chosen on the
 * information step.
 */

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({
  path: 'institution',
  version: '1'
})
export class InstitutionController {
  constructor(private readonly institutionService: InstitutionService) {}

  /**
   * Creates a new institution type (Admin only)
   */
  @Roles(Role.ADMIN)
  @Post('institution-type')
  async create(@Body() dto: CreateInstitutionTypeDto) {
    const data = await this.institutionService.create(dto)
    return { message: 'Add institution type successfully', result: { id: data.id, name: data.name, createdAt: data.createdAt } }
  }

  /**
   * Renames an institution type (Admin only)
   */
  @Roles(Role.ADMIN)
  @Patch('institution-type/:id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInstitutionTypeDto,
  ) {
    const result = await this.institutionService.update(id, dto);
    return { message: 'Update institution type successfully', result };
  }

  /**
   * Deletes an institution type (Admin only). Refused while any institution
   * still references it.
   */
  @Roles(Role.ADMIN)
  @Delete('institution-type/:id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.institutionService.remove(id);
    return { message: 'Delete institution type successfully', result };
  }

  /**
   * Paginated list of institution types.
   *
   * Two audiences, two rules — the status decorator admits the union, and the
   * per-role check below narrows it:
   *   - the ADMIN reaches it to manage the list, and is always ACTIVE;
   *   - an INSTITUTION reaches it only WHILE ONBOARDING — PENDING_PROFILE
   *     (filling the information step) or PENDING_APPROVAL (correcting it after
   *     submitting). Once ACTIVE it has already chosen its type and has no
   *     business back on the picker, so an active institution is refused.
   */
  @AccountsStatus(
    AccountStatus.ACTIVE,
    AccountStatus.PENDING_PROFILE,
    AccountStatus.PENDING_APPROVAL,
  )
  @Roles(Role.ADMIN, Role.INSTITUTIONS)
  @Get('institution-type')
  async findAll(
    @CurrentUser() user,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    if (
      user.role === Role.INSTITUTIONS &&
      user.accountStatus === AccountStatus.ACTIVE
    ) {
      throw new ForbiddenException(
        'Institution types are only available while your application is being completed',
      );
    }
    const result = await this.institutionService.findAll(page);
    return { message: 'Fetch institution type  successfully', result };
  }
}
