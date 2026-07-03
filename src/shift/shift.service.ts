import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shift } from './entities/shift.entity';
import { UpdateShiftDto } from './dto/update-shift.dto';

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
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  /** Admin-only: edit name/times. Shifts cannot be created or deleted. */
  async updateTimes(id: string, dto: UpdateShiftDto) {
    const shift = await this.getOrThrow(id);
    if (dto.name !== undefined) shift.name = dto.name;
    if (dto.startTime !== undefined) shift.startTime = dto.startTime;
    if (dto.endTime !== undefined) shift.endTime = dto.endTime;
    const saved = await this.shiftRepo.save(shift);
    return { message: 'Shift updated successfully', shift: this.map(saved) };
  }

  private map(s: Shift) {
    return { id: s.id, name: s.name, start_time: s.startTime, end_time: s.endTime };
  }
}
