import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Media } from './entities/media.entity';
import { OnboardingModule } from '@src/onboarding/onboarding.module';
import { Account } from '@src/user/entities/account.entity';
import { CommonModule } from '@src/common/common.module';

@Module({
  imports:[TypeOrmModule.forFeature([Media,Account]),CommonModule],
  controllers: [MediaController],
  providers: [MediaService],
  exports:[MediaService]
})
export class MediaModule {}
