import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddActualQuantityToLines1789720000000 implements MigrationInterface {
  name = 'AddActualQuantityToLines1789720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'collection_request_lines',
      new TableColumn({
        name: 'actual_quantity',
        type: 'decimal',
        precision: 12,
        scale: 3,
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('collection_request_lines', 'actual_quantity');
  }
}
