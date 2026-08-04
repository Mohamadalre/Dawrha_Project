/**
 * Does the application actually START?
 *
 * `tsc` proves the types line up and the unit tests construct services by hand
 * — neither of them ever asks Nest to build the dependency graph. So a provider
 * a service takes but no module registers passes both and then refuses to boot,
 * which is exactly what happened: `ProvinceRepository` was missing from
 * `WarehouseModule` for as long as the governorate rule has existed.
 *
 * Creating the application CONTEXT resolves every module and provider without
 * binding a port or starting the HTTP server, so it is safe to run anywhere.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@src/app.module';

NestFactory.createApplicationContext(AppModule, { logger: ['error'] })
  .then(async (app) => {
    await app.close();
    console.log('\nBOOT OK — every provider resolved');
    process.exit(0);
  })
  .catch((e) => {
    console.error('\nBOOT FAILED:', e?.message ?? e);
    process.exit(1);
  });
