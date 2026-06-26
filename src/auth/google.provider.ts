import { OAuth2Client } from 'google-auth-library';
import { UnauthorizedException } from '@nestjs/common';
import * as dotenv from 'dotenv';
import { winstonLogger } from '@src/core/logger-config/winston.config';

dotenv.config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export async function verifyGoogleToken(idToken: string) {
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload: any = ticket.getPayload();

    if (!payload || !payload.email_verified) {
      throw new UnauthorizedException('Google account email is not verified.');
    }

    return {
      email: payload.email,
      name: payload.name,
      googleId: payload.sub,
      picture: payload.picture,
    };
  } catch (error: any) {

    winstonLogger.error('Google Error', {
      context: 'GoogleProvider',
      channel: 'error',
      stack: error?.stack,
      metadata: {
        message: error?.message,
      },
    })
    if (
      error.message?.includes('Token used too late') ||
      error.message?.includes('expired')
    ) {
      throw new UnauthorizedException('Google ID token has expired.');
    }

    throw new UnauthorizedException('Invalid Google ID token.');
  }
}