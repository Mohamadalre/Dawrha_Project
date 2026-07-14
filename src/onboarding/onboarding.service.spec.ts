import { AccountStatus } from '@src/user/enums/account-status.enum';
import { OnboardingService } from './onboarding.service';

/**
 * Unit tests for the centralized onboarding behaviour: marking an account as
 * pending approval must both update the status AND notify the user.
 */
describe('OnboardingService.markPendingApproval', () => {
  let service: OnboardingService;
  let accountRepo: any;
  let statusNotifier: any;

  beforeEach(() => {
    accountRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }), findOne: jest.fn().mockResolvedValue({ id: 'a1', role: 'citizen' }) };
    statusNotifier = { notifyPendingApproval: jest.fn().mockResolvedValue(undefined) };

    const noop: any = {};
    service = new OnboardingService(
      noop, // progressRepo
      noop, // resolver
      noop, // provinceRepo
      accountRepo, // acccountRepo
      noop, // wasteCategoryRepo
      noop, // commonService
      noop, // cloudinaryService
      statusNotifier, // statusNotifier
      { enqueuePushDriverRequest: jest.fn() } as any, // odooSync
    );
  });

  it('sets the account to PENDING_APPROVAL and sends a notification', async () => {
    // markPendingApproval is protected — exercise it via a cast.
    await (service as any).markPendingApproval('acc1');

    expect(accountRepo.update).toHaveBeenCalledWith('acc1', {
      accountStatus: AccountStatus.PENDING_APPROVAL,
    });
    expect(statusNotifier.notifyPendingApproval).toHaveBeenCalledWith('acc1');
  });
});
