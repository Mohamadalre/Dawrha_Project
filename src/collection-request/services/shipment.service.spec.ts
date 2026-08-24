import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { Shipment } from '../entities/shipment.entity';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { ShipmentStatus } from '../enums/shipment-status.enum';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import { DispatchGatewayEvents } from '../gateways/dispatch.gateway';

const SHIPMENT_ID = 'a1000000-0000-4000-8000-000000000001';
const DRIVER_ID = 'e5000000-0000-4000-8000-000000000001';
const WAREHOUSE_ID = 'w0000000-0000-4000-8000-000000000001';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: SHIPMENT_ID,
    shipmentNumber: 'SHP-2026-08-24-001',
    status: ShipmentStatus.DELIVERED,
    driverId: DRIVER_ID,
    truckId: 't1',
    warehouseId: WAREHOUSE_ID,
    departedAt: new Date('2026-08-24T08:00:00Z'),
    driver: { id: DRIVER_ID, account: { name: 'Saeed' } },
    truck: { plateNumber: 'ABC-123' },
    ...overrides,
  } as unknown as Shipment;
}

describe('ShipmentService — reception QR formats', () => {
  let service: ShipmentService;
  let shipmentRepo: Record<string, jest.Mock>;
  let requestRepo: Record<string, jest.Mock>;
  let driverRepo: Record<string, jest.Mock>;
  let productRepo: Record<string, jest.Mock>;

  const shipment = makeShipment();

  beforeEach(async () => {
    shipmentRepo = {
      findOne: jest.fn().mockResolvedValue(shipment),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
    };
    requestRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'r1',
          requestNumber: 'CR-1',
          shipmentId: SHIPMENT_ID,
          status: CollectionRequestStatus.DELIVERED,
          estimatedWeightKg: '10',
          lines: [
            {
              productId: 'p1',
              productName: 'Test Material Sync',
              unitType: 'KG',
              quantity: 5,
              actualQuantity: 4,
            },
          ],
        },
      ] as CollectionRequest[]),
      save: jest.fn(),
    };
    driverRepo = { findOne: jest.fn().mockResolvedValue(null) };
    productRepo = { find: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ShipmentService,
        { provide: getRepositoryToken(Shipment), useValue: shipmentRepo },
        {
          provide: getRepositoryToken(CollectionRequest),
          useValue: requestRepo,
        },
        { provide: getRepositoryToken(CollectorProfile), useValue: driverRepo },
        {
          provide: getRepositoryToken(TruckAssignmentEntity),
          useValue: {},
        },
        { provide: getRepositoryToken(TruckHandover), useValue: {} },
        { provide: getRepositoryToken(Warehouse), useValue: {} },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: DispatchGatewayEvents, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(ShipmentService);
  });

  it('accepts the bare shipment UUID', async () => {
    const load = await service.getShipmentForReception(
      SHIPMENT_ID,
      WAREHOUSE_ID,
    );
    expect(load.backend_shipment_id).toBe(SHIPMENT_ID);
    expect(shipmentRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SHIPMENT_ID } }),
    );
  });

  it('accepts the DAWRHA-DRIVER-prefixed shipment UUID', async () => {
    const load = await service.getShipmentForReception(
      `DAWRHA-DRIVER:${SHIPMENT_ID}`,
      WAREHOUSE_ID,
    );
    expect(load.backend_shipment_id).toBe(SHIPMENT_ID);
  });

  it.each([
    `DAWRHA-DRIVER:${DRIVER_ID}`,
    DRIVER_ID,
  ])('resolves the driver QR %s to the driver current shipment', async (ref) => {
    driverRepo.findOne.mockResolvedValue({ id: DRIVER_ID });
    shipmentRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(shipment);

    const load = await service.getShipmentForReception(ref, WAREHOUSE_ID);
    expect(load.driver_name).toBe('Saeed');
    const fallback = shipmentRepo.findOne.mock.calls[1][0];
    expect(fallback.where).toMatchObject({ driverId: DRIVER_ID });
    expect((fallback.where as any).status._value).toEqual([
      ShipmentStatus.IN_TRANSIT,
      ShipmentStatus.DELIVERED,
    ]);
    expect(fallback.order).toEqual({ departedAt: 'DESC' });
  });

  it('does not fall back to an arbitrary shipment when the uuid is unknown', async () => {
    driverRepo.findOne.mockResolvedValue(null);
    shipmentRepo.findOne.mockReset();
    shipmentRepo.findOne.mockResolvedValue(null);
    await expect(
      service.getShipmentForReception(DRIVER_ID, WAREHOUSE_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Exactly one lookup (as a shipment) — no unscoped second try.
    expect(shipmentRepo.findOne).toHaveBeenCalledTimes(1);
    expect(shipmentRepo.findOne.mock.calls[0][0].where).toEqual({
      id: DRIVER_ID,
    });
  });

  it('reads a non-UUID QR as a clean not-found', async () => {
    await expect(
      service.getShipmentForReception('DAWRHA-DRIVER:not-a-uuid', WAREHOUSE_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getShipmentForReception('', WAREHOUSE_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(shipmentRepo.findOne).not.toHaveBeenCalled();
  });

  it('keeps the warehouse isolation guard for both formats', async () => {
    await expect(
      service.getShipmentForReception(`DAWRHA-DRIVER:${SHIPMENT_ID}`, 'other'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getShipmentForReception(SHIPMENT_ID, 'other'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
