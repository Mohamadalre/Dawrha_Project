import { SetMetadata } from '@nestjs/common';
import { AccountStatus } from '@src/user/enums/account-status.enum';

export const ACCOUNTSTATUS_KEY = 'accountStatus';
export const AccountsStatus = (...accountStatus: AccountStatus[]) => SetMetadata(ACCOUNTSTATUS_KEY, accountStatus);
