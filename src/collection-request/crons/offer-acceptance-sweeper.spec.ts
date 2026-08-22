import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OfferAcceptanceSweeper } from './offer-acceptance-sweeper.cron';
import { DispatchEngineService } from '../services/dispatch-engine.service';
import { CollectionRequestAssignment } from '../entities/collection-request-assignment.entity';
import { CollectionRequestAssignmentStatus } from '../enums/collection-request-assignment-status.enum';

describe('OfferAcceptanceSweeper', () => {
  it('expires offers whose window passed and leaves live offers alone', async () => {
    const expired = {
      id: 'as-expired',
      requestId: 'req-1',
      driverId: 'dA',
      status: CollectionRequestAssignmentStatus.OFFERED,
      offerExpiresAt: new Date(Date.now() - 60_000),
    };
    const live = {
      id: 'as-live',
      requestId: 'req-1',
      driverId: 'dB',
      status: CollectionRequestAssignmentStatus.OFFERED,
      offerExpiresAt: new Date(Date.now() + 60_000),
    };
    const assignmentRepo = { find: jest.fn().mockResolvedValue([expired, live]) };
    const engine = { settleOffer: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OfferAcceptanceSweeper,
        { provide: getRepositoryToken(CollectionRequestAssignment), useValue: assignmentRepo },
        { provide: DispatchEngineService, useValue: engine },
      ],
    }).compile();

    const sweeper = moduleRef.get(OfferAcceptanceSweeper);
    await sweeper.expireOffers();

    expect(engine.settleOffer).toHaveBeenCalledTimes(1);
    expect(engine.settleOffer).toHaveBeenCalledWith(
      expired,
      CollectionRequestAssignmentStatus.EXPIRED,
    );
  });
});