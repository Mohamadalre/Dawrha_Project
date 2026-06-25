import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { InstitutionWasteCategory } from '@src/waste-management/entities/institution-waste-category.entity';
import { FactoryWasteCategory } from '@src/waste-management/entities/factory-waste-category.entity';
import { ExternalPartnerWasteCategory } from '@src/waste-management/entities/external-partner-waste-category.entity';

/**
 * Resolves which waste-category IDs are assigned to a given account.
 *
 * Only companies (INSTITUTIONS) are restricted to the categories selected for
 * them during registration. Everyone else — individuals (CITIZEN), factories
 * (FACTORY), free facilities (EXTERNAL_PARTNER) and admins — sees the full
 * catalogue. Callers treat a `null` result as "no restriction".
 */
@Injectable()
export class AssignedCategoryProvider {
  constructor(
    @InjectRepository(InstitutionWasteCategory)
    private readonly institutionRepo: Repository<InstitutionWasteCategory>,
    @InjectRepository(FactoryWasteCategory)
    private readonly factoryRepo: Repository<FactoryWasteCategory>,
    @InjectRepository(ExternalPartnerWasteCategory)
    private readonly partnerRepo: Repository<ExternalPartnerWasteCategory>,
  ) {}

  /**
   * @returns an array of assigned category IDs, or `null` when the role is not
   *          category-restricted (CITIZEN / ADMIN / others).
   */
  async getAssignedCategoryIds(
    accountId: string,
    role: Role,
  ): Promise<string[] | null> {
    let rows: Array<{ id: string }> = [];

    switch (role) {
      case Role.INSTITUTIONS:
        rows = await this.institutionRepo
          .createQueryBuilder('iwc')
          .innerJoin('iwc.institution', 'material')
          .innerJoin('material.institutionProfile', 'profile')
          .innerJoin('profile.account', 'account')
          .innerJoin('iwc.wasteType', 'category')
          .where('account.id = :accountId', { accountId })
          .select('DISTINCT category.id', 'id')
          .getRawMany();
        break;

      default:
        // CITIZEN / FACTORY / EXTERNAL_PARTNER / ADMIN — no category restriction.
        return null;
    }

    return rows.map((r) => r.id).filter(Boolean);
  }
}
