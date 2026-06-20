/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable } from "@nestjs/common";
import { LoginHandler } from "./login.handler";
import { Account } from "@src/user/entities/account.entity";
import { DeviceDto } from "../dto/auth.dto";



@Injectable()
export class InactiveHandler implements LoginHandler {
    constructor() { }
    async handle(account: Account, dto: DeviceDto) {

        return {
            status: 'NoActive_ACCOUNT'


        };
    }
}