import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class AddMyCategoriesDto {
  /** Category ids to add to the caller's own selected-categories list. */
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true, message: 'Each waste category id must be a valid id' })
  categoryIds: string[];
}
