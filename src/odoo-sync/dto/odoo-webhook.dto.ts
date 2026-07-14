import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/**
 * Payload sent by the Odoo automated action when recycle.stock changes.
 * Omitting `odoo_warehouse_id` re-syncs every Odoo-linked warehouse.
 */
export class OdooInventoryWebhookDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  odoo_warehouse_id?: number;
}


export class OdooDriverDecisionDto {
  @IsUUID()
  backend_driver_id: string;

  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  /**
   * Full lifecycle control from Odoo: overrides `approved` when present.
   * ACTIVE (approve/unblock) | REJECTED | BLOCKED | NEED_CHANGES (request info edits).
   */
  @IsOptional()
  @IsIn(['ACTIVE', 'REJECTED', 'BLOCKED', 'NEED_CHANGES'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejection_reason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  truck_odoo_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shift_odoo_id?: number;
}

export class OdooShiftChangeDecisionDto {
  @IsUUID()
  backend_request_id: string;

  @IsBoolean()
  approved: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejection_reason?: string;
}
