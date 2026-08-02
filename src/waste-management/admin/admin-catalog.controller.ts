import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { AdminCatalogService } from './admin-catalog.service';
import {
  AdminListQueryDto,
  CreateCategoryDto,
  CreateConditionDto,
  CreateOfferDto,
  CreateProductDto,
  CreateUnitDto,
  UpdateCategoryDto,
  UpdateConditionDto,
  UpdateOfferDto,
  UpdateProductDto,
  UpdateUnitDto,
} from './dto/admin-catalog.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/waste', version: '1' })
export class AdminCatalogController {
  constructor(private readonly adminCatalog: AdminCatalogService) {}

  // Categories
  @Get('categories')
  @Permissions('admin.waste.manage')
  async listCategories(@Query() query: AdminListQueryDto) {
    const result = await this.adminCatalog.listCategories(query);
    return { message: 'Categories fetched successfully', result };
  }

  @Post('categories')
  @Permissions('admin.waste.create')
  async createCategory(@CurrentUser() user, @Body() dto: CreateCategoryDto) {
    return this.adminCatalog.createCategory(user.id, dto);
  }

  @Put('categories/:categoryId')
  @Permissions('admin.waste.update')
  async updateCategory(
    @CurrentUser() user,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.adminCatalog.updateCategory(user.id, categoryId, dto);
  }

  @Delete('categories/:categoryId')
  @Permissions('admin.waste.delete')
  async deleteCategory(
    @CurrentUser() user,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return this.adminCatalog.deleteCategory(user.id, categoryId);
  }

  // Products
  @Get('products')
  @Permissions('admin.waste.manage')
  async listProducts(@Query() query: AdminListQueryDto) {
    const result = await this.adminCatalog.listProducts(query);
    return { message: 'Products fetched successfully', result };
  }

  @Post('products')
  @Permissions('admin.waste.create')
  async createProduct(@CurrentUser() user, @Body() dto: CreateProductDto) {
    const result = await this.adminCatalog.createProduct(user.id, dto);
    return { message: 'Product created successfully', result };
  }

  @Put('products/:productId')
  @Permissions('admin.waste.update')
  async updateProduct(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    const result = await this.adminCatalog.updateProduct(user.id, productId, dto);
    return { message: 'Product updated successfully', result };
  }

  @Delete('products/:productId')
  @Permissions('admin.waste.delete')
  async deleteProduct(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.adminCatalog.deleteProduct(user.id, productId);
  }

  // Offers (may target one material condition for graded buyers)
  @Get('offers')
  @Permissions('admin.waste.manage')
  async listOffers(@Query() query: AdminListQueryDto) {
    const result = await this.adminCatalog.listOffers(query);
    return { message: 'Offers fetched successfully', result };
  }

  @Post('offers')
  @Permissions('admin.waste.create')
  async createOffer(@CurrentUser() user, @Body() dto: CreateOfferDto) {
    return this.adminCatalog.createOffer(user.id, dto);
  }

  @Put('offers/:offerId')
  @Permissions('admin.waste.update')
  async updateOffer(
    @CurrentUser() user,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.adminCatalog.updateOffer(user.id, offerId, dto);
  }

  @Delete('offers/:offerId')
  @Permissions('admin.waste.delete')
  async deleteOffer(
    @CurrentUser() user,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.adminCatalog.deleteOffer(user.id, offerId);
  }

  // Measurement units (dynamic — no fixed enum)
  @Get('units')
  @Permissions('admin.waste.manage')
  async listUnits() {
    const result = await this.adminCatalog.listUnits();
    return { message: 'Units fetched successfully', result };
  }

  @Post('units')
  @Permissions('admin.waste.create')
  async createUnit(@CurrentUser() user, @Body() dto: CreateUnitDto) {
    return this.adminCatalog.createUnit(user.id, dto);
  }

  @Put('units/:unitId')
  @Permissions('admin.waste.update')
  async updateUnit(
    @CurrentUser() user,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.adminCatalog.updateUnit(user.id, unitId, dto);
  }

  @Delete('units/:unitId')
  @Permissions('admin.waste.delete')
  async deleteUnit(
    @CurrentUser() user,
    @Param('unitId', ParseUUIDPipe) unitId: string,
  ) {
    return this.adminCatalog.deleteUnit(user.id, unitId);
  }

  // Material grades are NOT managed here any more.
  //
  // They belong to a MATERIAL, not to a global vocabulary — the grades that
  // describe scrap paper say nothing useful about copper — so they live under
  // /admin/waste/products/:productId/conditions (ProductConditionsController).
  // Keeping a flat collection here is what made them global in the first place.
}
