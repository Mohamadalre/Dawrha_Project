import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class CreateInstitutionTypeDto{
    @IsString()
    @IsNotEmpty({message:'Institution type is required'})
    @MinLength(2)
    name:string
}

export class UpdateInstitutionTypeDto {
    @IsString()
    @IsNotEmpty({ message: 'Institution type is required' })
    @MinLength(2)
    name: string;
}