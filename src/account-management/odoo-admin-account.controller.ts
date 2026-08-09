import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Account } from '@src/user/entities/account.entity';
import { OdooService } from '@src/odoo/odoo.service';
import { UpdateOdooAdminDto } from './dto/update-odoo-admin.dto';

/**
 * The Odoo admin account, managed from the backend by the platform admin.
 *
 * "Two-way consistency": an edit here writes to BOTH sides in one call — the
 * Odoo `res.users` the backend connects as, AND the caller's own backend admin
 * account — so the same person's name / email / phone never drift apart between
 * the two systems. `login` and `password` are intentionally not touchable: they
 * are the credentials the backend authenticates to Odoo with.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'account-management/odoo-account', version: '1' })
export class OdooAdminAccountController {
  constructor(
    private readonly odoo: OdooService,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

  /** The Odoo admin's current info (name / login / email / phone). */
  @Get()
  @Permissions('admin.accounts.manage')
  async get() {
    const odoo = await this.odoo.getConnectedAdminUser();
    return { message: 'Odoo admin account fetched successfully', result: { odoo } };
  }

  /**
   * Edit the Odoo admin's name / email / phone from the backend. The same values
   * are mirrored onto the caller's backend admin account, so both sides stay in
   * step. The Odoo write happens first: if it fails, nothing is changed here
   * either, so the two never diverge silently.
   */
  @Patch()
  @Permissions('admin.accounts.manage')
  async update(@CurrentUser() user, @Body() dto: UpdateOdooAdminDto) {
    // Credentials first (login / password): rotating them updates Odoo, the live
    // connection and .env together, so a following profile write still connects.
    if (dto.login !== undefined || dto.password !== undefined) {
      await this.odoo.updateAdminCredentials({ login: dto.login, password: dto.password });
    }

    // Display fields (name / email / phone) — written to Odoo res.users.
    const odoo = await this.odoo.updateConnectedAdminUser({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
    });

    // Mirror the display fields onto the backend admin account (the caller) so
    // the two systems stay in step. Credentials are Odoo-only.
    const account = await this.accountRepo.findOne({ where: { id: user.id } });
    if (account) {
      if (dto.name !== undefined) account.name = dto.name;
      if (dto.email !== undefined) account.email = dto.email;
      if (dto.phone !== undefined) account.phone = dto.phone;
      await this.accountRepo.save(account);
    }

    return {
      message: 'Odoo admin account updated successfully',
      result: {
        odoo,
        // Confirms which credentials were rotated, without ever echoing values.
        credentials_updated: {
          login: dto.login !== undefined,
          password: dto.password !== undefined,
        },
        backend: account
          ? { id: account.id, name: account.name, email: account.email, phone: account.phone ?? '' }
          : null,
      },
    };
  }
}
