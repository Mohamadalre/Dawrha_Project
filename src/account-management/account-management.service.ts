import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { validate as isUUID } from 'uuid';
import { ProfileResolver } from '@src/user/providers/profile-resolver.privder';
import { Media, statusMedia } from '@src/media/entities/media.entity';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { AccountDetailsDto } from './dto/account-details.dto';
import { BlockedAccountStatusDto, UpdateAccountStatusDto } from './dto/update-account-status.dto';
import { UpdateMediaStatusDto } from './dto/update-media-status.dto';
import { ProfileDataProvider } from './providers/profile-data.provider';
import { AccountStatusNotifier } from '@src/notification/account-status.notifier';

@Injectable()
export class AccountManagementService {
  constructor(
    private readonly profileResolver: ProfileResolver,
    private readonly profileDataProvider: ProfileDataProvider,
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly statusNotifier: AccountStatusNotifier,
  ) {}
//DOTO  remove id media in getprofile just
  async getProfiles(
    role: Role,
    page: number,
    limit: number,
  ): Promise<{ items: AccountDetailsDto[]; total: number; page: number; limit: number }> {
    const repo = this.profileResolver.getRepo(role);

    const [profiles, total] = await repo.findAndCount({
      relations: this.profileDataProvider.getRelations(role),
      where: { account: { accountStatus: AccountStatus.PENDING_APPROVAL } },
      skip: (page - 1) * limit,
      take: limit,
    });

    if (total === 0) {
      throw new NotFoundException(`No ${role.toLowerCase().replace('_', ' ')} accounts pending approval`);
    }

    const mediaMap = await this.buildMediaMap(profiles.map((p: any) => p.id));

    const items = profiles.map((profile: any) => {
      const { account, province, address, coordinates, DesscriptLocation, ...profileFields } = profile;
      const materialKey = this.profileDataProvider.getMaterialKey(role);
      const materials = materialKey ? profile[materialKey] : undefined;
      const location = province
        ? { province, address, coordinates, description: DesscriptLocation }
        : undefined;

      return {
        account,
        profile: profileFields,
        materials,
        location,
        mediaIds: mediaMap.get(profile.id) ?? [],
      };
    });

    return { items, total, page, limit };
  }

  async updateMediaStatus(mediaId: string, dto: UpdateMediaStatusDto) {
    if (!isUUID(mediaId)) {
      throw new BadRequestException('Invalid media ID');
    }

    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    const { profile } = await this.resolveProfile(media.ownerId);
    const account = profile.account;

    let movedToNeedChanges = false;
    if (account.accountStatus === AccountStatus.PENDING_APPROVAL) {
      await this.accountRepo.update(account.id, { accountStatus: AccountStatus.NEED_CHANGES });
      movedToNeedChanges = true;
    } else if (account.accountStatus !== AccountStatus.NEED_CHANGES) {
      throw new ConflictException(
        `Account is ${account.accountStatus.toLowerCase().replace('_', ' ')}. Media status can only be updated for pending approval or accounts needing changes`,
      );
    }

    if (media.status !== statusMedia.PENDING) {
      throw new ConflictException(
        `Media is already ${media.status.toLowerCase()}. Only pending media can be updated`,
      );
    }

    await this.mediaRepo.update(mediaId, { status: dto.status });

    if (movedToNeedChanges) {
      await this.statusNotifier.notifyStatusDecision(
        account.id,
        AccountStatus.NEED_CHANGES,
        'بعض المستندات تحتاج إلى تعديل وإعادة الرفع',
      );
    }

    return { message: `Media ${dto.status.toLowerCase()} successfully` };
  }

  async getProfileMedia(profileId: string) {
    const { profile } = await this.resolveProfile(profileId);

    if (profile.account.accountStatus !== AccountStatus.PENDING_APPROVAL) {
      throw new ConflictException(
        `Account is ${profile.account.accountStatus.toLowerCase().replace('_', ' ')}. Media can only be viewed for pending approval accounts`,
      );
    }

    const media = await this.mediaRepo.find({
      where: { ownerId: profileId },
    });

    if (media.length === 0) {
      throw new NotFoundException('No media found for this profile');
    }

    return media;
  }

  async updateStatus(accountId: string, dto: UpdateAccountStatusDto) {
    if (!isUUID(accountId)) {
      throw new BadRequestException('Invalid account ID');
    }

    const account = await this.accountRepo.findOne({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    if (account.accountStatus !== AccountStatus.PENDING_APPROVAL) {
      throw new ConflictException(
        `Account already ${account.accountStatus.toLowerCase().replace('_', ' ')}. Cannot update status again`,
      );
    }

    if (dto.status === AccountStatus.BLOCKED) {
      throw new BadRequestException('Cannot block a pending approval account. Use the block-status endpoint');
    }

    const updateData: Partial<Account> = { accountStatus: dto.status };
    if (dto.description !== undefined) {
      updateData.description = dto.description;
    }

    await this.accountRepo.update(account.id, updateData);

    // Tell the user the decision (approved / rejected / needs changes) and why.
    await this.statusNotifier.notifyStatusDecision(account.id, dto.status, dto.description);

    return { message: `Account ${dto.status.toLowerCase().replace('_', ' ')} successfully` };
  }

  async blockStatus(accountId: string, dto: BlockedAccountStatusDto) {
    if (!isUUID(accountId)) {
      throw new BadRequestException('Invalid account ID');
    }

    const account = await this.accountRepo.findOne({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const current = account.accountStatus;
    const target = dto.status;

    if (current === AccountStatus.ACTIVE && target === AccountStatus.BLOCKED) {
      await this.accountRepo.update(account.id, {
        accountStatus: AccountStatus.BLOCKED,
        ...(dto.description !== undefined && { description: dto.description }),
      });
      return { message: 'Account blocked successfully' };
    }

    if (current === AccountStatus.BLOCKED && target === AccountStatus.ACTIVE) {
      await this.accountRepo.update(account.id, {
        accountStatus: AccountStatus.ACTIVE,
        ...(dto.description !== undefined && { description: dto.description }),
      });
      return { message: 'Account unblocked successfully' };
    }

    if (current === target) {
      throw new ConflictException(`Account is already ${current.toLowerCase().replace('_', ' ')}`);
    }

    throw new BadRequestException(
      `Cannot change status from ${current.toLowerCase().replace('_', ' ')} to ${target.toLowerCase().replace('_', ' ')}. Only ACTIVE↔BLOCKED transitions are allowed`,
    );
  }

  private async resolveProfile(profileId: string): Promise<{ role: Role; profile: any }> {
    if (!isUUID(profileId)) {
      throw new BadRequestException('Invalid profile ID');
    }

    const roles = [Role.FACTORY, Role.INSTITUTIONS, Role.COLLECTOR, Role.EXTERNAL_PARTNER];

    for (const role of roles) {
      const repo = this.profileResolver.getRepo(role);
      const profile = await repo.findOne({
        where: { id: profileId },
        relations: ['account'],
      });
      if (profile) {
        return { role, profile };
      }
    }

    throw new NotFoundException('Profile not found');
  }

  private async buildMediaMap(profileIds: string[]): Promise<Map<string, string[]>> {
    if (profileIds.length === 0) return new Map();

    const mediaList = await this.mediaRepo.find({
      where: { ownerId: In(profileIds) },
      select: ['id', 'ownerId'],
    });

    const map = new Map<string, string[]>();
    for (const m of mediaList) {
      const ids = map.get(m.ownerId);
      if (ids) ids.push(m.id);
      else map.set(m.ownerId, [m.id]);
    }
    return map;
  }
}
