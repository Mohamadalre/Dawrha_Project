import { SetMetadata } from '@nestjs/common';
import { AccountStatus } from '@src/user/enums/account-status.enum';

export const ACCOUNTSTATUS_KEY = 'accountStatus';

/**
 * Every status that can be holding a token.
 *
 * For routes that belong to the SESSION rather than to the business: logging
 * out, setting the device language, reading notifications. Whoever holds a
 * token must be able to reach these, or the fail-closed rule turns into a trap
 * — and it did:
 *
 *   • logout became ACTIVE-only, so an applicant could sign in and not sign out;
 *   • so did the notification routes, which is worse than it sounds, because
 *     the notifications an inactive account receives are precisely the ones
 *     about its own application — "approved", "rejected", "please re-upload".
 *     Delivering a message only to a status forbidden from reading it is not a
 *     restriction, it is a dead letter.
 *
 * BLOCKED is deliberately absent: it is issued no token at all, and the guard
 * refuses it before any list is consulted.
 */
export const TOKEN_HOLDING_STATUSES = [
  AccountStatus.ACTIVE,
  AccountStatus.PENDING_PROFILE,
  AccountStatus.PENDING_APPROVAL,
  AccountStatus.NEED_CHANGES,
  AccountStatus.REJECTED,
] as const;
export const AccountsStatus = (...accountStatus: AccountStatus[]) => SetMetadata(ACCOUNTSTATUS_KEY, accountStatus);
