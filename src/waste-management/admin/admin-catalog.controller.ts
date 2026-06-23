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
  CreateProductDto,
  UpdateCategoryDto,
  UpdateProductDto,
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
    return { message: 'تم إضافة المنتج بنجاح', result };
  }

  @Put('products/:productId')
  @Permissions('admin.waste.update')
  async updateProduct(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    const result = await this.adminCatalog.updateProduct(user.id, productId, dto);
    return { message: 'تم تحديث المنتج بنجاح', result };
  }

  @Delete('products/:productId')
  @Permissions('admin.waste.delete')
  async deleteProduct(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.adminCatalog.deleteProduct(user.id, productId);
  }
}
