import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { SuggestionsService } from './suggestions.service';
import { CreateSuggestionDto } from './dto/create-suggestion.dto';

/**
 * Product suggestion API shared by all buyer roles. The suggesting account's
 * role is captured in the audit log, so a single endpoint serves the
 * individual and company variants from the brief.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'waste/products', version: '1' })
export class SuggestionsController {
  constructor(private readonly suggestionsService: SuggestionsService) {}

  @Post('suggest')
  @Permissions('waste.products.suggest')
  async suggest(@CurrentUser() user, @Body() dto: CreateSuggestionDto) {
    const result = await this.suggestionsService.create(user, dto);
    return { message: result.message, result };
  }
}
