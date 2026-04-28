import { Injectable } from "@nestjs/common";
import { LoginHandler } from "./login.handler";
import { Account } from "@src/user/entities/account.entity";
import { DeviceDto } from "../dto/auth.dto";



@Injectable()
export class NeedChangeHandler implements LoginHandler {
    constructor() { }
    async handle(account: Account, dto: DeviceDto) {
   
        return {
            status: 'NEED_CHANGE'
           

        };
    }
}