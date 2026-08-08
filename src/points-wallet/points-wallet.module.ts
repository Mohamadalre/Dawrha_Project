import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PointsWallet } from './entities/points-wallet.entity';
import { PointsWalletService } from './points-wallet.service';
import { PointsWalletController } from './points-wallet.controller';

/**
 * Points wallets. Exports the service so the activation paths (admin approval,
 * OTP verification, Google sign-up) can create a wallet the moment an account
 * becomes active.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PointsWallet])],
  controllers: [PointsWalletController],
  providers: [PointsWalletService],
  exports: [PointsWalletService],
})
export class PointsWalletModule {}
