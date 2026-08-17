import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Not, Repository } from 'typeorm';
import { Stage } from './entities/stage.entity';
import { PointsWallet } from '@src/points-wallet/entities/points-wallet.entity';
import { Role } from '@src/user/enums/role.enum';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
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
    private readonly cloudinary: CloudinaryService,
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

    // How many users each stage currently holds — a user is "in" a stage when
    // their wallet balance falls in its band. Useful before an admin edits or
    // deletes one: a band with people in it is not an empty slot.
    const counts = await this.userCounts(rows);

    return {
      stages: rows.map((s) => ({ ...this.map(s), user_count: counts.get(s.id) ?? 0 })),
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

  /** Users whose wallet balance falls in each stage's band, by stage id. */
  private async userCounts(stages: Stage[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!stages.length) return map;
    // Ranges never overlap, so a wallet is counted for at most one stage. One
    // query per stage keeps this simple; a ladder has a handful of stages.
    for (const s of stages) {
      const count = await this.walletRepo
        .createQueryBuilder('w')
        .where('w.points BETWEEN :min AND :max', { min: s.minPoints, max: s.maxPoints })
        .getCount();
      map.set(s.id, count);
    }
    return map;
  }

  /**
   * The ladder as a USER sees it: the active stages in order, each flagged
   * whether it is the caller's current one. Read-only — users never edit stages.
   */
  async listForUser(accountId: string) {
    const wallet = await this.walletRepo.findOne({ where: { accountId } });
    const points = wallet?.points ?? 0;
    const rows = await this.stageRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
    const currentId = rows.find((s) => points >= s.minPoints && points <= s.maxPoints)?.id ?? null;
    return {
      points,
      current_stage_id: currentId,
      stages: rows.map((s) => ({ ...this.map(s), is_current: s.id === currentId })),
    };
  }

  /** Refuse a name another stage already uses (case-insensitive). */
  private async assertNameFree(name: string, excludeId?: string) {
    const clash = await this.stageRepo.findOne({
      where: excludeId
        ? { name: ILike(name), id: Not(excludeId) }
        : { name: ILike(name) },
    });
    if (clash) {
      throw new BadRequestException(`A stage named "${clash.name}" already exists`);
    }
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
    // A stage image is mandatory — the ladder is shown to users as badges, and a
    // stage with no image is a blank one on their screen.
    if (!imageUrl) {
      throw new BadRequestException('A stage image is required');
    }
    await this.assertNameFree(dto.name);
    await this.assertRange(dto.minPoints, dto.maxPoints);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Stage);
      // The order is never chosen by hand: a new stage is appended as the next
      // number in the sequence. Re-ordering is a separate, deliberate action.
      const sortOrder = (await repo.count()) + 1;
      const saved = await repo.save(
        repo.create({
          name: dto.name,
          imageUrl,
          minPoints: dto.minPoints,
          maxPoints: dto.maxPoints,
          sortOrder,
          isActive: dto.isActive ?? true,
        }),
      );
      return { message: 'Stage created successfully', result: this.map(saved) };
    });
  }

  async update(id: string, dto: UpdateStageDto, imageUrl?: string | null) {
    const stage = await this.stageRepo.findOne({ where: { id } });
    if (!stage) throw new NotFoundException('Stage not found');

    if (dto.name !== undefined && dto.name !== stage.name) {
      await this.assertNameFree(dto.name, id);
    }

    const min = dto.minPoints ?? stage.minPoints;
    const max = dto.maxPoints ?? stage.maxPoints;
    if (dto.minPoints !== undefined || dto.maxPoints !== undefined) {
      await this.assertRange(min, max, id);
    }

    // Remember the old image: a new one REPLACES it, and the old Cloudinary
    // asset must not be left orphaned once the row no longer points at it.
    const oldImageUrl = stage.imageUrl ?? null;
    const replacingImage = imageUrl !== undefined && imageUrl !== oldImageUrl;

    const result = await this.dataSource.transaction(async (manager) => {
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

    // Best-effort, AFTER the row is safely saved: deleting the old file must
    // never fail an otherwise-successful edit.
    if (replacingImage && oldImageUrl) {
      await this.cloudinary.deleteByUrl(oldImageUrl);
    }
    return result;
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

    const imageUrl = stage.imageUrl ?? null;

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

    // The stage is gone; its image would otherwise be an orphan on Cloudinary.
    if (imageUrl) await this.cloudinary.deleteByUrl(imageUrl);
    return { message: 'Stage deleted successfully', result: { id } };
  }

  /**
   * The stage the caller is currently in, decided by their wallet balance, with
   * the band and their own points. `stage` is null when their balance falls in
   * no configured band (or no stages exist yet).
   */
  async myStage(accountId: string, role?: Role) {
    const wallet = await this.walletRepo.findOne({ where: { accountId } });
    const points = wallet?.points ?? 0;
    // Only an ACTIVE stage classifies the user; an inactive band matches no one.
    const stage = await this.stageRepo
      .createQueryBuilder('s')
      .where('s.minPoints <= :p AND s.maxPoints >= :p', { p: points })
      .andWhere('s.isActive = true')
      .orderBy('s.sortOrder', 'ASC')
      .getOne();

    // The caller's rank WITHIN their own stage, by points, highest first.
    //
    // The stages are the CITIZENS' loyalty ladder, so the rank is computed among
    // CITIZEN accounts only — a factory / institution / free facility is never
    // ranked, and gets no rank here. Competition ranking: rank = 1 + how many
    // citizens in the SAME band have MORE points, so ties share a rank.
    // `stage_users_count` is the citizens in the band ("3 of 20"). Null when the
    // caller is in no stage, or is not a citizen.
    let stageRank: number | null = null;
    let stageUsersCount = 0;
    if (stage && role === Role.CITIZEN) {
      const band = { min: stage.minPoints, max: stage.maxPoints, role: Role.CITIZEN };
      stageUsersCount = await this.walletRepo
        .createQueryBuilder('w')
        .innerJoin('w.account', 'a')
        .where('w.points BETWEEN :min AND :max', band)
        .andWhere('a.role = :role', band)
        .getCount();
      const ahead = await this.walletRepo
        .createQueryBuilder('w')
        .innerJoin('w.account', 'a')
        .where('w.points BETWEEN :min AND :max', band)
        .andWhere('a.role = :role', band)
        .andWhere('w.points > :p', { p: points })
        .getCount();
      stageRank = ahead + 1;
    }

    return {
      points,
      current_stage: stage ? this.map(stage) : null,
      // The caller's standing inside their stage.
      stage_rank: stageRank,
      stage_users_count: stageUsersCount,
      // A plain sentence for the common "no stage yet" case, so the client shows
      // something meaningful instead of an empty object the user has to
      // interpret.
      message: stage
        ? `You are in the "${stage.name}" stage`
        : 'You are not in any stage yet — earn more points to reach one',
    };
  }
}
