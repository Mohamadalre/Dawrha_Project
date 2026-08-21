import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  MaterialCondition,
  UNGRADED_CONDITION,
} from '../../entities/material-condition.entity';
import { InvalidConditionCodeException } from '../../exceptions/waste.exceptions';

/**
 * Read-side helper over material grades.
 *
 * Grades belong to a MATERIAL, so every question here needs to know which
 * material is being asked about. A bare code means nothing on its own: two
 * materials may each have a 'GOOD', and they are different grades of different
 * things. Validating a code without its material is exactly how an order for
 * one material could be accepted carrying another material's grade.
 *
 * Cached per material for a short window — the lists are tiny and read on every
 * catalogue render — and cleared the moment an admin edits them.
 */
@Injectable()
export class ConditionsService {
  private static readonly CACHE_TTL_MS = 60_000;

  private readonly byProduct = new Map<
    string,
    { rows: MaterialCondition[]; expiresAt: number }
  >();

  constructor(
    @InjectRepository(MaterialCondition)
    private readonly conditionRepo: Repository<MaterialCondition>,
  ) {}

  /** Every grade of one material, in the admin's chosen order. */
  async forProduct(productId: string): Promise<MaterialCondition[]> {
    const cached = this.byProduct.get(productId);
    if (cached && Date.now() < cached.expiresAt) return cached.rows;

    const rows = await this.conditionRepo.find({
      where: { productId },
      order: { sortOrder: 'ASC' },
    });
    this.byProduct.set(productId, {
      rows,
      expiresAt: Date.now() + ConditionsService.CACHE_TTL_MS,
    });
    return rows;
  }

  async activeForProduct(productId: string): Promise<MaterialCondition[]> {
    return (await this.forProduct(productId)).filter((c) => c.isActive);
  }

  /**
   * Does this material have grades at all?
   *
   * The question that decides how it is priced, how it is ordered and how its
   * stock is reported — asked in one place so it is answered the same way
   * everywhere.
   */
  async hasConditions(productId: string): Promise<boolean> {
    return (await this.activeForProduct(productId)).length > 0;
  }

  /**
   * Validates a grade code AGAINST ITS MATERIAL, returning it normalised.
   *
   * Refuses a code the material does not have — including any code at all when
   * the material is ungraded, because there is then nothing a grade could mean.
   */
  async validateActiveCode(productId: string, code: string): Promise<string> {
    const normalized = (code ?? '').trim().toUpperCase();
    const conditions = await this.activeForProduct(productId);
    if (!conditions.some((c) => c.code === normalized)) {
      throw new InvalidConditionCodeException(conditions.map((c) => c.code));
    }
    return normalized;
  }

  /**
   * A grade BY ID, asserted to belong to this material.
   *
   * The check is the whole point of taking an id rather than a code: a code is
   * unique only inside its own material, so nothing about the string "GOOD"
   * says whose GOOD it is, and a record filed against another material's grade
   * would never match anything while still looking correct.
   *
   * Returns the row, so the caller can copy its code from the resolved record
   * instead of trusting one that was sent alongside — the two can then never
   * disagree.
   */
  async resolveActiveById(
    productId: string,
    conditionId: string,
  ): Promise<{ id: string; code: string }> {
    const conditions = await this.activeForProduct(productId);
    const found = conditions.find((c) => c.id === conditionId);
    if (!found) {
      // Reported as the codes this material DOES have: the admin picked from a
      // list, so the useful answer is which list they should have picked from.
      throw new InvalidConditionCodeException(conditions.map((c) => c.code));
    }
    return { id: found.id, code: found.code };
  }

  /**
   * The grade a buyer's order line should carry.
   *
   * Ungraded material → null, and sending a code is refused rather than
   * ignored: silently dropping it would let a buyer believe they ordered a
   * grade that was never recorded anywhere.
   */
  async resolveOrderedCondition(
    productId: string,
    code: string | null | undefined,
  ): Promise<string | null> {
    const available = await this.activeForProduct(productId);
    if (!available.length) {
      if (code) throw new InvalidConditionCodeException([]);
      return null;
    }
    if (!code) {
      throw new InvalidConditionCodeException(available.map((c) => c.code));
    }
    return this.validateActiveCode(productId, code);
  }

  /**
   * `productId:code` → Arabic label, for a set of materials in one query.
   *
   * Keyed by the pair because the same code means different things for
   * different materials. UNGRADED is added under a bare key: it is not a grade
   * of anything, it is stock that has not been sorted yet.
   */
  async labelMapFor(productIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    map.set(UNGRADED_CONDITION, 'غير مفروزة');
    if (!productIds.length) return map;

    const rows = await this.conditionRepo.find({
      where: { productId: In(productIds) },
    });
    for (const row of rows) {
      map.set(`${row.productId}:${row.code}`, row.nameAr);
    }
    return map;
  }

  /**
   * `productId:code` → the grade's sort order, for a set of materials at once.
   *
   * The order the admin arranged their grades in is part of a grade's identity
   * to a buyer — it is how "best" sits above "good" on their screen — so every
   * catalogue view that lists grades ships it alongside the label. Keyed by the
   * (material, code) pair for the same reason the labels are: a code is unique
   * only inside its own material.
   */
  async sortOrderMapFor(productIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!productIds.length) return map;

    const rows = await this.conditionRepo.find({
      where: { productId: In(productIds) },
    });
    for (const row of rows) {
      map.set(`${row.productId}:${row.code}`, row.sortOrder);
    }
    return map;
  }

  /**
   * `productId:code` → the CANONICAL grade object every response returns a grade
   * in: `{ id, code, name, sort_order }`.
   *
   * One builder so no two routes disagree on how a grade looks. `name` is the
   * Arabic label (the app is Arabic-first, and this is what the old scattered
   * `condition_label` already showed). Keyed by the (material, code) pair
   * because a code is unique only inside its own material.
   */
  async gradeMapFor(
    productIds: string[],
  ): Promise<Map<string, { id: string; code: string; name: string; sort_order: number }>> {
    const map = new Map<
      string,
      { id: string; code: string; name: string; sort_order: number }
    >();
    if (!productIds.length) return map;

    const rows = await this.conditionRepo.find({
      where: { productId: In(productIds) },
    });
    for (const r of rows) {
      map.set(`${r.productId}:${r.code}`, {
        id: r.id,
        code: r.code,
        name: r.nameAr,
        sort_order: r.sortOrder,
      });
    }
    return map;
  }

  /**
   * The canonical grade object for one (material, code), from a map built by
   * `gradeMapFor`. Falls back to a code-only object when the grade is unknown —
   * a frozen order/cart line naming a since-deleted grade, or the `UNGRADED`
   * placeholder — so the SHAPE is always the same, never a bare string.
   */
  static gradeObject(
    productId: string,
    code: string | null | undefined,
    gradeMap: Map<string, { id: string; code: string; name: string; sort_order: number }>,
  ): { id: string | null; code: string; name: string; sort_order: number | null } | null {
    if (!code) return null;
    const found = gradeMap.get(`${productId}:${code}`);
    if (found) return found;
    return { id: null, code, name: code, sort_order: null };
  }

  /** Called by the admin write-side after any grade mutation. */
  invalidate(productId?: string): void {
    if (productId) this.byProduct.delete(productId);
    else this.byProduct.clear();
  }
}
