import { OdooHealthMonitorService } from './odoo-health-monitor.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

/**
 * The monitor must alert on the EDGE, not on every tick: one ERROR when the
 * link drops, one recovery notice when it returns, and silence in between.
 */
describe('OdooHealthMonitorService', () => {
  let errSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    errSpy = jest.spyOn(winstonLogger, 'error').mockImplementation(() => winstonLogger as any);
    infoSpy = jest.spyOn(winstonLogger, 'info').mockImplementation(() => winstonLogger as any);
  });
  afterEach(() => jest.restoreAllMocks());

  const build = (odoo: { isReachable: jest.Mock }) =>
    new OdooHealthMonitorService(odoo as any);

  it('stays silent while the link is healthy', async () => {
    const odoo = { isReachable: jest.fn().mockResolvedValue(true) };
    const svc = build(odoo);
    await svc.check();
    await svc.check();
    expect(errSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('alerts ONCE when the link drops (marker ODOO_UNREACHABLE), not every tick', async () => {
    const odoo = { isReachable: jest.fn().mockResolvedValue(false) };
    const svc = build(odoo);
    await svc.check(); // down edge -> alert
    await svc.check(); // still down -> no repeat
    await svc.check();
    const alerts = errSpy.mock.calls.filter(
      (c) => (c[1] as any)?.alert === 'ODOO_UNREACHABLE',
    );
    expect(alerts).toHaveLength(1);
  });

  it('logs a recovery when the link comes back', async () => {
    const odoo = { isReachable: jest.fn() };
    const svc = build(odoo);
    odoo.isReachable.mockResolvedValueOnce(false); // down
    await svc.check();
    odoo.isReachable.mockResolvedValueOnce(true); // recovered
    await svc.check();
    const recovery = infoSpy.mock.calls.filter(
      (c) => (c[1] as any)?.alert === 'ODOO_RECOVERED',
    );
    expect(recovery).toHaveLength(1);
  });

  it('re-alerts after a full down → up → down cycle', async () => {
    const odoo = { isReachable: jest.fn() };
    const svc = build(odoo);
    for (const up of [false, true, false]) {
      odoo.isReachable.mockResolvedValueOnce(up);
      await svc.check();
    }
    const alerts = errSpy.mock.calls.filter(
      (c) => (c[1] as any)?.alert === 'ODOO_UNREACHABLE',
    );
    expect(alerts).toHaveLength(2); // one per drop
  });
});
