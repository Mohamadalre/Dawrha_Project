import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InstitutionType } from './entities/institution-type.entity';
import { Not, Repository } from 'typeorm';
import { CreateInstitutionTypeDto, UpdateInstitutionTypeDto } from './dto/Institution-type.dto';
import { InstitutionProfile } from '@src/user/entities/profile/institution-profile.entity';

/**
 * Service for managing institution types.
 *
 * Full CRUD for the admin (create / update / delete / list); institutions get
 * the list only, and may read it while still onboarding (see the controller's
 * status decorator) so they can pick a type on the information step.
 */
@Injectable()
export class InstitutionService {
    constructor(
        @InjectRepository(InstitutionType)
        private readonly repo: Repository<InstitutionType>,
        @InjectRepository(InstitutionProfile)
        private readonly profileRepo: Repository<InstitutionProfile>,
    ) { }

    /**
     * Creates a new institution type.
     *
     * @param dto - Institution type creation data
     * @returns The created institution type
     * @throws BadRequestException if institution type already exists
     */
    async create(dto: CreateInstitutionTypeDto) {
        const name = dto.name.trim();
        const exist = await this.repo.findOne({ where: { name } });
        if (exist) throw new BadRequestException('Institution type already exists');
        const type = this.repo.create({ name });
        return await this.repo.save(type);
    }

    /**
     * Renames an institution type.
     *
     * @throws NotFoundException if the id does not exist
     * @throws BadRequestException if another type already carries the new name
     */
    async update(id: string, dto: UpdateInstitutionTypeDto) {
        const type = await this.repo.findOne({ where: { id } });
        if (!type) throw new NotFoundException('Institution type not found');

        const name = dto.name.trim();
        // A different row already holding this name would trip the UNIQUE index
        // and surface as a 500 — refuse it by name instead.
        const clash = await this.repo.findOne({ where: { name, id: Not(id) } });
        if (clash) throw new BadRequestException('Institution type already exists');

        type.name = name;
        const saved = await this.repo.save(type);
        return { id: saved.id, name: saved.name, updatedAt: saved.updatedAt };
    }

    /**
     * Deletes an institution type.
     *
     * Refused while any institution still points at it: the profile's `type_id`
     * is a foreign key, so deleting a referenced type would either fail as a
     * raw constraint 500 or orphan those institutions' type. The admin is told
     * how many use it so they can reassign first.
     */
    async remove(id: string) {
        const type = await this.repo.findOne({ where: { id } });
        if (!type) throw new NotFoundException('Institution type not found');

        const inUse = await this.profileRepo.count({ where: { institutionType: { id } } });
        if (inUse > 0) {
            throw new BadRequestException(
                `This institution type is used by ${inUse} institution(s) and cannot be deleted`,
            );
        }

        await this.repo.delete(id);
        return { id };
    }

    /**
     * Paginated list of institution types (id + name), newest first.
     *
     * @param page - Page number (default 1)
     * @param limit - Items per page (default 10)
     */
    async findAll(page = 1, limit = 10) {
        const safePage = Math.max(1, Math.floor(page) || 1);
        const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 10), 100);
        const [items, total] = await this.repo.findAndCount({
            order: { createdAt: 'DESC' },
            skip: (safePage - 1) * safeLimit,
            take: safeLimit,
            select: { id: true, name: true },
        });
        return {
            items,
            total,
            page: safePage,
            limit: safeLimit,
            total_pages: Math.ceil(total / safeLimit),
            has_next: safePage * safeLimit < total,
            has_prev: safePage > 1,
        };
    }
}
