import { Body, Controller, Get, Param, Post, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { PricingService } from './pricing.service';
import { SetPricingDto } from './dto/set-pricing.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/waste/products', version: '1' })
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

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

  @Get(':productId/pricing')
  @Permissions('admin.pricing.manage')
  async getHistory(@Param('productId', ParseUUIDPipe) productId: string) {
    const result = await this.pricingService.getPriceHistory(productId);
    return { message: 'Price history fetched successfully', result };
  }
}
