import { DataSource } from 'typeorm';
import { InstitutionType } from '@src/institution/entities/institution-type.entity';

export async function seedInstitutionTypes(dataSource: DataSource) {
  const repo = dataSource.getRepository(InstitutionType);
  const typeName = 'Otherwise';

  const existing = await repo.findOne({ where: { name: typeName } });
  if (existing) {
    return;
  }

  await repo.save({ name: typeName });
}
