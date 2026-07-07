import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ShiftChangeRequestStatus } from '../enums/shift-change-request-status.enum';

/** Driver: request to be (re)assigned to a truck on a shift. */
export class CreateShiftChangeRequestDto {
  @IsUUID()
  truckId: string;

  @IsUUID()
  shiftId: string;
}

/** Admin: move a request to PROCESSING, or REJECT it (reason required). */
export class UpdateRequestStatusDto {
  @IsIn([ShiftChangeRequestStatus.PROCESSING, ShiftChangeRequestStatus.REJECTED])
  status: ShiftChangeRequestStatus;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  rejectionReason?: string;
}

/** Admin: process a driver's (PROCESSING) request — performs the assignment swap. */
export class ProcessRequestDto {
  @IsUUID()
  driverId: string;
}
