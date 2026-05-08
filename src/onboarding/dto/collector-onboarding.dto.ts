import { normalizeSyrianPhoneNumber } from "@src/common/utils/phone-normalization.provider";
import { CollectionFrequeny } from "@src/user/enums/collectionFrequeny.enum";
import { Shift } from "@src/user/enums/shift.enum";
import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, IsOptional, Matches, IsEnum, IsArray, ArrayNotEmpty, IsUUID } from "class-validator";

export class InformationCollectorDTo {
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

