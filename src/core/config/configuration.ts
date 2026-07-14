import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number(),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number(),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number(),
  REDIS_PASSWORD: Joi.string().allow('', null).optional(),
  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_TEMPORARY_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().required(),
  JWT_REFRESH_DEFAULT_EXPIRATION: Joi.string().required(),
  JWT_REFRESH_REMEMBER_ME_EXPIRATION: Joi.string().required(),
  JWT_TEMPORARY_EXPIRATION: Joi.string().required(),

  // External integrations — validated up-front so a misconfigured deployment
  // fails fast at boot instead of at the first request that touches them.
  ODOO_URL: Joi.string().uri().required(),
  ODOO_DB: Joi.string().required(),
  ODOO_USERNAME: Joi.string().required(),
  ODOO_PASSWORD: Joi.string().required(),
  ODOO_GROUP_ID: Joi.number().required(),
  // Shared secret for the inbound Odoo→backend inventory webhook. Optional:
  // when unset the webhook endpoint refuses requests (503).
  ODOO_WEBHOOK_SECRET: Joi.string().min(32).optional(),

  GOOGLE_CLIENT_ID: Joi.string().required(),

  FIREBASE_PROJECT_ID: Joi.string().required(),
  FIREBASE_CLIENT_EMAIL: Joi.string().required(),
  FIREBASE_PRIVATE_KEY: Joi.string().required(),

  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),

  MAIL_HOST: Joi.string().required(),
  MAIL_PORT: Joi.number().required(),
  MAIL_USER: Joi.string().required(),
  MAIL_PASS: Joi.string().required(),
  MAIL_FROM: Joi.string().required(),
});

export const configuration = () => ({
  env: process.env.NODE_ENV,
  port: parseInt(process.env.PORT || '3000', 10),
  database: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME,
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION,
    refreshExpiration: process.env.JWT_REFRESH_DEFAULT_EXPIRATION || process.env.JWT_REFRESH_REMEMBER_ME_EXPIRATION,
  },
});
