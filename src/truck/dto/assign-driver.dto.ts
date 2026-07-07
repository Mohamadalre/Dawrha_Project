import { IsUUID } from 'class-validator';

/** Assign a driver to a truck on a specific shift. */
export class AssignDriverDto {
  @IsUUID()
  truckId: string;

  @IsUUID()
  driverId: string;

  // @IsUUID()
  // shiftId: string;
}
