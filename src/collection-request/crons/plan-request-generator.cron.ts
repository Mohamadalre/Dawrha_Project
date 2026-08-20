import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { Product } from '@src/waste-management/entities/product.entity';
import { EffectivePriceService } from '@src/waste-management/common/providers/effective-price.service';
import { UnitsService } from '@src/waste-management/common/providers/units.service';
import { CollectionPlan } from '../entities/collection-plan.entity';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectionRequestLine } from '../entities/collection-request-line.entity';
import { CollectionRequestType } from '../enums/collection-request-type.enum';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import { CollectionPlanFrequency } from '../enums/collection-plan-frequency.enum';
import { nextSequentialNumber } from '../utils/sequence.util';
import { estimateWeightKg } from '../utils/weight.util';

/**
 * Turns institutions' standing plans into ORG_PLAN collection requests.
 *
 * Runs daily at 03:00 and generates one request per plan whose schedule is due
 * TODAY. Re-running the cron (or catching up after downtime) is harmless:
 * every generated request carries (source_plan_id, source_plan_date), the pair
 * is unique, and `last_generated_date` skips plans already served — so a
 * duplicate request for the same plan-day is impossible.
 *
 * Generated requests stay CREATED: the dispatch engine's lead-time job
 * (next sprint) is what opens the queue window `scheduled_lead_min` before
 * `scheduled_at`, so they wait here until then.
 */
@Injectable()
export class PlanRequestGenerator {
  private readonly logger = new Logger('PlanRequestGenerator');

  constructor(
    @InjectRepository(CollectionPlan)
    private readonly planRepo: Repository<CollectionPlan>,
    @InjectRepository(CollectionRequest)
    private readonly requestRepo: Repository<CollectionRequest>,
    @InjectRepository(CollectionRequestLine)
    private readonly lineRepo: Repository<CollectionRequestLine>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly effectivePrice: EffectivePriceService,
    private readonly units: UnitsService,
  ) {}

  @Cron('0 3 * * *')
  async generateDueRequests(): Promise<void> {
    const today = this.localDateString(new Date());
    const plans = await this.planRepo.find({
      where: { isActive: true },
      relations: ['lines'],
    });

    let generated = 0;
    for (const plan of plans) {
      try {
        if (!this.isDue(plan, today)) continue;
        const created = await this.generateForPlan(plan, today);
        if (created) generated++;
      } catch (error) {
        // One bad plan must never stop the rest of the run.
        this.logger.error(
          `Plan ${plan.id} failed to generate for ${today}: ${(error as Error).message}`,
        );
      }
    }

    if (generated) {
      this.logger.log(`Generated ${generated} collection request(s) for ${today}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private isDue(plan: CollectionPlan, today: string): boolean {
    if (plan.startDate && today < plan.startDate) return false;
    if (plan.endDate && today > plan.endDate) return false;
    if (plan.lastGeneratedDate === today) return false;

    const date = new Date(`${today}T00:00:00`);
    switch (plan.frequency) {
      case CollectionPlanFrequency.DAILY:
        return true;
      case CollectionPlanFrequency.WEEKLY: {
        // JS getDay(): 0=Sunday; ISO weekday 1=Monday .. 7=Sunday.
        const isoWeekday = date.getDay() || 7;
        return plan.weekdays?.includes(isoWeekday) ?? false;
      }
      case CollectionPlanFrequency.MONTHLY:
        return plan.monthDays?.includes(date.getDate()) ?? false;
      default:
        return false;
    }
  }

  private async generateForPlan(
    plan: CollectionPlan,
    today: string,
  ): Promise<boolean> {
    const lines = plan.lines ?? [];
    if (!lines.length) return false;

    const products = await this.productRepo.find({
      where: { id: In(lines.map((l) => l.productId)) },
    });
    const found = new Map(products.map((p) => [p.id, p]));
    const weightCodes = await this.units.weightCodes();

    const requestLines = [];
    let weightKg = 0;
    let grandTotal = 0;
    for (const line of lines) {
      const product = found.get(line.productId);
      // The line is a snapshot and survives catalogue edits — but a request
      // needs a live price, so a deactivated/removed product skips its line.
      if (!product || !product.isActive) continue;

      const effective = await this.effectivePrice.effectivePrice(
        product.id,
        Role.INSTITUTIONS,
        null,
      );
      if (!effective) continue;

      const unitPrice = Number(effective.price);
      const quantity = Number(line.quantity);
      const total = +(unitPrice * quantity).toFixed(3);
      weightKg += estimateWeightKg(product, quantity, weightCodes);
      grandTotal += total;

      requestLines.push(
        this.lineRepo.create({
          productId: product.id,
          productName: line.productName,
          unitType: line.unitType,
          quantity: line.quantity,
          unitPrice: String(unitPrice),
          total: String(total),
          note: plan.itemNote ?? null,
        }),
      );
    }

    if (!requestLines.length) return false;

    const scheduledAt = new Date(`${today}T${plan.collectionTime}`);
    const request = this.requestRepo.create({
      requestNumber: await nextSequentialNumber(
        this.requestRepo,
        'requestNumber',
        this.requestPrefix(),
        5,
      ),
      type: CollectionRequestType.ORG_PLAN,
      status: CollectionRequestStatus.CREATED,
      accountId: plan.accountId,
      scheduledAt,
      estimatedWeightKg: String(+weightKg.toFixed(3)),
      estimatedGrandTotal: String(+grandTotal.toFixed(3)),
      sourcePlanId: plan.id,
      sourcePlanDate: today,
      lines: requestLines,
    });

    await this.requestRepo.save(request);

    plan.lastGeneratedDate = today;
    await this.planRepo.save(plan);
    return true;
  }

  private requestPrefix(): string {
    const now = new Date();
    return `CR-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private localDateString(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
