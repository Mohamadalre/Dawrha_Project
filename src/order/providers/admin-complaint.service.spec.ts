import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminComplaintService } from './admin-complaint.service';
import { ComplaintStatus } from '../enums/complaint-kind.enum';

/**
 * The admin's complaints desk: read them, and decide the ones that are theirs.
 * A closed complaint cannot be re-decided, and closing one needs a reason.
 */
describe('AdminComplaintService', () => {
  const build = (complaint: any) => {
    const saved: any[] = [];
    const qb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[complaint].filter(Boolean), complaint ? 1 : 0]),
    };
    const complaintRepo = {
      findOne: jest.fn().mockResolvedValue(complaint),
      createQueryBuilder: jest.fn(() => qb),
      save: jest.fn(async (c: any) => {
        saved.push({ ...c });
        return c;
      }),
    };
    const orderRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'ord-1', orderNumber: 'ORD-1', buyerAccountId: 'acc-1' },
      ]),
    };
    const svc = new AdminComplaintService(complaintRepo as any, orderRepo as any);
    return { svc, saved, qb };
  };

  const open = () => ({
    id: 'c-1',
    orderId: 'ord-1',
    partId: 'p-1',
    warehouseId: 'wh-1',
    kind: 'DELIVERY',
    route: 'ADMIN',
    status: ComplaintStatus.OPEN,
    description: 'Late',
    createdAt: new Date(),
  });

  it('lists complaints with order context', async () => {
    const { svc } = build(open());
    const res: any = await svc.list({});
    expect(res.complaints).toHaveLength(1);
    expect(res.complaints[0].order.number).toBe('ORD-1');
  });

  it('applies status / route / kind filters when given', async () => {
    const { svc, qb } = build(open());
    await svc.list({
      status: ComplaintStatus.OPEN,
      route: 'ADMIN' as any,
      kind: 'DELIVERY' as any,
      page: 2,
      limit: 5,
    });
    const clauses = (qb.andWhere as jest.Mock).mock.calls.map((c) => c[0]);
    expect(clauses).toEqual(
      expect.arrayContaining(['c.status = :status', 'c.route = :route', 'c.kind = :kind']),
    );
    // Pagination is honoured.
    expect(qb.skip).toHaveBeenCalledWith(5); // (page 2 - 1) * 5
    expect(qb.take).toHaveBeenCalledWith(5);
  });

  it('does not add filter clauses when none are given', async () => {
    const { svc, qb } = build(open());
    await svc.list({});
    expect((qb.andWhere as jest.Mock)).not.toHaveBeenCalled();
  });

  it('resolves an open complaint, stamping who and when', async () => {
    const { svc, saved } = build(open());
    await svc.decide('c-1', 'admin-9', {
      status: ComplaintStatus.RESOLVED,
      resolution: 'Refunded the delivery fee',
    });
    expect(saved[0].status).toBe(ComplaintStatus.RESOLVED);
    expect(saved[0].resolvedBy).toBe('admin-9');
    expect(saved[0].resolvedAt).toBeInstanceOf(Date);
  });

  it('requires a resolution note when closing', async () => {
    const { svc } = build(open());
    await expect(
      svc.decide('c-1', 'admin-9', { status: ComplaintStatus.RESOLVED }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to re-decide a closed complaint', async () => {
    const { svc } = build({ ...open(), status: ComplaintStatus.RESOLVED });
    await expect(
      svc.decide('c-1', 'admin-9', {
        status: ComplaintStatus.REJECTED,
        resolution: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s an unknown complaint', async () => {
    const { svc } = build(null);
    await expect(svc.detail('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marks IN_REVIEW without requiring a note or stamping resolution', async () => {
    const { svc, saved } = build(open());
    await svc.decide('c-1', 'admin-9', { status: ComplaintStatus.IN_REVIEW });
    expect(saved[0].status).toBe(ComplaintStatus.IN_REVIEW);
    expect(saved[0].resolvedBy).toBeUndefined();
  });
});
