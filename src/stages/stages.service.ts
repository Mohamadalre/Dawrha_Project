import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { Stage } from './entities/stage.entity';
import { PointsWallet } from '@src/points-wallet/entities/points-wallet.entity';
import { CreateStageDto, ListStagesQueryDto, UpdateStageDto } from './dto/stage.dto';

/**
 * Points stages (مراحل). The admin owns the list; users are classified into the
 * one stage whose points band contains their wallet balance.
 *
 * Two invariants the service keeps so the feature is never ambiguous:
 *   1. `sort_order` is a CONTIGUOUS 1..N sequence — inserting shifts the ones
 *      after down, moving shifts the span between, deleting closes the gap.
 *   2. Point ranges NEVER OVERLAP — so "which stage is this balance in?" always
 *      has exactly one answer.
 */
@Injectable()
export class StagesService {
  constructor(
    @InjectRepository(Stage)
    private readonly stageRepo: Repository<Stage>,
    @InjectRepository(PointsWallet)
    private readonly walletRepo: Repository<PointsWallet>,
    private readonly dataSource: DataSource,
  ) {}

  private map(s: Stage) {
    return {
      id: s.id,
      name: s.name,
      image: s.imageUrl ?? null,
      order: s.sortOrder,
      min_points: s.minPoints,
      max_points: s.maxPoints,
      is_active: s.isActive,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    };
  }

  /** Stages in display order, paginated, with an optional active/inactive filter. */
  async list(query: ListStagesQueryDto) {
    const page = Math.max(1, Math.floor(query.page) || 1);
    const limit = Math.min(Math.max(1, Math.floor(query.limit) || 20), 100);

    const where =
      query.status === 'active'
        ? { isActive: true }
        : query.status === 'inactive'
          ? { isActive: false }
          : {};

    const [rows, total] = await this.stageRepo.findAndCount({
      where,
      order: { sortOrder: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      stages: rows.map((s) => this.map(s)),
      pagination: {
        total,
        page,
        limit,
        total_pages: limit > 0 ? Math.ceil(total / limit) : 0,
        has_next: page * limit < total,
        has_prev: page > 1,
      },
    };
  }

  /**
   * Refuse a range that overlaps any OTHER stage (two bands [a,b] and [c,d]
   * overlap when a <= d AND c <= b), and a reversed range.
   */
  private async assertRange(minPoints: number, maxPoints: number, excludeId?: string) {
    if (minPoints > maxPoints) {
      throw new BadRequestException('The first point must not be greater than the last point');
    }
    const qb = this.stageRepo
      .createQueryBuilder('s')
      .where('s.minPoints <= :max AND s.maxPoints >= :min', { min: minPoints, max: maxPoints });
    if (excludeId) qb.andWhere('s.id != :excludeId', { excludeId });
    const clash = await qb.getOne();
    if (clash) {
      throw new BadRequestException(
        `This range overlaps the stage "${clash.name}" (${clash.minPoints}–${clash.maxPoints})`,
      );
    }
  }

  async create(dto: CreateStageDto, imageUrl?: string | null) {
    await this.assertRange(dto.minPoints, dto.maxPoints);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Stage);
      const count = await repo.count();
      // Where to place it: clamp a requested position into 1..count+1; append by default.
      const target = dto.order ? Math.min(Math.max(dto.order, 1), count + 1) : count + 1;
      // Make room: everything at or after the target shifts down by one.
      if (target <= count) {
        await repo
          .createQueryBuilder()
          .update(Stage)
          .set({ sortOrder: () => '"sort_order" + 1' })
          .where('"sort_order" >= :target', { target })
          .execute();
      }
      const saved = await repo.save(
        repo.create({
          name: dto.name,
          imageUrl: imageUrl ?? null,
          minPoints: dto.minPoints,
          maxPoints: dto.maxPoints,
          sortOrder: target,
          isActive: dto.isActive ?? true,
        }),
      );
      return { message: 'Stage created successfully', result: this.map(saved) };
    });
  }

  async update(id: string, dto: UpdateStageDto, imageUrl?: string | null) {
    const stage = await this.stageRepo.findOne({ where: { id } });
    if (!stage) throw new NotFoundException('Stage not found');

    const min = dto.minPoints ?? stage.minPoints;
    const max = dto.maxPoints ?? stage.maxPoints;
    if (dto.minPoints !== undefined || dto.maxPoints !== undefined) {
      await this.assertRange(min, max, id);
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Stage);

      if (dto.name !== undefined) stage.name = dto.name;
      if (imageUrl !== undefined) stage.imageUrl = imageUrl;
      if (dto.isActive !== undefined) stage.isActive = dto.isActive;
      stage.minPoints = min;
      stage.maxPoints = max;
      await repo.save(stage);

      // A move is handled by the same shift logic as reorder.
      if (dto.order !== undefined && dto.order !== stage.sortOrder) {
        await this.moveWithin(repo, stage.id, dto.order);
      }

      const fresh = await repo.findOne({ where: { id } });
      return { message: 'Stage updated successfully', result: this.map(fresh!) };
    });
  }

  /** Move a stage to a new 1-based position; the span between shifts to fill in. */
  async reorder(id: string, newOrder: number) {
    const exists = await this.stageRepo.findOne({ where: { id } });
    if (!exists) throw new NotFoundException('Stage not found');
    await this.dataSource.transaction((manager) =>
      this.moveWithin(manager.getRepository(Stage), id, newOrder),
    );
    const fresh = await this.stageRepo.findOne({ where: { id } });
    return { message: 'Stage order updated successfully', result: this.map(fresh!) };
  }

  private async moveWithin(repo: Repository<Stage>, id: string, requested: number) {
    const stage = await repo.findOne({ where: { id } });
    if (!stage) throw new NotFoundException('Stage not found');
    const count = await repo.count();
    const to = Math.min(Math.max(requested, 1), count);
    const from = stage.sortOrder;
    if (to === from) return;

    if (to < from) {
      // Moving UP: the block [to, from-1] slides down by one.
      await repo
        .createQueryBuilder()
        .update(Stage)
        .set({ sortOrder: () => '"sort_order" + 1' })
        .where('"sort_order" >= :to AND "sort_order" < :from AND id != :id', { to, from, id })
        .execute();
    } else {
      // Moving DOWN: the block [from+1, to] slides up by one.
      await repo
        .createQueryBuilder()
        .update(Stage)
        .set({ sortOrder: () => '"sort_order" - 1' })
        .where('"sort_order" > :from AND "sort_order" <= :to AND id != :id', { from, to, id })
        .execute();
    }
    await repo.update(id, { sortOrder: to });
  }

  async remove(id: string) {
    const stage = await this.stageRepo.findOne({ where: { id } });
    if (!stage) throw new NotFoundException('Stage not found');

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Stage);
      const removedOrder = stage.sortOrder;
      await repo.delete(id);
      // Close the gap: everything after the removed stage slides up by one.
      await repo
        .createQueryBuilder()
        .update(Stage)
        .set({ sortOrder: () => '"sort_order" - 1' })
        .where('"sort_order" > :removedOrder', { removedOrder })
        .execute();
    });

    return { message: 'Stage deleted successfully', result: { id } };
  }

  /**
   * The stage the caller is currently in, decided by their wallet balance, with
   * the band and their own points. `stage` is null when their balance falls in
   * no configured band (or no stages exist yet).
   */
  async myStage(accountId: string) {
    const wallet = await this.walletRepo.findOne({ where: { accountId } });
    const points = wallet?.points ?? 0;
    // Only an ACTIVE stage classifies the user; an inactive band matches no one.
    const stage = await this.stageRepo
      .createQueryBuilder('s')
      .where('s.minPoints <= :p AND s.maxPoints >= :p', { p: points })
      .andWhere('s.isActive = true')
      .orderBy('s.sortOrder', 'ASC')
      .getOne();
    return {
      points,
      current_stage: stage ? this.map(stage) : null,
    };
  }
}
