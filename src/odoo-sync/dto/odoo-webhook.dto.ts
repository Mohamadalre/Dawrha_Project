import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Payload sent by the Odoo automated action when recycle.stock changes.
 * Omitting `odoo_warehouse_id` re-syncs every Odoo-linked warehouse.
 */
export class OdooInventoryWebhookDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  odoo_warehouse_id?: number;
}


export class OdooDriverDecisionDto {
  @IsUUID()
  backend_driver_id: string;

  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  /**
   * Full lifecycle control from Odoo: overrides `approved` when present.
   * ACTIVE (approve/unblock) | REJECTED | BLOCKED | NEED_CHANGES (request info
   * edits) | PENDING_APPROVAL (the admin re-opened a rejected application, so
   * it goes back under review).
   */
  @IsOptional()
  @IsIn(['ACTIVE', 'REJECTED', 'BLOCKED', 'NEED_CHANGES', 'PENDING_APPROVAL'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejection_reason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  truck_odoo_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shift_odoo_id?: number;

  /** Warehouse the driver was accepted into / moved to (Odoo id). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouse_odoo_id?: number;

  /**
   * True when the Odoo admin only MOVED the driver to another warehouse —
   * the backend updates the mirror and neither touches the account status
   * nor notifies the driver.
   */
  @IsOptional()
  @IsBoolean()
  warehouse_change_only?: boolean;

  /**
   * Media ids the Odoo admin flagged as unacceptable (sent with
   * status NEED_CHANGES): the backend marks them REJECTED so the driver's
   * re-upload endpoint accepts exactly those images again.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  rejected_media_ids?: string[];

  /**
   * The Odoo reviewer marked a document unacceptable and NOTHING ELSE.
   *
   * Mark the listed media REJECTED; leave the account status alone and send no
   * notification. Rejecting a document and telling the driver to replace it
   * are different acts, and a reviewer working through four documents has to
   * be able to do the first several times before doing the second.
   */
  @IsOptional()
  @IsBoolean()
  documents_only?: boolean;

  /**
   * The Odoo reviewer ASKED for the listed documents back.
   *
   * Sent with NEED_CHANGES. The media are recorded as outstanding, and that
   * record — not "is anything rejected" — is what decides when the driver has
   * finished answering.
   */
  @IsOptional()
  @IsBoolean()
  request_reupload?: boolean;

  /**
   * The Odoo reviewer GAVE UP waiting for the listed documents.
   *
   * Sent with PENDING_APPROVAL. The outstanding requests are withdrawn and the
   * driver goes back under review — but the documents keep the status they were
   * given, because withdrawing the question is not accepting the answer.
   */
  @IsOptional()
  @IsBoolean()
  cancel_reupload?: boolean;

  /**
   * Documents the Odoo reviewer marked ACCEPTABLE.
   *
   * Rejecting one always travelled; accepting one did not — so the mirror kept
   * the document REJECTED while Odoo showed it accepted, and the driver could
   * still be asked to replace a file that had already been taken.
   *
   * Validated exactly like `rejected_media_ids`: these are backend media ids,
   * and a loose string rule here would let a malformed id through to a query
   * that silently matches nothing.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  approved_media_ids?: string[];
}

export class OdooShiftChangeDecisionDto {
  @IsUUID()
  backend_request_id: string;

  /**
   * The warehouse manager's move on the request:
   * PROCESSING (started reviewing) | ACCEPTED (with the reserved truck) |
   * REJECTED (with a reason).
   */
  @IsIn(['PROCESSING', 'ACCEPTED', 'REJECTED'])
  status: 'PROCESSING' | 'ACCEPTED' | 'REJECTED';

  /** Truck reserved for the new shift — required by the handler on ACCEPTED. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  truck_odoo_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejection_reason?: string;
}

/**
 * Everything a warehouse does to one part of a buyer's order, reported back.
 *
 * `part_id` is the correlation key — a buyer order split across three
 * warehouses is three Odoo orders, and only the part id says which piece of the
 * buyer's order a given decision belongs to.
 *
 * Fields beyond the event itself are accepted loosely on purpose: Odoo sends
 * one payload shape for every event, so a field that is irrelevant to the
 * current event simply arrives empty rather than making the push fail.
 */
/**
 * One thing a warehouse did to a part of a buyer's order.
 *
 * Every field Odoo actually sends is declared, including the ones this side only
 * records: the app validates with `forbidNonWhitelisted`, so an undeclared field
 * is a 400 for the WHOLE event — which is how a channel can look wired up on
 * both ends and still deliver nothing. Keep this in step with
 * `recycle.backend.sync.sync_order`.
 */
export class OdooOrderEventDto {
  @IsString()
  @MaxLength(64)
  event: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  odoo_id: number;

  /** Empty for orders created inside Odoo, which have no buyer part. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  part_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  invoice_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  output_zone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  handover_state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  handover_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  approval_reject_reason?: string;

  // ── Carried for the record, not acted on ────────────────────────────────
  // Declared so the event validates. They are what an operator needs when a
  // part's history has to be reconstructed from the logs.

  /** Odoo's own order reference, e.g. "ORD/00042". */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  /** Odoo-side workflow state: pending | processing | ready | completed | cancelled. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  factory_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  /**
   * The Odoo warehouse this part now sits in. Acted on for a `reassigned` event
   * — the admin re-routed a split part — to re-point the backend's part and
   * re-price its delivery leg.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouse_odoo_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  warehouse?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  stock_deducted_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  finished_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  manager_approval?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  handover_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  handover_note?: string;
}
