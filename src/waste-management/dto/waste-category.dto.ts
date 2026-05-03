import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class CreateWasteCategory{
    @IsString()
    @IsNotEmpty()
    @MinLength(2)
    name:string
}