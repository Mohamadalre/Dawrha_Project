import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { PricingTier } from '@src/waste-management/enums/pricing-tier.enum';
import { PricingService } from './pricing.service';
import { SetPricingDto } from './dto/set-pricing.dto';
import { UpdatePricingTableDto } from './dto/update-pricing-table.dto';
import { UpdateTierPriceDto } from './dto/update-tier-price.dto';
import {
  CorrectPricingDto,
  PriceHistoryQueryDto,
  SetPricingExpiryDto,
  UpdateCurrentCurrencyDto,
} from './dto/pricing-admin.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/waste/products', version: '1' })
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  /** Replace the full price list (all four tiers). */
  // 200: this REPLACES the price list of an existing product (an upsert on a
  // sub-resource), so no new resource is created for the client to follow.
  @HttpCode(HttpStatus.OK)
  @Post(':productId/pricing')
  @Permissions('admin.pricing.manage')
  async setPricing(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetPricingDto,
  ) {
    return this.pricingService.setPricing(user.id, productId, dto);
  }

  /**
   * Edits the price table — any subset of roles, in one call.
   *
   * The role is the KEY in the body, not a field: `{ "factory": [...] }` says
   * which tier is being edited, and editing two tiers becomes one atomic call
   * rather than two that can half-fail. A tier left out keeps its prices.
   *
   * 200: nothing is created — an existing table is edited.
   */
  @Patch(':productId/pricing')
  @HttpCode(HttpStatus.OK)
  @Permissions('admin.waste.update')
  async updatePricingTable(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdatePricingTableDto,
  ) {
    return this.pricingService.updatePricingTable(user.id, productId, dto);
  }
  /**
   * Re-denominate the CURRENT price list — live rows only, history untouched.
   *
   * Declared BEFORE `:productId/pricing/:tier`, or `/currency` would be captured
   * as a tier value and rejected by the enum pipe. Omit `tier` in the body to
   * move every live tier together.
   */
  @Patch(':productId/pricing/currency')
  @Permissions('admin.pricing.manage')
  async updateCurrency(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateCurrentCurrencyDto,
  ) {
    return this.pricingService.updateCurrentCurrency(
      user.id, productId, dto.currency, dto.tier,
    );
  }

  /** Edit a single tier's price (e.g. only FACTORY). */
  @Patch(':productId/pricing/:tier')
  @Permissions('admin.pricing.manage')
  async updateTier(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('tier', new ParseEnumPipe(PricingTier)) tier: PricingTier,
    @Body() dto: UpdateTierPriceDto,
  ) {
    return this.pricingService.updateTierPrice(user.id, productId, tier, dto);
  }

  // ── One route per buyer tier ───────────────────────────────────────
  //
  // POST, not PATCH, and named rather than parameterised. Setting a tier's
  // price REPLACES it: the live row is archived and a new one opens, because a
  // price change is a new fact with its own start date — an order placed last
  // week was priced at last week's figure, and rewriting the row in place would
  // make that order unexplainable. POST is the honest verb for "create the new
  // price"; PATCH would suggest the old number is being edited.
  //
  // Correcting a number that was simply typed wrong is a different act and has
  // its own route: PATCH pricing/:pricingId.

  /** Factories — priced per grade when the material is graded. */
  @Post(':productId/pricing/factory')
  @Permissions('admin.pricing.manage')
  async setFactoryPrice(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateTierPriceDto,
  ) {
    return this.pricingService.updateTierPrice(
      user.id, productId, PricingTier.FACTORY, dto);
  }

  /** Free facilities — priced per grade when the material is graded. */
  @Post(':productId/pricing/free-facility')
  @Permissions('admin.pricing.manage')
  async setFreeFacilityPrice(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateTierPriceDto,
  ) {
    return this.pricingService.updateTierPrice(
      user.id, productId, PricingTier.FREE_FACILITY, dto);
  }

  /** Institutions — one price for the material, never per grade. */
  @Post(':productId/pricing/institution')
  @Permissions('admin.pricing.manage')
  async setInstitutionPrice(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateTierPriceDto,
  ) {
    return this.pricingService.updateTierPrice(
      user.id, productId, PricingTier.COMPANY, dto);
  }

  /** Individual users — one price for the material, never per grade. */
  @Post(':productId/pricing/user')
  @Permissions('admin.pricing.manage')
  async setUserPrice(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateTierPriceDto,
  ) {
    return this.pricingService.updateTierPrice(
      user.id, productId, PricingTier.INDIVIDUAL, dto);
  }

  /**
   * Give the live prices an end date.
   *
   * NOT the same as deleting the list: deleting suspends the material at once
   * and pulls it from every catalogue, while this leaves it sellable until the
   * date arrives. Omit `tier` to expire every tier together.
   */
  @Post(':productId/pricing/expiry')
  @Permissions('admin.pricing.manage')
  async setPricingExpiry(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetPricingExpiryDto,
  ) {
    return this.pricingService.expireCurrentPricing(
      user.id,
      productId,
      new Date(dto.effective_until),
      dto.tier,
    );
  }

  /** Delete the whole price list — it is moved to history. */
  @Delete(':productId/pricing')
  @Permissions('admin.pricing.manage')
  async deletePricing(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.pricingService.deletePricing(user.id, productId);
  }

  /** Current (live) price per tier. */
  @Get(':productId/pricing')
  @Permissions('admin.pricing.manage')
  async getCurrent(@Param('productId', ParseUUIDPipe) productId: string) {
    const result = await this.pricingService.getCurrentPricing(productId);
    return { message: 'Current pricing fetched successfully', result };
  }

  /**
   * The price timeline — live rows AND archived ones, every tier.
   *
   * `as_of=YYYY-MM-DD` answers "what did we charge on that day": a price was in
   * force on a date when it started on or before it and had not yet ended. That
   * rule is applied to the live table as well as the archive, because a price
   * still in force today was also in force last month and lives in the LIVE
   * table — reading only the archive is what made this look empty.
   */
  @Get(':productId/pricing/history')
  @Permissions('admin.pricing.manage')
  async getHistory(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: PriceHistoryQueryDto,
  ) {
    const result = await this.pricingService.getPriceHistory(productId, {
      as_of: query.as_of,
      page: query.page,
      limit: query.limit,
    });
    return { message: 'Price history fetched successfully', result };
  }

  /**
   * Correct a live price that was typed wrong.
   *
   * PATCH because the row is edited in place — no archive entry, because no
   * commercial price change happened. A superseded row cannot be corrected: it
   * is what past orders were actually charged at.
   */
  @Patch('pricing/:pricingId')
  @Permissions('admin.pricing.manage')
  async correctPricing(
    @CurrentUser() user,
    @Param('pricingId', ParseUUIDPipe) pricingId: string,
    @Body() dto: CorrectPricingDto,
  ) {
    return this.pricingService.correctPricingRow(user.id, pricingId, {
      price: dto.price,
      currency: dto.currency,
    });
  }

  /**
   * One price row in full, by its own id — with the recent history of its tier
   * alongside it.
   *
   * Declared LAST on purpose: `:productId/pricing/...` would otherwise swallow
   * a bare `pricing/<id>` path, and the route that matched first would win.
   */
  @Get('pricing/:pricingId')
  @Permissions('admin.pricing.manage')
  async getPricingById(@Param('pricingId', ParseUUIDPipe) pricingId: string) {
    return this.pricingService.getPricingById(pricingId);
  }
}
