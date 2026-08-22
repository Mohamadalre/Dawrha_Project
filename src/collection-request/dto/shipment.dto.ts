import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeliverShipmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
