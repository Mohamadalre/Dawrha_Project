import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from '@src/notification/notification.module';
import { PlatformSettingsModule } from '@src/platform-settings/platform-settings.module';
import { PointsWallet } from './entities/points-wallet.entity';
import { PointsRate } from './entities/points-rate.entity';
import { LeaderboardSnapshot } from './entities/leaderboard-snapshot.entity';
import { Stage } from '@src/stages/entities/stage.entity';
import { PointsWalletService } from './points-wallet.service';
import { PointsRateService } from './points-rate.service';
import { LeaderboardSnapshotService } from './leaderboard-snapshot.service';
import { PointsWalletController } from './points-wallet.controller';
import { PointsRateController } from './points-rate.controller';

/**
 * Points wallets and the money-per-point rate that feeds them.
 *
 * Exports the wallet service so the activation paths (admin approval, OTP
 * verification, Google sign-up) can create a wallet the moment an account
 * becomes active, and so the order flow can reward a completed order.
 */
@Module({
  imports: [
    // Stage is read (not written) here so the leaderboard can name each user's
    // current stage. Registering the entity is enough — no dependency on
    // StagesModule, which would be circular (stages already read wallets).
    TypeOrmModule.forFeature([PointsWallet, PointsRate, Stage, LeaderboardSnapshot]),
    // Awarding points tells the buyer they were gifted them.
    NotificationModule,
    // The rate's currency comes from the central platform setting.
    PlatformSettingsModule,
  ],
  controllers: [PointsWalletController, PointsRateController],
  providers: [PointsWalletService, PointsRateService, LeaderboardSnapshotService],
  exports: [PointsWalletService, PointsRateService],
})
export class PointsWalletModule {}
