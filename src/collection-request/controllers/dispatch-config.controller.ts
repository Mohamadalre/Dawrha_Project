import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { DispatchConfig } from '../entities/dispatch-config.entity';
import { UpdateDispatchConfigDto } from '../dto/admin-collection.dto';
import { CoverageRebalanceCron } from '../crons/coverage-rebalance.cron';

/**
 * The single dispatch-engine configuration: GET the row admin edits, PATCH a
 * full or partial save. Updates are merged field by field so a PATCH of only
 * `rebalanceMin` leaves the weights untouched; a new `rebalanceMin` also
 * re-registers the coverage cron interval.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/dispatch-config', version: '1' })
export class DispatchConfigController {
  constructor(
    @InjectRepository(DispatchConfig)
    private readonly configRepo: Repository<DispatchConfig>,
    private readonly coverageCron: CoverageRebalanceCron,
  ) {}

  @Get()
  @Permissions('collection.dispatch.manage')
  async get() {
    const config = await this.current();
    return { message: 'Dispatch configuration', result: this.toView(config) };
  }

  @Patch()
  @Permissions('collection.dispatch.manage')
  async update(@Body() dto: UpdateDispatchConfigDto) {
    const config = await this.current();

    if (dto.weights) {
      // class-transformer exposes unset fields as `undefined`; those must not
      // overwrite the stored weights.
      const patch = Object.fromEntries(
        Object.entries(dto.weights).filter(([, v]) => v !== undefined),
      );
      config.weights = { ...config.weights, ...patch };
    }
    if (dto.accept_window_sec != null) config.acceptWindowSec = dto.accept_window_sec;
    if (dto.scheduled_lead_min != null) {
      config.scheduledLeadMin = dto.scheduled_lead_min;
    }
    if (dto.route_merge_max_min != null) {
      config.routeMergeMaxMin = dto.route_merge_max_min;
    }
    if (dto.route_merge_max_km != null) {
      config.routeMergeMaxKm = String(dto.route_merge_max_km);
    }
    if (dto.institution_tolerance_min != null) {
      config.institutionToleranceMin = dto.institution_tolerance_min;
    }
    if (dto.rebalance_min != null) config.rebalanceMin = dto.rebalance_min;
    if (dto.is_enabled != null) config.isEnabled = dto.is_enabled;

    await this.configRepo.save(config);

    // The tunable cadence drives the cron directly.
    await this.coverageCron.reschedule();

    return {
      message: 'Dispatch configuration updated',
      result: this.toView(config),
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private async current(): Promise<DispatchConfig> {
    let config = await this.configRepo.findOne({
      where: { singleton: true },
    });
    if (!config) {
      config = this.configRepo.create({ singleton: true });
      config = await this.configRepo.save(config);
    }
    return config;
  }

  private toView(config: DispatchConfig) {
    return {
      weights: config.weights,
      accept_window_sec: config.acceptWindowSec,
      scheduled_lead_min: config.scheduledLeadMin,
      route_merge_max_min: config.routeMergeMaxMin,
      route_merge_max_km: Number(config.routeMergeMaxKm),
      institution_tolerance_min: config.institutionToleranceMin,
      rebalance_min: config.rebalanceMin,
      is_enabled: config.isEnabled,
      updated_at: config.updatedAt,
    };
  }
}