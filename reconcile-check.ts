/**
 * Are the two systems actually in agreement RIGHT NOW?
 *
 * Run this after any outage between the backend and Odoo. It performs every
 * reconciliation pass once, on demand, instead of waiting for the ten-minute
 * cron — and prints what it found.
 *
 * It also proves the JSON-RPC reads themselves still work: a renamed Odoo field
 * is a runtime fault that neither `tsc` nor the mocked unit tests can catch.
 *
 * Read-only in itself. The passes it triggers only ever enqueue the ordinary
 * sync jobs, so running it twice is harmless.
 *
 *   npx ts-node -r tsconfig-paths/register reconcile-check.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@src/app.module';
import { DataSource } from 'typeorm';
import { OdooService } from '@src/odoo/odoo.service';
import { DriverStateReconcileService } from '@src/odoo-sync/driver-state-reconcile.service';
import { OrderStateReconcileService } from '@src/odoo-sync/order-state-reconcile.service';
import { CatalogPushReconcileService } from '@src/odoo-sync/catalog-push-reconcile.service';
import { DriverRequestReconcileService } from '@src/odoo-sync/driver-request-reconcile.service';
import { PushReconcileService } from '@src/odoo-sync/push-reconcile.service';
import { ShiftChangeStateReconcileService } from '@src/odoo-sync/shift-change-state-reconcile.service';
import { OrphanReconcileService } from '@src/odoo-sync/orphan-reconcile.service';

/** What each Odoo driver-request state means for the account here. */
const EXPECT: Record<string, string> = {
  accepted: 'ACTIVE',
  rejected: 'REJECTED',
  need_changes: 'NEED_CHANGES',
  pending: '(undecided)',
};

NestFactory.createApplicationContext(AppModule, { logger: ['error'] })
  .then(async (app) => {
    const ds = app.get(DataSource);

    // ── driver decisions, row by row ────────────────────────────────────
    const drivers = await app.get(OdooService).fetchDriverRequestStates();
    console.log(`\n── driver requests in Odoo: ${drivers.length} ──`);
    console.log('  odoo_state   expected           actual             agrees');
    for (const d of drivers) {
      const rows = await ds.query(
        `SELECT a.account_status FROM collector_profiles c
           JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
        [d.backendDriverId],
      );
      const actual = rows[0]?.account_status ?? '(not in this backend)';
      const expected = d.isBlocked ? 'BLOCKED' : EXPECT[d.state];
      const agrees =
        expected === '(undecided)' ? 'n/a' : expected === actual ? 'YES' : 'NO — will converge';
      console.log(
        `  ${d.state.padEnd(12)} ${expected.padEnd(18)} ${String(actual).padEnd(18)} ${agrees}`,
      );
    }

    // ── catalogue rows that never reached Odoo ──────────────────────────
    const stuck = await ds.query(`
      SELECT 'categories' t, count(*)::int c FROM waste_categories  WHERE odoo_sync_status <> 'SYNCED'
      UNION ALL SELECT 'products',   count(*)::int FROM products            WHERE odoo_sync_status <> 'SYNCED'
      UNION ALL SELECT 'units',      count(*)::int FROM measurement_units   WHERE odoo_sync_status <> 'SYNCED'
      UNION ALL SELECT 'conditions', count(*)::int FROM material_conditions WHERE odoo_sync_status <> 'SYNCED'
      UNION ALL SELECT 'warehouses', count(*)::int FROM warehouses          WHERE odoo_sync_status <> 'SYNCED'`);
    console.log('\n── catalogue rows not yet in Odoo ──');
    for (const r of stuck) console.log(`  ${String(r.t).padEnd(12)} ${r.c}`);

    // ── run every pass once ─────────────────────────────────────────────
    console.log('\n── reconciliation passes ──');
    console.log(
      '  driverState  ',
      JSON.stringify(await app.get(DriverStateReconcileService).reconcile('manual')),
    );
    console.log(
      '  orderState   ',
      JSON.stringify(await app.get(OrderStateReconcileService).reconcile('manual')),
    );
    console.log(
      '  catalogPush  ',
      JSON.stringify(await app.get(CatalogPushReconcileService).reconcile('manual')),
    );
    console.log('  shiftChange  ', JSON.stringify(await app.get(ShiftChangeStateReconcileService).reconcile('manual')));
    console.log('  orphans      ', JSON.stringify(await app.get(OrphanReconcileService).findOrphans('manual')));
    await app.get(DriverRequestReconcileService).scheduledReconcile();
    await app.get(PushReconcileService).scheduledReconcile();
    console.log('  driverRequest + push: done (any action is logged above)');

    // Give the in-process queue worker a moment to actually run what was queued.
    await new Promise((r) => setTimeout(r, 15000));

    await app.close();
    console.log('\nRECONCILE CHECK OK');
    process.exit(0);
  })
  .catch((e) => {
    console.error('\nRECONCILE CHECK FAILED:', e?.stack ?? e);
    process.exit(1);
  });
