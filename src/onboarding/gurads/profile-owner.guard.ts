import { CanActivate, ForbiddenException, Injectable, NotFoundException, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ProfileResolver } from "@src/user/providers/profile-resolver.privder";
import { Role } from "@src/user/enums/role.enum";
import { OnboardingService } from "../onboarding.service";
import { InjectRepository } from "@nestjs/typeorm";
import { Account } from "@src/user/entities/account.entity";
import { Repository } from "typeorm";
import { AccountStatus } from "@src/user/enums/account-status.enum";


@Injectable()
export class ProfileOwnerGuard implements CanActivate {
    constructor(
        private resolver: ProfileResolver,
        @InjectRepository(Account)
        private readonly accountRep: Repository<Account>,
        private readonly onboardingService: OnboardingService
    ) { }


    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();

        const account = req.user;
        const accountProfile = await this.accountRep.findOne({ where: { id: account.id } })
        if(!accountProfile)
            throw new NotFoundException('Account not found');

        if (account.accountStatus !== AccountStatus.PENDING_PROFILE)
            throw new UnauthorizedException('Account is not pending profile completion');

        if (account.role == Role.CITIZEN || account.role == Role.ADMIN) {
            throw new ForbiddenException('You are not allowed');
        }
        const repo = this.resolver.getRepo(account.role);



        const profile = await repo.findOne({
            where: {account: { id: account.id }},
            relations: ['account']
        });

        if (!profile) {
            throw new NotFoundException('Profile not found');
        }

        if (profile.account.id !== account.id) {
            throw new ForbiddenException('Not your profile');
        }


        req.profile = profile;




        return true;
    }
}