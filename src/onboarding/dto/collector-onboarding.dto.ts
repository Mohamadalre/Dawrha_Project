
import { Shift } from "@src/user/enums/shift.enum";
import { IsNotEmpty, IsString, IsOptional, Matches, IsEnum, IsUUID } from "class-validator";

export class InformationCollectorDto {
    @IsNotEmpty()
    @Matches(/^\d{11}$/, {
        message: 'National ID must be exactly 11 digits',
    })
    NationalID: string;

    @IsNotEmpty()
    @IsString()
    @IsEnum(Shift)
    shift: Shift;

}


export class LocationCollectorDto {

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsOptional()
  descriptionAddress?: string;

  @IsString()
  @IsNotEmpty()
  @IsUUID()
  provinceId: string;
}

