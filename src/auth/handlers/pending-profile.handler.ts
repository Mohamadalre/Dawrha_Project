import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { LoginHandler } from "./login.handler";
import { AuthService } from "../auth.service";
import { Account } from "@src/user/entities/account.entity";
import { DeviceDto } from "../dto/auth.dto";
import { CommonService } from "@src/common/common.service";




@Injectable()
export class PendingProfileHandler implements LoginHandler {
    constructor(
        @Inject(forwardRef(() => AuthService))
        private readonly authService: AuthService,
        private readonly commonService: CommonService

    ) { }
    async handle(account: Account, dto: DeviceDto) {
         const step = await this.commonService.getCurrentStep(account);
        const token = await this.authService.generateTokens(
            account.id,
            account.role,
            account.accountStatus,
            dto.deviceId,
            dto.deviceType,
            dto.fcmToken

        );
        return {
            status: 'PENDING_PROFILE',
            token,
            step
            

        };
    }
}