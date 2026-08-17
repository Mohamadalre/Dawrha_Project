import { OnboardingSubmissionService } from './onboarding-submission.service';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';

/**
 * The materials block is shaped to the ROLE — never a union of every role's
 * fields. This is the bug the user hit: "editing at an institution showed the
 * factory's details." An institution describes a PICKUP; a factory / free
 * facility describes an ORDER. Each must see ONLY its own fields.
 *
 * Driven through the real `getSubmission` so the role → config → mapMaterials
 * wiring is what is under test, not a hand-called mapper.
 */
describe('OnboardingSubmissionService — per-role material separation', () => {
  const INSTITUTION_FIELDS = [
    'estimated_waste_quantity',
    'collection_frequency',
    'preferred_collection_time',
  ];
  // A factory arranges a delivery: quantity + preference + detailed windows.
  const FACTORY_FIELDS = [
    'average_order_quantity',
    'delivery_preference',
    'delivery_time_slots',
  ];
  // Retired from BOTH buyer roles — must never resurface.
  const RETIRED_ORDER_FIELDS = [
    'estimation_order_schedule',
    'preferred_delivery_schedule',
  ];

  const build = (role: Role, profile: any) => {
    const accountRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'acc-1',
        name: 'Test',
        email: 't@x.com',
        phone: null,
        role,
        accountStatus: AccountStatus.PENDING_APPROVAL,
      }),
    };
    const profileRepo = { findOne: jest.fn().mockResolvedValue(profile) };
    const resolver = { getRepo: jest.fn().mockReturnValue(profileRepo) };
    const mediaRepo = { find: jest.fn().mockResolvedValue([]) };

    const svc = new OnboardingSubmissionService(
      accountRepo as any,
      {} as any, // provinceRepo
      mediaRepo as any,
      {} as any, // institutionTypeRepo
      {} as any, // shiftRepo
      {} as any, // wasteCategoryRepo
      resolver as any,
      {} as any, // cloudinary
      {} as any, // odooSync
      {} as any, // applicationsCache
    );
    return svc;
  };

  it('an INSTITUTION sees only pickup fields — no factory/order fields', async () => {
    const svc = build(Role.INSTITUTIONS, {
      id: 'inst-1',
      institutionName: 'Green Co',
      materialInputs: {
        id: 'm-1',
        wasteTypes: [],
        estimatedWasteQuantity: '500',
        collectionFrequney: 'WEEKLY',
        preferredCollectionTime: [{ day: 'MONDAY', from: '08:00', to: '12:00' }],
        // Even if the row somehow carried order fields, they must NOT surface.
        averageOrderQuantity: 'LEAKED',
      },
    });

    const res: any = await svc.getSubmission('acc-1', Role.INSTITUTIONS);

    for (const f of INSTITUTION_FIELDS) expect(res.materials).toHaveProperty(f);
    for (const f of FACTORY_FIELDS) expect(res.materials).not.toHaveProperty(f);
    expect(res.materials.estimated_waste_quantity).toBe('500');
  });

  it('a FACTORY sees quantity + preference + detailed windows — not pickup or retired fields', async () => {
    const svc = build(Role.FACTORY, {
      id: 'fac-1',
      factoryName: 'Acme',
      factoryMaterial: {
        id: 'm-2',
        wasteTypes: [],
        averageOrderQuantity: '2000',
        deliveryPreference: true,
        deliveryTimeSlots: [{ day: 'MONDAY', from: '08:00', to: '12:00' }],
        estimatedWasteQuantity: 'LEAKED',
      },
    });

    const res: any = await svc.getSubmission('acc-1', Role.FACTORY);

    for (const f of FACTORY_FIELDS) expect(res.materials).toHaveProperty(f);
    for (const f of INSTITUTION_FIELDS) expect(res.materials).not.toHaveProperty(f);
    for (const f of RETIRED_ORDER_FIELDS) expect(res.materials).not.toHaveProperty(f);
    expect(res.materials.average_order_quantity).toBe('2000');
    expect(res.materials.delivery_time_slots).toEqual([
      { day: 'MONDAY', from: '08:00', to: '12:00' },
    ]);
  });

  it('an EXTERNAL_PARTNER (free facility) sees ONLY quantity — not delivery, pickup, or retired fields', async () => {
    const svc = build(Role.EXTERNAL_PARTNER, {
      id: 'ext-1',
      externalPartnerName: 'FreeFac',
      externalPartnerMaterial: {
        id: 'm-3',
        wasteTypes: [],
        averageOrderQuantity: '750',
      },
    });

    const res: any = await svc.getSubmission('acc-1', Role.EXTERNAL_PARTNER);

    expect(res.materials).toHaveProperty('average_order_quantity');
    // A free facility has NO delivery preference or windows (factory-only now).
    expect(res.materials).not.toHaveProperty('delivery_preference');
    expect(res.materials).not.toHaveProperty('delivery_time_slots');
    for (const f of INSTITUTION_FIELDS) expect(res.materials).not.toHaveProperty(f);
    for (const f of RETIRED_ORDER_FIELDS) expect(res.materials).not.toHaveProperty(f);
  });
});
