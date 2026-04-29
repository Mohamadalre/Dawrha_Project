import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsString,
  IsOptional,
  IsNotEmpty,
  //IsIn,
} from 'class-validator';

export class LocationDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  coordinates: number[]; 

  // @IsString()
  // @IsIn(['Point'])
  // type: 'Point';

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsOptional()
  descriptionAddress?: string;

  @IsString()
  @IsNotEmpty()
  provinceId: string;
}