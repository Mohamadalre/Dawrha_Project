import { Module } from "@nestjs/common";
import { CommonService } from "./common.service";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AccountProgress } from "@src/onboarding/entities/account-progress.entity";


@Module({
    imports: [TypeOrmModule.forFeature([AccountProgress])],
    providers: [CommonService],
    exports: [CommonService],
})
export class CommonModule { }