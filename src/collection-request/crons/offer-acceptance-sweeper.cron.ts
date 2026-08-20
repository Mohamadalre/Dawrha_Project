import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectionRequestAssignment } from '../entities/collection-request-assignment.entity';
import { DispatchEngineService } from '../services/dispatch-engine.service';
import { CollectionRequestAssignmentStatus } from '../enums/collection-request-assignment-status.enum';

/**
 * The accept-window's clock, since a driver may simply never answer.
 *
 * Every minute, offers whose deadline passed are EXPIRED and the engine moves
 * to the next candidate (or flags the request NEEDS_ADMIN). Bounded to the 100
 * oldest, which a minute of offers can never exceed at 5-minute windows.
 */
@Injectable()
export class OfferAcceptanceSweeper {
  private readonly logger = new Logger('OFFER_SWEEPER');

  constructor(
    @InjectRepository(CollectionRequestAssignment)
    private readonly assignmentRepo: Repository<CollectionRequestAssignment>,
    private readonly engine: DispatchEngineService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireOffers(): Promise<void> {
    const now = new Date();
    const expired = await this.assignmentRepo.find({
      where: { status: CollectionRequestAssignmentStatus.OFFERED },
      relations: ['request'],
      order: { offerExpiresAt: 'ASC' },
      take: 100,
    });

    let expiredCount = 0;
    for (const assignment of expired) {
      if (assignment.offerExpiresAt && assignment.offerExpiresAt <= now) {
        try {
          await this.engine.settleOffer(
            assignment,
            CollectionRequestAssignmentStatus.EXPIRED,
          );
          expiredCount++;
        } catch (error) {
          this.logger.error(
            `Failed to expire offer ${assignment.id}`,
            error as Error,
          );
        }
      }
    }
    if (expiredCount) {
      this.logger.log(`Expired ${expiredCount} offer(s) with no response`);
    }
  }
}