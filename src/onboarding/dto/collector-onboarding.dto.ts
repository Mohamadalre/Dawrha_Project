
import { IsNotEmpty, IsString, IsOptional, Matches, IsUUID } from "class-validator";

export class InformationCollectorDto {
    @IsNotEmpty()
    @Matches(/^\d{11}$/, {
        message: 'National ID must be exactly 11 digits',
    })
    NationalID: string;

    // The chosen work shift (from GET /shifts) — id, not an enum value.
    @IsNotEmpty()
    @IsString()
    @IsUUID()
    shiftId: string;

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

