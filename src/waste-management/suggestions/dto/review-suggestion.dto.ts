import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { Role } from '@src/user/enums/role.enum';

/**
 * The admin's reply to a proposer. The admin no longer approves or rejects a
 * suggestion — they read it and may send a message, which reaches the proposer
 * as a notification.
 */
export class ReplySuggestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message: string;
}

/** Filter the review queue by WHO submitted it. */
export const SUGGESTION_SUBMITTERS = [
  Role.CITIZEN,
  Role.INSTITUTIONS,
  Role.FACTORY,
  Role.EXTERNAL_PARTNER,
  'ODOO',
] as const;
export type SuggestionSubmitter = (typeof SUGGESTION_SUBMITTERS)[number];

export class ListSuggestionsQuery extends PaginationQueryDto {
  /**
   * The submitter's role — CITIZEN / INSTITUTIONS / FACTORY / EXTERNAL_PARTNER —
   * or `ODOO` for proposals filed by the Odoo administrator.
   */
  @IsOptional()
  @IsIn(SUGGESTION_SUBMITTERS as unknown as string[])
  submitted_by?: SuggestionSubmitter;
}
