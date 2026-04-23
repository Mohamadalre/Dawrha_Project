import { MigrationInterface, QueryRunner } from "typeorm";
export declare class Inital1776729664973 implements MigrationInterface {
    name: string;
    up(queryRunner: QueryRunner): Promise<void>;
    down(queryRunner: QueryRunner): Promise<void>;
}
