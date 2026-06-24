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
import { CartService } from './cart.service';
import { AddOfferToCartDto, AddToCartDto, UpdateCartItemDto } from './dto/cart.dto';

/**
 * Cart APIs for every buyer role. Citizen carts enforce a daily unit cap;
 * company/factory/free-facility carts enforce only the minimum-order rule
 * (no daily cap) — handled inside CartService via per-role CART_LIMITS.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'cart', version: '1' })
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @Permissions('cart.view')
  async getCart(@CurrentUser() user) {
    const result = await this.cartService.getCart(user);
    return { message: 'Cart fetched successfully', result };
  }

  @Post('items')
  @Permissions('cart.manage')
  async addItem(@CurrentUser() user, @Body() dto: AddToCartDto) {
    const result = await this.cartService.addItem(user, dto);
    return { message: 'Product added to cart', result };
  }

  @Put('items/:itemId')
  @Permissions('cart.manage')
  async updateItem(
    @CurrentUser() user,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    const result = await this.cartService.updateItem(user, itemId, dto);
    return { message: 'Cart item updated', result };
  }

  @Delete('items/:itemId')
  @Permissions('cart.manage')
  async removeItem(@CurrentUser() user, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.cartService.removeItem(user, itemId);
  }

  @Post('offers')
  @Permissions('cart.manage')
  async addOffer(@CurrentUser() user, @Body() dto: AddOfferToCartDto) {
    const result = await this.cartService.addOffer(user, dto);
    return { message: 'Offer added to cart', result };
  }

  /** Clears the entire cart (removes all items). */
  @Delete()
  @Permissions('cart.manage')
  async clearCart(@CurrentUser() user) {
    return this.cartService.clearCart(user);
  }
}
