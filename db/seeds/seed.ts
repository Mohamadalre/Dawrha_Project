import { Permission } from "@src/permission/entities/permission.entity";
import { RolePermission } from "@src/permission/entities/role-permission.entity";
import { ROLE_PERMISSIONS } from "./role-permissions.config";
import { Role } from "@src/user/enums/role.enum";
import { DataSource } from "typeorm";

export async function seed(dataSource: DataSource) {
    const permissionRepo = dataSource.getRepository(Permission);
    const rolePermissionRepo = dataSource.getRepository(RolePermission);


    const allPermissions = new Set<string>();

    Object.values(ROLE_PERMISSIONS).forEach(perms => {
        perms.forEach(p => {
            if (p !== '*') allPermissions.add(p);
        });
    });

    for (const key of allPermissions) {
        const exists = await permissionRepo.findOne({ where: { key } });
        if (!exists) {
            await permissionRepo.save({ key });
        }
    }

    const permissions = await permissionRepo.find();

    const permissionMap = new Map(
        permissions.map(p => [p.key, p]),
    );


    for (const role of Object.keys(ROLE_PERMISSIONS)) {
        const perms = ROLE_PERMISSIONS[role];

        const finalPerms =
            perms.includes('*')
                ? permissions
                : perms.map(p => permissionMap.get(p));

        for (const perm of finalPerms) {
            const exists = await rolePermissionRepo.findOne({
                where: {
                    role: role as Role,
                    permission: { id: perm.id },
                },
            });

            if (!exists) {
                await rolePermissionRepo.save({
                    role: role as Role,
                    permission: perm,
                });
            }
        }
    }

    console.log('Seed completed (Professional)');
}