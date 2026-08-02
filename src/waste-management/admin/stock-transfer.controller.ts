import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { StockTransferService } from './stock-transfer.service';

export class TransferStockDto {
  @IsUUID()
  warehouseId: string;

  /**
   * The grades, BY ID.
   *
   * Not by code: a grade code is unique only within its material, so nothing
   * about the string "GOOD" says whose GOOD it is. Both ids are checked to
   * belong to the material in the path — a transfer between grades of two
   * different materials would move quantity between unrelated things, and no
   * total would balance afterwards.
   */
  @IsUUID()
  fromConditionId: string;

  @IsUUID()
  toConditionId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;

  /** Why. Recorded in the audit trail — a re-grade without a reason is a
   *  quantity that moved and nobody can say why. */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  reason?: string;
}

/**
 * Re-grading stock that is already in a warehouse.
 *
 * A re-inspection changes the answer: material graded GOOD on arrival turns out
 * to be EXCELLENT. Without this the only ways out were to write it off and
 * re-receive it — inventing a delivery that never happened — or to leave the
 * stock mislabelled and therefore mispriced.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/waste/products/:productId/conditions', version: '1' })
export class StockTransferController {
  constructor(private readonly transfers: StockTransferService) {}

  /**
   * Move quantity from one grade of a material to another.
   *
   * Only UNRESERVED stock moves. Reserved quantity is promised to an order that
   * has not shipped, and moving it would leave that order pointing at a grade
   * its goods are no longer in — with the shortage surfacing at deduction time,
   * after the buyer was told yes. The response reports what was left untouched.
   *
   * The source grade is kept even when it empties: an empty grade is still one
   * this material is sold at.
   */
  @Post('transfer-stock')
  @Permissions('admin.warehouse.manage')
  async transferStock(
    @CurrentUser() user,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: TransferStockDto,
  ) {
    return this.transfers.transfer(user.id, productId, {
      warehouseId: dto.warehouseId,
      fromConditionId: dto.fromConditionId,
      toConditionId: dto.toConditionId,
      quantity: dto.quantity,
      reason: dto.reason,
    });
  }
}
