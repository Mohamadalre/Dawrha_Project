import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';

/** Public static pages: about the app + terms of use (i18n-served). */
@Module({
  controllers: [ContentController],
})
export class ContentModule {}
