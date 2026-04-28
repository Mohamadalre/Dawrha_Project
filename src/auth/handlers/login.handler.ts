import { Account } from "@src/user/entities/account.entity";


export interface LoginHandler {
    handle(account: Account,dto?:any): Promise<any>;
}