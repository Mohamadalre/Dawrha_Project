import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { OptionalJwtAuthGuard } from '@src/auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { CatalogService } from './catalog.service';
import {
  CategoryQueryDto,
  OfferQueryDto,
  OfferSearchQueryDto,
} from './dto/catalog-query.dto';

/**
 * The guest product query — pagination, category, free text.
 *
 * Notably WITHOUT the price_min / price_max filters the buyer query carries:
 * filtering by price is a way of reading prices back out one range at a time,
 * so offering it here would give away what the response deliberately withholds.
 */
class PublicProductQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/**
 * Public (guest) catalogue. Visitors with NO token may browse and search
 * categories and offers only. Everything else — products with tier pricing,
 * the cart, etc. — stays behind JwtAuthGuard, so a guest simply cannot reach it.
 *
 * The optional guard still attaches the user when a valid token IS present, so a
 * logged-in buyer hitting these routes gets their category-scoped results.
 */
@UseGuards(OptionalJwtAuthGuard)
@Controller({ path: 'waste/public', version: '1' })
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  async getCategories(@CurrentUser() user, @Query() query: CategoryQueryDto) {
    const result = await this.catalog.getCategories(user ?? null, query);
    return { message: 'Categories fetched successfully', result };
  }

  /**
   * The materials we deal in — without prices.
   *
   * Deliberately NOT a guest price list. Price is a function of the buyer's
   * tier, so a number shown to nobody-in-particular is a number nobody is
   * actually quoted; a visitor who sees 10 and then registers to find 7 reads
   * it as a bait, not as a tier system. And a factory's sheet is commercially
   * sensitive — publishing it would hand a competitor the lot in one call.
   *
   * Only materials that are actually on sale for someone appear: a material
   * priced for no tier cannot be bought by any account that registers.
   */
  @Get('products')
  async getProducts(@Query() query: PublicProductQueryDto) {
    const result = await this.catalog.guestProducts(query);
    return { message: 'Products fetched successfully', result };
  }

  /** One material, with the names of its grades — still no prices. */
  @Get('products/:productId')
  async getProduct(@Param('productId', ParseUUIDPipe) productId: string) {
    const result = await this.catalog.guestProductDetail(productId);
    return { message: 'Product fetched successfully', result };
  }

  /**
   * Offers. A guest is told one EXISTS on a material, never what it is worth —
   * see CatalogService.mapOffer. A signed-in caller reaching the same route
   * gets the real figures, because by then there is a tier to quote against.
   */
  @Get('offers')
  async getOffers(@CurrentUser() user, @Query() query: OfferQueryDto) {
    const result = await this.catalog.getOffers(user ?? null, query);
    return { message: 'Offers fetched successfully', result };
  }

  @Get('offers/search')
  async searchOffers(@CurrentUser() user, @Query() query: OfferSearchQueryDto) {
    const result = await this.catalog.searchOffers(user ?? null, query);
    return { message: 'Offers fetched successfully', result };
  }
}
