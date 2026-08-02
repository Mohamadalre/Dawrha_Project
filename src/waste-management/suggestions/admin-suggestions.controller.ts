import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { SuggestionsService } from './suggestions.service';
import {
  ListSuggestionsQuery,
  ReviewSuggestionDto,
} from './dto/review-suggestion.dto';

/**
 * The admin's review queue for proposed materials — from app buyers and from
 * the Odoo administrator alike, since both now propose rather than create.
 *
 * `?source=ODOO` is the read-only list of what Odoo proposed.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/waste/suggestions', version: '1' })
export class AdminSuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get()
  @Permissions('admin.waste.manage')
  async list(@Query() query: ListSuggestionsQuery) {
    return this.suggestions.listForAdmin(query);
  }

  @Get(':suggestionId')
  @Permissions('admin.waste.manage')
  async detail(@Param('suggestionId', ParseUUIDPipe) suggestionId: string) {
    return this.suggestions.detailForAdmin(suggestionId);
  }

  /**
   * Rules on a proposal. Approving records the decision and tells the proposer
   * — it does NOT create the material (see SuggestionsService.review).
   *
   * 200: an existing proposal is edited; nothing is created, here or anywhere.
   */
  @Patch(':suggestionId/review')
  @HttpCode(HttpStatus.OK)
  @Permissions('admin.waste.manage')
  async review(
    @CurrentUser() user,
    @Param('suggestionId', ParseUUIDPipe) suggestionId: string,
    @Body() dto: ReviewSuggestionDto,
  ) {
    return this.suggestions.review(user.id, suggestionId, dto);
  }
}
