import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Points are a REWARD converted from the order/collection value at the admin's
 * per-role rate WITHOUT flooring — a 3500 order at 1000-per-point is worth 3.5
 * points, not 3. The wallet balance was an integer, so the fraction was lost.
 * Widen it to numeric(14,2). Existing integer balances cast cleanly.
 */
export class PointsWalletDecimal1790400000000 implements MigrationInterface {
  name = 'PointsWalletDecimal1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "points_wallets"
         ALTER COLUMN "points" TYPE numeric(14,2),
         ALTER COLUMN "points" SET DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Back to integer — any fractional balances are floored on the way down.
    await queryRunner.query(
      `ALTER TABLE "points_wallets"
         ALTER COLUMN "points" TYPE integer USING floor("points"),
         ALTER COLUMN "points" SET DEFAULT 0`,
    );
  }
}
