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
    const result = await this.adminCatalog.createCategory(user.id, dto);
    return { message: result.message, result };
  }

  @Put('categories/:categoryId')
  @Permissions('admin.waste.update')
  async updateCategory(
    @CurrentUser() user,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    const result = await this.adminCatalog.updateCategory(user.id, categoryId, dto);
    return { message: result.message, result };
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
    const result = await this.adminCatalog.createOffer(user.id, dto);
    return { message: result.message, result };
  }

  @Put('offers/:offerId')
  @Permissions('admin.waste.update')
  async updateOffer(
    @CurrentUser() user,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: UpdateOfferDto,
  ) {
    const result = await this.adminCatalog.updateOffer(user.id, offerId, dto);
    return { message: result.message, result };
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
    const result = await this.adminCatalog.createUnit(user.id, dto);
    return { message: result.message, result };
  }

  @Put('units/:unitId')
  @Permissions('admin.waste.update')
  async updateUnit(
    @CurrentUser() user,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() dto: UpdateUnitDto,
  ) {
    const result = await this.adminCatalog.updateUnit(user.id, unitId, dto);
    return { message: result.message, result };
  }

  @Delete('units/:unitId')
  @Permissions('admin.waste.delete')
  async deleteUnit(
    @CurrentUser() user,
    @Param('unitId', ParseUUIDPipe) unitId: string,
  ) {
    return this.adminCatalog.deleteUnit(user.id, unitId);
  }

  // Material conditions (grades) — dynamic, pushed to the Odoo sorting UI
  @Get('conditions')
  @Permissions('admin.waste.manage')
  async listConditions() {
    const result = await this.adminCatalog.listConditions();
    return { message: 'Conditions fetched successfully', result };
  }

  @Post('conditions')
  @Permissions('admin.waste.create')
  async createCondition(@CurrentUser() user, @Body() dto: CreateConditionDto) {
    const result = await this.adminCatalog.createCondition(user.id, dto);
    return { message: result.message, result };
  }

  @Put('conditions/:conditionId')
  @Permissions('admin.waste.update')
  async updateCondition(
    @CurrentUser() user,
    @Param('conditionId', ParseUUIDPipe) conditionId: string,
    @Body() dto: UpdateConditionDto,
  ) {
    const result = await this.adminCatalog.updateCondition(user.id, conditionId, dto);
    return { message: result.message, result };
  }

  @Delete('conditions/:conditionId')
  @Permissions('admin.waste.delete')
  async deleteCondition(
    @CurrentUser() user,
    @Param('conditionId', ParseUUIDPipe) conditionId: string,
  ) {
    return this.adminCatalog.deleteCondition(user.id, conditionId);
  }
}
