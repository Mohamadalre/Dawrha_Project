

import {
  IsEmail,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateWarehouseDto {
  @IsString()
  warehouseName: string;

  @IsString()
  warehouseCode: string;

  @IsString()
  managerFullName: string;

  @IsEmail()
  managerEmail: string;

  @IsString()
  managerPhone: string;

  @MinLength(6)
  managerPassword: string;
}