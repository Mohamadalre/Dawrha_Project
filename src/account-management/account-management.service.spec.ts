import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccountManagementService } from './account-management.service';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { statusMedia } from '@src/media/entities/media.entity';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

/**
 * Reviewing an application.
 *
 * The flow this pins down separates two acts that used to be one. Marking a
 * document unacceptable is the REVIEWER's judgement, recorded in their own
 * file; asking the applicant to replace it is a second, deliberate act that
 * interrupts them. Collapsing the two meant a reviewer could not work down a
 * list of four documents marking each one — the first rejection ended the
 * review and sent the applicant off to start fixing, before anyone had looked
 * at the rest.
 *
 * Three rules do most of the work, and each exists because of a specific way
 * this goes wrong:
 *
 *   APPROVING is blocked by a rejected document, not by an unread one.
 *   Approving is itself a statement that the submission is acceptable, so it
 *   settles what is still open — but it must not override the reviewer's own
 *   recorded finding that one document was not.
 *
 *   REJECTING is blocked by an unread document. A rejection has to be
 *   answerable later, and "we said no while three of your four documents were
 *   unread" is not an answer.
 *
 *   The applicant comes back when nothing is still ASKED FOR — not when
 *   nothing is rejected. Those differ, and the difference is the trap: an
 *   account can carry a silently-rejected document the applicant was never
 *   told about, and keying their release off rejections strands them.
 */
describe('AccountManagementService — reviewing an application', () => {
  let service: AccountManagementService;
  let profileResolver: any;
  let profileDataProvider: any;
  let mediaRepo: any;
  let accountRepo: any;
  let userDeviceRepo: any;
  let statusNotifier: any;
  let applicationsCache: any;
  let profileRepo: any;
  let dataSource: any;
  let pointsWallet: any;

  /** The account under review, mutated by the tests to set the scene. */
  let account: any;
  /** Its documents. */
  let documents: any[];

  /**
   * The subset of TypeORM's `where` this service actually asks for.
   *
   * Only the shapes in use are honoured — `status` equality, `ownerId`
   * equality, and `reuploadRequestedAt: Not(IsNull())`. Anything else would be
   * inventing behaviour no call site depends on, and a mock that quietly
   * accepts a filter it does not apply is worse than one that never had it.
   */
  const matches = (doc: any, where: any) => {
    if (!where) return true;
    if (where.status !== undefined && doc.status !== where.status) return false;
    if (where.ownerId !== undefined && typeof where.ownerId === 'string'
        && doc.ownerId !== where.ownerId) return false;
    if (where.reuploadRequestedAt !== undefined && !doc.reuploadRequestedAt) return false;
    return true;
  };

  const media = (over: Partial<any> = {}) => ({
    id: UUID,
    ownerId: UUID,
    ownerType: 'FACTORY',
    fileType: 'LICENSE',
    url: 'https://cdn/licence.jpg',
    publicId: 'factories/1/LICENSE/1',
    status: statusMedia.PENDING,
    reuploadRequestedAt: null,
    reuploadReason: null,
    createdAt: new Date('2026-01-01'),
    ...over,
  });

  beforeEach(() => {
    account = {
      id: 'a1',
      role: Role.FACTORY,
      accountStatus: AccountStatus.PENDING_APPROVAL,
    };
    documents = [media()];

    profileRepo = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      // Carries the LOCATION COLUMNS, because a real profile does: they come
      // from LocationBase, which every profile extends, so they arrive on the
      // entity whether or not a given payload wants them. A mock without them
      // makes "the detail payload has no location" pass by describing a
      // profile that never had one — which is a test about the mock.
      findOne: jest.fn().mockResolvedValue({
        id: UUID,
        account,
        factoryName: 'مصنع الاختبار',
        province: { id: 'prov-1', name: 'دمشق' },
        address: 'المزة',
        DesscriptLocation: 'بجانب الحديقة',
        coordinates: { type: 'Point', coordinates: [36.27, 33.51] },
      }),
    };
    profileResolver = { getRepo: jest.fn().mockReturnValue(profileRepo) };
    profileDataProvider = {
      getRelations: jest.fn().mockReturnValue(['account']),
      getMaterialKey: jest.fn().mockReturnValue('factoryMaterial'),
    };
    mediaRepo = {
      // `find` and `count` HONOUR the `where` they are given, rather than
      // answering the question the test wishes had been asked.
      //
      // A mock that ignores its filter turns "counts what is still requested"
      // into a test that passes whichever column the code actually counts —
      // which is precisely the distinction this suite exists to pin down. It
      // was ignoring it, and the mutation check said so: flipping the service
      // to count rejections left every test green.
      find: jest.fn(async ({ where }: any = {}) => documents.filter((d) => matches(d, where))),
      findOne: jest.fn(async () => documents[0]),
      count: jest.fn(async ({ where }: any = {}) =>
        documents.filter((d) => matches(d, where)).length,
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    accountRepo = {
      findOne: jest.fn(async () => account),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => ({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => account),
      })),
    };
    userDeviceRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    statusNotifier = {
      notifyStatusDecision: jest.fn().mockResolvedValue(undefined),
      notifyReviewResumed: jest.fn().mockResolvedValue(undefined),
      notifyReopened: jest.fn().mockResolvedValue(undefined),
      notifyBlocked: jest.fn().mockResolvedValue(undefined),
      notifyUnblocked: jest.fn().mockResolvedValue(undefined),
    };
    // Cache is a pass-through here: never a hit, invalidation a no-op.
    applicationsCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };
    pointsWallet = {
      ensureForAccount: jest.fn().mockResolvedValue(null),
      view: jest.fn().mockResolvedValue({ points: 0, currency: 'POINTS', wallet_id: null }),
    };
    dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb({
          getRepository: (entity: any) =>
            entity?.name === 'Media' ? mediaRepo : accountRepo,
        }),
      ),
    };

    service = new AccountManagementService(
      profileResolver,
      profileDataProvider,
      mediaRepo,
      accountRepo,
      userDeviceRepo,
      statusNotifier,
      applicationsCache,
      dataSource,
      pointsWallet,
    );
  });

  // ==========================================================================
  // The review queue
  // ==========================================================================
  describe('the review queue', () => {
    it('shows only applications that are actually waiting', async () => {
      await service.listReviewQueue(Role.FACTORY, 1, 10);

      expect(profileRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { account: { accountStatus: AccountStatus.PENDING_APPROVAL } },
        }),
      );
    });

    it('puts the OLDEST application first', async () => {
      // Newest-first is the default everywhere else and exactly wrong here: it
      // buries whoever has waited longest under everyone who applied since.
      await service.listReviewQueue(Role.FACTORY, 1, 10);

      expect(profileRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'ASC' } }),
      );
    });

    it('keeps a resubmitted application in its original place', async () => {
      // Ordering by "became pending most recently" would send it to the back
      // every time the reviewer asked for a document — punishing the applicant
      // with a longer wait each round for answering a question they were asked.
      const submitted = new Date('2026-01-01');
      profileRepo.findAndCount.mockResolvedValue([
        [{ id: 'p-old', createdAt: submitted, account }],
        1,
      ]);

      const res: any = await service.listReviewQueue(Role.FACTORY, 1, 10);

      expect(res.items[0].submitted_at).toEqual(submitted);
      expect(profileRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'ASC' } }),
      );
    });

    it('says how many documents each applicant still owes', async () => {
      profileRepo.findAndCount.mockResolvedValue([[{ id: UUID, createdAt: new Date(), account }], 1]);
      mediaRepo.find.mockResolvedValue([{ id: 'm1', ownerId: UUID }, { id: 'm2', ownerId: UUID }]);

      const res: any = await service.listReviewQueue(Role.FACTORY, 1, 10);

      expect(res.items[0].documents_requested).toBe(2);
    });
  });

  describe('listing by status', () => {
    it('rejects a status that is not one', async () => {
      await expect(
        service.getProfiles(Role.FACTORY, { page: 1, limit: 10, status: 'NONSENSE' as AccountStatus }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns every status when none is given', async () => {
      await service.getProfiles(Role.FACTORY, { page: 1, limit: 10 });
      expect(profileRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('filters to the status asked for', async () => {
      await service.getProfiles(Role.FACTORY, {
        page: 1, limit: 10, status: AccountStatus.REJECTED,
      });
      expect(profileRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { account: { accountStatus: AccountStatus.REJECTED } },
        }),
      );
    });

    it('never leaks the password hash or the sign-in identity', async () => {
      // This screen used to return the whole entity, so every applicant's
      // argon2 hash travelled to the browser of anyone allowed to open the
      // review list. A secret that is merely unused is still a secret that
      // leaked — it is in the body, the browser cache, and any log of one.
      profileRepo.findAndCount.mockResolvedValue([
        [{
          id: 'p1',
          createdAt: new Date(),
          account: {
            ...account,
            name: 'F', email: 'f@x.com', phone: '0999', profileImage: 'img.png',
            passwordHash: '$argon2id$v=19$SECRET',
            googleId: 'g-1', provider: 'LOCAL', isEmailVerified: true,
          },
        }],
        1,
      ]);

      const res: any = await service.getProfiles(Role.FACTORY, { page: 1, limit: 10 });

      const serialized = JSON.stringify(res.items);
      expect(serialized).not.toContain('argon2');
      expect(serialized).not.toContain('googleId');
      expect(res.items[0].account.email).toBe('f@x.com');
    });
  });

  // ==========================================================================
  // Deciding on a document
  // ==========================================================================
  describe('marking a document', () => {
    it('rejects it WITHOUT telling the applicant', async () => {
      // The whole point of the split: a reviewer must be able to mark one
      // document bad while still working through the rest.
      const res: any = await service.updateMediaStatus(UUID, {
        status: statusMedia.REJECTED,
      } as any);

      expect(mediaRepo.update).toHaveBeenCalledWith(
        UUID, expect.objectContaining({ status: statusMedia.REJECTED }),
      );
      expect(statusNotifier.notifyStatusDecision).not.toHaveBeenCalled();
      expect(res.message).toContain('has not been told');
    });

    it('does not move the account when a document is rejected', async () => {
      await service.updateMediaStatus(UUID, { status: statusMedia.REJECTED } as any);
      expect(accountRepo.update).not.toHaveBeenCalled();
    });

    it('lets a rejected document be accepted again', async () => {
      // A reviewer who mis-clicks, or re-reads a scan and changes their mind,
      // must be able to say so without involving the applicant at all.
      documents = [media({ status: statusMedia.REJECTED })];

      const res: any = await service.updateMediaStatus(UUID, {
        status: statusMedia.APPROVED,
      } as any);

      expect(res.message).toBe('Document approved successfully');
    });

    it('closes any outstanding request when the document is accepted', async () => {
      documents = [media({ status: statusMedia.REJECTED, reuploadRequestedAt: new Date() })];

      await service.updateMediaStatus(UUID, { status: statusMedia.APPROVED } as any);

      expect(mediaRepo.update).toHaveBeenCalledWith(
        UUID,
        expect.objectContaining({ reuploadRequestedAt: null, reuploadReason: null }),
      );
    });

    it('refuses to re-judge a document once the account is approved', async () => {
      // The documents are the evidence the approval rests on; re-marking one
      // afterwards rewrites the basis of a decision already acted upon.
      account.accountStatus = AccountStatus.ACTIVE;

      await expect(
        service.updateMediaStatus(UUID, { status: statusMedia.REJECTED } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('FREEZES the documents of a rejected application', async () => {
      // The decision has been taken and sent. Quietly re-marking the evidence
      // underneath it changes what the applicant was refused for, after they
      // have already been told — and nothing on either side would show that
      // the grounds had moved.
      account.accountStatus = AccountStatus.REJECTED;

      await expect(
        service.updateMediaStatus(UUID, { status: statusMedia.APPROVED } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('thaws them once the application is re-opened', async () => {
      // Reconsidering is allowed — in the open. Re-opening says so, tells the
      // applicant, and puts the application back where documents are editable.
      account.accountStatus = AccountStatus.REJECTED;
      await service.reopenApplication(UUID, {});
      account.accountStatus = AccountStatus.PENDING_APPROVAL;

      await expect(
        service.updateMediaStatus(UUID, { status: statusMedia.APPROVED } as any),
      ).resolves.toBeDefined();
    });

    it('refuses to push a document back to PENDING', async () => {
      // That is not a review outcome, it is undoing one without saying which
      // way. Only the applicant re-uploading returns a document to PENDING.
      await expect(
        service.updateMediaStatus(UUID, { status: statusMedia.PENDING } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reports a missing document as not found', async () => {
      mediaRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateMediaStatus(UUID, { status: statusMedia.APPROVED } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==========================================================================
  // Asking for a document again
  // ==========================================================================
  describe('requesting a document again', () => {
    it('tells the applicant and moves the account to NEED_CHANGES', async () => {
      documents = [media({ status: statusMedia.REJECTED })];

      const res: any = await service.requestReupload(UUID, { reason: 'الصورة غير واضحة' });

      expect(mediaRepo.update).toHaveBeenCalledWith(
        UUID,
        expect.objectContaining({ reuploadReason: 'الصورة غير واضحة' }),
      );
      expect(accountRepo.update).toHaveBeenCalledWith('a1', {
        accountStatus: AccountStatus.NEED_CHANGES,
      });
      expect(statusNotifier.notifyStatusDecision).toHaveBeenCalledWith(
        'a1', AccountStatus.NEED_CHANGES, 'الصورة غير واضحة',
      );
      expect(res.account_status).toBe(AccountStatus.NEED_CHANGES);
    });

    it('refuses a document that was never rejected', async () => {
      // "We need this again" has to be preceded by a recorded finding of what
      // was wrong with it — otherwise the applicant is asked to replace a
      // document nobody said anything about.
      documents = [media({ status: statusMedia.PENDING })];

      await expect(service.requestReupload(UUID, {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to ask twice while the applicant has not answered', async () => {
      documents = [media({ status: statusMedia.REJECTED, reuploadRequestedAt: new Date() })];

      await expect(service.requestReupload(UUID, {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses on a REJECTED application until it is re-opened', async () => {
      // ONE door back, not two. Asking for a document on a rejected
      // application would be an implicit re-opening by the back door — the
      // applicant would be pulled into NEED_CHANGES without ever being told
      // the refusal was being reconsidered. `reopenApplication` is the door,
      // and it says so out loud.
      account.accountStatus = AccountStatus.REJECTED;
      documents = [media({ status: statusMedia.REJECTED })];

      await expect(
        service.requestReupload(UUID, { reason: 'أرسل نسخة أوضح' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('works once the application has been re-opened', async () => {
      account.accountStatus = AccountStatus.REJECTED;
      documents = [media({ status: statusMedia.REJECTED })];

      const reopened: any = await service.reopenApplication(UUID, {});
      expect(reopened.account_status).toBe(AccountStatus.PENDING_APPROVAL);
      account.accountStatus = AccountStatus.PENDING_APPROVAL;

      const res: any = await service.requestReupload(UUID, { reason: 'أرسل نسخة أوضح' });
      expect(res.account_status).toBe(AccountStatus.NEED_CHANGES);
    });

    it('refuses on an approved account', async () => {
      account.accountStatus = AccountStatus.ACTIVE;
      documents = [media({ status: statusMedia.REJECTED })];

      await expect(service.requestReupload(UUID, {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('sends a default reason rather than an empty message', async () => {
      documents = [media({ status: statusMedia.REJECTED })];

      await service.requestReupload(UUID, {});

      const [, , reason] = statusNotifier.notifyStatusDecision.mock.calls[0];
      expect(String(reason).length).toBeGreaterThan(0);
      expect(String(reason)).toContain('LICENSE');
    });
  });

  // ==========================================================================
  // The shape of the detail payload
  // ==========================================================================
  describe('account details', () => {
    it('carries no location block', async () => {
      // `GET :profileId/location` answers that on its own, for every role. Two
      // places holding one answer is how they start disagreeing — and the
      // location columns arrive on every profile from LocationBase whether the
      // payload wants them or not, so they have to be dropped deliberately.
      const res: any = await service.getAccountDetails(UUID);

      expect(res.profile).not.toHaveProperty('location');
      expect(res).not.toHaveProperty('location');
    });

    it('does not leak the raw location columns into the profile either', async () => {
      // Dropping the assembled block but leaving `province`, `address`,
      // `coordinates` and `DesscriptLocation` in the spread would remove the
      // heading and keep the data.
      const res: any = await service.getAccountDetails(UUID);

      for (const key of ['province', 'address', 'coordinates', 'DesscriptLocation']) {
        expect(res.profile).not.toHaveProperty(key);
      }
    });
  });

  // ==========================================================================
  // The applicant never comes back
  // ==========================================================================
  describe('cancelling the document requests', () => {
    beforeEach(() => {
      account.accountStatus = AccountStatus.NEED_CHANGES;
      documents = [
        media({ id: 'm1', status: statusMedia.REJECTED, reuploadRequestedAt: new Date() }),
        media({ id: 'm2', status: statusMedia.APPROVED }),
      ];
    });

    it('breaks the stall and returns the account to the queue', async () => {
      // The state the flow could not leave: asking for a document moves the
      // account to NEED_CHANGES, no decision may be taken in NEED_CHANGES, so
      // an applicant who never answers left the reviewer with no move at all —
      // unable to approve, reject or close the application.
      const res: any = await service.cancelReuploadRequests(UUID, {});

      expect(res.cancelled).toBe(1);
      expect(res.account_status).toBe(AccountStatus.PENDING_APPROVAL);
    });

    it('clears every outstanding request in one act', async () => {
      documents = [
        media({ id: 'm1', status: statusMedia.REJECTED, reuploadRequestedAt: new Date() }),
        media({ id: 'm2', status: statusMedia.REJECTED, reuploadRequestedAt: new Date() }),
      ];

      const res: any = await service.cancelReuploadRequests(UUID, {});

      // Account-level, not per document: cancelling one of two would leave the
      // account blocked on the other, which is a button that appears to fail.
      expect(res.cancelled).toBe(2);
      expect(mediaRepo.update).toHaveBeenCalledWith(
        expect.anything(),
        { reuploadRequestedAt: null, reuploadReason: null },
      );
    });

    it('withdraws the QUESTION, not the finding', async () => {
      // Cancelling is not accepting. Turning "I gave up waiting" into "I accept
      // what you sent" would approve a document the reviewer had just called
      // unacceptable, silently.
      await service.cancelReuploadRequests(UUID, {});

      const patches = mediaRepo.update.mock.calls.map(([, p]: any[]) => p);
      expect(patches.every((p: any) => !('status' in p))).toBe(true);
    });

    it('leaves the account rejectable but not approvable', async () => {
      // The pair of doors this deliberately leaves open. Every document has
      // been judged, so a rejection is answerable; one is still marked
      // unacceptable, so an approval would override the reviewer's own finding.
      await service.cancelReuploadRequests(UUID, {});
      account.accountStatus = AccountStatus.PENDING_APPROVAL;

      await expect(
        service.updateStatus(UUID, { status: AccountStatus.ACTIVE } as any),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.updateStatus(UUID, { status: AccountStatus.REJECTED } as any),
      ).resolves.toBeDefined();
    });

    it('tells the applicant to stop trying', async () => {
      // Until this arrives their screen still says "upload your licence again"
      // — a demand nobody is waiting on, which they will either keep trying to
      // satisfy or read as the app being broken.
      await service.cancelReuploadRequests(UUID, { reason: 'سنراجع ما قدّمته' });

      expect(statusNotifier.notifyReviewResumed).toHaveBeenCalledWith(
        UUID, 'سنراجع ما قدّمته',
      );
    });

    it('refuses when nothing was ever asked for', async () => {
      documents = [media({ status: statusMedia.REJECTED })];

      await expect(
        service.cancelReuploadRequests(UUID, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to touch a driver here', async () => {
      account.role = Role.COLLECTOR;

      await expect(
        service.cancelReuploadRequests(UUID, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ==========================================================================
  // The applicant comes back
  // ==========================================================================
  describe('settling the review state', () => {
    it('returns the account to the queue when nothing is outstanding', async () => {
      account.accountStatus = AccountStatus.NEED_CHANGES;
      documents = [];

      const moved = await service.settleReviewState('a1', UUID);

      expect(moved).toBe(true);
      expect(accountRepo.update).toHaveBeenCalledWith('a1', {
        accountStatus: AccountStatus.PENDING_APPROVAL,
      });
    });

    it('keeps the account waiting while another document is still asked for', async () => {
      account.accountStatus = AccountStatus.NEED_CHANGES;
      documents = [media({ reuploadRequestedAt: new Date() })];

      const moved = await service.settleReviewState('a1', UUID);

      expect(moved).toBe(false);
      expect(accountRepo.update).not.toHaveBeenCalled();
    });

    it('ignores a document rejected but never asked for', async () => {
      // The trap this rule exists for: a silently-rejected document the
      // applicant was never told about and cannot see would otherwise hold
      // them in NEED_CHANGES for ever, having fixed everything they were asked
      // for, with nothing on their screen left to fix.
      account.accountStatus = AccountStatus.NEED_CHANGES;
      documents = [media({ status: statusMedia.REJECTED, reuploadRequestedAt: null })];

      const moved = await service.settleReviewState('a1', UUID);

      expect(moved).toBe(true);
    });
  });

  // ==========================================================================
  // Deciding on the account
  // ==========================================================================
  describe('approving', () => {
    it('approves and settles the documents still open under it', async () => {
      documents = [media({ status: statusMedia.PENDING })];

      const res: any = await service.updateStatus(UUID, {
        status: AccountStatus.ACTIVE,
      } as any);

      expect(res.account_status).toBe(AccountStatus.ACTIVE);
      expect(mediaRepo.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: statusMedia.APPROVED }),
      );
    });

    it('refuses over a document the reviewer marked unacceptable', async () => {
      // Approving must not override the reviewer's own recorded finding.
      documents = [media({ status: statusMedia.REJECTED })];

      await expect(
        service.updateStatus(UUID, { status: AccountStatus.ACTIVE } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('approves a previously REJECTED account', async () => {
      account.accountStatus = AccountStatus.REJECTED;
      documents = [media({ status: statusMedia.APPROVED })];

      const res: any = await service.updateStatus(UUID, {
        status: AccountStatus.ACTIVE,
      } as any);

      expect(res.account_status).toBe(AccountStatus.ACTIVE);
    });

    it('refuses while the applicant has been asked for something', async () => {
      account.accountStatus = AccountStatus.NEED_CHANGES;

      await expect(
        service.updateStatus(UUID, { status: AccountStatus.ACTIVE } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('takes the row LOCK before reading the status it decides on', async () => {
      // Two reviewers opening the same application is the normal case. Without
      // the lock both pass the "still undecided?" check and the second decision
      // silently overwrites the first — including the notice already sent.
      const qb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => account),
      };
      accountRepo.createQueryBuilder.mockReturnValue(qb);
      documents = [media({ status: statusMedia.APPROVED })];

      await service.updateStatus(UUID, { status: AccountStatus.ACTIVE } as any);

      expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('rejecting', () => {
    it('refuses while any document is unread', async () => {
      // A rejection has to be answerable later, and "we said no while your
      // documents were unread" is not an answer.
      documents = [media({ status: statusMedia.PENDING })];

      await expect(
        service.updateStatus(UUID, { status: AccountStatus.REJECTED } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('leaves the documents exactly as the reviewer judged them', async () => {
      // A rejection is a verdict on the application, not on every file in it —
      // overwriting them would erase which one was actually the problem.
      documents = [
        media({ id: 'm1', status: statusMedia.APPROVED }),
        media({ id: 'm2', status: statusMedia.REJECTED }),
      ];

      await service.updateStatus(UUID, { status: AccountStatus.REJECTED } as any);

      expect(mediaRepo.update).not.toHaveBeenCalled();
    });

    it('records the reason where the applicant cannot rewrite it', async () => {
      // `description` is the account holder's own field — they write it in
      // PATCH /user/profile and read it back. A reason kept there is one the
      // subject can read and overwrite.
      documents = [media({ status: statusMedia.APPROVED })];

      await service.updateStatus(UUID, {
        status: AccountStatus.REJECTED,
        description: 'السجل التجاري منتهٍ',
      } as any);

      const [, patch] = accountRepo.update.mock.calls.at(-1);
      expect(patch.adminNote).toBe('السجل التجاري منتهٍ');
      expect(patch).not.toHaveProperty('description');
    });

    it('refuses to un-approve an approved account', async () => {
      // The account is already trading; "un-approving" would strand the orders
      // placed under it. Removing someone who should not be here is blocking.
      account.accountStatus = AccountStatus.ACTIVE;

      await expect(
        service.updateStatus(UUID, { status: AccountStatus.REJECTED } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to decide a driver here at all', async () => {
      account.role = Role.COLLECTOR;

      await expect(
        service.updateStatus(UUID, { status: AccountStatus.ACTIVE } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ==========================================================================
  // Blocking
  // ==========================================================================
  describe('blocking', () => {
    it('blocks an approved account and ends every session', async () => {
      account.accountStatus = AccountStatus.ACTIVE;

      const res: any = await service.blockStatus(UUID, {
        status: AccountStatus.BLOCKED,
        description: 'فواتير غير مدفوعة',
      } as any);

      expect(userDeviceRepo.update).toHaveBeenCalledWith(
        { accountId: 'a1' }, { refreshToken: '', fcmToken: '' },
      );
      expect(res.account_status).toBe(AccountStatus.BLOCKED);
    });

    it('keeps the block reason away from the blocked user', async () => {
      // Naming the signal that caught them is the one piece of information
      // that helps whoever is abusing the platform evade it next time.
      account.accountStatus = AccountStatus.ACTIVE;

      await service.blockStatus(UUID, {
        status: AccountStatus.BLOCKED,
        description: 'اشتباه احتيال',
      } as any);

      const [, patch] = accountRepo.update.mock.calls.at(-1);
      expect(patch.adminNote).toBe('اشتباه احتيال');
      expect(patch).not.toHaveProperty('description');
      // And the notice itself carries no reason.
      expect(statusNotifier.notifyBlocked).toHaveBeenCalledWith('a1');
    });

    it('refuses to block an application that is still under review', async () => {
      // "We are not letting you in" and "you were in and we threw you out" are
      // different decisions, answered by different people for different reasons.
      account.accountStatus = AccountStatus.PENDING_APPROVAL;

      await expect(
        service.blockStatus(UUID, { status: AccountStatus.BLOCKED } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to block a rejected account', async () => {
      account.accountStatus = AccountStatus.REJECTED;

      await expect(
        service.blockStatus(UUID, { status: AccountStatus.BLOCKED } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('unblocks back to approved and clears the note', async () => {
      account.accountStatus = AccountStatus.BLOCKED;

      const res: any = await service.blockStatus(UUID, {
        status: AccountStatus.ACTIVE,
      } as any);

      expect(accountRepo.update).toHaveBeenCalledWith('a1', {
        accountStatus: AccountStatus.ACTIVE,
        adminNote: null,
      });
      expect(res.account_status).toBe(AccountStatus.ACTIVE);
    });
  });

  // ==========================================================================
  // Reading one applicant
  // ==========================================================================
  describe('account details', () => {
    beforeEach(() => {
      profileRepo.findOne = jest.fn(async (opts: any) => {
        if (opts.relations?.includes('factoryMaterial') || opts.relations?.length === 1) {
          return {
            id: UUID,
            account,
            factoryName: 'مصنع النور',
            province: { id: 'pr1', name: 'دمشق' },
            address: 'المزة',
            DesscriptLocation: 'خلف الحديقة',
            coordinates: { type: 'Point', coordinates: [36.27, 33.51] },
            factoryMaterial: {
              id: 'mat1',
              averageOrderQuantity: '500',
              wasteTypes: [
                {
                  id: 'link1',
                  wasteType: {
                    id: 'cat1', name: 'بلاستيك', isActive: true,
                    odooCategoryId: 7, odooSyncStatus: 'SYNCED',
                  },
                },
              ],
            },
          };
        }
        return { id: UUID, account };
      });
      documents = [
        media({ id: 'm-lic', fileType: 'LICENSE' }),
        media({ id: 'm-id', fileType: 'ID_CARD_FRONT' }),
      ];
    });

    it('puts the role outside the profile', async () => {
      const res: any = await service.getAccountDetails(UUID);
      expect(res.role).toBe(Role.FACTORY);
      expect(res.profile).not.toHaveProperty('role');
    });

    it('carries the profile id INSIDE the profile, not beside it', async () => {
      const res: any = await service.getAccountDetails(UUID);
      expect(res.profile.id).toBe(UUID);
      expect(res).not.toHaveProperty('profileId');
    });

    it('gives the account object only who they are and where they stand', async () => {
      const res: any = await service.getAccountDetails(UUID);
      expect(Object.keys(res.account).sort()).toEqual(
        ['account_status', 'email', 'id', 'name'],
      );
    });

    it('nests the material, and the categories inside it', async () => {
      // "Which materials, and how much per collection" is one question on the
      // form; splitting it across two levels makes the reader join it back up.
      const res: any = await service.getAccountDetails(UUID);

      expect(res.profile.material.averageOrderQuantity).toBe('500');
      expect(res.profile.material.waste_types).toEqual([
        {
          id: 'cat1',
          name: 'بلاستيك',
          is_active: true,
          odoo_category_id: 7,
          odoo_sync_status: 'SYNCED',
        },
      ]);
    });

    it('does not leave the material sitting beside the profile fields too', async () => {
      const res: any = await service.getAccountDetails(UUID);
      expect(res.profile).not.toHaveProperty('factoryMaterial');
    });

    it('keys the documents by which document each one is', async () => {
      // A reviewer holding a bare array of uuids cannot ask for "the licence"
      // without fetching every record to find out which one it was.
      const res: any = await service.getAccountDetails(UUID);

      expect(res.profile.documents).toEqual({
        LICENSE: 'm-lic',
        ID_CARD_FRONT: 'm-id',
      });
    });
  });

  describe('documents listing', () => {
    it('returns one object per document, with its provenance', async () => {
      documents = [media({ id: 'm1' })];

      const res: any = await service.getProfileDocuments(UUID);

      expect(res).toHaveLength(1);
      expect(Object.keys(res[0]).sort()).toEqual([
        'created_at', 'file_type', 'id', 'owner_id', 'owner_type',
        'public_id', 'reupload_reason', 'reupload_requested_at', 'status', 'url',
      ]);
    });

    it('is readable after the account has been decided', async () => {
      // The old rule refused unless the account was pending, which locked the
      // reviewer out of the documents in exactly the cases where they matter:
      // reconsidering a rejection, or checking what was accepted after a
      // dispute.
      account.accountStatus = AccountStatus.REJECTED;
      documents = [media()];

      await expect(service.getProfileDocuments(UUID)).resolves.toHaveLength(1);
    });

    it('reports an applicant with no documents as not found', async () => {
      documents = [];
      await expect(service.getProfileDocuments(UUID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('self-service (an applicant reading its OWN account)', () => {
    it('refuses a role with no onboarding application (citizen / admin)', async () => {
      await expect(
        service.getOwnAccountDetails('acc1', Role.CITIZEN),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.getOwnLocation('acc1', Role.ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an INSTITUTION and a DRIVER past the gate to their own lookup', async () => {
      // Both now have a self-service view: they pass the role gate and reach the
      // profile lookup (which 404s here only because no profile row is mocked).
      profileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getOwnAccountDetails('acc1', Role.INSTITUTIONS),
      ).rejects.not.toBeInstanceOf(ForbiddenException);
      await expect(
        service.getOwnLocation('acc1', Role.COLLECTOR),
      ).rejects.not.toBeInstanceOf(ForbiddenException);
    });

    it('lets a FACTORY past the gate to its own profile lookup', async () => {
      // No profile row for this account → resolves past the role gate and
      // surfaces a not-found, proving the gate admitted the factory.
      profileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getOwnAccountDetails('acc1', Role.FACTORY),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('location', () => {
    it('answers for any reviewed role from the profile id alone', async () => {
      profileRepo.findOne.mockResolvedValue({
        id: UUID,
        account,
        // Province stores its names as name_en / name_ar (there is no `name`
        // column) — the mock now matches the real entity.
        province: { id: 'pr1', name_en: 'Damascus', name_ar: 'دمشق' },
        address: 'المزة',
        DesscriptLocation: 'خلف الحديقة',
        coordinates: { type: 'Point', coordinates: [36.27, 33.51] },
      });

      const res: any = await service.getProfileLocation(UUID);

      expect(res.province).toEqual({ id: 'pr1', name_en: 'Damascus', name_ar: 'دمشق' });
      // Stored GeoJSON order is [lng, lat]; both are spelled out so no caller
      // has to remember which way round it is.
      expect(res.coordinates).toEqual([36.27, 33.51]);
      expect(res.longitude).toBe(36.27);
      expect(res.latitude).toBe(33.51);
    });

    it('reports an unknown profile as not found', async () => {
      profileRepo.findOne.mockResolvedValue(null);
      await expect(service.getProfileLocation(UUID2)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
