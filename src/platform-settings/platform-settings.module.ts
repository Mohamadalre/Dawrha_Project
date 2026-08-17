import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformSettings } from './entities/platform-settings.entity';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformSettingsController } from './platform-settings.controller';

/**
 * Platform-wide settings (default currency). Exports the service so any pricing
 * path can read the default currency instead of hardcoding it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PlatformSettings])],
  controllers: [PlatformSettingsController],
  providers: [PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
