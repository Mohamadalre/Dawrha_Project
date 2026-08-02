import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { SuggestionStatus } from '../../enums/suggestion-status.enum';
import { SuggestionSource } from '../../enums/suggestion-source.enum';

export class ReviewSuggestionDto {
  /**
   * Only a terminal ruling may be set here. PENDING_REVIEW is excluded on
   * purpose: "un-reviewing" a decision the proposer has already been told about
   * would leave the two sides disagreeing about what was decided.
   */
  @IsIn([SuggestionStatus.APPROVED, SuggestionStatus.REJECTED])
  status: SuggestionStatus.APPROVED | SuggestionStatus.REJECTED;

  /** Required when rejecting — see SuggestionsService.review. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  admin_notes?: string;
}

export class ListSuggestionsQuery extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(SuggestionStatus)
  status?: SuggestionStatus;

  /** `ODOO` gives exactly the read-only list of what the Odoo admin proposed. */
  @IsOptional()
  @IsEnum(SuggestionSource)
  source?: SuggestionSource;
}
