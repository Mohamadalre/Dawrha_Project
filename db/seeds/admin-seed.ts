import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import * as dotenv from 'dotenv';


export async function seedAdmin(dataSource: DataSource) {
    dotenv.config()
  const repo = dataSource.getRepository(Account);

  const existingAdmin = await repo.findOne({
    where: { email: 'admin@dawrha.com' },
  });

  if (existingAdmin) {
    console.log('Admin already exists');
    return;
  }

  const passwordHash = await argon2.hash(process.env.ADMINPASSWORD||'Admin@123');

  const admin = repo.create({
    name: process.env.ADMINNAME||'Super Admin',
    email: process.env.ADMINEMAIL||'admin@dawrha.com',
    passwordHash,
    role: Role.ADMIN,
    accountStatus: AccountStatus.ACTIVE,
    isEmailVerified: true,
  });

  await repo.save(admin);

  console.log('Admin seeded successfully');
}