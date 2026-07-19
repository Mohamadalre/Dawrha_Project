import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shift, ShiftType } from './entities/shift.entity';
import { ShiftNotFoundException } from './exceptions/shift.exceptions';

@Injectable()
export class ShiftService {
  constructor(
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
  ) {}

  /**
   * Driver-facing shift list (onboarding / shift-change pickers).
   * Only DRIVER-type shifts that still exist in Odoo are offered —
   * warehouse-staff shifts never reach the driver app.
   */
  async list() {
    const shifts = await this.shiftRepo.find({
      where: { shiftType: ShiftType.DRIVER, isActive: true },
      order: { startTime: 'ASC' },
    });
    return { shifts: shifts.map((s) => this.map(s)) };
  }

  /** Ensures a shift exists (used by other modules before linking to it). */
  async getOrThrow(id: string): Promise<Shift> {
    const shift = await this.shiftRepo.findOne({ where: { id } });
    if (!shift) throw new ShiftNotFoundException();
    return shift;
  }

  /**
   * A shift a DRIVER may pick (onboarding / shift change): must exist, be
   * driver-typed and still active in Odoo. Anything else looks "not found".
   */
  async getDriverShiftOrThrow(id: string): Promise<Shift> {
    const shift = await this.getOrThrow(id);
    if (shift.shiftType !== ShiftType.DRIVER || !shift.isActive) {
      throw new ShiftNotFoundException();
    }
    return shift;
  }

  private map(s: Shift) {
    return { id: s.id, name: s.name, start_time: s.startTime, end_time: s.endTime };
  }
}
