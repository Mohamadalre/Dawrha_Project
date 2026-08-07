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
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { Role } from '@src/user/enums/role.enum';
import { OfferAudience } from '../../enums/offer-audience.enum';

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

/**
 * One grade of a material, and what it costs under the offer.
 *
 * Graded buyers are priced per condition, so an offer aimed at them is not one
 * number — it is a number per grade they are actually being offered. A single
 * price would have to stand for "excellent" and "poor" alike, which is the
 * distinction the grades exist to draw.
 */
export class OfferConditionAmountDto {
  /**
   * The grade, BY ID.
   *
   * A code is unique only inside its own material, so "GOOD" says nothing
   * about whose GOOD it is. An offer accepted by code could be filed against
   * another material's grade, where it would never match a basket line.
   */
  @IsUUID()
  condition_id: string;

  /** How much comes OFF this grade's price. */
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  amount: number;
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
   * The AMOUNT the price moves by — added for sellers, taken off for buyers.
   *
   * Not a final price. One offer reaches two roles who are priced differently,
   * and a single final price cannot be right for both: 7.50 is a discount off
   * a factory's 10 and a rise on a free facility's 6. An amount applies to
   * whatever each of them already pays.
   *
   * Optional here and resolved by the SERVICE, because a buyer offer on a
   * graded material states its amounts per grade instead — which a DTO cannot
   * know, since only the material knows whether it is graded.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  amount?: number;

  /**
   * The offer expressed as a PERCENTAGE of the price instead of an amount.
   *
   * Mutually exclusive with `amount` — sending both is refused rather than
   * silently preferring one, because the two would disagree the moment a price
   * moved and there would be no way to tell which the administrator meant.
   *
   * The stored amount is derived from it against each price the offer touches,
   * so a percentage offer on a graded material yields a DIFFERENT amount per
   * grade — 25% of a 70 grade is 17.50 and of a 60 grade is 15 — which is what
   * "a quarter off" actually means and what a single flat amount could not say.
   *
   * The difference from `amount` shows up LATER: when the material's price is
   * edited, a percentage offer keeps its percentage and has its amount
   * recomputed, while an amount offer keeps its amount.
   *
   * Capped at 100 for a buyer offer by the negative-price rule anyway; the
   * bound here catches the typo before any price is read.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  percentage?: number;

  /**
   * Per-grade amounts, for a BUYER offer on a graded material.
   *
   * Several grades may be offered at once, each with its own reduction. Every
   * grade named must belong to this material.
   *
   * Omitting it on a graded material is legitimate and means "every grade" —
   * the flat `amount` above is then applied to each of them, and refused if it
   * would drive any single grade below zero.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OfferConditionAmountDto)
  conditions?: OfferConditionAmountDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsDateString()
  valid_from?: string;

  @IsOptional()
  @IsDateString()
  valid_until?: string;
}

// UpdateOfferDto removed with the general PUT offers/:offerId route — an offer
// is now edited only through UpdateOfferAmountDto (/amount, with its dates) and
// UpdateOfferValidityDto (/validity), each re-validating just what it changes.

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
 * Change only when an offer ends.
 *
 * `null` is meaningful and distinct from omitted: it clears the date and makes
 * the offer open-ended. A DTO that could not express that would leave "runs
 * until further notice" unreachable once a date had ever been set.
 */
export class UpdateOfferValidityDto {
  @IsOptional()
  @IsDateString()
  valid_until?: string | null;

  /** Moving the start is rarer but belongs with it — both bound the window. */
  @IsOptional()
  @IsDateString()
  valid_from?: string;
}

/**
 * Change the offer's size — as an AMOUNT or as a PERCENTAGE.
 *
 * Exactly one of `amount` / `percentage` is given, the same rule creation
 * follows: the two disagree the first time a price moves and nothing afterwards
 * could say which the administrator meant. The stored `discountPercentage` is
 * still DERIVED and never accepted — a hand-typed percentage is free to disagree
 * with the two numbers either side of it, so a "biggest discounts" list ranked
 * by it would rank by somebody's arithmetic rather than by the money saved.
 *
 * The difference between the two bases shows up LATER, when the material's price
 * is edited: an AMOUNT offer keeps its amount, a PERCENTAGE offer keeps its
 * percentage and has the amount recomputed. This route sets that basis.
 *
 * Takes effect everywhere the offer is read. Orders already placed keep the
 * price they were quoted — the cart snapshots `unit_price` when the line is
 * created, so a later edit cannot reprice work already committed.
 */
export class UpdateOfferAmountDto {
  /**
   * The new AMOUNT the price moves by.
   *
   * Re-validated exactly as on creation: raised past a price it does not make
   * that price small, it makes it NEGATIVE — which means paying a buyer to
   * take the material away. Mutually exclusive with `percentage`; the derived
   * percentage is recomputed from it and never sent.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  amount?: number;

  /**
   * The new size expressed as a PERCENTAGE of the price instead of an amount.
   *
   * Mutually exclusive with `amount`. The stored amount is derived from it
   * against each price the offer touches (the cheapest tier it faces, so it can
   * never drive one below zero), and — unlike an amount edit — the offer keeps
   * this percentage as its promise, so a later price change recomputes the
   * amount rather than freezing it.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  percentage?: number;

  /**
   * The window, editable in the SAME request as the size.
   *
   * They are one decision in practice — "make it 2 off, and run it to the end
   * of the month" — and splitting them across two calls leaves the offer
   * briefly live at the new size on the old dates. Both are optional: send only
   * the size and the window is left exactly as it was.
   */
  @IsOptional()
  @IsDateString()
  valid_from?: string;

  /** `null` removes the end date — the offer becomes open-ended. */
  @IsOptional()
  @IsDateString()
  valid_until?: string | null;
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
  /** A single instant: return offers whose validity window contains it. */
  @IsOptional()
  @IsDateString()
  on?: string;

  /** Range start: return offers whose window overlaps [from, to]. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Range end. */
  @IsOptional()
  @IsDateString()
  to?: string;
}
