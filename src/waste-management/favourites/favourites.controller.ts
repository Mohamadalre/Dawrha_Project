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
 * Guarded by `cart.view`, which every buyer role holds and no other role does.
 * A favourites list is the same class of thing as a basket: the signed-in
 * buyer's own working set.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'favourites', version: '1' })
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Get()
  @Permissions('cart.view')
  async list(
    @CurrentUser() user,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const result = await this.favourites.list(user, page, limit);
    return { message: 'Favourites fetched successfully', result };
  }

  @Post()
  @Permissions('cart.manage')
  async add(@CurrentUser() user, @Body() dto: AddFavouriteDto) {
    return this.favourites.add(user, dto.product_id, dto.note);
  }

  @Patch(':favouriteId')
  @Permissions('cart.manage')
  async update(
    @CurrentUser() user,
    @Param('favouriteId', ParseUUIDPipe) favouriteId: string,
    @Body() dto: UpdateFavouriteDto,
  ) {
    return this.favourites.update(user, favouriteId, dto.note);
  }

  @Delete(':favouriteId')
  @Permissions('cart.manage')
  async remove(
    @CurrentUser() user,
    @Param('favouriteId', ParseUUIDPipe) favouriteId: string,
  ) {
    return this.favourites.remove(user, favouriteId);
  }
}
