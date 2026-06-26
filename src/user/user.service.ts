import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { Account } from './entities/account.entity';
import { Role } from './enums/role.enum';
import { ProfileResolver } from './providers/profile-resolver.privder';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CitizenProfile } from './entities/profile/citizen-profile.entity';
import { Location } from './entities/location/location.entity';
import { Province } from './entities/location/province.entity';
import { LocationDto } from '@src/onboarding/dto/location.dto';

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
  ) {}

  async findByEmail(email: string): Promise<Account> {
    const account = await this.accountRepository.findOne({
      where: { email }
    });

    if (!account) {
      throw new NotFoundException(`Account with email ${email} not found`);
    }
    return account;
  }

  async findById(id: string): Promise<Account> {
    const account = await this.accountRepository.findOne({
      where: { id },
    });
    if (!account) {
      throw new NotFoundException(`Account not found`);
    }
    return account;
  }

  // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
  async update(id: string, data: object): Promise<Boolean> {
    const account = await this.accountRepository.update(id,data);
    if (!account) {
      throw new NotFoundException(`Account not found`);
    }
    return true;
  }

  /**
   * Returns the current user's account info (without the password) plus the
   * role-specific profile. A single endpoint serves every role — the role is
   * read from the JWT, not the URL. ADMIN/CITIZEN have no extended profile.
   */
  async getProfile(accountId: string, role: Role) {
    const account = await this.findById(accountId);
    const { passwordHash, ...safeAccount } = account;

    let profile: unknown = null;
    if (role !== Role.ADMIN) {
      const repo = this.profileResolver.getRepo(role);
      profile = await repo.findOne({
        where: { account: { id: accountId } },
        relations: this.profileRelations[role] ?? [],
      });
    }

    return { account: safeAccount, profile };
  }

  /**
   * Changes the current user's password after verifying the current one and the
   * confirmation match.
   */
  async changePassword(accountId: string, dto: ChangePasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Password confirmation does not match');
    }

    const account = await this.findById(accountId);
    if (!account.passwordHash) {
      throw new BadRequestException('This account has no password set (e.g. social login)');
    }

    const currentMatches = await argon2.verify(account.passwordHash, dto.currentPassword);
    if (!currentMatches) {
      throw new BadRequestException('Current password is incorrect');
    }

    const sameAsOld = await argon2.verify(account.passwordHash, dto.newPassword);
    if (sameAsOld) {
      throw new BadRequestException('The new password must be different from the current one');
    }

    const newHash = await argon2.hash(dto.newPassword);
    await this.accountRepository.update(accountId, { passwordHash: newHash });

    return { message: 'Password changed successfully' };
  }

  // ---------------------------------------------------------------------------
  // Citizen locations (multiple). Other roles keep a single location set during
  // onboarding, so these endpoints are limited to CITIZEN.
  // ---------------------------------------------------------------------------

  private assertCitizen(role: Role) {
    if (role !== Role.CITIZEN) {
      throw new ForbiddenException('Only individual users can manage multiple locations');
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
      province: loc.province ? { id: loc.province.id } : null,
    };
  }

  /** Adds a new location for the current citizen (same fields as onboarding). */
  async addLocation(accountId: string, role: Role, dto: LocationDto) {
    this.assertCitizen(role);

    const province = await this.provinceRepo.findOne({ where: { id: dto.provinceId } });
    if (!province) throw new BadRequestException('Invalid province');

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

    return { id: location.id, message: 'Location added successfully' };
  }

  /** Lists the current citizen's locations. */
  async listLocations(accountId: string, role: Role) {
    this.assertCitizen(role);
    const profile = await this.citizenProfileRepo.findOne({
      where: { account: { id: accountId } },
      relations: ['locations', 'locations.province'],
    });
    return (profile?.locations ?? []).map((l) => this.mapLocation(l));
  }

  /** Removes one of the current citizen's locations. */
  async removeLocation(accountId: string, role: Role, locationId: string) {
    this.assertCitizen(role);
    const location = await this.locationRepo.findOne({
      where: { id: locationId },
      relations: ['cititzenProfile', 'cititzenProfile.account'],
    });
    if (!location) throw new NotFoundException('Location not found');
    if (location.cititzenProfile?.account?.id !== accountId) {
      throw new ForbiddenException('This location does not belong to your account');
    }
    await this.locationRepo.delete(locationId);
    return { message: 'Location removed successfully' };
  }
}
