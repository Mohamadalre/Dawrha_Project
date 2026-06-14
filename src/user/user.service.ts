import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from './entities/account.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) { }

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
}
