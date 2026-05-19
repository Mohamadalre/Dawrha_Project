import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AccountStatus } from '@src/user/enums/account-status.enum';

const ALLOWED_STATUSES = [AccountStatus.ACTIVE, AccountStatus.NEED_CHANGES, AccountStatus.REJECTED, AccountStatus.BLOCKED];

export class UpdateAccountStatusDto {
  @IsIn(ALLOWED_STATUSES)
  @IsNotEmpty()
  status: AccountStatus;

  @IsOptional()
  @IsString()
  description?: string;
}


export class BlockedAccountStatusDto {
  @IsIn([AccountStatus.ACTIVE,AccountStatus.BLOCKED])
  @IsNotEmpty()
  status: AccountStatus;

  @IsOptional()
  @IsString()
  description?: string;
}