import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { TruckStatus } from '../enums/truck-status.enum';

/** Filter trucks by status and/or by the shift they have a driver assigned on. */
export class ListTrucksQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TruckStatus)
  status?: TruckStatus;

  @IsOptional()
  @IsUUID()
  shiftId?: string;
}
