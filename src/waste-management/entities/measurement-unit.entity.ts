import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OdooSyncStatus } from '../enums/odoo-sync-status.enum';

/**
 * Admin-managed measurement units (replaces the fixed KG/PIECE enum).
 * Products, cart items and suggestions store the unit `code`; this table is
 * the source of truth for which codes are allowed and how they are labelled.
 * Units are mirrored to the Odoo warehouse addon (SYNC_UNIT job) because the
 * sorting flow there needs `allows_tolerance` per unit.
 */
@Entity('measurement_units')
export class MeasurementUnit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable machine code stored on products/cart items (e.g. KG, PIECE, TON). */
  @Column({ unique: true, length: 20 })
  code: string;

  @Column({ length: 100 })
  nameEn: string;

  @Column({ length: 100 })
  nameAr: string;

  /** Weight units participate in the cart minimum-weight rule. */
  @Column({ default: false })
  isWeight: boolean;

  /**
   * Used by the Odoo warehouse project during sorting:
   * true  → the sorter's processed quantity MAY differ from the shipment's
   *         declared quantity (weight-like units: KG, TON, ...);
   * false → quantities MUST match exactly (count-like units: PIECE — a
   *         5-piece shipment must be sorted as exactly 5 pieces).
   */
  @Column({ default: false })
  allowsTolerance: boolean;

  /** Odoo id of the mirrored unit; null until the sync job pushes it. */
  @Column({ type: 'int', nullable: true })
  odooUnitId?: number;

  @Column({ type: 'enum', enum: OdooSyncStatus, default: OdooSyncStatus.PENDING })
  odooSyncStatus: OdooSyncStatus;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
