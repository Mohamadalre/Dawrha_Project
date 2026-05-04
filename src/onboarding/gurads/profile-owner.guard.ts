import { CanActivate, ForbiddenException, Injectable, NotFoundException, ExecutionContext, BadRequestException } from "@nestjs/common";
import { ProfileResolver } from "@src/user/providers/profile-resolver.privder";
import { Role } from "@src/user/enums/role.enum";
import { OnboardingService } from "../onboarding.service";
import { InjectRepository } from "@nestjs/typeorm";
import { Account } from "@src/user/entities/account.entity";
import { Repository } from "typeorm";
import { isUUID } from "class-validator";

@Injectable()
export class ProfileOwnerGuard implements CanActivate {
    constructor(
        private resolver: ProfileResolver,
        @InjectRepository(Account)
        private readonly accountRep:Repository<Account>,
        private readonly onboardingService: OnboardingService
    ) { }


    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();

        const account = req.user;
        const profileId = req.params.profileId;
        if(!isUUID(req.params.profileId)){
            throw new BadRequestException('Invalid UUID')
        }

        
        if (account.role == Role.CITIZEN) {
            throw new ForbiddenException('You are not allowed');
        }
        const repo = this.resolver.getRepo(account.role);

        

        const profile = await repo.findOne({
            where: { id: profileId },
            relations:['account']
        });
        if (!profile) {
            throw new NotFoundException('Profile not found');
        }

        if (profile.account.id !==  account.id) {
            throw new ForbiddenException('Not your profile');
        }


        req.profile = profile;
    
        
     

        return true;
    }
}