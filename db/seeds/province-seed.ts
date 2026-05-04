import { DataSource } from 'typeorm';
import { Province } from '@src/user/entities/location/province.entity';
import { SYRIA_GOVERNORATES } from './province.config';


export async function seedProvince(dataSource: DataSource) {
  const repo = dataSource.getRepository(Province);

  for (const gov of SYRIA_GOVERNORATES) {
    const exists = await repo.findOne({
      where: { name_en: gov.name_en},
    });

    if (!exists) {
      const newGov = repo.create(gov);
      await repo.save(newGov);
    }
  }

  console.log(' Governorates seeded successfully');
}