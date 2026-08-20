import {
  Body,
  ConflictException,
  Controller,
  Get,
  Patch,
  Post,
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
import {
  CreateOdooAdminDto,
  UpdateOdooAdminCredentialsDto,
  UpdateOdooAdminDto,
} from './dto/update-odoo-admin.dto';
import { BadRequestException } from '@nestjs/common';

/**
 * The Odoo admin account, managed from the backend by the platform admin.
 *
 * "Two-way consistency": a profile edit here writes to BOTH sides in one call —
 * the Odoo `res.users` the backend connects as, AND the caller's own backend
 * admin account — so the same person's name / email / phone never drift apart
 * between the two systems.
 *
 * The sign-in credentials (`login` / `password`) are ALSO changeable, but only
 * through the dedicated `PATCH credentials` endpoint below — never as a side
 * effect of a routine profile edit. That endpoint is exactly for changing the
 * account the Odoo admin signs into their Odoo page with; because those are the
 * same credentials the backend connects with, the service re-authenticates with
 * the new values (and rolls back on failure) before persisting them.
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
   * Create an ADDITIONAL Odoo admin account, so the platform can have more than
   * one. Invite model: Odoo emails the new admin a link to set their own
   * password — the backend never chooses, sends, or stores an admin secret.
   */
  @Post('admins')
  @Permissions('admin.accounts.manage')
  async createAdmin(@Body() dto: CreateOdooAdminDto) {
    try {
      const created = await this.odoo.createAdminUser({
        // The email is the sign-in login AND the contact email — one value, so
        // the new admin signs into Odoo with exactly the address the invite is
        // sent to, and the two Odoo fields cannot disagree.
        name: dto.name,
        login: dto.email,
        email: dto.email,
        phone: dto.phone,
      });
      return {
        message: 'Odoo admin account created successfully',
        result: { odoo: created },
      };
    } catch (err: any) {
      // Odoo's unique-login constraint → a clean 409 rather than a raw 500.
      // The login IS the email, so the message names the email.
      if (/login|unique|already|exist/i.test(String(err?.message ?? ''))) {
        throw new ConflictException('An Odoo admin with this email already exists');
      }
      throw err;
    }
  }

  /**
   * Edit the Odoo admin's name / email / phone from the backend. The same values
   * are mirrored onto the caller's backend admin account, so both sides stay in
   * step. The Odoo write happens first: if it fails, nothing is changed here
   * either, so the two never diverge silently.
   *
   * PROFILE ONLY — the login/password are NOT rotated here. Changing the
   * password from a routine profile edit is intentionally out of scope; the
   * credentials are the backend's own connection to Odoo.
   */
  @Patch()
  @Permissions('admin.accounts.manage')
  async update(@CurrentUser() user, @Body() dto: UpdateOdooAdminDto) {
    // Display fields (name / email / phone) — written to Odoo res.users.
    const odoo = await this.odoo.updateConnectedAdminUser({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
    });

    // Mirror the display fields onto the backend admin account (the caller) so
    // the two systems stay in step.
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
        backend: account
          ? { id: account.id, name: account.name, email: account.email, phone: account.phone ?? '' }
          : null,
      },
    };
  }

  /**
   * Change the Odoo admin's SIGN-IN credentials — the login and/or password used
   * to sign into the Odoo page.
   *
   * Separate from the profile edit above on purpose: this is the deliberate act
   * of rotating the connection, not a contact-details tidy-up. Because these are
   * the same credentials the backend authenticates to Odoo with, the service
   * writes them to Odoo, RE-AUTHENTICATES with the new values to prove they work
   * (restoring the old ones and failing loudly if they do not), and only then
   * persists them to `.env` — so the backend can never lock itself out.
   */
  @Patch('credentials')
  @Permissions('admin.accounts.manage')
  async updateCredentials(@Body() dto: UpdateOdooAdminCredentialsDto) {
    if (dto.login === undefined && dto.password === undefined) {
      throw new BadRequestException('Provide a new login, a new password, or both');
    }
    await this.odoo.updateAdminCredentials({
      login: dto.login,
      password: dto.password,
    });
    const odoo = await this.odoo.getConnectedAdminUser();
    return {
      message: 'Odoo admin sign-in credentials updated successfully',
      result: { odoo },
    };
  }
}
