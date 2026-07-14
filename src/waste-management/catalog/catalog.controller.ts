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
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
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

  /** Categories the caller picked in the onboarding "material" step. */
  @Get('my-categories')
  @Permissions('waste.materials.view')
  async getMyCategories(@CurrentUser() user) {
    const result = await this.catalog.getMyCategories(user);
    return { message: 'My categories fetched successfully', result };
  }

  /**
   * Products under the categories the caller selected in the onboarding
   * "add material information" step — factories, free facilities, institutions.
   */
  @Get('my-materials')
  @Permissions('waste.materials.view')
  async getMyMaterials(@CurrentUser() user, @Query() query: PaginationQueryDto) {
    const result = await this.catalog.getMyMaterials(user, query);
    return { message: 'My materials fetched successfully', result };
  }

  /** Active material conditions (grades) — pickers for factory / free-facility orders. */
  @Get('conditions')
  @Permissions('waste.products.view')
  async getConditions() {
    const result = await this.catalog.getConditions();
    return { message: 'Conditions fetched successfully', result };
  }

  /** Active measurement units — for unit pickers (suggestions, admin panels). */
  @Get('units')
  @Permissions('waste.products.view')
  async getUnits() {
    const result = await this.catalog.getUnits();
    return { message: 'Units fetched successfully', result };
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

  /** Per-warehouse stock of a product — factories & free facilities only. */
  @Get('products/:productId/availability')
  @Permissions('waste.products.availability')
  async getProductAvailability(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    const result = await this.catalog.getProductAvailability(user, productId);
    return { message: 'Product availability fetched successfully', result };
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
