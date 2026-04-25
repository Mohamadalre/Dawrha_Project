import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionCacheProvider } from "../permission-cache.provider";
import { PermissionsService } from "../permissions.service";


@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private cache: PermissionCacheProvider,
        private readonly permissionsService:PermissionsService
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const required = this.reflector.get<string[]>(
            'permissions',
            context.getHandler(),
        );

        if (!required) return true;

        const req = context.switchToHttp().getRequest();
        const user = req.user;

        let permissions = await this.cache.get(user.id);


        if (!permissions) {
            const rows = await this.permissionsService.getPermissionsByRole(user.role);

            permissions = rows.map(r => r.permission.key);


            await this.cache.set(user.id, permissions);
        }


        const allowed = required.every(p =>
            permissions.includes(p),
        );

        if (!allowed) {
            throw new ForbiddenException('No Permission');
        }

        return true;
    }
}