/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { LoginHandler } from './login.handler';
import { Account } from '@src/user/entities/account.entity';
import { DeviceDto } from '../dto/auth.dto';

/**
 * Signing in to a blocked account.
 *
 * The `status` code stays, for clients that already branch on it. The message
 * is added because a bare `BLOCKED_ACCOUNT` left every app to invent its own
 * wording, and one of them will invent the wrong one.
 *
 * It says WHAT happened and WHERE TO GO, and nothing about why. The reason is
 * recorded on the account for the administrator alone: naming the signal that
 * caught somebody is the single most useful thing you could tell them if they
 * intend to try again. A human at support can explain as much as a human
 * decides to.
 */
@Injectable()
export class BlockedHandler implements LoginHandler {
  constructor() {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async handle(account: Account, dto: DeviceDto) {
    return {
      status: 'BLOCKED_ACCOUNT',
      message: 'Your account has been blocked. Please contact technical support.',
    };
  }
}
