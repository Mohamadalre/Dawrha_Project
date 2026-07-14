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
    switch (role) {
      case Role.INSTITUTIONS:
        return this.selectionQuery(this.institutionRepo, 'institution', 'institutionProfile', accountId);
      default:
        // CITIZEN / FACTORY / EXTERNAL_PARTNER / ADMIN — no category restriction.
        return null;
    }
  }

  /**
   * Categories the account actually picked in the onboarding "add material
   * information" step. Unlike {@link getAssignedCategoryIds} (catalogue
   * *restriction* — institutions only), this reads the raw selections for all
   * three commercial roles; `null` means the role has no material step at all.
   */
  async getSelectedCategoryIds(
    accountId: string,
    role: Role,
  ): Promise<string[] | null> {
    switch (role) {
      case Role.INSTITUTIONS:
        return this.selectionQuery(this.institutionRepo, 'institution', 'institutionProfile', accountId);
      case Role.FACTORY:
        return this.selectionQuery(this.factoryRepo, 'factoryMaterial', 'factoryProfile', accountId);
      case Role.EXTERNAL_PARTNER:
        return this.selectionQuery(this.partnerRepo, 'externalPartnerMaterial', 'externalPartnerProfile', accountId);
      default:
        return null;
    }
  }

  /** Shared join: link table → material → profile → account, selecting category ids. */
  private async selectionQuery(
    repo: Repository<InstitutionWasteCategory | FactoryWasteCategory | ExternalPartnerWasteCategory>,
    materialRelation: string,
    profileRelation: string,
    accountId: string,
  ): Promise<string[]> {
    const rows: Array<{ id: string }> = await repo
      .createQueryBuilder('link')
      .innerJoin(`link.${materialRelation}`, 'material')
      .innerJoin(`material.${profileRelation}`, 'profile')
      .innerJoin('profile.account', 'account')
      .innerJoin('link.wasteType', 'category')
      .where('account.id = :accountId', { accountId })
      .select('DISTINCT category.id', 'id')
      .getRawMany();

    return rows.map((r) => r.id).filter(Boolean);
  }
}
