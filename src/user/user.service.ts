import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import {
  PROVINCES_CACHE_TTL_SECONDS,
  PROVINCES_CACHE_VERSION_KEY,
  provincesCacheKey,
} from '@src/common/constants/cache.constants';
import * as argon2 from 'argon2';
import { Account } from './entities/account.entity';
import { Role } from './enums/role.enum';
import { ProfileResolver } from './providers/profile-resolver.privder';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AccountStatus } from './enums/account-status.enum';
import {
  AccountNotActiveException,
  AccountNotFoundException,
  CitizenOnlyLocationsException,
  IncorrectPasswordException,
  InvalidProvinceException,
  LocationNotFoundException,
  NoPasswordSetException,
  NotYourLocationException,
  PasswordConfirmationMismatchException,
  PhoneAlreadyExistsException,
  SamePasswordException,
} from './exceptions/user.exceptions';
import { CitizenProfile } from './entities/profile/citizen-profile.entity';
import { Location } from './entities/location/location.entity';
import { Province } from './entities/location/province.entity';
import { UserDevice } from '@src/auth/entities/user-device.entity';
import { Not, IsNull } from 'typeorm';
import { Language } from '@src/common/enums/language.enum';
import { LocationDto } from '@src/onboarding/dto/location.dto';
import { UserCacheService } from './providers/user-cache.service';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';

@Injectable()
export class UserService {
  /** Role-specific relations loaded for the profile view. */
  private readonly profileRelations: Partial<Record<Role, string[]>> = {
    [Role.FACTORY]: [
      'factoryMaterial',
      'factoryMaterial.wasteTypes',
      'factoryMaterial.wasteTypes.wasteType',
    ],
    [Role.INSTITUTIONS]: [
      'materialInputs',
      'materialInputs.wasteTypes',
      'materialInputs.wasteTypes.wasteType',
      'institutionType',
    ],
    [Role.EXTERNAL_PARTNER]: [
      'externalPartnerMaterial',
      'externalPartnerMaterial.wasteTypes',
      'externalPartnerMaterial.wasteTypes.wasteType',
    ],
    [Role.COLLECTOR]: [],
    [Role.CITIZEN]: [],
  };

  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly profileResolver: ProfileResolver,
    @InjectRepository(CitizenProfile)
    private readonly citizenProfileRepo: Repository<CitizenProfile>,
    @InjectRepository(Location)
    private readonly locationRepo: Repository<Location>,
    @InjectRepository(Province)
    private readonly provinceRepo: Repository<Province>,
    @InjectRepository(UserDevice)
    private readonly deviceRepo: Repository<UserDevice>,
    private readonly userCache: UserCacheService,
    private readonly cloudinary: CloudinaryService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  /**
   * The list of governorates (provinces) for the user app — paginated, and
   * cached ONCE globally because every account reads the same list.
   *
   * The route is gated to ACTIVE accounts at the controller. Caching is global
   * (not per-account): the version key is shared with the province-admin write
   * paths, which bump it on create/update/delete, so an edit reaches every
   * reader on the next request. Fail-open — any Redis error falls through to
   * the database.
   */
  async listProvinces(page = 1, limit = 20) {
    const parts = `${page}:${limit}`;
    try {
      const version = (await this.redis.get(PROVINCES_CACHE_VERSION_KEY)) ?? '0';
      const cached = await this.redis.get(provincesCacheKey(version, parts));
      if (cached) return JSON.parse(cached);
    } catch {
      // ignore and read through to the DB
    }

    const [rows, total] = await this.provinceRepo.findAndCount({
      select: { id: true, name_ar: true, name_en: true },
      order: { name_en: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const result = {
      provinces: rows.map((p) => ({
        id: p.id,
        name_en: p.name_en,
        name_ar: p.name_ar,
      })),
      pagination: buildPagination(total, page, limit),
    };

    try {
      const version = (await this.redis.get(PROVINCES_CACHE_VERSION_KEY)) ?? '0';
      await this.redis.set(
        provincesCacheKey(version, parts),
        JSON.stringify(result),
        'EX',
        PROVINCES_CACHE_TTL_SECONDS,
      );
    } catch {
      // caching is best-effort
    }
    return result;
  }

  async findByEmail(email: string): Promise<Account> {
    const account = await this.accountRepository.findOne({
      where: { email }
    });

    if (!account) {
      throw new AccountNotFoundException(`Account with email ${email} not found`);
    }
    return account;
  }

  async findById(id: string): Promise<Account> {
    const account = await this.accountRepository.findOne({
      where: { id },
    });
    if (!account) {
      throw new AccountNotFoundException();
    }
    return account;
  }

  // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
  async update(id: string, data: object): Promise<Boolean> {
    const account = await this.accountRepository.update(id,data);
    if (!account) {
      throw new AccountNotFoundException();
    }
    return true;
  }

  /**
   * Self-service edit of the basic account fields (name / phone / description)
   * for every role — allowed ONLY while the account is ACTIVE. Blocked/pending
   * accounts must go through the admin/onboarding flows instead.
   */
  async updateProfile(accountId: string, dto: UpdateProfileDto) {
    const account = await this.findById(accountId);

    if (account.accountStatus !== AccountStatus.ACTIVE) {
      throw new AccountNotActiveException();
    }

    // Phone is re-checked for uniqueness on EDIT with the same guard used when
    // it is first set — the format is enforced by the DTO, the "no two accounts
    // share a phone" rule by `assertPhoneAvailable` here — so an edit can never
    // slip a duplicate past a check that only ran at registration.
    if (dto.phone !== undefined && dto.phone !== account.phone) {
      await this.assertPhoneAvailable(dto.phone, accountId);
      account.phone = dto.phone;
    }
    if (dto.name !== undefined) account.name = dto.name;
    if (dto.description !== undefined) account.description = dto.description;
    // The image is NOT edited here — it has its own upload/replace/delete
    // routes that keep the Cloudinary asset in step (see UpdateProfileDto).

    const saved = await this.accountRepository.save(account);

    // The profile card just changed — drop its cached copy so the next read
    // rebuilds it rather than serving the pre-edit values.
    await this.userCache.invalidate(accountId, 'profile');

    return {
      message: 'Profile updated successfully',
      // Absent fields come back as '' rather than null, so a client can bind
      // them straight into a form without a null-guard on every one.
      result: {
        id: saved.id,
        name: saved.name ?? '',
        phone: saved.phone ?? '',
        profileImage: saved.profileImage ?? '',
        description: saved.description ?? '',
      },
    };
  }

  /**
   * A phone number belongs to at most one account.
   *
   * The column is `unique`, so the database is the real guard — but a raw
   * unique-violation surfaces as a 500 with a Postgres message, which tells the
   * user nothing they can act on. This pre-checks and throws the domain error
   * instead, and every create/update path that sets a phone routes through it
   * so the rule is stated in one place.
   *
   * `exceptAccountId` skips the caller's own row, so re-saving an unchanged
   * phone is not mistaken for a duplicate.
   */
  async assertPhoneAvailable(phone: string, exceptAccountId?: string): Promise<void> {
    const owner = await this.accountRepository.findOne({ where: { phone } });
    if (owner && owner.id !== exceptAccountId) {
      throw new PhoneAlreadyExistsException();
    }
  }

  // ---------------------------------------------------------------------------
  // Profile image (ACTIVE accounts only)
  // ---------------------------------------------------------------------------

  /**
   * The Cloudinary public id embedded in an upload URL, or null if the string is
   * not a Cloudinary URL we manage.
   *
   * `accounts.profile_image` stores the delivery URL, not the public id — so to
   * delete or replace the old asset the id has to be recovered from the URL.
   * A Cloudinary URL is `…/upload/v<version>/<publicId>.<ext>`; everything
   * between the version segment and the extension is the public id (folders
   * included). Anything that does not match that shape (an external avatar, a
   * Google picture) yields null and is simply left alone rather than guessed at.
   */
  private cloudinaryPublicId(url?: string | null): string | null {
    if (!url || !url.includes('res.cloudinary.com')) return null;
    const m = url.match(/\/upload\/(?:v\d+\/)?(.+?)\.[a-zA-Z0-9]+$/);
    return m ? m[1] : null;
  }

  private async assertActive(accountId: string): Promise<Account> {
    const account = await this.findById(accountId);
    if (account.accountStatus !== AccountStatus.ACTIVE) {
      throw new AccountNotActiveException();
    }
    return account;
  }

  /** Uploads a new profile image, replacing any existing one. ACTIVE only. */
  async setProfileImage(accountId: string, file: Express.Multer.File, role: Role) {
    const account = await this.assertActive(accountId);

    const uploaded = await this.cloudinary.uploadFile(
      file,
      accountId,
      role.toLowerCase(),
      'profile',
    );

    const previous = this.cloudinaryPublicId(account.profileImage);
    account.profileImage = uploaded.imageUrl;
    await this.accountRepository.save(account);
    await this.userCache.invalidate(accountId, 'profile');

    // Replace = the NEW asset is uploaded and saved first (so a failure never
    // leaves the account with no image), THEN the old cloud file is removed so
    // it is not left orphaned. Awaited so the cleanup actually completes within
    // the request rather than being fire-and-forget, but non-fatal: the new
    // image is already live, so a failed cleanup must not fail the edit.
    if (previous) {
      await this.cloudinary.deleteFile(previous).catch(() => undefined);
    }

    return {
      message: 'Profile image updated successfully',
      result: { profileImage: uploaded.imageUrl },
    };
  }

  /** Removes the profile image entirely. ACTIVE only. */
  async deleteProfileImage(accountId: string) {
    const account = await this.assertActive(accountId);

    const publicId = this.cloudinaryPublicId(account.profileImage);

    // Cloudinary FIRST, and awaited — before the database row is cleared.
    //
    // The stored URL is the ONLY handle on the cloud asset, so clearing the DB
    // first and then failing to delete would strand the file with nothing left
    // to find it by. `deleteFile` already treats an asset that is not there as
    // success, so re-deleting can never wedge the operation; a genuine failure
    // aborts here and leaves BOTH the row and the file in place — consistent
    // and retryable — rather than half-removed.
    if (publicId) {
      await this.cloudinary.deleteFile(publicId);
    }

    account.profileImage = null;
    await this.accountRepository.save(account);
    await this.userCache.invalidate(accountId, 'profile');

    // '' rather than null — the field binds straight into the UI.
    return { message: 'Profile image removed successfully', result: { profileImage: '' } };
  }

  /**
   * The current user's own profile card, for EVERY role.
   *
   * Deliberately flat: `accountId, name, email, phone, profileImage,
   * accountStatus, role`. The old shape nested the whole account under
   * `account` and the role-profile under `profile`; callers had to reach two
   * levels and dig the passwordHash-free account out by hand. This returns
   * exactly the fields a profile screen shows and nothing else.
   *
   * The ROLE profile's id is deliberately NOT exposed here. A caller only ever
   * needs their ACCOUNT id (`accountId`) — the profile-row id is an internal key
   * the admin account-review routes use, resolved there from the token, so
   * leaking it onto a self profile served no one and only widened the surface.
   *
   * Cached per-account (`UserCacheService`): a profile is read on almost every
   * screen and changes rarely. Every write path that touches these fields
   * (`updateProfile`, the image routes, Google phone capture) invalidates it,
   * so a stale card can never outlive the edit that changed it.
   */
  async getProfile(accountId: string, role: Role) {
    const cached = await this.userCache.get<Record<string, unknown>>('profile', accountId);
    if (cached) return cached;

    const account = await this.findById(accountId);

    // Absent values come back as '' rather than null — the app binds these
    // straight into a profile screen, and a null there is one more special case
    // every field has to guard. Only the ACCOUNT id is returned; the role-profile
    // row id is intentionally withheld.
    const result = {
      accountId: account.id,
      name: account.name ?? '',
      email: account.email ?? '',
      phone: account.phone ?? '',
      profileImage: account.profileImage ?? '',
      accountStatus: account.accountStatus,
      role: account.role,
    };

    await this.userCache.set('profile', accountId, '', result);
    return result;
  }

  /**
   * Changes the current user's password after verifying the current one and the
   * confirmation match.
   */
  async changePassword(accountId: string, dto: ChangePasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new PasswordConfirmationMismatchException();
    }

    const account = await this.findById(accountId);
    if (!account.passwordHash) {
      throw new NoPasswordSetException();
    }

    const currentMatches = await argon2.verify(account.passwordHash, dto.currentPassword);
    if (!currentMatches) {
      throw new IncorrectPasswordException();
    }

    const sameAsOld = await argon2.verify(account.passwordHash, dto.newPassword);
    if (sameAsOld) {
      throw new SamePasswordException();
    }

    const newHash = await argon2.hash(dto.newPassword);
    await this.accountRepository.update(accountId, { passwordHash: newHash });

    return { message: 'Password changed successfully' };
  }

  // ---------------------------------------------------------------------------
  // App settings & active sessions
  // ---------------------------------------------------------------------------

  /**
   * App settings for the current user: the active language and the ones it can
   * be switched to.
   *
   * Language is stored per DEVICE (it also drives push notifications), so the
   * "current" one is the most recently used device's; the request language is
   * the fallback before any device has been recorded.
   */
  async getAppSettings(accountId: string, _requestLang?: string) {
    const account = await this.accountRepository.findOne({ where: { id: accountId } });
    // The account's SAVED language is the source of truth now — it is what every
    // response is returned in, so the settings screen must show the same value.
    return {
      language: account?.language ?? Language.EN,
      available_languages: [Language.EN, Language.AR],
    };
  }

  /**
   * Change the account's language. From the next request on, every response
   * comes back in it — the client never sends a language header again.
   */
  async setLanguage(accountId: string, language: Language) {
    const account = await this.accountRepository.findOne({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Account not found');
    account.language = language;
    await this.accountRepository.save(account);
    return { message: 'Language updated successfully', result: { language } };
  }

  /**
   * The devices currently signed in to this account — "where am I logged in".
   *
   * A session is a device whose refresh token is still live; logout blanks it,
   * so a signed-out device drops off the list. The refresh token itself never
   * leaves this method.
   *
   * No row is ever duplicated: `(accountId, deviceId)` is unique, so logging out
   * and back in on the SAME phone updates that one row and bumps its `lastLogin`
   * rather than adding a second entry. Cached briefly (`sessions`, 5m) because
   * the list moves with every login/logout — the short TTL is the freshness
   * bound the cache resource was designed around.
   */
  async listActiveSessions(accountId: string) {
    const cached = await this.userCache.get<unknown>('sessions', accountId);
    if (cached) return cached;

    const devices = await this.deviceRepo.find({
      where: { accountId, refreshToken: Not(IsNull()) },
      order: { lastLogin: 'DESC' },
    });
    // Logout sets the token to an EMPTY string (not null), so it survives the
    // `Not(IsNull())` filter above — drop those here so only live sessions show.
    const active = devices.filter((d) => !!d.refreshToken && d.refreshToken.length > 0);

    const result = {
      sessions: active.map((d) => ({
        id: d.id,
        device_id: d.deviceId ?? null,
        device_type: d.deviceType ?? null,
        language: d.language,
        last_login: d.lastLogin ?? null,
        created_at: d.createdAt,
      })),
      count: active.length,
    };
    await this.userCache.set('sessions', accountId, '', result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Citizen locations (multiple). Other roles keep a single location set during
  // onboarding, so these endpoints are limited to CITIZEN.
  // ---------------------------------------------------------------------------

  private assertCitizen(role: Role) {
    if (role !== Role.CITIZEN) {
      throw new CitizenOnlyLocationsException();
    }
  }

  private async getOrCreateCitizenProfile(accountId: string): Promise<CitizenProfile> {
    let profile = await this.citizenProfileRepo.findOne({
      where: { account: { id: accountId } },
    });
    if (!profile) {
      profile = await this.citizenProfileRepo.save(
        this.citizenProfileRepo.create({ account: { id: accountId } as Account }),
      );
    }
    return profile;
  }

  private mapLocation(loc: Location) {
    return {
      id: loc.id,
      address: loc.address ?? null,
      description: loc.DesscriptLocation ?? null,
      coordinates: loc.coordinates?.coordinates ?? null,
      // The province carries its NAME, not only its id — the id alone forces
      // the client into a second lookup to show anything human. Both languages
      // travel so the app renders in whichever it is set to without asking the
      // server which one the reader wants.
      province: loc.province
        ? {
            id: loc.province.id,
            name_en: loc.province.name_en,
            name_ar: loc.province.name_ar,
          }
        : null,
    };
  }

  /** Adds a new location for the current citizen (same fields as onboarding). */
  async addLocation(accountId: string, role: Role, dto: LocationDto) {
    this.assertCitizen(role);

    const province = await this.provinceRepo.findOne({ where: { id: dto.provinceId } });
    if (!province) throw new InvalidProvinceException();

    const profile = await this.getOrCreateCitizenProfile(accountId);
    const [lng, lat] = dto.coordinates;

    const location = await this.locationRepo.save(
      this.locationRepo.create({
        cititzenProfile: profile,
        province,
        address: dto.address,
        DesscriptLocation: dto.descriptionAddress,
        coordinates: { type: 'Point', coordinates: [lng, lat] },
      }),
    );

    // The list this location now belongs to is cached; without this bump a
    // freshly added location would be invisible until the TTL lapsed.
    await this.userCache.invalidate(accountId, 'locations');

    return { id: location.id, message: 'Location added successfully' };
  }

  /**
   * The current citizen's locations, paginated and cached.
   *
   * Cached under the account's `locations` version (see UserCacheService), keyed
   * by the page so each slice is stored once. `addLocation`/`removeLocation`
   * bump that version, so an edit can never leave a stale page behind.
   */
  async listLocations(accountId: string, role: Role, page = 1, limit = 20) {
    this.assertCitizen(role);

    const parts = `${page}:${limit}`;
    const cached = await this.userCache.get<unknown>('locations', accountId, parts);
    if (cached) return cached;

    const profile = await this.citizenProfileRepo.findOne({
      where: { account: { id: accountId } },
    });
    if (!profile) {
      return { locations: [], pagination: buildPagination(0, page, limit) };
    }

    const [rows, total] = await this.locationRepo.findAndCount({
      where: { cititzenProfile: { id: profile.id } },
      relations: ['province'],
      order: { id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const result = {
      locations: rows.map((l) => this.mapLocation(l)),
      pagination: buildPagination(total, page, limit),
    };
    await this.userCache.set('locations', accountId, parts, result);
    return result;
  }

  /**
   * One of the current citizen's locations, in full, with its province name.
   *
   * Ownership is checked before anything is returned — a location id that is
   * not this account's is a not-found, not another user's address. Cached under
   * the `location` resource keyed by the location id; the same invalidation
   * that clears the list clears this.
   */
  async getLocationById(accountId: string, role: Role, locationId: string) {
    this.assertCitizen(role);

    const cached = await this.userCache.get<unknown>('location', accountId, locationId);
    if (cached) return cached;

    const location = await this.locationRepo.findOne({
      where: { id: locationId },
      relations: ['province', 'cititzenProfile', 'cititzenProfile.account'],
    });
    if (!location) throw new LocationNotFoundException();
    if (location.cititzenProfile?.account?.id !== accountId) {
      throw new NotYourLocationException();
    }

    const result = this.mapLocation(location);
    await this.userCache.set('location', accountId, locationId, result);
    return result;
  }

  /** Removes one of the current citizen's locations. */
  async removeLocation(accountId: string, role: Role, locationId: string) {
    this.assertCitizen(role);
    const location = await this.locationRepo.findOne({
      where: { id: locationId },
      relations: ['cititzenProfile', 'cititzenProfile.account'],
    });
    if (!location) throw new LocationNotFoundException();
    if (location.cititzenProfile?.account?.id !== accountId) {
      throw new NotYourLocationException();
    }
    await this.locationRepo.delete(locationId);

    // Both the list and this location's own detail are cached — bump so neither
    // keeps serving a location that is gone.
    await this.userCache.invalidate(accountId, 'locations');

    return { message: 'Location removed successfully' };
  }
}
