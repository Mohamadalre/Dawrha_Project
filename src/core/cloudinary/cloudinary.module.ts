import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

/**
 * CloudinaryModule - Centralized Cloudinary Configuration
 *
 * Responsibilities:
 * - Initialize Cloudinary with API credentials
 * - Provide CloudinaryService to other modules
 * - Handle configuration from environment variables
 *
 * Best Practice: This module should be imported in CoreModule
 * so that the upload service can be used across the application
 */
@Module({
  providers: [
    {
      provide: 'CLOUDINARY',
      useFactory: (configService: ConfigService) => {
        // Initialize Cloudinary with credentials from environment
        cloudinary.config({
          cloud_name: configService.get<string>('CLOUDINARY_CLOUD_NAME'),
          api_key: configService.get<string>('CLOUDINARY_API_KEY'),
          api_secret: configService.get<string>('CLOUDINARY_API_SECRET'),
          timeout: 60000, // Set timeout to 60 seconds
        });

        return cloudinary;
      },
      inject: [ConfigService],
    },
    CloudinaryService,
  ],
  exports: [CloudinaryService, 'CLOUDINARY'],
})
export class CloudinaryModule {}
