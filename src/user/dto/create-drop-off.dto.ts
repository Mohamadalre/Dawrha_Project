import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class DropOffLineDto {
  @ApiProperty({ description: 'Product ID' })
  @IsUUID()
  @IsNotEmpty()
  product_id: string;

  @ApiProperty({ description: 'Quantity', example: 5 })
  @IsNumber()
  @Min(0.01)
  quantity: number;
}

export class CreateDropOffDto {
  @ApiProperty({ description: 'Driver ID (from QR scan)' })
  @IsUUID()
  @IsNotEmpty()
  driver_id: string;

  @ApiProperty({ description: 'Coverage point ID' })
  @IsUUID()
  @IsNotEmpty()
  coverage_point_id: string;

  @ApiProperty({ description: 'Material lines', type: [DropOffLineDto] })
  @IsArray()
  @IsNotEmpty()
  lines: DropOffLineDto[];
}
