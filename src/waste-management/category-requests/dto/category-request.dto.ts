import { IsArray, IsOptional, IsString, IsUUID, ArrayNotEmpty, MaxLength } from 'class-validator';
import { IsIn } from 'class-validator';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';

export class CreateCategoryRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  categoryIds: string[];
}

export class RejectCategoryRequestDto {
  @IsString()
  @MaxLength(1000)
  reason: string;
}

export class CategoryRequestQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'all'])
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'all' = 'PENDING';
}
