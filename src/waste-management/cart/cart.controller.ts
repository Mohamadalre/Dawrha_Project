import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  // Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { CartService } from './cart.service';
import { AddToCartDto, UpdateCartItemDto } from './dto/cart.dto';

/**
 * Cart APIs for every buyer role. The cart is just a basket — it carries no
 * quantity floor or daily unit cap. The commercial guardrails are VALUE-based
 * and admin-managed (minimum order value + spending cap) and are enforced at
 * CHECKOUT, the one place a basket becomes money.
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

  // NOTE: there is no separate "add offer to cart" route any more. An offer is
  // just a price on a MATERIAL, so adding the material (POST items) already
  // applies whatever offer is live for the caller's role — a second route would
  // be a second way to do the same thing, out of step the moment one changed.

  /** Clears the entire cart (removes all items). */
  @Delete()
  @Permissions('cart.manage')
  async clearCart(@CurrentUser() user) {
    return this.cartService.clearCart(user);
  }
}
