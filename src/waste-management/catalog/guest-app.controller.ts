import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { GuestAudience } from '../enums/guest-audience.enum';
import { GuestAppService } from './guest-app.service';

export class GuestAppListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class GuestAppSearchQueryDto extends PaginationQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  query: string;
}

/**
 * Shared route surface of both visitor apps.
 *
 * The two controllers below differ in exactly one thing — the audience — and
 * that difference is bound to the CLASS, not read from the request. A visitor in
 * the user app therefore cannot reach factory pricing by any parameter they
 * could send; the only way to see the other sheet is to call the other path,
 * which is the same as opening the other app.
 *
 * There are no write routes here at all, and that is not an omission: a visitor
 * has no account to hang a cart on and no confirmed location to match warehouses
 * against, so a cart or an order would have to invent both.
 */
abstract class BaseGuestAppController {
  protected abstract readonly audience: GuestAudience;

  constructor(protected readonly guest: GuestAppService) {}

  /** Categories that actually hold something this audience can buy. */
  @Get('categories')
  async categories(@Query() query: GuestAppListQueryDto) {
    const result = await this.guest.categories(this.audience, query);
    return { message: 'Categories fetched successfully', result };
  }

  /** Materials of one category — the natural next tap after the list above. */
  @Get('categories/:categoryId/products')
  async categoryProducts(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Query() query: GuestAppListQueryDto,
  ) {
    const result = await this.guest.products(this.audience, {
      ...query,
      category_id: categoryId,
    });
    return { message: 'Products fetched successfully', result };
  }

  @Get('products')
  async products(@Query() query: GuestAppListQueryDto) {
    const result = await this.guest.products(this.audience, query);
    return { message: 'Products fetched successfully', result };
  }

  @Get('products/:productId')
  async productDetail(@Param('productId', ParseUUIDPipe) productId: string) {
    const result = await this.guest.productDetail(this.audience, productId);
    return { message: 'Product fetched successfully', result };
  }

  @Get('offers')
  async offers(@Query() query: GuestAppListQueryDto) {
    const result = await this.guest.offers(this.audience, query);
    return { message: 'Offers fetched successfully', result };
  }

  /**
   * One search box over categories AND materials.
   *
   * A visitor typing "plastic" does not know which of the two they are naming,
   * and asking them to pick a tab first is the database's question, not theirs.
   */
  @Get('search')
  async search(@Query() query: GuestAppSearchQueryDto) {
    const result = await this.guest.search(this.audience, query);
    return { message: 'Search results fetched successfully', result };
  }
}

/**
 * Visitor catalogue of the USER app — citizens and institutions.
 *
 * Prices are shown: unlike the app-agnostic guest routes, the path already tells
 * us which kind of buyer this visitor would become, so a number can be quoted
 * that they will actually be paid. Both tiers of the app travel together because
 * a visitor has not yet chosen between them.
 */
@Controller({ path: 'user-app/guest', version: '1' })
export class UserAppGuestController extends BaseGuestAppController {
  protected readonly audience = GuestAudience.USER;

  constructor(guest: GuestAppService) {
    super(guest);
  }
}

/**
 * Visitor catalogue of the FACTORY app — factories and free facilities.
 *
 * Graded materials arrive as a price PER GRADE plus a `price_from`, because that
 * is how these tiers are genuinely sold; an ungraded material carries a single
 * price, since there is nothing for a grade to distinguish.
 */
@Controller({ path: 'factory-app/guest', version: '1' })
export class FactoryAppGuestController extends BaseGuestAppController {
  protected readonly audience = GuestAudience.FACTORY;

  constructor(guest: GuestAppService) {
    super(guest);
  }
}
