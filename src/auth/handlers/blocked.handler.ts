/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from "@nestjs/common";
import { LoginHandler } from "./login.handler";
import { Account } from "@src/user/entities/account.entity";
import { DeviceDto } from "../dto/auth.dto";



@Injectable()
export class BlockedHandler implements LoginHandler {
    constructor() { }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async handle(account: Account, dto: DeviceDto) {
        return {
            status: 'BLOCKED_ACCOUNT'


        };
    }
}