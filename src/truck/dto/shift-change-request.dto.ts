import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * A driver's shift-change request: ONLY the shift he wants to move into plus
 * a mandatory reason. No truck is picked here — the warehouse manager
 * reserves one (of the requested shift) when he approves in Odoo.
 */
export class CreateShiftChangeRequestDto {
  /** Backend id of the DRIVER shift (of the driver's own warehouse). */
  @IsUUID()
  shiftId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
