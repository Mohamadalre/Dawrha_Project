import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { CatalogService } from './catalog.service';
import {
  ByPriceQueryDto,
  CategoryQueryDto,
  OfferQueryDto,
  OfferSearchQueryDto,
  ProductQueryDto,
  SearchQueryDto,
} from './dto/catalog-query.dto';

/**
 * Home-screen catalogue read APIs shared by every buyer role.
 *
 * Restricted roles (company / factory / free-facility) are automatically scoped
 * to their assigned categories inside CatalogService, so a single set of
 * endpoints serves the "individual" and "company/factory" specs from the brief.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'waste', version: '1' })
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @Permissions('waste.categories.view')
  async getCategories(@CurrentUser() user, @Query() query: CategoryQueryDto) {
    const result = await this.catalog.getCategories(user, query);
    return { message: 'Categories fetched successfully', result };
  }

  @Get('categories/:categoryId/products')
  @Permissions('waste.products.view')
  async getProductsByCategory(
    @CurrentUser() user,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Query() query: ProductQueryDto,
  ) {
    const result = await this.catalog.getProductsByCategory(user, categoryId, query);
    return { message: 'Products fetched successfully', result };
  }

  @Get('search')
  @Permissions('waste.products.view')
  async search(@CurrentUser() user, @Query() query: SearchQueryDto) {
    const result = await this.catalog.search(user, query);
    return { message: 'Search completed successfully', result };
  }

  @Get('products/by-price')
  @Permissions('waste.products.view')
  async byPrice(@CurrentUser() user, @Query() query: ByPriceQueryDto) {
    const result = await this.catalog.getProductsByPrice(user, query);
    return { message: 'Products fetched successfully', result };
  }

  @Get('offers')
  @Permissions('waste.offers.view')
  async getOffers(@CurrentUser() user, @Query() query: OfferQueryDto) {
    const result = await this.catalog.getOffers(user, query);
    return { message: 'Offers fetched successfully', result };
  }

  @Get('offers/search')
  @Permissions('waste.offers.view')
  async searchOffers(@CurrentUser() user, @Query() query: OfferSearchQueryDto) {
    const result = await this.catalog.searchOffers(user, query);
    return { message: 'Offers fetched successfully', result };
  }
}
