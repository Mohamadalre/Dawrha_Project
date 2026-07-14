import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OdooSyncStatus } from '../enums/odoo-sync-status.enum';

/**
 * Admin-managed material conditions (grades) — NOT a fixed enum.
 * The Odoo sorting employee grades every sorted quantity with one of these
 * (e.g. EXCELLENT / GOOD / POOR / DAMAGED — seeded defaults, admin can add
 * more). They drive:
 *  - per-condition stock lines mirrored from Odoo (`warehouse_inventory`),
 *  - per-condition pricing for the FACTORY / FREE_FACILITY tiers,
 * and are pushed to Odoo (SYNC_CONDITION) so the sorting UI lists them.
 */
@Entity('material_conditions')
export class MaterialCondition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable machine code stored on stock/pricing rows (e.g. EXCELLENT). */
  @Column({ unique: true, length: 30 })
  code: string;

  @Column({ length: 100 })
  nameEn: string;

  @Column({ length: 100 })
  nameAr: string;

  /** Display order in pickers (best condition first). */
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ default: true })
  isActive: boolean;

  /** Odoo id of the mirrored condition; null until the sync job pushes it. */
  @Column({ type: 'int', nullable: true })
  odooConditionId?: number;

  @Column({ type: 'enum', enum: OdooSyncStatus, default: OdooSyncStatus.PENDING })
  odooSyncStatus: OdooSyncStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** Stock mirrored from Odoo before sorting carries this pseudo-condition. */
export const UNGRADED_CONDITION = 'UNGRADED';
