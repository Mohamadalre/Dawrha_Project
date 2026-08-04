import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Role } from '@src/user/enums/role.enum';
import { FavouritesService } from './favourites.service';

export class AddFavouriteDto {
  @IsUUID()
  product_id: string;

  /** The buyer's own note — "the grade the Aleppo line takes". */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateFavouriteDto {
  /**
   * The only editable part of a favourite.
   *
   * The material cannot change — a favourite pointing at a different material
   * is a different favourite — so the note is what "edit" means here. An empty
   * string clears it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/**
 * A buyer's shortlist of materials.
 *
 * ONE set of routes for all four buyer roles — citizen, institution, factory,
 * free facility. It is the same act for every one of them, and the price shown
 * is resolved from the caller's own tier, so the role changes the numbers
 * without changing the endpoint.
 *
 * A favourites list is the same class of thing as a basket: the signed-in
 * buyer's own working set, which nobody else writes to.
 *
 * `cart.view` / `cart.manage` do NOT express that on their own — the admin
 * holds every key in the catalogue — so the roles are named explicitly per
 * route. The admin gets one read-only window (`GET account/:accountId`) and is
 * refused all three mutations.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'favourites', version: '1' })
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Get()
  // Buyers only. An admin has no favourites of their own, so letting them here
  // would answer an empty list and look like the buyer had saved nothing —
  // they use `GET account/:accountId` below and name whose list they mean.
  @Roles(Role.CITIZEN, Role.INSTITUTIONS, Role.FACTORY, Role.EXTERNAL_PARTNER)
  @Permissions('cart.view')
  async list(
    @CurrentUser() user,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const result = await this.favourites.list(user, page, limit);
    return { message: 'Favourites fetched successfully', result };
  }

  /**
   * The admin's read-only window onto ONE account's favourites.
   *
   * An administrator has a reason to see what a buyer has saved — answering a
   * support question, or reading a complaint about a price — and no reason at
   * all to change it. So they are given the seeing and refused the touching:
   * this route is theirs alone, and the three mutating ones below are closed to
   * them entirely.
   *
   * `list` is reused with the target's identity rather than a second
   * implementation, because the prices in a favourites list are TIER-DEPENDENT
   * (`livePricesFor(..., caller.role)`). An admin reading their own way through
   * would be shown numbers this buyer never sees, which is precisely the thing
   * a support question is trying to establish.
   */
  @Get('account/:accountId')
  @Roles(Role.ADMIN)
  @Permissions('cart.view')
  async listForAccount(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const result = await this.favourites.listForAccount(accountId, page, limit);
    return { message: 'Favourites fetched successfully', result };
  }

  // ── Mutations: buyers only ──────────────────────────────────────────────
  //
  // `cart.manage` alone does NOT express this. The permission catalogue grants
  // the admin EVERY key (`ADMIN_PERMISSIONS = Object.keys(WASTE_PERMISSIONS)`),
  // so the note that used to sit on this class — "held by every buyer role and
  // no other" — was simply untrue, and an administrator could add to, edit and
  // delete from a buyer's own saved list.
  //
  // A favourites list is that buyer's working set. Nobody else writes to it.

  @Post()
  @Roles(Role.CITIZEN, Role.INSTITUTIONS, Role.FACTORY, Role.EXTERNAL_PARTNER)
  @Permissions('cart.manage')
  async add(@CurrentUser() user, @Body() dto: AddFavouriteDto) {
    return this.favourites.add(user, dto.product_id, dto.note);
  }

  @Patch(':favouriteId')
  @Roles(Role.CITIZEN, Role.INSTITUTIONS, Role.FACTORY, Role.EXTERNAL_PARTNER)
  @Permissions('cart.manage')
  async update(
    @CurrentUser() user,
    @Param('favouriteId', ParseUUIDPipe) favouriteId: string,
    @Body() dto: UpdateFavouriteDto,
  ) {
    return this.favourites.update(user, favouriteId, dto.note);
  }

  @Delete(':favouriteId')
  @Roles(Role.CITIZEN, Role.INSTITUTIONS, Role.FACTORY, Role.EXTERNAL_PARTNER)
  @Permissions('cart.manage')
  async remove(
    @CurrentUser() user,
    @Param('favouriteId', ParseUUIDPipe) favouriteId: string,
  ) {
    return this.favourites.remove(user, favouriteId);
  }
}
