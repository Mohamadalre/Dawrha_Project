import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shift } from './entities/shift.entity';
import { ShiftNotFoundException } from './exceptions/shift.exceptions';

@Injectable()
export class ShiftService {
  constructor(
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
  ) {}

  /** All shifts (used by drivers when onboarding and by admins). */
  async list() {
    const shifts = await this.shiftRepo.find({ order: { startTime: 'ASC' } });
    return { shifts: shifts.map((s) => this.map(s)) };
  }

  /** Ensures a shift exists (used by other modules before linking to it). */
  async getOrThrow(id: string): Promise<Shift> {
    const shift = await this.shiftRepo.findOne({ where: { id } });
    if (!shift) throw new ShiftNotFoundException();
    return shift;
  }

  private map(s: Shift) {
    return { id: s.id, name: s.name, start_time: s.startTime, end_time: s.endTime };
  }
}
