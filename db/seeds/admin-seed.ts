import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';


export async function seedAdmin(dataSource: DataSource) {
  const repo = dataSource.getRepository(Account);

  const existingAdmin = await repo.findOne({
    where: { email: 'admin@dawrha.com' },
  });

  if (existingAdmin) {
    console.log('Admin already exists');
    return;
  }

  const passwordHash = await argon2.hash('Admin@123');

  const admin = repo.create({
    name: 'Super Admin',
    email: 'admin@dawrha.com',
    passwordHash,
    role: Role.ADMIN,
    accountStatus: AccountStatus.ACTIVE,
    isEmailVerified: true,
  });

  await repo.save(admin);

  console.log('Admin seeded successfully');
}