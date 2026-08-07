import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
  ReplySuggestionDto,
} from './dto/review-suggestion.dto';

/**
 * The admin's view of proposed materials — from app buyers and the Odoo
 * administrator alike. The admin READS proposals (oldest first, filterable by
 * who submitted them) and may REPLY to a proposer; there is no approve/reject
 * and no status to change.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/waste/suggestions', version: '1' })
export class AdminSuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  /** Oldest first; filter with `?submitted_by=FACTORY|INSTITUTIONS|…|ODOO`. */
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
   * Send a reply to the proposer. It reaches them as a notification. Does not
   * create a material and does not change any status.
   */
  @Post(':suggestionId/reply')
  @HttpCode(HttpStatus.OK)
  @Permissions('admin.waste.manage')
  async reply(
    @CurrentUser() user,
    @Param('suggestionId', ParseUUIDPipe) suggestionId: string,
    @Body() dto: ReplySuggestionDto,
  ) {
    return this.suggestions.reply(user.id, suggestionId, dto.message);
  }
}
