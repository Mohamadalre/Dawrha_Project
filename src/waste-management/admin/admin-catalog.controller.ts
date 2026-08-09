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
  UpdateOfferAmountDto,
  UpdateOfferValidityDto,
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

  // The general "edit the whole offer" route (PUT offers/:offerId) was removed
  // on purpose. An offer is edited through the two FOCUSED routes below —
  // `/amount` (with its dates) and `/validity` — which each re-validate exactly
  // what they touch. The general route required re-sending the audience and the
  // amount on every edit, where a slip silently rewrote them; deleting it closes
  // that footgun and leaves one clear way to make each kind of change.

  /**
   * Change ONLY when the offer ends.
   *
   * Separate from the general update because it is the common edit and the one
   * an operator reaches for under time pressure — extending an offer that is
   * about to lapse. Sending it through the full update means composing a body
   * that repeats the price and the audience, and a mistake there silently
   * rewrites them.
   *
   * Null clears the date, making the offer open-ended.
   */
  @Patch('offers/:offerId/validity')
  @Permissions('admin.waste.update')
  async updateOfferValidity(
    @CurrentUser() user,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: UpdateOfferValidityDto,
  ) {
    const result = await this.adminCatalog.updateOfferValidity(user.id, offerId, dto);
    return { message: 'Offer validity updated successfully', result };
  }

  /**
   * Change the AMOUNT the price moves by — and, in the same request, when the
   * offer runs.
   *
   * They travel together because they are one decision in practice ("make it 2
   * off, and run it to the end of the month"), and split across two calls the
   * offer is briefly live at the new amount on the old dates — long enough for
   * a real order to be priced by it. Both dates are optional: send only the
   * amount and the window is left exactly as it was.
   *
   * Takes effect everywhere the offer is read — the offers list, the material
   * listings, and any cart line added AFTER the change. Orders already placed
   * keep the price they were quoted: the cart snapshots `unit_price` when the
   * line is created, so a later edit cannot reprice work already committed.
   */
  @Patch('offers/:offerId/amount')
  @Permissions('admin.waste.update')
  async updateOfferAmount(
    @CurrentUser() user,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: UpdateOfferAmountDto,
  ) {
    const result = await this.adminCatalog.updateOfferAmount(user.id, offerId, dto);
    return { message: 'Offer amount updated successfully', result };
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
