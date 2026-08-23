import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { Role } from '@src/user/enums/role.enum';
import { OfferAudience } from '../../enums/offer-audience.enum';
import { IsIsoDateTimeWithOffset } from '@src/common/validators/is-iso-datetime-with-offset.validator';

/** Buyer roles an offer may be limited to. */
export const OFFER_TARGETABLE_ROLES = [
  Role.CITIZEN,
  Role.INSTITUTIONS,
  Role.FACTORY,
  Role.EXTERNAL_PARTNER,
] as const;

/** Uppercases unit codes so 'kg' and 'KG' hit the same measurement_units row. */
const normalizeUnitCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class AdminListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status: 'active' | 'inactive' | 'all' = 'all';

  @IsOptional()
  @IsUUID()
  category_id?: string;

  /**
   * Offers list only: limit to offers on ONE material (its id). Turns the
   * general offers list into "the offers for this material".
   */
  @IsOptional()
  @IsUUID()
  product_id?: string;

  /**
   * Offers list only: keep offers that are LIVE on this date — i.e. their
   * window contains it (`validFrom <= date < validUntil`, an open-ended offer
   * counting as live from its start). Answers "which offers were running on
   * 2026-08-15?".
   */
  @IsOptional()
  @IsDateString()
  on_date?: string;
}

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;


  // Parsed from a string too: these forms are submitted as multipart/form-data
  // (they carry the image FILE), where every field arrives as text — so "true"
  // must become true and "false" false, while an omitted flag stays undefined.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === true || value === 'true',
  )
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;


  // Parsed from a string too: these forms are submitted as multipart/form-data
  // (they carry the image FILE), where every field arrives as text — so "true"
  // must become true and "false" false, while an omitted flag stays undefined.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === true || value === 'true',
  )
  @IsBoolean()
  is_active?: boolean;
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsUUID()
  category_id: string;


  /**
   * The material's unit, given by ID — exactly like `category_id`.
   *
   * REQUIRED, and the only way to name a unit here. The code (`unit_type`) was
   * accepted for a while and is not any more: a code is a label that can be
   * renamed and re-used, so two callers sending "KG" could mean two different
   * rows, and a material's unit decides how every quantity of it is read. An id
   * names one row for good.
   */
  @IsUUID()
  unit_id: string;

  /**
   * Weight of ONE unit in kilograms. REQUIRED when the unit is not KG and
   * ignored when it is (a kilogram already weighs a kilogram). Delivery truck
   * capacity is measured in kg, so a by-the-piece material cannot be routed
   * without it. Parsed from text because the form is multipart.
   */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' || value === null ? undefined : Number(value),
  )
  @IsNumber()
  @Min(0.001)
  unit_weight_kg?: number;

  // Parsed from a string too: these forms are submitted as multipart/form-data
  // (they carry the image FILE), where every field arrives as text — so "true"
  // must become true and "false" false, while an omitted flag stays undefined.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === true || value === 'true',
  )
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;


  /** Same as on create: by ID, and only by ID. */
  @IsOptional()
  @IsUUID()
  unit_id?: string;

  /**
   * Weight of one unit in kilograms — see {@link CreateProductDto}. On update it
   * becomes required only when the (new or existing) unit is not KG and the
   * material has no weight yet; supplying it while the unit is KG is ignored.
   */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' || value === null ? undefined : Number(value),
  )
  @IsNumber()
  @Min(0.001)
  unit_weight_kg?: number;

  // Parsed from a string too: these forms are submitted as multipart/form-data
  // (they carry the image FILE), where every field arrives as text — so "true"
  // must become true and "false" false, while an omitted flag stays undefined.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === true || value === 'true',
  )
  @IsBoolean()
  is_active?: boolean;
}

export class CreateUnitDto {
  @Transform(normalizeUnitCode)
  @Matches(/^[A-Z0-9_]{1,20}$/, {
    message: 'Unit code must be 1-20 uppercase letters, digits or underscores',
  })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_en: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_ar: string;

  @IsOptional()
  @IsBoolean()
  is_weight?: boolean;

  /**
   * Consumed by the Odoo warehouse project during sorting: true → the sorter's
   * processed quantity may differ from the shipment's declared quantity;
   * false → must match exactly (e.g. PIECE). Defaults to is_weight.
   */
  @IsOptional()
  @IsBoolean()
  allows_tolerance?: boolean;
}

export class OfferConditionPriceDto {
  /**
   * The grade, BY ID.
   *
   * Not by code: a code is unique only inside its own material, so the string
   * "GOOD" says nothing about whose GOOD it is. An offer accepted by code could
   * be filed against another material's grade — where it would never match a
   * cart line and would simply never apply, while still appearing live on every
   * screen.
   */
  @IsUUID()
  condition_id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  offer_price: number;
}

export class CreateOfferDto {
  @IsUUID()
  product_id: string;

  /**
   * WHICH SIDE of the trade — required, and the field the whole request hangs
   * on.
   *
   * The platform buys from citizens and institutions and sells to factories
   * and free facilities, so the same offer means opposite things to them:
   * SELLERS are paid MORE, BUYERS are charged LESS. Without this the amount
   * below has no direction, and no default is safe — guessing wrong moves
   * every affected price the wrong way.
   */
  @IsEnum(OfferAudience)
  audience: OfferAudience;

  /**
   * One role INSIDE that audience, when the offer is meant for only one.
   *
   * Omitted means BOTH roles of the audience, which is the common case. A role
   * from the other side is refused rather than ignored: it would be an
   * increase applied to a price that is supposed to fall.
   */
  @IsOptional()
  @IsArray()
  @IsIn(OFFER_TARGETABLE_ROLES, { each: true })
  target_roles?: Role[];

  /**
   * The offer as a PERCENTAGE of the price — the ONLY way an offer is stated.
   *
   * A percentage, not an amount, on purpose. One offer reaches roles priced
   * differently, and a percentage is the one figure that is fair to all of them:
   * "20% off" is 20% of each role's OWN price, and on a graded material it is
   * 20% of EACH grade's own price (a different amount per grade) — which is what
   * "a fifth off" actually means and what a single flat amount could never say.
   *
   * The stored amount is DERIVED from this percentage against every price the
   * offer touches, and the percentage is kept as the promise: when the
   * material's price is later edited, the amount is recomputed so the discount
   * stays the same share it was created as.
   *
   * Required. Sellers may exceed 100% (a generous rise); a buyer offer is capped
   * below 100 by the negative-price rule in the service, and the bound here
   * catches a typo before any price is read.
   */
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  percentage: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsIsoDateTimeWithOffset()
  valid_from?: string;

  @IsOptional()
  @IsIsoDateTimeWithOffset()
  valid_until?: string;
}

/**
 * Edit an offer through ONE route: its description, its size (amount OR
 * percentage), and its window. PATCH semantics — send only what changes, and at
 * least one field is required.
 *
 * Rules carried over from the two focused routes this replaces:
 *  - amount and percentage are MUTUALLY EXCLUSIVE — they disagree the first time
 *    the price moves, and nothing afterwards could say which the admin meant;
 *  - the derived discountPercentage is never accepted — only amount/percentage;
 *  - a percentage is the PROMISE kept across later price edits (its amount is
 *    recomputed), while an amount freezes the number;
 *  - valid_until = null CLEARS the end date (open-ended); the window must end
 *    after it starts.
 *
 * The audience and target roles are deliberately NOT editable here: changing who
 * an offer is for flips which way it moves a price, so it is not folded into a
 * routine description/size/date edit.
 */
export class UpdateOfferDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /**
   * The new size of the offer, as a PERCENTAGE — the only way its size is
   * stated, on edit exactly as on create. There is no amount input.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  percentage?: number;

  @IsOptional()
  @IsIsoDateTimeWithOffset()
  valid_from?: string;

  /** `null` removes the end date — the offer becomes open-ended. */
  @IsOptional()
  @IsIsoDateTimeWithOffset()
  valid_until?: string | null;

  /**
   * Deactivate (`false`) or reactivate (`true`) the offer WITHOUT deleting it.
   *
   * A deactivated offer stops being live immediately — it drops out of every
   * buyer/guest catalogue and offers list at once, while the admin still sees it
   * (status=all) and can switch it back on. This is the deliberate "turn it off"
   * that a past end-date cannot express (the window must end after it starts),
   * and unlike delete it keeps the row and its history.
   */
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateConditionDto {
  @Transform(normalizeUnitCode)
  @Matches(/^[A-Z0-9_]{1,30}$/, {
    message: 'Condition code must be 1-30 uppercase letters, digits or underscores',
  })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_en: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_ar: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort_order?: number;
}

export class UpdateConditionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_en?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_ar?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort_order?: number;

  // Parsed from a string too: these forms are submitted as multipart/form-data
  // (they carry the image FILE), where every field arrives as text — so "true"
  // must become true and "false" false, while an omitted flag stays undefined.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === true || value === 'true',
  )
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_en?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_ar?: string;

  @IsOptional()
  @IsBoolean()
  is_weight?: boolean;

  @IsOptional()
  @IsBoolean()
  allows_tolerance?: boolean;

  // Parsed from a string too: these forms are submitted as multipart/form-data
  // (they carry the image FILE), where every field arrives as text — so "true"
  // must become true and "false" false, while an omitted flag stays undefined.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === true || value === 'true',
  )
  @IsBoolean()
  is_active?: boolean;
}

/**
 * The timeline of a material's offers, optionally narrowed to a point or a
 * window in time.
 *
 * `on` answers "which offers were live on THIS date" — the validity window
 * contains that instant. `from`/`to` answer "which offers touched this range" —
 * the window overlaps it. Given neither, the whole timeline comes back, newest
 * window first. `on` takes precedence over `from`/`to` when both are sent, since
 * a single instant is the more specific question.
 */
export class OfferTimelineQueryDto extends PaginationQueryDto {
  /**
   * The timeline is a RANGE, always — offers whose validity window overlaps
   * [from, to]. The single-instant `on` option was removed: a point in time is
   * just the degenerate range `from === to`, and keeping both invited callers to
   * send `on` together with `from`/`to` and wonder which one won.
   */
  /** Range start: return offers whose window overlaps [from, to]. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Range end. */
  @IsOptional()
  @IsDateString()
  to?: string;
}
