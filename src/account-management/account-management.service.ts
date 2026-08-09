import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { validate as isUUID } from 'uuid';
import { ProfileResolver } from '@src/user/providers/profile-resolver.privder';
import { Media, statusMedia } from '@src/media/entities/media.entity';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import {
  AccountListQueryDto,
  BlockedAccountStatusDto,
  RequestReuploadDto,
  UpdateAccountStatusDto,
} from './dto/update-account-status.dto';
import { UpdateMediaStatusDto } from './dto/update-media-status.dto';
import {
  AccountAlreadyInStatusException,
  AccountAwaitingApplicantException,
  AdminAccountNotFoundException,
  ApprovalBlockedByRejectedDocumentException,
  ApprovedAccountIsFinalException,
  BlockNeedsApprovedAccountException,
  DocumentsFrozenException,
  DriverManagedInOdooException,
  InvalidIdException,
  InvalidStatusTransitionException,
  MediaAlreadyReviewedException,
  NoMediaForProfileException,
  NothingRequestedException,
  OnlyRejectedCanReopenException,
  ProfileNotFoundException,
  RejectionNeedsEveryDocumentJudgedException,
  ReuploadAlreadyRequestedException,
  ReuploadNeedsRejectedDocumentException,
  ReuploadNotReviewableException,
} from './exceptions/account-management.exceptions';
import { MediaNotFoundException } from '@src/media/exceptions/media.exceptions';
import { ProfileDataProvider } from './providers/profile-data.provider';
import { AccountStatusNotifier } from '@src/notification/account-status.notifier';
import { UserDevice } from '@src/auth/entities/user-device.entity';
import { ApplicationsCacheService } from './providers/applications-cache.service';
import { PointsWalletService } from '@src/points-wallet/points-wallet.service';

/** The roles whose applications are reviewed here. Drivers are reviewed in Odoo. */
const REVIEWABLE_ROLES = [Role.FACTORY, Role.INSTITUTIONS, Role.EXTERNAL_PARTNER];

/**
 * The account statuses in which a reviewer may still re-mark a DOCUMENT.
 *
 * ACTIVE is absent because an approval is final: those documents are the
 * evidence it rests on, and re-marking one afterwards rewrites the basis of a
 * decision already acted upon. BLOCKED is not a review state at all.
 *
 * REJECTED is absent too, and that is the deliberate part. A rejection is a
 * decision that has been taken and communicated; quietly flipping the documents
 * underneath it changes what the applicant was refused for, after the fact,
 * with the refusal already sent. Reconsidering is allowed — but it has to be
 * done in the open, by RE-OPENING the application (`reopenApplication`), which
 * puts it back under review where the documents are editable again and the
 * applicant is told.
 */
const UNDER_REVIEW = [
  AccountStatus.PENDING_APPROVAL,
  AccountStatus.NEED_CHANGES,
];

/**
 * The account, as a REVIEWER needs to see it.
 *
 * These screens used to return the whole entity. That meant `passwordHash` —
 * every applicant's argon2 hash — travelling to the browser of anyone allowed
 * to open the review list, alongside `googleId`, `provider` and the
 * verification flags. None of it is anything a reviewer acts on, and a secret
 * that is merely unused is still a secret that leaked.
 *
 * Written as an allow-list, not a delete-list: a field added to the entity
 * later is invisible here until someone chooses to expose it, which is the
 * safe direction for the mistake to fall.
 */
function reviewerAccountView(account: any) {
  if (!account) return null;
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    phone: account.phone ?? null,
    profile_image: account.profileImage ?? null,
    account_status: account.accountStatus,
    role: account.role,
  };
}

@Injectable()
export class AccountManagementService {
  constructor(
    private readonly profileResolver: ProfileResolver,
    private readonly profileDataProvider: ProfileDataProvider,
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(UserDevice)
    private readonly userDeviceRepo: Repository<UserDevice>,
    private readonly statusNotifier: AccountStatusNotifier,
    private readonly applicationsCache: ApplicationsCacheService,
    private readonly dataSource: DataSource,
    private readonly pointsWallet: PointsWalletService,
  ) {}

  // ---------------------------------------------------------------------------
  // Accounts — generic listing (any role) + soft-archive "delete"
  // ---------------------------------------------------------------------------

  /**
   * Accounts filtered by role and/or status, newest first, paginated. Archived
   * ("deleted") accounts are hidden unless `include_archived` is set — the admin
   * can still audit them, but the default window is the live population.
   */
  async listAccounts(query: {
    role?: Role;
    status?: AccountStatus;
    page: number;
    limit: number;
    include_archived?: boolean;
  }) {
    const page = Math.max(1, Math.floor(query.page) || 1);
    const limit = Math.min(Math.max(1, Math.floor(query.limit) || 10), 100);

    const where: Record<string, unknown> = {};
    if (query.role) where.role = query.role;
    if (query.status) where.accountStatus = query.status;
    if (!query.include_archived) where.archivedAt = IsNull();

    const [rows, total] = await this.accountRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      accounts: rows.map((a) => ({
        ...reviewerAccountView(a),
        is_archived: !!a.archivedAt,
        archived_at: a.archivedAt ?? null,
        created_at: a.createdAt,
      })),
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
   * "Delete" an account — a SOFT ARCHIVE. The row stays (so its email and phone
   * remain claimed and nobody can silently re-register on them, and its data is
   * kept for audit), but `archivedAt` is stamped: login answers "account not
   * found" and any token it still holds is refused on the next request (see
   * JwtStrategy). Reversible only by an admin clearing the flag.
   *
   * Refused for an admin account, for an already-archived one, and for the
   * caller's own account — none of which is a "delete this applicant" action.
   */
  async archiveAccount(accountId: string, adminId: string) {
    const account = await this.accountRepo.findOne({ where: { id: accountId } });
    if (!account) throw new AdminAccountNotFoundException();
    if (account.archivedAt) {
      throw new BadRequestException('Account is already deleted');
    }
    if (account.role === Role.ADMIN) {
      throw new BadRequestException('An admin account cannot be deleted');
    }
    if (account.id === adminId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    account.archivedAt = new Date();
    account.archivedBy = adminId;
    await this.accountRepo.save(account);

    // Drop the reviewer's cached listings for this role so the account leaves
    // them at once. Existing tokens need no explicit revoke — JwtStrategy
    // refuses an archived account on its very next request.
    await this.applicationsCache.invalidate(account.role);

    return { id: accountId, archived_at: account.archivedAt };
  }

  // ===========================================================================
  // Reading
  // ===========================================================================

  /**
   * The REVIEW QUEUE: applications waiting for a decision, oldest first.
   *
   * Only PENDING_APPROVAL. Every other status is a finished or a stalled
   * application, and mixing them in made the queue useless as a queue — the
   * reviewer could not tell what was still owed to somebody from what had
   * already been answered.
   *
   * Oldest FIRST, by when the application was submitted. Newest-first is the
   * default everywhere else and it is exactly wrong here: it buries the person
   * who has been waiting longest under everyone who applied since, which is
   * how one application waits a month while later ones are answered the same
   * day. The order is a suggestion, not a constraint — the reviewer may take
   * any row — but the suggestion should point at the oldest debt.
   *
   * An application that went NEED_CHANGES and came back KEEPS ITS ORIGINAL
   * PLACE. Ordering by the moment it most recently became pending would send
   * it to the back of the queue every time the reviewer asked for a document,
   * so the applicant would be punished — with a longer wait each round — for
   * answering a question the reviewer chose to ask.
   */
  async listReviewQueue(role: Role, page: number, limit: number) {
    return this.listByStatus(role, {
      page,
      limit,
      status: AccountStatus.PENDING_APPROVAL,
      oldestFirst: true,
      cacheTag: 'queue',
    });
  }

  /**
   * A role's accounts in ONE status, or in every status when none is given.
   *
   * The counterpart to the queue: the queue answers "what do I still owe
   * anyone?", this answers "show me the rejected ones / the blocked ones / all
   * of them". Newest first, because outside the queue the interesting row is
   * the recent one.
   */
  async getProfiles(role: Role, query: AccountListQueryDto) {
    return this.listByStatus(role, {
      page: query.page,
      limit: query.limit,
      status: query.status,
      oldestFirst: false,
      cacheTag: 'list',
    });
  }

  private async listByStatus(
    role: Role,
    opts: {
      page: number;
      limit: number;
      status?: AccountStatus;
      oldestFirst: boolean;
      cacheTag: string;
    },
  ) {
    const { page, limit, status, oldestFirst, cacheTag } = opts;
    if (status && !Object.values(AccountStatus).includes(status)) {
      throw new BadRequestException('Invalid account status');
    }

    // Cache-aside: the review screen polls these lists far more often than the
    // rows change, and every mutation bumps the role's version counter, so a
    // hit can never serve data from before the last decision.
    const cacheKey = `${cacheTag}:p${page}:l${limit}:s${status ?? 'all'}`;
    const cached = await this.applicationsCache.get<any>(role, cacheKey);
    if (cached) return cached;

    const repo = this.profileResolver.getRepo(role);
    const [profiles, total] = await repo.findAndCount({
      where: status ? { account: { accountStatus: status } } : {},
      relations: ['account'],
      order: { createdAt: oldestFirst ? 'ASC' : 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // How many documents each applicant still owes back — the one fact that
    // decides whether a row here is actionable, and the reviewer should not
    // have to open it to find out.
    const outstanding = await this.outstandingCounts(profiles.map((p: any) => p.id));

    const items = profiles.map((p: any) => ({
      profile_id: p.id,
      submitted_at: p.createdAt,
      documents_requested: outstanding.get(p.id) ?? 0,
      account: reviewerAccountView(p.account),
      // `admin_note` was here and is gone. It holds the reviewer's reason for a
      // REJECTION or a BLOCK — and this listing returns PENDING_APPROVAL rows
      // only, which by definition have neither. It was therefore null on every
      // row of every page, and a field that is always null teaches a reader to
      // stop looking at it on the screens where it does carry something.
      //
      // The COLUMN stays. It is what shows the block reason to the admin and
      // only to the admin, which is the whole reason it was split out of
      // `description` — a field the account holder writes and reads back.
    }));

    const payload = {
      items,
      total,
      page,
      limit,
      total_pages: limit > 0 ? Math.ceil(total / limit) : 0,
      has_next: page * limit < total,
      has_prev: page > 1,
    };
    await this.applicationsCache.set(role, cacheKey, payload);
    return payload;
  }

  /**
   * Everything a reviewer needs about one applicant, in the shape of the
   * question they are answering.
   *
   * Laid out as WHO (`account`) and WHAT THEY SUBMITTED (`profile`), with the
   * material and its categories nested inside the profile where they were
   * filled in, and the documents keyed by which document each one is. The flat
   * bag this used to return made the reviewer rebuild the application form in
   * their head out of a list of column names.
   */
  async getAccountDetails(profileId: string) {
    const { role } = await this.resolveProfile(profileId);
    const repo = this.profileResolver.getRepo(role);

    const profile: any = await repo.findOne({
      where: { id: profileId },
      relations: this.profileDataProvider.getRelations(role),
    });
    if (!profile) throw new ProfileNotFoundException();

    const materialKey = this.profileDataProvider.getMaterialKey(role);
    // The location columns are destructured off and DROPPED. They live on
    // LocationBase, so they arrive on every profile whether or not this payload
    // wants them — and it does not: `GET :profileId/location` answers that
    // question on its own, for every role, and two places holding one answer is
    // how they start disagreeing. Still destructured rather than left in `rest`
    // so they cannot leak back in by accident.
    const { account, province, address, coordinates, DesscriptLocation, ...rest } =
      profile;
    // Whatever the material relation is called on this role, it does not
    // belong beside the profile's own fields — it is nested below.
    if (materialKey) delete rest[materialKey];

    return {
      // OUTSIDE the profile: the role decides how everything below it reads,
      // so it has to be legible before the reader gets there.
      role,
      account: {
        id: account?.id ?? null,
        name: account?.name ?? null,
        email: account?.email ?? null,
        account_status: account?.accountStatus ?? null,
      },
      profile: {
        id: profileId,
        ...rest,
        material: this.mapMaterial(materialKey ? profile[materialKey] : null),
        documents: await this.documentIdsByType(profileId),
      },
    };
  }

  /**
   * The material section: what they deal in, and how much of it.
   *
   * The waste categories live INSIDE it because that is where they were
   * answered — "which materials, and how much per collection" is one question
   * on the form, and splitting it across two levels of the response makes the
   * reader join it back up.
   */
  private mapMaterial(material: any) {
    if (!material) return null;
    const {
      wasteTypes,
      factoryProfile,
      institutionProfile,
      externalPartnerProfile,
      ...info
    } = material;
    return {
      ...info,
      waste_types: (wasteTypes ?? [])
        .map((link: any) => link.wasteType)
        .filter(Boolean)
        .map((category: any) => ({
          id: category.id,
          name: category.name,
          is_active: category.isActive,
          // The mirror in Odoo. A category with no id there has not been
          // synced, and nothing ordered against it can be fulfilled — so the
          // reviewer sees that here, rather than discovering it at the first
          // order.
          odoo_category_id: category.odooCategoryId ?? null,
          odoo_sync_status: category.odooSyncStatus ?? null,
        })),
    };
  }

  /**
   * The applicant's documents as `{ LICENSE: <id>, ID_CARD_FRONT: <id>, … }`.
   *
   * Keyed by what each document IS, not a bare list of uuids. A reviewer
   * holding an array has no way to ask for "the licence" without fetching
   * every record to find out which one it was.
   */
  private async documentIdsByType(profileId: string): Promise<Record<string, string>> {
    const media = await this.mediaRepo.find({
      where: { ownerId: profileId },
      select: ['id', 'fileType', 'createdAt'],
      order: { createdAt: 'ASC' },
    });
    const out: Record<string, string> = {};
    for (const m of media) out[m.fileType] = m.id;
    return out;
  }

  /**
   * The applicant's documents, in full — one object each.
   *
   * Readable in EVERY status, not only while pending. The old rule refused
   * unless the account was PENDING_APPROVAL, which locked the reviewer out of
   * the documents in exactly the situations where they matter most: deciding
   * whether to re-open a rejection, or checking what was accepted after a
   * dispute.
   */
  async getProfileDocuments(profileId: string) {
    await this.resolveProfile(profileId);

    const media = await this.mediaRepo.find({
      where: { ownerId: profileId },
      order: { createdAt: 'ASC' },
    });
    if (media.length === 0) throw new NoMediaForProfileException();

    return media.map((m) => this.documentView(m));
  }

  // ===========================================================================
  // SELF-SERVICE — a factory / free facility reading its OWN application back
  // ===========================================================================
  //
  // The admin routes above answer the review question by PROFILE id. A signed-in
  // buyer asking about their own account wants the very same answers, so these
  // resolve the caller's profile from the token and reuse the admin builders
  // rather than duplicating them — one shape, one place it is computed.
  //
  // Restricted to FACTORY and EXTERNAL_PARTNER: they are the roles with a
  // reviewed application, uploaded documents and a single onboarding location to
  // show. The controller additionally gates these to ACTIVE accounts.

  /** This account's own profile id for its role, or a clear refusal. */
  private async ownProfileId(accountId: string, role: Role): Promise<string> {
    if (role !== Role.FACTORY && role !== Role.EXTERNAL_PARTNER) {
      throw new ForbiddenException(
        'This view is available only to factories and free facilities',
      );
    }
    const repo = this.profileResolver.getRepo(role);
    const profile = await repo.findOne({
      where: { account: { id: accountId } },
      select: ['id'],
    });
    if (!profile) throw new ProfileNotFoundException();
    return profile.id;
  }

  /** The caller's own account details (same shape as the admin review view). */
  async getOwnAccountDetails(accountId: string, role: Role) {
    return this.getAccountDetails(await this.ownProfileId(accountId, role));
  }

  /** The caller's own location. */
  async getOwnLocation(accountId: string, role: Role) {
    return this.getProfileLocation(await this.ownProfileId(accountId, role));
  }

  /** The caller's own uploaded documents / images. */
  async getOwnDocuments(accountId: string, role: Role) {
    return this.getProfileDocuments(await this.ownProfileId(accountId, role));
  }

  /** Full details of a single document. */
  async getMediaDetails(mediaId: string) {
    if (!isUUID(mediaId)) throw new InvalidIdException('Invalid media ID');
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new MediaNotFoundException();
    return this.documentView(media);
  }

  private documentView(m: Media) {
    return {
      id: m.id,
      url: m.url,
      public_id: m.publicId,
      file_type: m.fileType,
      owner_id: m.ownerId,
      owner_type: m.ownerType,
      status: m.status,
      // Set only while the applicant still owes this one back.
      reupload_requested_at: m.reuploadRequestedAt ?? null,
      reupload_reason: m.reuploadReason ?? null,
      created_at: m.createdAt,
    };
  }

  /**
   * Where the applicant is — ONE route for all three reviewed roles.
   *
   * The three profiles carry the same four location columns (they share
   * `LocationBase`), so three routes would have been the same query written
   * three times — and a caller would have to know the applicant's role before
   * it could ask a question that does not depend on it.
   */
  async getProfileLocation(profileId: string) {
    const { role, profile } = await this.resolveProfile(profileId, {
      withLocation: true,
    });

    return {
      profile_id: profileId,
      role,
      // Province carries its names as `name_en`/`name_ar`; the old `.name` here
      // was always undefined, so the location card showed a governorate with no
      // name. Both languages travel so the app renders in whichever it is set.
      province: profile.province
        ? {
            id: profile.province.id,
            name_en: profile.province.name_en,
            name_ar: profile.province.name_ar,
          }
        : null,
      address: profile.address ?? null,
      description: profile.DesscriptLocation ?? null,
      // GeoJSON order, as stored: [longitude, latitude].
      coordinates: profile.coordinates?.coordinates ?? null,
      latitude: profile.coordinates?.coordinates?.[1] ?? null,
      longitude: profile.coordinates?.coordinates?.[0] ?? null,
    };
  }

  // ===========================================================================
  // Deciding on a DOCUMENT
  // ===========================================================================

  /**
   * Mark one document acceptable or not. SILENTLY.
   *
   * This used to notify the applicant and push the whole account into
   * NEED_CHANGES the instant a single document was marked bad. That made the
   * two halves of the reviewer's job impossible to separate: they could not
   * work down a list of four documents marking each one, because the first
   * rejection ended the review and sent the applicant off to start fixing —
   * before anybody had looked at the rest.
   *
   * Rejecting is now a note in the reviewer's own file. Asking the applicant
   * for a replacement is a separate, deliberate act (`requestReupload`), and it
   * is the only thing that ever interrupts them.
   *
   * A rejected document CAN be marked acceptable again: a reviewer who
   * mis-clicks, or re-reads a scan and changes their mind, must be able to say
   * so without involving the applicant at all.
   */
  async updateMediaStatus(mediaId: string, dto: UpdateMediaStatusDto) {
    if (!isUUID(mediaId)) throw new InvalidIdException('Invalid media ID');

    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new MediaNotFoundException();

    const { profile } = await this.resolveProfile(media.ownerId);
    const account = profile.account;

    // A DECIDED account's documents are settled. For an approved one they are
    // the evidence the approval rests on, and re-marking one afterwards
    // rewrites the basis of a decision already acted upon.
    if (!UNDER_REVIEW.includes(account.accountStatus)) {
      throw new DocumentsFrozenException(account.accountStatus);
    }

    // Setting a document back to PENDING is not a review outcome — it is
    // undoing one without saying which way. The applicant re-uploading is what
    // legitimately returns a document to PENDING.
    if (dto.status === statusMedia.PENDING) {
      throw new MediaAlreadyReviewedException(media.status);
    }
    if (media.status === dto.status) {
      return { message: `Document is already ${dto.status.toLowerCase()}` };
    }

    await this.mediaRepo.update(mediaId, {
      status: dto.status,
      // Marking it acceptable answers any outstanding request for it: there is
      // nothing left for the applicant to send.
      ...(dto.status === statusMedia.APPROVED
        ? { reuploadRequestedAt: null, reuploadReason: null }
        : {}),
    });

    // Clearing the last outstanding request can be what puts the account back
    // in the queue.
    if (dto.status === statusMedia.APPROVED) {
      await this.settleReviewState(account.id, media.ownerId);
    }

    return {
      message:
        dto.status === statusMedia.APPROVED
          ? 'Document approved successfully'
          : 'Document rejected. The applicant has not been told — request it again when you want them to replace it',
    };
  }

  /**
   * Ask the applicant for ONE document again.
   *
   * The only act in the review flow that reaches the applicant. It requires the
   * document to be REJECTED already, so "we need this again" is always preceded
   * by a recorded judgement of what was wrong with it — a request with no
   * rejection behind it is a reviewer asking for a document they never said
   * anything about.
   *
   * It is also what RE-OPENS a rejected account. That is not a side effect: an
   * account rejected over a bad document is otherwise unreachable, because
   * approving it is blocked by that document and the document cannot be
   * relabelled underneath a decided account. Asking for a replacement is the
   * one move that changes the facts rather than the paperwork.
   */
  async requestReupload(mediaId: string, dto: RequestReuploadDto) {
    if (!isUUID(mediaId)) throw new InvalidIdException('Invalid media ID');

    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new MediaNotFoundException();

    const { profile } = await this.resolveProfile(media.ownerId);
    const account = profile.account;

    if (account.role === Role.COLLECTOR) throw new DriverManagedInOdooException();
    if (!UNDER_REVIEW.includes(account.accountStatus)) {
      throw new ReuploadNotReviewableException(account.accountStatus);
    }
    if (media.status !== statusMedia.REJECTED) {
      throw new ReuploadNeedsRejectedDocumentException(media.status);
    }
    if (media.reuploadRequestedAt) {
      throw new ReuploadAlreadyRequestedException();
    }

    const reason =
      (dto.reason ?? '').trim() ||
      `المستند "${media.fileType}" غير مقبول — يرجى رفع نسخة أوضح.`;

    await this.mediaRepo.update(mediaId, {
      reuploadRequestedAt: new Date(),
      reuploadReason: reason,
    });
    await this.accountRepo.update(account.id, {
      accountStatus: AccountStatus.NEED_CHANGES,
    });
    await this.applicationsCache.invalidate(account.role);
    await this.statusNotifier.notifyStatusDecision(
      account.id,
      AccountStatus.NEED_CHANGES,
      reason,
    );

    return {
      message: 'Document requested from the applicant',
      media_id: mediaId,
      file_type: media.fileType,
      account_status: AccountStatus.NEED_CHANGES,
    };
  }

  /**
   * Re-open a rejected application, putting it back under review.
   *
   * The way to reconsider a rejection IN THE OPEN. Documents are frozen while
   * an application is rejected — a decision has been taken and sent, and
   * quietly re-marking the evidence underneath it changes what the applicant
   * was refused for after they have already been told. So the reviewer says so
   * first: the application returns to PENDING_APPROVAL, the documents become
   * editable again, and the applicant is notified that it is being looked at
   * once more.
   *
   * Without this, freezing the documents would recreate the dead end the
   * cancel-request route exists to prevent: rejected, unchangeable, and
   * impossible to revisit.
   *
   * The reviewer's original note is KEPT. It records why the application was
   * refused the first time, and that history is exactly what makes a second
   * look worth anything.
   */
  async reopenApplication(accountId: string, dto: { reason?: string }) {
    if (!isUUID(accountId)) throw new InvalidIdException('Invalid account ID');

    const account = await this.accountRepo.findOne({ where: { id: accountId } });
    if (!account) throw new AdminAccountNotFoundException();
    if (account.role === Role.COLLECTOR) throw new DriverManagedInOdooException();

    if (account.accountStatus !== AccountStatus.REJECTED) {
      throw new OnlyRejectedCanReopenException(account.accountStatus);
    }

    await this.accountRepo.update(accountId, {
      accountStatus: AccountStatus.PENDING_APPROVAL,
    });
    await this.applicationsCache.invalidate(account.role);
    await this.statusNotifier.notifyReopened(accountId, dto.reason);

    return {
      message: 'Application re-opened — it is under review again',
      account_id: accountId,
      account_status: AccountStatus.PENDING_APPROVAL,
    };
  }

  /**
   * Stop waiting for an applicant who never answered.
   *
   * Without this the review flow had a state it could not leave. Asking for a
   * document moves the account to NEED_CHANGES; no decision may be taken in
   * NEED_CHANGES, because deciding then judges an application the reviewer has
   * themselves called incomplete. So an applicant who simply never comes back
   * left the application open for ever, and the reviewer had no move at all —
   * they could not approve it, could not reject it, and could not close it.
   *
   * Cancelling is NOT accepting. The documents keep the status the reviewer
   * gave them, so a rejected one stays rejected: what is withdrawn is the
   * question, not the finding. That has a deliberate consequence — the account
   * comes back to the queue where it can now be REJECTED (every document has
   * been judged), but still cannot be APPROVED over a document the reviewer
   * marked unacceptable. Which is the right pair of doors to leave open: the
   * stall is broken without quietly turning "I gave up waiting" into "I accept
   * what you sent".
   */
  async cancelReuploadRequests(accountId: string, dto: { reason?: string }) {
    if (!isUUID(accountId)) throw new InvalidIdException('Invalid account ID');

    const account = await this.accountRepo.findOne({ where: { id: accountId } });
    if (!account) throw new AdminAccountNotFoundException();
    if (account.role === Role.COLLECTOR) throw new DriverManagedInOdooException();

    const profile = await this.profileResolver
      .getRepo(account.role)
      .findOne({ where: { account: { id: accountId } } });
    if (!profile) throw new ProfileNotFoundException();

    const outstanding = await this.mediaRepo.find({
      where: { ownerId: profile.id, reuploadRequestedAt: Not(IsNull()) },
    });
    if (!outstanding.length) throw new NothingRequestedException();

    await this.mediaRepo.update(
      { id: In(outstanding.map((m) => m.id)) },
      { reuploadRequestedAt: null, reuploadReason: null },
    );

    // Reuses the same release the applicant's own re-upload goes through, so
    // there is one rule for "is anything still outstanding?" and not two that
    // can drift apart.
    await this.settleReviewState(accountId, profile.id);
    await this.applicationsCache.invalidate(account.role);
    await this.statusNotifier.notifyReviewResumed(accountId, dto.reason);

    return {
      message: 'Document requests cancelled — the account is back under review',
      account_id: accountId,
      cancelled: outstanding.length,
      account_status: AccountStatus.PENDING_APPROVAL,
    };
  }

  /**
   * Put the account back in the queue once nothing is outstanding.
   *
   * The test is "no document is still ASKED FOR", not "no document is
   * rejected". Those differ, and the difference is a trap: a reviewer may
   * reject a document without asking for it — that is the whole point of the
   * split above — and keying the account's release off rejections would strand
   * an applicant in NEED_CHANGES over a document nobody ever mentioned to them
   * and which they have no way to see.
   */
  async settleReviewState(accountId: string, ownerId: string): Promise<boolean> {
    const outstanding = await this.mediaRepo.count({
      where: { ownerId, reuploadRequestedAt: Not(IsNull()) },
    });
    if (outstanding > 0) return false;

    const account = await this.accountRepo.findOne({ where: { id: accountId } });
    if (!account || account.accountStatus !== AccountStatus.NEED_CHANGES) return false;

    await this.accountRepo.update(accountId, {
      accountStatus: AccountStatus.PENDING_APPROVAL,
    });
    await this.applicationsCache.invalidate(account.role);
    return true;
  }

  // ===========================================================================
  // Deciding on the ACCOUNT
  // ===========================================================================

  /**
   * Approve or reject an application.
   *
   * Runs in a transaction with the account row LOCKED. Two reviewers opening
   * the same application is the normal case, not the exotic one, and without
   * the lock both pass the "is it still undecided?" check and the second
   * decision silently overwrites the first — including the notification the
   * applicant has already been sent.
   *
   * The two gates are deliberately different, and the difference is worth
   * knowing:
   *
   *   APPROVING is blocked by a REJECTED document. Undecided ones are fine and
   *   are approved along with the account — approving is itself a statement
   *   that the submission is acceptable, so it settles anything still open.
   *   What it must not do is override the reviewer's own recorded judgement
   *   that one specific document was not acceptable.
   *
   *   REJECTING is blocked by an UNDECIDED document. A rejection has to be
   *   answerable afterwards, and "we said no while three of your four
   *   documents were still unread" is not an answer.
   */
  async updateStatus(accountId: string, dto: UpdateAccountStatusDto) {
    if (!isUUID(accountId)) throw new InvalidIdException('Invalid account ID');

    const { account, profileId } = await this.dataSource.transaction(async (manager) => {
      const accountRepo = manager.getRepository(Account);
      const mediaRepo = manager.getRepository(Media);

      const locked = await accountRepo
        .createQueryBuilder('a')
        .setLock('pessimistic_write')
        .where('a.id = :accountId', { accountId })
        .getOne();
      if (!locked) throw new AdminAccountNotFoundException();
      if (locked.role === Role.COLLECTOR) throw new DriverManagedInOdooException();

      // An approval is the one decision that cannot be taken back: the account
      // is already trading, and "un-approving" it would strand the orders
      // placed under it. Removing somebody who should not be here is what
      // blocking is for.
      if (locked.accountStatus === AccountStatus.ACTIVE) {
        throw new ApprovedAccountIsFinalException();
      }
      if (locked.accountStatus === AccountStatus.NEED_CHANGES) {
        throw new AccountAwaitingApplicantException();
      }
      if (
        locked.accountStatus !== AccountStatus.PENDING_APPROVAL &&
        locked.accountStatus !== AccountStatus.REJECTED
      ) {
        throw new InvalidStatusTransitionException(locked.accountStatus, dto.status);
      }
      if (locked.accountStatus === dto.status) {
        throw new AccountAlreadyInStatusException(locked.accountStatus);
      }

      const profile = await this.profileResolver
        .getRepo(locked.role)
        .findOne({ where: { account: { id: accountId } } });
      const media = profile ? await mediaRepo.find({ where: { ownerId: profile.id } }) : [];

      if (dto.status === AccountStatus.ACTIVE) {
        const rejected = media.filter((m) => m.status === statusMedia.REJECTED);
        if (rejected.length) {
          throw new ApprovalBlockedByRejectedDocumentException(rejected.length);
        }
        // Approving the account settles everything still open under it.
        const pending = media.filter((m) => m.status === statusMedia.PENDING);
        if (pending.length) {
          await mediaRepo.update(
            { id: In(pending.map((m) => m.id)) },
            {
              status: statusMedia.APPROVED,
              reuploadRequestedAt: null,
              reuploadReason: null,
            },
          );
        }
      } else {
        const undecided = media.filter((m) => m.status === statusMedia.PENDING);
        if (undecided.length) {
          throw new RejectionNeedsEveryDocumentJudgedException(undecided.length);
        }
        // Documents keep whatever the reviewer decided about them. A rejection
        // is a verdict on the application, not on every file in it, and
        // overwriting them would erase which one was actually the problem.
      }

      await accountRepo.update(accountId, {
        accountStatus: dto.status,
        // The reason goes in the REVIEWER's column. `description` belongs to
        // the account holder — they write it and read it back on their own
        // profile.
        ...(dto.description !== undefined ? { adminNote: dto.description } : {}),
      });

      return { account: locked, profileId: profile?.id ?? null };
    });

    await this.applicationsCache.invalidate(account.role);
    // Activating an institution/factory/free-facility opens its points wallet —
    // created empty, once, the moment it becomes able to trade.
    if (dto.status === AccountStatus.ACTIVE) {
      await this.pointsWallet.ensureForAccount(accountId, account.role);
    }
    await this.statusNotifier.notifyStatusDecision(accountId, dto.status, dto.description);

    return {
      message:
        dto.status === AccountStatus.ACTIVE
          ? 'Account approved successfully'
          : 'Account rejected successfully',
      account_id: accountId,
      profile_id: profileId,
      account_status: dto.status,
    };
  }

  /**
   * Block or unblock.
   *
   * Only an APPROVED account can be blocked. Blocking removes access somebody
   * actually has; applying it to an application still under review conflates
   * "we are not letting you in" with "you were in and we threw you out", and
   * those are answered by different people for different reasons.
   */
  async blockStatus(accountId: string, dto: BlockedAccountStatusDto) {
    if (!isUUID(accountId)) throw new InvalidIdException('Invalid account ID');

    const account = await this.accountRepo.findOne({ where: { id: accountId } });
    if (!account) throw new AdminAccountNotFoundException();
    // Drivers (collectors) are blocked / unblocked from ODOO only.
    if (account.role === Role.COLLECTOR) throw new DriverManagedInOdooException();

    const current = account.accountStatus;
    const target = dto.status;
    if (current === target) throw new AccountAlreadyInStatusException(current);

    if (target === AccountStatus.BLOCKED) {
      if (current !== AccountStatus.ACTIVE) {
        throw new BlockNeedsApprovedAccountException(current);
      }
      await this.accountRepo.update(account.id, {
        accountStatus: AccountStatus.BLOCKED,
        // Admin-only. The blocked user is told they are blocked and to contact
        // support; naming the signal that caught them is the one piece of
        // information that helps them evade it next time.
        ...(dto.description !== undefined ? { adminNote: dto.description } : {}),
      });
      // Force-logout everywhere: wiping every device's refresh + FCM token
      // kills token renewal, and the JWT strategy refuses the still-valid
      // access token on the very next request because the account reads
      // BLOCKED. So the session ends now, not when the token expires.
      await this.userDeviceRepo.update(
        { accountId: account.id },
        { refreshToken: '', fcmToken: '' },
      );
      await this.applicationsCache.invalidate(account.role);
      await this.statusNotifier.notifyBlocked(account.id);
      return {
        message: 'Account blocked successfully',
        account_status: AccountStatus.BLOCKED,
      };
    }

    if (current !== AccountStatus.BLOCKED) {
      throw new InvalidStatusTransitionException(current, target);
    }
    await this.accountRepo.update(account.id, {
      accountStatus: AccountStatus.ACTIVE,
      adminNote: null,
    });
    await this.applicationsCache.invalidate(account.role);
    await this.statusNotifier.notifyUnblocked(account.id);
    return {
      message: 'Account unblocked successfully',
      account_status: AccountStatus.ACTIVE,
    };
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async resolveProfile(
    profileId: string,
    opts: { withLocation?: boolean } = {},
  ): Promise<{ role: Role; profile: any }> {
    if (!isUUID(profileId)) throw new InvalidIdException('Invalid profile ID');

    const relations = opts.withLocation ? ['account', 'province'] : ['account'];
    for (const role of [...REVIEWABLE_ROLES, Role.COLLECTOR]) {
      const repo = this.profileResolver.getRepo(role);
      const profile = await repo.findOne({ where: { id: profileId }, relations });
      if (profile) return { role, profile };
    }
    throw new ProfileNotFoundException();
  }

  /** How many documents each of these applicants has been asked to replace. */
  private async outstandingCounts(profileIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!profileIds.length) return map;

    const rows = await this.mediaRepo.find({
      where: { ownerId: In(profileIds), reuploadRequestedAt: Not(IsNull()) },
      select: ['id', 'ownerId'],
    });
    for (const r of rows) map.set(r.ownerId, (map.get(r.ownerId) ?? 0) + 1);
    return map;
  }
}
