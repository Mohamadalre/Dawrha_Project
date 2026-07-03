import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Admins may edit a shift's name and/or its start/end times (HH:mm or HH:mm:ss). */
export class UpdateShiftDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'startTime must be a valid 24h time (HH:mm or HH:mm:ss)',
  })
  startTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'endTime must be a valid 24h time (HH:mm or HH:mm:ss)',
  })
  endTime?: string;
}
