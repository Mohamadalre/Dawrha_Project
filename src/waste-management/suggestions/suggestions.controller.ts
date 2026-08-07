import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';
import { SuggestionsService } from './suggestions.service';
import { CreateSuggestionDto } from './dto/create-suggestion.dto';

/**
 * Product suggestion API, open to every buyer role.
 *
 * A suggestion is a material NAME + an EXISTING category + one or more IMAGE
 * FILES (multipart `images`). The proposer is told it is under review; they do
 * not get to browse a queue of their own suggestions — the admin does.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'waste/products', version: '1' })
export class SuggestionsController {
  constructor(
    private readonly suggestionsService: SuggestionsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('suggest')
  @Permissions('waste.products.suggest')
  @UseInterceptors(FilesInterceptor('images', 5, imageMemoryStorage))
  async suggest(
    @CurrentUser() user,
    @UploadedFiles() images: Express.Multer.File[],
    @Body() dto: CreateSuggestionDto,
  ) {
    // Upload every picture before touching the database, so a suggestion row is
    // only written once its images are safely stored.
    const imageUrls: string[] = [];
    for (const file of images ?? []) {
      const uploaded = await this.cloudinary.uploadFile(file, user.id, 'suggestion', 'image');
      imageUrls.push(uploaded.imageUrl);
    }
    return this.suggestionsService.create(user, dto, imageUrls);
  }
}
