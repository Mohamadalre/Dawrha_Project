import { BadRequestException } from '@nestjs/common';
import { OnboardingSubmissionService } from './onboarding-submission.service';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { Role } from '@src/user/enums/role.enum';

/**
 * Editing a location is a CHANGE to something that exists — so a location must
 * have been added first. The location step writes the coordinates, so their
 * absence is the proof it was never done, and the edit is refused with a clear
 * "add it first" rather than silently creating one through the edit route.
 */
describe('OnboardingSubmissionService — edit-location requires a location', () => {
  const build = (profile: any, status = AccountStatus.PENDING_PROFILE) => {
    const accountRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'acc-1', accountStatus: status }),
    };
    const profileRepo = {
      findOne: jest.fn().mockResolvedValue(profile),
      save: jest.fn(async (p) => p),
    };
    const resolver = { getRepo: () => profileRepo };
    const provinceRepo = { findOne: jest.fn() };
    const applicationsCache = { invalidate: jest.fn() };
    const odooSync = { enqueuePushDriverRequest: jest.fn() };

    const service = new OnboardingSubmissionService(
      accountRepo as any,
      provinceRepo as any,
      {} as any, // mediaRepo
      {} as any, // institutionTypeRepo
      {} as any, // shiftRepo
      {} as any, // wasteCategoryRepo
      resolver as any,
      {} as any, // cloudinary
      odooSync as any,
      applicationsCache as any,
    );
    return { service, profileRepo };
  };

  it('refuses to edit the location when none was added yet (no coordinates)', async () => {
    const { service, profileRepo } = build({ id: 'p1', coordinates: null });

    await expect(
      service.updateLocation('acc-1', Role.FACTORY, { address: 'New St' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Nothing was written — the edit never reached a save.
    expect(profileRepo.save).not.toHaveBeenCalled();
  });

  it('allows the edit once a location exists (coordinates present)', async () => {
    const { service, profileRepo } = build({
      id: 'p1',
      coordinates: { type: 'Point', coordinates: [36.2, 33.5] },
      province: null,
    });

    const res: any = await service.updateLocation('acc-1', Role.FACTORY, {
      address: 'Corrected St',
    });

    expect(profileRepo.save).toHaveBeenCalled();
    expect(res.location).toBeDefined();
  });
});
