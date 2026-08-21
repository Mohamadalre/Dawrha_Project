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
import { assertValidTimeSlots } from '../dto/delivery-time-slot.dto';

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
    materialRelation: 'externalPartnerMaterial',
    infoFields: ['externalPartnerName', 'externalPartnerPhone', 'externalPartnerSlogo'],
    // Documents are OPTIONAL for a free facility (not in ONBOARDING_STEPS, so the
    // application is submitted without them) — but when uploaded they are owned,
    // shown in the submission, replaceable, and reviewed by the admin like any
    // other role's.
    ownerType: OwnerType.EXTERNAL_PARTNER,
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
    // Editable while the applicant is still BUILDING the profile
    // (PENDING_PROFILE) and after they have SUBMITTED it and are waiting on the
    // admin (PENDING_APPROVAL). Both are the applicant's own to change: someone
    // who saved their institution details, moved on to the location step, then
    // wants to go back and correct a field is acting on a draft they own —
    // there is no reason to force a submission first. The "must have created the
    // step already" condition is enforced downstream: getProfile throws if the
    // profile row is missing, and updateMaterials throws if materials were never
    // submitted, so editing a step that does not exist yet still fails cleanly.
    const editable = [
      AccountStatus.PENDING_PROFILE,
      AccountStatus.PENDING_APPROVAL,
    ];
    if (!editable.includes(account.accountStatus)) {
      throw new ForbiddenException(
        'You can only edit your application while you are building it or while it is pending approval',
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

  /**
   * The materials block, shaped to the ROLE — never a union of every role's
   * fields. An institution describes a PICKUP (quantity, how often, when to
   * collect); a factory or free-facility describes an ORDER (average quantity,
   * schedule, delivery preference). Returning both sets meant an institution's
   * screen carried a factory's fields (all null) and the reverse — which is the
   * "editing at an institution shows the factory's details" bug. Each role now
   * gets only the fields it actually fills in.
   */
  private mapMaterials(profile: any, role: Role, materialRelation?: string) {
    if (!materialRelation) return null;
    const m = profile[materialRelation];
    if (!m) return null;
    const wasteTypes = (m.wasteTypes ?? [])
      .map((w: any) => w.wasteType && { id: w.wasteType.id, name: w.wasteType.name })
      .filter(Boolean);

    const base = { id: m.id, waste_types: wasteTypes };

    if (role === Role.INSTITUTIONS) {
      return {
        ...base,
        estimated_waste_quantity: m.estimatedWasteQuantity ?? null,
        collection_frequency: m.collectionFrequney ?? null,
        preferred_collection_time: m.preferredCollectionTime ?? null,
      };
    }

    // A FACTORY arranges a delivery: quantity, whether it wants delivery, and
    // the detailed windows it can receive it in.
    if (role === Role.FACTORY) {
      return {
        ...base,
        average_order_quantity: m.averageOrderQuantity ?? null,
        delivery_preference: m.deliveryPreference ?? null,
        delivery_time_slots: m.deliveryTimeSlots ?? null,
      };
    }

    // A free facility (EXTERNAL_PARTNER) gives only categories and a quantity.
    return {
      ...base,
      average_order_quantity: m.averageOrderQuantity ?? null,
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
      materials: this.mapMaterials(profile, role, cfg.materialRelation),
      // True while at least one document was rejected — the applicant must use
      // the re-upload endpoint for those specific files.
      has_rejected_documents: documents.some((m) => m.status === statusMedia.REJECTED),
      is_editable: account.accountStatus === AccountStatus.PENDING_APPROVAL,
    };
  }

  // ---------------------------------------------------------------------------
  // 2) Edit the "information" step (pending approval only)
  //
  // ONE METHOD PER ROLE — deliberately not a shared, map-driven update. The
  // fields differ completely (an institution has a type and a license, a
  // factory has two registers, a partner has neither) and the institution
  // carries a rule the others do not (type id XOR free-typed type). Folding all
  // of that into a single generic method is exactly where a factory edit could
  // touch an institution-only concern; keeping them apart makes each one only
  // as complex as its own role.
  //
  // Each saves through the SAME 409 guard, so a UNIQUE collision (phone,
  // license, register) is answered as a clean conflict rather than a raw 500.
  // ---------------------------------------------------------------------------

  /** Institution "information" edit — includes the type id ⊕ free-type rule. */
  async updateInstitutionInformation(accountId: string, dto: Record<string, any>) {
    const role = Role.INSTITUTIONS;
    const cfg = this.config(role);
    const account = await this.getAccount(accountId);
    this.assertEditable(account);

    const profile: any = await this.getProfile(accountId, role, cfg);

    if (dto.institutionName !== undefined) profile.institutionName = dto.institutionName;
    if (dto.licenseNumber !== undefined) profile.licenseNumber = dto.licenseNumber;
    if (dto.taxNumber !== undefined) profile.taxNumber = dto.taxNumber;
    if (dto.phoneNumber !== undefined) profile.institutionPhone = dto.phoneNumber;

    // The type is EITHER a real institution-type id OR a free-typed name, never
    // both — the two columns describe the same fact. So whichever one this edit
    // sets, the other is cleared: choosing an id drops any leftover free text,
    // and typing a custom name drops the id link. Sending both is rejected
    // rather than silently guessed.
    await this.applyInstitutionType(profile, dto);

    await this.saveInfo(role, profile);
    await this.afterEdit(role, accountId);
    const fresh = await this.getSubmission(accountId, role);
    return { information: fresh.information };
  }

  /** Factory "information" edit — name, the two registers, tax, phone. */
  async updateFactoryInformation(accountId: string, dto: Record<string, any>) {
    const role = Role.FACTORY;
    const cfg = this.config(role);
    const account = await this.getAccount(accountId);
    this.assertEditable(account);

    const profile: any = await this.getProfile(accountId, role, cfg);
    if (dto.factoryName !== undefined) profile.factoryName = dto.factoryName;
    if (dto.commercialRecord !== undefined) profile.commercialRecord = dto.commercialRecord;
    if (dto.industrialRecord !== undefined) profile.industrialRecord = dto.industrialRecord;
    if (dto.taxNumber !== undefined) profile.taxNumber = dto.taxNumber;
    if (dto.phoneNumber !== undefined) profile.factoryPhone = dto.phoneNumber;

    await this.saveInfo(role, profile);
    await this.afterEdit(role, accountId);
    const fresh = await this.getSubmission(accountId, role);
    return { information: fresh.information };
  }

  /** Free-facility (external partner) "information" edit — name and phone. */
  async updateExternalPartnerInformation(accountId: string, dto: Record<string, any>) {
    const role = Role.EXTERNAL_PARTNER;
    const cfg = this.config(role);
    const account = await this.getAccount(accountId);
    this.assertEditable(account);

    const profile: any = await this.getProfile(accountId, role, cfg);
    if (dto.externalPartnerName !== undefined) profile.externalPartnerName = dto.externalPartnerName;
    if (dto.phoneNumber !== undefined) profile.externalPartnerPhone = dto.phoneNumber;

    await this.saveInfo(role, profile);
    await this.afterEdit(role, accountId);
    const fresh = await this.getSubmission(accountId, role);
    return { information: fresh.information };
  }

  /** Collector "information" edit — national id (unique) and driver shift. */
  async updateCollectorInformation(accountId: string, dto: Record<string, any>) {
    const role = Role.COLLECTOR;
    const cfg = this.config(role);
    const account = await this.getAccount(accountId);
    this.assertEditable(account);

    const profile: any = await this.getProfile(accountId, role, cfg);

    if (dto.NationalID !== undefined) {
      // Refused by name here — the unique index is the final guard, but
      // reaching it surfaces a generic constraint error.
      const clash = await this.resolver
        .getRepo(role)
        .findOne({ where: { NationalID: dto.NationalID } });
      if (clash && clash.id !== profile.id) {
        throw new ConflictException('This National ID is already used by another account');
      }
      profile.NationalID = dto.NationalID;
    }

    if (dto.shiftId !== undefined) {
      const shift = await this.shiftRepo.findOne({ where: { id: dto.shiftId } });
      // Same rule as onboarding: an applicant has no warehouse yet, so only a
      // GLOBAL driver shift is selectable.
      if (!shift || shift.shiftType !== ShiftType.DRIVER || !shift.isActive || !shift.isGlobal) {
        throw new BadRequestException('shiftId invalid');
      }
      profile.shift = shift;
      profile.shiftId = shift.id;
    }

    await this.saveInfo(role, profile);
    await this.afterEdit(role, accountId);
    const fresh = await this.getSubmission(accountId, role);
    return { information: fresh.information };
  }

  /**
   * Applies the institution type ⊕ free-type rule to a profile from a DTO.
   * Shared by the onboarding add step and the edit above so both enforce it
   * identically.
   */
  private async applyInstitutionType(profile: any, dto: Record<string, any>) {
    const hasId = dto.institutionTypeId !== undefined && dto.institutionTypeId !== null && dto.institutionTypeId !== '';
    const hasOther = dto.otherInstitutionType !== undefined && dto.otherInstitutionType !== null && dto.otherInstitutionType !== '';

    if (hasId && hasOther) {
      throw new BadRequestException(
        'Provide either an institution type id or a custom type, not both',
      );
    }
    if (hasId) {
      const type = await this.institutionTypeRepo.findOne({
        where: { id: dto.institutionTypeId },
      });
      if (!type) throw new BadRequestException('institutionTypeId invalid');
      profile.institutionType = type;
      profile.otherInstitutionType = null;
    } else if (hasOther) {
      profile.otherInstitutionType = dto.otherInstitutionType;
      profile.institutionType = null;
    }
    // Neither sent → leave the existing choice untouched (PATCH semantics).
  }

  /**
   * Saves a profile after an information edit, turning a UNIQUE violation
   * (phone / license / register / national id) into a clean 409.
   */
  private async saveInfo(role: Role, profile: any) {
    try {
      await this.resolver.getRepo(role).save(profile);
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException('One of these values is already used by another account');
      }
      throw err;
    }
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

    // EDIT means change what is there — so a location must already exist. The
    // location step writes the coordinates, so their absence is the signal it
    // was never done: the applicant is trying to CREATE a location through the
    // edit route, skipping the ordered add step. They are told to add it first.
    // (In PENDING_APPROVAL this never trips — a submitted application has been
    // through every step — so it only guards a mid-onboarding shortcut.)
    if (!(profile as any).coordinates) {
      throw new BadRequestException(
        'Add your location first — there is nothing to edit yet',
      );
    }

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

    // Scalars — only the ones this role actually owns. Each role's fields are
    // disjoint now (an institution schedules a pickup, a factory arranges a
    // delivery with windows, a free facility gives only a quantity), so the set
    // is chosen by role and nothing bleeds across.
    const scalars =
      role === Role.INSTITUTIONS
        ? ['estimatedWasteQuantity', 'collectionFrequney', 'preferredCollectionTime']
        : role === Role.FACTORY
          ? ['deliveryPreference', 'deliveryTimeSlots']
          : [];
    for (const f of scalars) {
      if (dto[f] !== undefined) material[f] = dto[f];
    }

    // The quantity is a positive number on the wire but a decimal string in the
    // column — convert it here so both buyer roles store it identically.
    if (
      (role === Role.FACTORY || role === Role.EXTERNAL_PARTNER) &&
      dto.averageOrderQuantity !== undefined
    ) {
      material.averageOrderQuantity = String(dto.averageOrderQuantity);
    }

    // A factory's edited delivery windows obey the same start-before-end rule
    // as first submission.
    if (role === Role.FACTORY && dto.deliveryTimeSlots !== undefined) {
      assertValidTimeSlots(dto.deliveryTimeSlots);
    }
    // An institution's edited collection windows follow the same rule.
    if (role === Role.INSTITUTIONS && dto.preferredCollectionTime !== undefined) {
      assertValidTimeSlots(dto.preferredCollectionTime);
    }

    // Replacing the chosen waste categories: verify every id exists first, so a
    // single bad id cannot wipe the previous selection. The ids are
    // DE-DUPLICATED first — a category sent twice is stored once, and the
    // existence check compares against the de-duplicated set (otherwise a
    // legitimate repeat would fail the length comparison and be rejected as
    // "invalid"). The offending ids are named, like the onboarding step does.
    if (dto.wasteCategoryId !== undefined) {
      const uniqueIds: string[] = [...new Set<string>(dto.wasteCategoryId)];
      const categories = await this.wasteCategoryRepo.find({
        where: { id: In(uniqueIds) },
      });
      if (categories.length !== uniqueIds.length) {
        const found = new Set(categories.map((c) => c.id));
        const missing = uniqueIds.filter((id) => !found.has(id));
        throw new BadRequestException({
          message: 'Some of these waste categories do not exist',
          errorCode: 'WASTE_CATEGORY_NOT_FOUND',
          invalid_ids: missing,
        });
      }
      const inactive = categories.filter((c) => !c.isActive);
      if (inactive.length) {
        throw new BadRequestException({
          message: 'Some of these waste categories are no longer available',
          errorCode: 'WASTE_CATEGORY_INACTIVE',
          invalid_ids: inactive.map((c) => c.id),
        });
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
