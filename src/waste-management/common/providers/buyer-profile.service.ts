import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FactoryProfile } from '@src/user/entities/profile/factory-profile.entity';
import { ExternalPartnerProfile } from '@src/user/entities/profile/external-partner-profile.entity';
import { Role } from '@src/user/enums/role.enum';

export interface BuyerProfileRef {
  profileId: string;
  provinceId: string | null;
}

/**
 * Finds the buyer's profile row, whichever table it lives in.
 *
 * Factories and free facilities keep their profiles in separate tables, but
 * everything downstream needs exactly two facts from either: the profile id (the
 * key the distance cache and the Odoo push use) and the governorate — which is
 * what warehouses are matched on. Resolving that here keeps every other service
 * indifferent to which kind of buyer it is serving, and that indifference is
 * what lets one flow cover both.
 *
 * Lives in the shared kernel rather than inside the ordering module because two
 * separate concerns need the same answer: allocation matches warehouses to the
 * governorate, and the catalogue reports availability from the warehouses OF
 * that governorate. Two copies of this lookup would be two chances for the
 * number a buyer is shown to disagree with the stock they can actually be sent.
 */
@Injectable()
export class BuyerProfileService {
  constructor(
    @InjectRepository(FactoryProfile)
    private readonly factoryRepo: Repository<FactoryProfile>,
    @InjectRepository(ExternalPartnerProfile)
    private readonly partnerRepo: Repository<ExternalPartnerProfile>,
  ) {}

  async forAccount(accountId: string, role: Role): Promise<BuyerProfileRef> {
    const profile =
      role === Role.FACTORY
        ? await this.factoryRepo.findOne({
            where: { account: { id: accountId } },
            relations: ['province'],
          })
        : await this.partnerRepo.findOne({
            where: { account: { id: accountId } },
            relations: ['province'],
          });

    if (!profile) {
      throw new BadRequestException('Complete your profile before ordering');
    }
    return {
      profileId: profile.id,
      provinceId: profile.province?.id ?? null,
    };
  }

  /**
   * The buyer's governorate, or null when the question does not apply.
   *
   * Returns null instead of throwing for roles that have no governorate-scoped
   * buying (citizens, institutions, admins) and for a profile that has not been
   * completed yet. Callers that merely narrow a view by governorate should
   * degrade to "not narrowed" rather than fail — refusing to show a catalogue
   * because a profile is half-filled helps nobody.
   */
  async provinceForBuyer(accountId: string, role: Role): Promise<string | null> {
    if (role !== Role.FACTORY && role !== Role.EXTERNAL_PARTNER) return null;
    try {
      const { provinceId } = await this.forAccount(accountId, role);
      return provinceId;
    } catch {
      return null;
    }
  }
}
