import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Media } from './entities/media.entity';
import { Account } from '@src/user/entities/account.entity';
import { CommonModule } from '@src/common/common.module';
//import { CloudinaryModule } from '@src/core/cloudinary/cloudinary.module';

import { CoreModule } from '@src/core/core.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Media, Account]),
    CommonModule,
    CoreModule,
    // CloudinaryModule
    
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
