import { IsIn } from 'class-validator';
import { ADMIN_SETTABLE_TRUCK_STATUSES, TruckStatus } from '../enums/truck-status.enum';

/**
 * Toggle a truck between ACTIVE and DISABLED only. The busy statuses are derived
 * from driver assignments and cannot be set here.
 */
export class UpdateTruckStatusDto {
  @IsIn(ADMIN_SETTABLE_TRUCK_STATUSES as readonly TruckStatus[])
  status: TruckStatus;
}
