import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { Product } from '@src/waste-management/entities/product.entity';
import { ProductNotFoundException } from '@src/waste-management/exceptions/waste.exceptions';
import { CollectionPlan } from '../entities/collection-plan.entity';
import { CollectionPlanLine } from '../entities/collection-plan-line.entity';
import {
  CollectionPlanAlreadyExistsException,
  CollectionPlanNotFoundException,
  CollectionPlanNotOwnedException,
  DuplicateLineProductException,
  EmptyRequestLinesException,
  UnsupportedFrequencyException,
} from '../exceptions/collection-request.exceptions';
import { CollectionPlanFrequency } from '../enums/collection-plan-frequency.enum';
import {
  CreateCollectionPlanDto,
  UpdateCollectionPlanDto,
} from '../dto/collection-plan.dto';

interface Caller {
  id: string;
  role: Role;
}

@Injectable()
export class CollectionPlanService {
  constructor(
    @InjectRepository(CollectionPlan)
    private readonly planRepo: Repository<CollectionPlan>,
    @InjectRepository(CollectionPlanLine)
    private readonly planLineRepo: Repository<CollectionPlanLine>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  // ---------------------------------------------------------------------------
  // Create — one plan per institution (unique accountId)
  // ---------------------------------------------------------------------------
  async create(caller: Caller, dto: CreateCollectionPlanDto) {
    const existing = await this.planRepo.findOne({
      where: { accountId: caller.id },
    });
    if (existing) throw new CollectionPlanAlreadyExistsException();

    this.assertFrequencyFields(dto.frequency, dto.weekdays, dto.month_days);

    const plan = this.planRepo.create({
      accountId: caller.id,
      name: dto.name,
      frequency: dto.frequency,
      weekdays: dto.weekdays ?? null,
      monthDays: dto.month_days ?? null,
      collectionTime: `${dto.collection_time}:00`,
      startDate: dto.start_date ?? null,
      endDate: dto.end_date ?? null,
      isActive: dto.is_active ?? true,
      itemNote: dto.item_note ?? null,
      lines: await this.buildLines(dto.lines),
    });
    const saved = await this.planRepo.save(plan);
    return this.toView(saved);
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------
  async getOwn(caller: Caller) {
    const plan = await this.planRepo.findOne({
      where: { accountId: caller.id },
      relations: ['lines'],
    });
    if (!plan) throw new CollectionPlanNotFoundException();
    return this.toView(plan);
  }

  async detail(caller: Caller, id: string) {
    const plan = await this.loadOwned(caller.id, id);
    return this.toView(plan);
  }

  // ---------------------------------------------------------------------------
  // Update — lines are replaced as a set, never accumulated
  // ---------------------------------------------------------------------------
  async update(caller: Caller, id: string, dto: UpdateCollectionPlanDto) {
    const plan = await this.loadOwned(caller.id, id);

    if (dto.frequency && dto.frequency !== plan.frequency) {
      this.assertFrequencyFields(dto.frequency, dto.weekdays, dto.month_days);
    }
    if (dto.weekdays !== undefined) plan.weekdays = dto.weekdays ?? null;
    if (dto.month_days !== undefined) plan.monthDays = dto.month_days ?? null;

    if (dto.name !== undefined) plan.name = dto.name;
    if (dto.frequency !== undefined) plan.frequency = dto.frequency;
    if (dto.collection_time !== undefined) {
      plan.collectionTime = `${dto.collection_time}:00`;
    }
    if (dto.start_date !== undefined) plan.startDate = dto.start_date ?? null;
    if (dto.end_date !== undefined) plan.endDate = dto.end_date ?? null;
    if (dto.is_active !== undefined) plan.isActive = dto.is_active;
    if (dto.item_note !== undefined) plan.itemNote = dto.item_note ?? null;

    if (dto.lines !== undefined) {
      await this.planLineRepo.delete({ planId: plan.id });
      plan.lines = await this.buildLines(dto.lines);
    }

    const saved = await this.planRepo.save(plan);
    return this.toView(saved);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private async loadOwned(accountId: string, id: string): Promise<CollectionPlan> {
    const plan = await this.planRepo.findOne({
      where: { id },
      relations: ['lines'],
    });
    if (!plan) throw new CollectionPlanNotFoundException();
    if (plan.accountId !== accountId) throw new CollectionPlanNotOwnedException();
    return plan;
  }

  private assertFrequencyFields(
    frequency: CollectionPlanFrequency,
    weekdays?: number[],
    monthDays?: number[],
  ): void {
    if (frequency === CollectionPlanFrequency.WEEKLY && !weekdays?.length) {
      throw new UnsupportedFrequencyException(
        'A weekly plan needs at least one weekday (1=Monday .. 7=Sunday)',
      );
    }
    if (frequency === CollectionPlanFrequency.MONTHLY && !monthDays?.length) {
      throw new UnsupportedFrequencyException(
        'A monthly plan needs at least one day of month (1..31)',
      );
    }
  }

  /** Snapshot the product name and unit into the plan line — catalogue edits must not move history. */
  private async buildLines(lines: Array<{ product_id: string; quantity: number }>) {
    if (!lines?.length) throw new EmptyRequestLinesException();
    const ids = lines.map((l) => l.product_id);
    if (new Set(ids).size !== ids.length) throw new DuplicateLineProductException();

    const products = await this.productRepo.find({
      where: { id: In(ids), isActive: true },
    });
    const found = new Map(products.map((p) => [p.id, p]));

    return lines.map((line) => {
      const product = found.get(line.product_id);
      if (!product) throw new ProductNotFoundException();
      return this.planLineRepo.create({
        productId: product.id,
        productName: product.name,
        unitType: product.unitType,
        quantity: String(line.quantity),
      });
    });
  }

  private toView(plan: CollectionPlan) {
    return {
      plan_id: plan.id,
      name: plan.name,
      frequency: plan.frequency,
      weekdays: plan.weekdays ?? [],
      month_days: plan.monthDays ?? [],
      collection_time: plan.collectionTime.slice(0, 5),
      start_date: plan.startDate,
      end_date: plan.endDate,
      is_active: plan.isActive,
      item_note: plan.itemNote,
      last_generated_date: plan.lastGeneratedDate,
      created_at: plan.createdAt,
      updated_at: plan.updatedAt,
      lines: (plan.lines ?? []).map((l) => ({
        line_id: l.id,
        product_id: l.productId,
        product_name: l.productName,
        unit_type: l.unitType,
        quantity: Number(l.quantity),
      })),
    };
  }
}
