import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OdooService } from './odoo.service';

@Module({
  imports: [
    // Bounded timeout so a hung Odoo instance can never block a request/worker
    // indefinitely; no redirects on RPC calls.
    HttpModule.register({
      timeout: 10_000,
      maxRedirects: 0,
    }),
  ],
  providers: [OdooService],
  exports: [OdooService],
})
export class OdooModule {}