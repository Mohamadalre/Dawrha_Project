import { CanActivate, ForbiddenException, Injectable, NotFoundException, ExecutionContext } from "@nestjs/common";
import { ProfileResolver } from "@src/user/providers/profile-resolver.privder";
import { Role } from "@src/user/enums/role.enum";
import { OnboardingService } from "../onboarding.service";

@Injectable()
export class ProfileOwnerGuard implements CanActivate {
    constructor(
        private resolver: ProfileResolver,
        private readonly onboardingService: OnboardingService
    ) { }


    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();

        const account = req.user;
        const profileId = req.params.profileId;
        if (account.role == Role.CITIZEN) {
            throw new ForbiddenException('You are not allowed');
        }
        const repo = this.resolver.getRepo(account.role);

        const profile = await repo.findOne({
            where: { id: profileId },
        });

        if (!profile) {
            throw new NotFoundException('Profile not found');
        }

        if (profile.account !== account.id) {
            throw new ForbiddenException('Not your profile');
        }

        req.profile = profile;
        

        return true;
    }
}