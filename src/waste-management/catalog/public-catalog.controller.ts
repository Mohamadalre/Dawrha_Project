import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '@src/auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { CatalogService } from './catalog.service';
import {
  CategoryQueryDto,
  OfferQueryDto,
  OfferSearchQueryDto,
} from './dto/catalog-query.dto';

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
