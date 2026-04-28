import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { LoginHandler } from "./login.handler";
import { AuthService } from "../auth.service";
import { Account } from "@src/user/entities/account.entity";
import { DeviceDto } from "../dto/auth.dto";

@Injectable()
export class ActiveHandler implements LoginHandler {
    constructor(
        @Inject(forwardRef(() => AuthService))
        private readonly authService: AuthService,
    ) {}

    async handle(account: Account, dto: DeviceDto) {
        const token = await this.authService.generateTokens(
            account.id,
            account.role,
            account.accountStatus,
            dto.deviceId,
            dto.deviceType,
            dto.fcmToken

        );
        return {
            status: 'ACTIVE_ACCOUNT',
            token
        }


    }
}