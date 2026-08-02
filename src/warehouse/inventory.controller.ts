import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { InventoryQueryService } from './providers/inventory-query.service';

/**
 * Stock questions asked BY MATERIAL rather than by warehouse.
 *
 * Kept on its own path because the two shapes read differently: the warehouse
 * routes answer "what is in this building", these answer "where is this
 * material". Nesting the second under `/warehouses/:id` would have forced a
 * warehouse into a question that has none.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/inventory', version: '1' })
export class InventoryController {
  constructor(private readonly inventory: InventoryQueryService) {}

  /** One material in one warehouse: available + a line per grade. */
  @Get('warehouses/:warehouseId/products/:productId')
  @Permissions('admin.warehouse.view')
  async inWarehouse(
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.inventory.forProductInWarehouse(productId, warehouseId);
  }

  /** One material everywhere: totals, grade breakdown, and which warehouses hold it. */
  @Get('products/:productId')
  @Permissions('admin.warehouse.view')
  async everywhere(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.inventory.forProduct(productId);
  }
}
