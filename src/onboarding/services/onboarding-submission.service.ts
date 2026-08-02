import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { Role } from '@src/user/enums/role.enum';
import { Province } from '@src/user/entities/location/province.entity';
import { Media, OwnerType, statusMedia } from '@src/media/entities/media.entity';
import { ProfileResolver } from '@src/user/providers/profile-resolver.privder';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { InstitutionType } from '@src/institution/entities/institution-type.entity';
import { Shift, ShiftType } from '@src/shift/entities/shift.entity';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { ApplicationsCacheService } from '@src/account-management/providers/applications-cache.service';
import { ONBOARDING_STEPS } from '../config/onboarding.config';

/**
 * DTO field → profile column, per role. The DTO speaks the applicant's
 * language ("phoneNumber") while each entity uses its own naming
 * ("institutionPhone", "factoryPhone"), so the translation lives in ONE table
 * instead of being re-derived in every branch. Relations (institution type,
 * shift) are handled separately because they need looking up and validating.
 */
const INFO_FIELD_MAP: Record<string, Record<string, string>> = {
  [Role.INSTITUTIONS]: {
    institutionName: 'institutionName',
    otherInstitutionType: 'otherInstitutionType',
    licenseNumber: 'licenseNumber',
    taxNumber: 'taxNumber',
    // A mobile now, and the only number — see the entity. The `landlinePhone`
    // key is gone rather than aliased: leaving it would let an edit write a
    // landline into the column a driver calls.
    phoneNumber: 'institutionPhone',
  },
  [Role.FACTORY]: {
    factoryName: 'factoryName',
    commercialRecord: 'commercialRecord',
    industrialRecord: 'industrialRecord',
    taxNumber: 'taxNumber',
    phoneNumber: 'factoryPhone',
  },
  [Role.EXTERNAL_PARTNER]: {
    externalPartnerName: 'externalPartnerName',
    // A mobile now, not a landline — see the entity. The old key is gone
    // rather than aliased: leaving it would let an edit write a landline into
    // the column a driver calls.
    phoneNumber: 'externalPartnerPhone',
  },
  [Role.COLLECTOR]: {
    NationalID: 'NationalID',
  },
};

/**
 * States in which an applicant may LOOK at what they submitted. Before that the
 * profile is still being filled in (PENDING_PROFILE), and once ACTIVE the
 * application is history — the account screens take over.
 */
const VIEWABLE_STATES: AccountStatus[] = [
  AccountStatus.PENDING_APPROVAL,
  AccountStatus.REJECTED,
  AccountStatus.NEED_CHANGES,
];

/**
 * Per-role wiring. Everything else in this service is role-agnostic: the
 * profile repo comes from ProfileResolver and the location lives on
 * LocationBase, which every profile extends.
 */
const ROLE_CONFIG: Record<
  string,
  {
    /** Relation holding the materials block (absent for COLLECTOR). */
    materialRelation?: string;
    /** Profile columns that make up the "information" step, in display order. */
    infoFields: string[];
    /** OwnerType used on the media rows (absent = the role uploads no docs). */
    ownerType?: OwnerType;
  }
> = {
  [Role.INSTITUTIONS]: {
    materialRelation: 'materialInputs',
    infoFields: [
      'institutionName', 'institutionPhone', 'licenseNumber', 'taxNumber',
      'institutionSlogo', 'otherInstitutionType',
    ],
    ownerType: OwnerType.INSTITUTIONS,
  },
  [Role.FACTORY]: {
    materialRelation: 'factoryMaterial',
    infoFields: [
      'factoryName', 'factoryPhone', 'commercialRecord', 'industrialRecord',
      'taxNumber', 'factorySlogo',
    ],
    ownerType: OwnerType.FACTORY,
  },
  [Role.EXTERNAL_PARTNER]: {
    // No documents step for this role (see ONBOARDING_STEPS).
    materialRelation: 'externalPartnerMaterial',
    infoFields: ['externalPartnerName', 'externalPartnerPhone', 'externalPartnerSlogo'],
  },
  [Role.COLLECTOR]: {
    infoFields: ['NationalID'],
    ownerType: OwnerType.COLLECTOR,
  },
};

/**
 * Lets an applicant review — and, while still awaiting a decision, correct —
 * the onboarding application they submitted.
 *
 * One service serves every role: the profile repository is resolved from the
 * role and the shared pieces (location on `LocationBase`, documents in `media`)
 * are identical, so only the per-role bits above differ.
 */
@Injectable()
export class OnboardingSubmissionService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(Province)
    private readonly provinceRepo: Repository<Province>,
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    @InjectRepository(InstitutionType)
    private readonly institutionTypeRepo: Repository<InstitutionType>,
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(WasteCategory)
    private readonly wasteCategoryRepo: Repository<WasteCategory>,
    private readonly resolver: ProfileResolver,
    private readonly cloudinary: CloudinaryService,
    private readonly odooSync: OdooSyncService,
    private readonly applicationsCache: ApplicationsCacheService,
  ) {}

  /**
   * Called after ANY applicant-side correction. The admin's listing pages are
   * cached, so an edit that isn't invalidated would leave the reviewer looking
   * at pre-edit data for up to the cache TTL.
   */
  private async afterEdit(role: Role, accountId: string): Promise<void> {
    await this.applicationsCache.invalidate(role);
    await this.repushIfDriver(role, accountId);
  }

  // ---------------------------------------------------------------------------
  // Shared guards / loading
  // ---------------------------------------------------------------------------
  private config(role: Role) {
    const cfg = ROLE_CONFIG[role];
    if (!cfg) throw new ForbiddenException('This role has no onboarding application');
    return cfg;
  }

  private async getAccount(accountId: string): Promise<Account> {
    const account = await this.accountRepo.findOne({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  /**
   * Loads the profile with the relations needed for a full review. Missing
   * relations are tolerated (a half-finished application still renders).
   */
  private async getProfile(accountId: string, role: Role, cfg: { materialRelation?: string }) {
    const relations = ['province'];
    if (cfg.materialRelation) {
      relations.push(cfg.materialRelation, `${cfg.materialRelation}.wasteTypes`);
      relations.push(`${cfg.materialRelation}.wasteTypes.wasteType`);
    }
    if (role === Role.INSTITUTIONS) relations.push('institutionType');
    if (role === Role.COLLECTOR) relations.push('shift');

    const profile = await this.resolver.getRepo(role).findOne({
      where: { account: { id: accountId } },
      relations,
    });
    if (!profile) throw new NotFoundException('Onboarding application not found');
    return profile;
  }

  /** Editing is allowed ONLY while the application is awaiting a decision. */
  private assertEditable(account: Account): void {
    if (account.accountStatus !== AccountStatus.PENDING_APPROVAL) {
      throw new ForbiddenException(
        'You can only edit your application while it is pending approval',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Shaping
  // ---------------------------------------------------------------------------
  private mapLocation(profile: any) {
    // PostGIS stores the point as [lng, lat].
    const coords = profile.coordinates?.coordinates;
    const [longitude, latitude] = Array.isArray(coords) ? coords : [null, null];
    return {
      province: profile.province
        ? {
            id: profile.province.id,
            name_ar: profile.province.name_ar,
            name_en: profile.province.name_en,
          }
        : null,
      address: profile.address ?? null,
      description_address: profile.DesscriptLocation ?? null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
    };
  }

  private mapMaterials(profile: any, materialRelation?: string) {
    if (!materialRelation) return null;
    const m = profile[materialRelation];
    if (!m) return null;
    const wasteTypes = (m.wasteTypes ?? [])
      .map((w: any) => w.wasteType && { id: w.wasteType.id, name: w.wasteType.name })
      .filter(Boolean);
    return {
      id: m.id,
      waste_types: wasteTypes,
      // Institutions describe a pickup; factories/partners describe an order.
      estimated_waste_quantity: m.estimatedWasteQuantity ?? null,
      collection_frequency: m.collectionFrequney ?? null,
      preferred_collection_time: m.preferredCollectionTime ?? null,
      average_order_quantity: m.averageOrderQuantity ?? null,
      estimation_order_schedule: m.estimationOrderSchedule ?? null,
      delivery_preference: m.deliveryPreference ?? null,
      preferred_delivery_schedule: m.perferredDeliverySchedule ?? null,
    };
  }

  private mapDocuments(media: Media[]) {
    return media.map((m) => ({
      media_id: m.id,
      file_type: m.fileType,
      url: m.url,
      status: m.status,
      // The applicant may only replace a REJECTED file through the
      // need-changes re-upload endpoint; everything else is edited through
      // the pending-approval document endpoint.
      is_rejected: m.status === statusMedia.REJECTED,
      uploaded_at: m.createdAt,
    }));
  }

  // ---------------------------------------------------------------------------
  // 1) View the submitted application
  // ---------------------------------------------------------------------------
  async getSubmission(accountId: string, role: Role) {
    const cfg = this.config(role);
    const account = await this.getAccount(accountId);

    if (!VIEWABLE_STATES.includes(account.accountStatus)) {
      throw new ForbiddenException(
        'Your application is not under review, so there is nothing to display',
      );
    }

    const profile = await this.getProfile(accountId, role, cfg);
    const documents = cfg.ownerType
      ? await this.mediaRepo.find({
          where: { ownerId: profile.id, ownerType: cfg.ownerType },
          order: { createdAt: 'ASC' },
        })
      : [];

    // Only the columns this role actually fills in, in a stable order.
    const information: Record<string, unknown> = {};
    for (const f of cfg.infoFields) information[f] = (profile as any)[f] ?? null;
    if (role === Role.INSTITUTIONS && (profile as any).institutionType) {
      information.institutionType = {
        id: (profile as any).institutionType.id,
        name: (profile as any).institutionType.name,
      };
    }
    if (role === Role.COLLECTOR && (profile as any).shift) {
      information.shift = {
        id: (profile as any).shift.id,
        name: (profile as any).shift.name,
        start_time: (profile as any).shift.startTime,
        end_time: (profile as any).shift.endTime,
      };
    }

    return {
      account: {
        id: account.id,
        name: account.name,
        email: account.email,
        phone: account.phone ?? null,
        role: account.role,
        status: account.accountStatus,
      },
      // The exact step order this role went through, so a client can render
      // the application in submission sequence.
      steps: ONBOARDING_STEPS[role] ?? [],
      information,
      location: this.mapLocation(profile),
      documents: this.mapDocuments(documents),
      materials: this.mapMaterials(profile, cfg.materialRelation),
      // True while at least one document was rejected — the applicant must use
      // the re-upload endpoint for those specific files.
      has_rejected_documents: documents.some((m) => m.status === statusMedia.REJECTED),
      is_editable: account.accountStatus === AccountStatus.PENDING_APPROVAL,
    };
  }

  // ---------------------------------------------------------------------------
  // 2) Edit the "information" step (pending approval only)
  // ---------------------------------------------------------------------------
  async updateInformation(accountId: string, role: Role, dto: Record<string, any>) {
    const cfg = this.config(role);
    const account = await this.getAccount(accountId);
    this.assertEditable(account);

    const profile: any = await this.getProfile(accountId, role, cfg);
    const map = INFO_FIELD_MAP[role] ?? {};

    // Plain columns, translated through the per-role map.
    for (const [dtoField, column] of Object.entries(map)) {
      if (dto[dtoField] !== undefined) profile[column] = dto[dtoField];
    }

    // Relations need a lookup + validation.
    if (role === Role.INSTITUTIONS && dto.institutionTypeId !== undefined) {
      const type = await this.institutionTypeRepo.findOne({
        where: { id: dto.institutionTypeId },
      });
      if (!type) throw new BadRequestException('institutionTypeId invalid');
      profile.institutionType = type;
    }
    if (role === Role.COLLECTOR && dto.shiftId !== undefined) {
      const shift = await this.shiftRepo.findOne({ where: { id: dto.shiftId } });
      // Same rule as onboarding: an applicant has no warehouse yet, so only a
      // GLOBAL driver shift is selectable.
      if (!shift || shift.shiftType !== ShiftType.DRIVER || !shift.isActive || !shift.isGlobal) {
        throw new BadRequestException('shiftId invalid');
      }
      profile.shift = shift;
      profile.shiftId = shift.id;
    }

    try {
      await this.resolver.getRepo(role).save(profile);
    } catch (err: any) {
      // licenseNumber / phones / NationalID are UNIQUE — surface a clean 409
      // instead of letting the driver error bubble up as a 500.
      if (err?.code === '23505') {
        throw new ConflictException('One of these values is already used by another account');
      }
      throw err;
    }

    await this.afterEdit(role, accountId);
    const fresh = await this.getSubmission(accountId, role);
    return { information: fresh.information };
  }

  // ---------------------------------------------------------------------------
  // 3) Edit the location (pending approval only)
  // ---------------------------------------------------------------------------
  async updateLocation(
    accountId: string,
    role: Role,
    dto: { coordinates?: number[]; address?: string; descriptionAddress?: string; provinceId?: string },
  ) {
    const cfg = this.config(role);
    const account = await this.getAccount(accountId);
    this.assertEditable(account);

    // A driver's GPS point is captured by the app at registration and is used
    // for dispatch — he may correct the written address, never the coordinates.
    if (role === Role.COLLECTOR && dto.coordinates !== undefined) {
      throw new ForbiddenException('Drivers cannot change their coordinates');
    }

    const profile = await this.getProfile(accountId, role, cfg);

    if (dto.provinceId !== undefined) {
      const province = await this.provinceRepo.findOne({ where: { id: dto.provinceId } });
      if (!province) throw new BadRequestException('province invalid');
      (profile as any).province = province;
    }
    if (dto.coordinates !== undefined) {
      const [lng, lat] = dto.coordinates ?? [0, 0];
      (profile as any).coordinates = { type: 'Point', coordinates: [lng, lat] };
    }
    if (dto.address !== undefined) (profile as any).address = dto.address;
    if (dto.descriptionAddress !== undefined) {
      (profile as any).DesscriptLocation = dto.descriptionAddress;
    }

    await this.resolver.getRepo(role).save(profile);
    // Drop the admin's cached listings and, for a driver, push the correction
    // to Odoo straight away so no reviewer ever decides on stale data.
    await this.afterEdit(role, accountId);

    const fresh = await this.getProfile(accountId, role, cfg);
    return { location: this.mapLocation(fresh) };
  }

  // ---------------------------------------------------------------------------
  // 3b) Edit the "materials" step (pending approval only)
  // ---------------------------------------------------------------------------
  /**
   * Only roles whose onboarding HAS a materials step can call this — a driver
   * has none, so the route does not exist for him and the guard here is the
   * second line of defence.
   *
   * The whole material graph (material → pivot rows → waste category) is saved
   * through the profile, which declares `cascade: true` on both hops — so
   * replacing the selected categories is a plain array assignment, exactly the
   * way the onboarding step builds it.
   */
  async updateMaterials(accountId: string, role: Role, dto: Record<string, any>) {
    const cfg = this.config(role);
    if (!cfg.materialRelation) {
      throw new ForbiddenException('This role has no materials step');
    }
    const account = await this.getAccount(accountId);
    this.assertEditable(account);

    const profile: any = await this.getProfile(accountId, role, cfg);
    const material = profile[cfg.materialRelation];
    if (!material) {
      throw new NotFoundException('Materials were not submitted yet');
    }

    // Scalars — only the ones this role actually owns.
    const scalars = role === Role.INSTITUTIONS
      ? ['estimatedWasteQuantity', 'collectionFrequney', 'preferredCollectionTime']
      : ['averageOrderQuantity', 'estimationOrderSchedule', 'deliveryPreference',
         'perferredDeliverySchedule'];
    for (const f of scalars) {
      if (dto[f] !== undefined) material[f] = dto[f];
    }

    // Replacing the chosen waste categories: verify every id exists first, so a
    // single bad id cannot wipe the previous selection.
    if (dto.wasteCategoryId !== undefined) {
      const categories = await this.wasteCategoryRepo.find({
        where: { id: In(dto.wasteCategoryId) },
      });
      if (categories.length !== dto.wasteCategoryId.length) {
        throw new BadRequestException('One or more waste category ids are invalid');
      }
      material.wasteTypes = categories.map((wasteType) => ({ wasteType }));
    }

    await this.resolver.getRepo(role).save(profile);
    await this.afterEdit(role, accountId);

    const fresh = await this.getSubmission(accountId, role);
    return { materials: fresh.materials };
  }

  // ---------------------------------------------------------------------------
  // 4) Replace an uploaded document (pending approval only)
  // ---------------------------------------------------------------------------
  async replaceDocument(
    accountId: string,
    role: Role,
    mediaId: string,
    file: Express.Multer.File,
  ) {
    const cfg = this.config(role);
    if (!cfg.ownerType) {
      throw new ForbiddenException('This role does not upload documents');
    }
    const account = await this.getAccount(accountId);
    this.assertEditable(account);

    const profile = await this.getProfile(accountId, role, cfg);
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('Media not found');

    // Ownership: the file must belong to THIS applicant's profile.
    if (media.ownerId !== profile.id || media.ownerType !== cfg.ownerType) {
      throw new ForbiddenException('This image does not belong to your account');
    }
    // A rejected file has its own dedicated flow (PATCH /media/:id/reupload)
    // which also puts the account back under review — keep the two apart so a
    // NEED_CHANGES account cannot bypass that path.
    if (media.status === statusMedia.REJECTED) {
      throw new ForbiddenException(
        'This document was rejected — use the re-upload endpoint for rejected documents',
      );
    }

    const oldPublicId = media.publicId;
    const uploaded = await this.cloudinary.uploadFile(
      file,
      media.ownerId,
      media.ownerType,
      media.fileType,
    );

    await this.mediaRepo.update(mediaId, {
      url: uploaded.imageUrl,
      publicId: uploaded.publicId,
      // Replacing a file resets the review of that file.
      status: statusMedia.PENDING,
    });

    await this.afterEdit(role, accountId);

    // Best-effort cleanup — a stale Cloudinary object must never fail the request.
    try {
      await this.cloudinary.deleteFile(oldPublicId);
    } catch {
      /* ignore */
    }

    const fresh = await this.mediaRepo.findOne({ where: { id: mediaId } });
    return { document: this.mapDocuments(fresh ? [fresh] : [])[0] ?? null };
  }

  /**
   * Driver applications live in Odoo, so any correction must reach the Odoo
   * admin immediately. The push is queued (and reconciled by cron), so a brief
   * Odoo outage cannot lose the edit.
   */
  private async repushIfDriver(role: Role, accountId: string): Promise<void> {
    if (role !== Role.COLLECTOR) return;
    await this.odooSync.enqueuePushDriverRequest({ accountId });
  }
}
