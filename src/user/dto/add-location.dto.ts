import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { LocationDto } from '@src/onboarding/dto/location.dto';

/**
 * Adding a location AFTER onboarding — the same fields as the onboarding
 * location, plus a NAME the citizen gives it.
 *
 * The name lives ONLY here, not on the shared onboarding DTO: the first location
 * is captured during signup and needs no label, while the extra ones a citizen
 * saves later are chosen from at checkout and so must be nameable ("Home",
 * "Work"). Extending keeps every location rule in one place and adds the label
 * without touching the onboarding flow.
 */
export class AddLocationDto extends LocationDto {
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;
}
