import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '@src/core/cloudinary/cloudinary.module';
import { PointsWallet } from '@src/points-wallet/entities/points-wallet.entity';
import { Stage } from './entities/stage.entity';
import { StagesService } from './stages.service';
import { AdminStagesController, StagesController } from './stages.controller';

/**
 * Points stages: admin CRUD + reorder, and the user's "which stage am I in?"
 * route (read against their points wallet).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Stage, PointsWallet]),
    CloudinaryModule,
  ],
  controllers: [AdminStagesController, StagesController],
  providers: [StagesService],
})
export class StagesModule {}
