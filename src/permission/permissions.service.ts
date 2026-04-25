import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Role } from '@src/user/enums/role.enum';
import { RolePermission } from './entities/role-permission.entity';
import { Repository } from 'typeorm';

@Injectable()
export class PermissionsService {
    constructor(@InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>) { }
    async getPermissionsByRole(role: Role) {
        return this.rolePermissionRepo.find({
            where: { role },
            relations: ['permission'],
        });
    }
}
