import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shift, ShiftType } from './entities/shift.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import {
  ShiftNotFoundException,
  DriverProfileNotFoundException,
} from './exceptions/shift.exceptions';

@Injectable()
export class ShiftService {
  constructor(
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(CollectorProfile)
    private readonly collectorRepo: Repository<CollectorProfile>,
  ) {}

  /**
   * ONBOARDING picker (account still PENDING_PROFILE). A not-yet-accepted driver
   * has NO warehouse yet, so they may only pick a GLOBAL driver shift — a
   * warehouse-specific one would silently force the admin's warehouse choice.
   */
  async listOnboardingShifts() {
    const shifts = await this.shiftRepo.find({
      where: { shiftType: ShiftType.DRIVER, isActive: true, isGlobal: true },
      order: { startTime: 'ASC' },
    });
    return { shifts: shifts.map((s) => this.map(s)) };
  }

  /**
   * "Available shifts" picker for an ACTIVE driver — the shifts he may request
   * to switch TO. He sees GLOBAL driver shifts PLUS the driver shifts scoped to
   * HIS OWN warehouse, MINUS the shift he is already on (you can't request to
   * move to your current shift). Anything scoped to another warehouse is hidden.
   * The id it returns feeds POST /shift-change-requests.
   */
  async listAvailableShifts(accountId: string) {
    const profile = await this.collectorRepo.findOne({
      where: { account: { id: accountId } },
      relations: ['warehouse'],
    });
    if (!profile) throw new DriverProfileNotFoundException();

    const myWarehouseOdooId = profile.warehouse?.odooWarehouseId ?? null;
    const all = await this.shiftRepo.find({
      where: { shiftType: ShiftType.DRIVER, isActive: true },
      order: { startTime: 'ASC' },
    });
    const shifts = all.filter(
      (s) =>
        s.id !== profile.shiftId && // exclude the driver's current shift
        (s.isGlobal ||
          (myWarehouseOdooId != null &&
            (s.odooWarehouseIds ?? []).includes(myWarehouseOdooId))),
    );
    return { shifts: shifts.map((s) => this.map(s)) };
  }

  /** Ensures a shift exists (used by other modules before linking to it). */
  async getOrThrow(id: string): Promise<Shift> {
    const shift = await this.shiftRepo.findOne({ where: { id } });
    if (!shift) throw new ShiftNotFoundException();
    return shift;
  }

  /**
   * A shift a driver may pick DURING ONBOARDING: must exist, be driver-typed,
   * still active, and GLOBAL (an unaccepted driver has no warehouse yet, so a
   * warehouse-specific shift is off-limits). Anything else looks "not found".
   */
  async getDriverShiftOrThrow(id: string): Promise<Shift> {
    const shift = await this.getOrThrow(id);
    if (shift.shiftType !== ShiftType.DRIVER || !shift.isActive || !shift.isGlobal) {
      throw new ShiftNotFoundException();
    }
    return shift;
  }

  private map(s: Shift) {
    return { id: s.id, name: s.name, start_time: s.startTime, end_time: s.endTime };
  }
}
