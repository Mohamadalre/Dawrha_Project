import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { PointsRate } from './entities/points-rate.entity';
import { isWalletEligible } from './points-wallet.service';
import { PlatformSettingsService } from '@src/platform-settings/platform-settings.service';

/**
 * The money-per-point conversion the admin authors, per role.
 *
 * One rate per role. `amountPerPoint` is what a single point is worth, so an
 * order worth `amountPerPoint × N` earns the buyer N points on receipt.
 */
@Injectable()
export class PointsRateService {
  constructor(
    @InjectRepository(PointsRate)
    private readonly rateRepo: Repository<PointsRate>,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** ADD (or replace) the rate for a role. */
  async create(role: Role, amountPerPoint: number, adminId: string) {
    this.assertSane(role, amountPerPoint);
    let rate = await this.rateRepo.findOne({ where: { role } });
    if (!rate) rate = this.rateRepo.create({ role });
    rate.amountPerPoint = String(amountPerPoint);
    // Currency is the central platform setting, never chosen per rate.
    rate.currency = await this.settings.defaultCurrency();
    rate.updatedBy = adminId;
    await this.rateRepo.save(rate);
    return { message: 'Points rate saved successfully', result: this.shape(rate) };
  }

  /** EDIT the rate for a role in place. */
  async update(
    role: Role,
    input: { amountPerPoint?: number },
    adminId: string,
  ) {
    const rate = await this.rateRepo.findOne({ where: { role } });
    if (!rate) throw new NotFoundException('No points rate set for this role yet');
    const amount = input.amountPerPoint ?? Number(rate.amountPerPoint);
    this.assertSane(role, amount);
    rate.amountPerPoint = String(amount);
    // Keep the currency aligned to the central platform setting.
    rate.currency = await this.settings.defaultCurrency();
    rate.updatedBy = adminId;
    await this.rateRepo.save(rate);
    return { message: 'Points rate updated successfully', result: this.shape(rate) };
  }

  async list() {
    const rows = await this.rateRepo.find({ order: { role: 'ASC' } });
    return { rates: rows.map((r) => this.shape(r)) };
  }

  /** The rate in force for a role, or null when the admin has set none. */
  forRole(role: Role): Promise<PointsRate | null> {
    return this.rateRepo.findOne({ where: { role } });
  }

  private assertSane(role: Role, amountPerPoint: number) {
    if (!isWalletEligible(role)) {
      throw new BadRequestException('Only trading roles (buyers and sellers) earn points');
    }
    if (!(amountPerPoint > 0)) {
      throw new BadRequestException('The amount per point must be greater than zero');
    }
  }

  private shape(r: PointsRate) {
    return {
      id: r.id,
      role: r.role,
      amount_per_point: Number(r.amountPerPoint),
      currency: r.currency,
      updated_at: r.updatedAt,
    };
  }
}
