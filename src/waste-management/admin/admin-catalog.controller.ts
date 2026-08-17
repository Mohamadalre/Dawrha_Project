import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
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
  OfferTimelineQueryDto,
  UpdateProductDto,
  UpdateUnitDto,
} from './dto/admin-catalog.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/waste', version: '1' })
export class AdminCatalogController {
  constructor(
    private readonly adminCatalog: AdminCatalogService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /**
   * Uploads an image FILE (when one is attached) and returns its URL.
   *
   * Category and product images arrive as a MULTIPART FILE in the request body,
   * never as a pasted URL: a link the client sends could point anywhere, would
   * bypass validation and cloud storage, and would rot the moment its source
   * moved. The file is uploaded here and only the resulting Cloudinary URL is
   * handed to the service. `undefined` (no file) leaves the image unchanged on
   * an edit and empty on a create.
   */
  private async uploadedImageUrl(
    file: Express.Multer.File | undefined,
    ownerId: string,
    kind: 'category' | 'product',
  ): Promise<string | undefined> {
    if (!file) return undefined;
    const uploaded = await this.cloudinary.uploadFile(file, ownerId, 'catalog', kind);
    return uploaded.imageUrl;
  }

  // Categories
  @Get('categories')
  @Permissions('admin.waste.manage')
  async listCategories(@Query() query: AdminListQueryDto) {
    const result = await this.adminCatalog.listCategories(query);
    return { message: 'Categories fetched successfully', result };
  }

  @Get('categories/:categoryId')
  @Permissions('admin.waste.manage')
  async getCategory(@Param('categoryId', ParseUUIDPipe) categoryId: string) {
    const result = await this.adminCatalog.getCategoryById(categoryId);
    return { message: 'Category fetched successfully', result };
  }

  @Post('categories')
  @Permissions('admin.waste.create')
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async createCategory(
    @CurrentUser() user,
    @Body() dto: CreateCategoryDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const imageUrl = await this.uploadedImageUrl(file, user.id, 'category');
    const result = await this.adminCatalog.createCategory(user.id, dto, imageUrl);
    return { message: 'Category created successfully', result };
  }

  @Put('categories/:categoryId')
  @Permissions('admin.waste.update')
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async updateCategory(
    @CurrentUser() user,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: UpdateCategoryDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const imageUrl = await this.uploadedImageUrl(file, user.id, 'category');
    return this.adminCatalog.updateCategory(user.id, categoryId, dto, imageUrl);
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

  /**
   * Every material with its category, unit, grades and CURRENT price for ALL
   * FOUR buyer roles at once (citizen / institution / factory / free facility).
   * Supports the same search / status / category filters and pagination.
   */
  @Get('products/pricing-overview')
  @Permissions('admin.waste.manage')
  async materialsPricingOverview(@Query() query: AdminListQueryDto) {
    const result = await this.adminCatalog.materialsPricingOverview(query);
    return { message: 'Materials pricing fetched successfully', result };
  }

  /** One material by id (declared AFTER the static products/* routes above). */
  @Get('products/:productId')
  @Permissions('admin.waste.manage')
  async getProduct(@Param('productId', ParseUUIDPipe) productId: string) {
    const result = await this.adminCatalog.getProductById(productId);
    return { message: 'Product fetched successfully', result };
  }

  @Post('products')
  @Permissions('admin.waste.create')
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async createProduct(
    @CurrentUser() user,
    @Body() dto: CreateProductDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const imageUrl = await this.uploadedImageUrl(file, user.id, 'product');
    const result = await this.adminCatalog.createProduct(user.id, dto, imageUrl);
    return { message: 'Product created successfully', result };
  }

  @Put('products/:productId')
  @Permissions('admin.waste.update')
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async updateProduct(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const imageUrl = await this.uploadedImageUrl(file, user.id, 'product');
    const result = await this.adminCatalog.updateProduct(user.id, productId, dto, imageUrl);
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

  /**
   * Edit an offer through ONE route: its description, its size (amount OR
   * percentage), and its window — any subset in a single call.
   *
   * Replaces the former focused routes (`/amount` and `/validity`). PATCH
   * semantics: only the fields sent change, so an edit cannot silently rewrite
   * what it did not touch. The audience/target roles are NOT editable here —
   * changing who an offer is for flips which way it moves a price.
   *
   * Takes effect everywhere the offer is read — the offers list, the material
   * listings, and any cart line added AFTER the change. Orders already placed
   * keep the price they were quoted (the cart snapshots `unit_price` on add).
   */
  @Patch('offers/:offerId')
  @Permissions('admin.waste.update')
  async updateOffer(
    @CurrentUser() user,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: UpdateOfferDto,
  ) {
    const result = await this.adminCatalog.updateOffer(user.id, offerId, dto);
    return { message: 'Offer updated successfully', result };
  }

  @Delete('offers/:offerId')
  @Permissions('admin.waste.delete')
  async deleteOffer(
    @CurrentUser() user,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.adminCatalog.deleteOffer(user.id, offerId);
  }

  /**
   * The timeline of ONE material's offers, filterable by time.
   *
   * `?on=<date>` returns the offers that were live on that date (their validity
   * window contains it); `?from=&to=` returns those whose window overlaps the
   * range; with neither, the whole timeline comes back, newest window first.
   * This is the "what was on offer for this material on such a day" view.
   */
  @Get('products/:productId/offers/timeline')
  @Permissions('admin.waste.manage')
  async offerTimeline(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: OfferTimelineQueryDto,
  ) {
    const result = await this.adminCatalog.offerTimeline(productId, query);
    return { message: 'Offer timeline fetched successfully', result };
  }

  // Measurement units (dynamic — no fixed enum)
  @Get('units')
  @Permissions('admin.waste.manage')
  async listUnits(@Query() query: AdminListQueryDto) {
    const result = await this.adminCatalog.listUnits(query);
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
