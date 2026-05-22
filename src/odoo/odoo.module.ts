import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OdooService } from './odoo.service';

@Module({
  imports: [HttpModule],
  providers: [OdooService],
  exports: [OdooService],
})
export class OdooModule {}