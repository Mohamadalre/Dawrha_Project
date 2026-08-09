import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { InstitutionMaterial } from '@src/user/entities/material/institution-material.entity';
import { FactoryMaterial } from '@src/user/entities/material/factory-material.entity';
import { ExternalPartnerMaterial } from '@src/user/entities/material/external-partner-material.entity';
import { InstitutionWasteCategory } from '@src/waste-management/entities/institution-waste-category.entity';
import { FactoryWasteCategory } from '@src/waste-management/entities/factory-waste-category.entity';
import { ExternalPartnerWasteCategory } from '@src/waste-management/entities/external-partner-waste-category.entity';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';

/**
 * Links waste categories to a commercial account's material record (the same
 * pivot rows created during onboarding's info-material step). After this runs,
 * the account's "my categories" view includes the new categories.
 *
 * Moved here from the old category-request feature (now removed): the request
 * flow existed only because buyers were once restricted to their picked
 * categories. They are not any more — everyone sees the whole catalogue — so a
 * buyer adds a category to their own list DIRECTLY, no admin approval.
 */
@Injectable()
export class AssignedCategoryWriter {
  constructor(
    @InjectRepository(InstitutionMaterial)
    private readonly institutionMaterialRepo: Repository<InstitutionMaterial>,
    @InjectRepository(FactoryMaterial)
    private readonly factoryMaterialRepo: Repository<FactoryMaterial>,
    @InjectRepository(ExternalPartnerMaterial)
    private readonly partnerMaterialRepo: Repository<ExternalPartnerMaterial>,
    @InjectRepository(InstitutionWasteCategory)
    private readonly institutionPivotRepo: Repository<InstitutionWasteCategory>,
    @InjectRepository(FactoryWasteCategory)
    private readonly factoryPivotRepo: Repository<FactoryWasteCategory>,
    @InjectRepository(ExternalPartnerWasteCategory)
    private readonly partnerPivotRepo: Repository<ExternalPartnerWasteCategory>,
  ) {}

  async addCategories(accountId: string, role: Role, categoryIds: string[]): Promise<void> {
    if (categoryIds.length === 0) return;

    switch (role) {
      case Role.INSTITUTIONS: {
        const material = await this.institutionMaterialRepo
          .createQueryBuilder('m')
          .innerJoin('m.institutionProfile', 'p')
          .innerJoin('p.account', 'a')
          .where('a.id = :accountId', { accountId })
          .getOne();
        this.assertMaterial(material);
        await this.institutionPivotRepo.save(
          categoryIds.map((id) =>
            this.institutionPivotRepo.create({
              institution: material,
              wasteType: { id } as WasteCategory,
            }),
          ),
        );
        break;
      }

      case Role.FACTORY: {
        const material = await this.factoryMaterialRepo
          .createQueryBuilder('m')
          .innerJoin('m.factoryProfile', 'p')
          .innerJoin('p.account', 'a')
          .where('a.id = :accountId', { accountId })
          .getOne();
        this.assertMaterial(material);
        await this.factoryPivotRepo.save(
          categoryIds.map((id) =>
            this.factoryPivotRepo.create({
              factoryMaterial: material,
              wasteType: { id } as WasteCategory,
            }),
          ),
        );
        break;
      }

      case Role.EXTERNAL_PARTNER: {
        const material = await this.partnerMaterialRepo
          .createQueryBuilder('m')
          .innerJoin('m.externalPartnerProfile', 'p')
          .innerJoin('p.account', 'a')
          .where('a.id = :accountId', { accountId })
          .getOne();
        this.assertMaterial(material);
        await this.partnerPivotRepo.save(
          categoryIds.map((id) =>
            this.partnerPivotRepo.create({
              externalPartnerMaterial: material,
              wasteType: { id } as WasteCategory,
            }),
          ),
        );
        break;
      }

      default:
        throw new BadRequestException('This role cannot hold assigned categories');
    }
  }

  private assertMaterial(material: unknown): asserts material {
    if (!material) {
      throw new BadRequestException('Account has no material profile to attach categories to');
    }
  }
}
