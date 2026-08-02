import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Editing an existing warehouse (PATCH — every field optional).
 *
 * ONLY the three fields this side owns. The rest are gone rather than ignored,
 * and that is the point: `governorate`, `address`, `latitude`, `longitude` and
 * `isActive` were all accepted here and silently discarded by the service, so
 * an admin who moved a warehouse to another governorate got a 200, saw their
 * value vanish on the next read, and had no way to tell whether the save or the
 * read was wrong. With `forbidNonWhitelisted` on, removing them turns that into
 * a 400 that names the field.
 *
 * The GOVERNORATE is not editable anywhere, by design and not by omission.
 * Order allocation matches buyers to warehouses by it, and every cached
 * distance, every open order and every delivery price already computed assumes
 * where the warehouse is. Moving a warehouse between governorates is not an
 * edit — it is a new warehouse and the closure of an old one.
 *
 * Location and lifecycle are edited in ODOO, which is the operational system,
 * and flow back through SYNC_WAREHOUSE. Accepting them on both sides would let
 * the two overwrite each other with whichever wrote last.
 */
export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  capacity?: number;
}
