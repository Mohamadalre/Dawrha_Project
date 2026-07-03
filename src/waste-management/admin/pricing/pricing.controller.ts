import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { PricingTier } from '@src/waste-management/enums/pricing-tier.enum';
import { PricingService } from './pricing.service';
import { SetPricingDto } from './dto/set-pricing.dto';
import { UpdateTierPriceDto } from './dto/update-tier-price.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/waste/products', version: '1' })
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  /** Replace the full price list (all four tiers). */
  @Post(':productId/pricing')
  @Permissions('admin.pricing.manage')
  async setPricing(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetPricingDto,
  ) {
    const result = await this.pricingService.setPricing(user.id, productId, dto);
    return { message: result.message, result };
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
    const result = await this.pricingService.updateTierPrice(user.id, productId, tier, dto);
    return { message: result.message, result };
  }

  /** Delete the whole price list — it is moved to history. */
  @Delete(':productId/pricing')
  @Permissions('admin.pricing.manage')
  async deletePricing(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    const result = await this.pricingService.deletePricing(user.id, productId);
    return { message: result.message, result };
  }

  /** Current (live) price per tier. */
  @Get(':productId/pricing')
  @Permissions('admin.pricing.manage')
  async getCurrent(@Param('productId', ParseUUIDPipe) productId: string) {
    const result = await this.pricingService.getCurrentPricing(productId);
    return { message: 'Current pricing fetched successfully', result };
  }

  /** Previous (archived) prices. */
  @Get(':productId/pricing/history')
  @Permissions('admin.pricing.manage')
  async getHistory(@Param('productId', ParseUUIDPipe) productId: string) {
    const result = await this.pricingService.getPriceHistory(productId);
    return { message: 'Price history fetched successfully', result };
  }
}
