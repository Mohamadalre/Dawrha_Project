
import { OAuth2Client } from 'google-auth-library';
import * as dotenv from 'dotenv';




dotenv.config();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
export async function verifyGoogleToken(idToken: string) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload:any = ticket.getPayload();

  if (!payload.email_verified) {
    throw new Error('Email not verified');
  }

  return {
    email: payload.email,
    name: payload.name,
    googleId: payload.sub,
    picture: payload.picture,

  };
}