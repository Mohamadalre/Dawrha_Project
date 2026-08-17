import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes the Syrian Lira (SYP) the DEFAULT currency everywhere a new row can be
 * created without stating one.
 *
 * Only the column DEFAULTS change — existing rows keep whatever currency they
 * were written with, because rewriting a past price or a past order's currency
 * would change history, not a setting. New rows that do not name a currency now
 * get SYP instead of JOD.
 */
export class DefaultCurrencySypMigration1789200000000 implements MigrationInterface {
  name = 'DefaultCurrencySypMigration1789200000000';

  private readonly columns: Array<[string, string]> = [
    ['orders', 'currency'],
    ['order_minimums', 'currency'],
    ['order_spending_caps', 'currency'],
    ['delivery_rates', 'currency'],
    ['delivery_tariffs', 'currency'],
    ['product_pricing', 'currency'],
    ['product_pricing_history', 'currency'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, col] of this.columns) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${col}" SET DEFAULT 'SYP'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, col] of this.columns) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${col}" SET DEFAULT 'JOD'`,
      );
    }
  }
}
