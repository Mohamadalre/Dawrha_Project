import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InstitutionType } from './entities/institution-type.entity';
import { Repository } from 'typeorm';
import { CreateInstitutionTypeDto } from './dto/Institution-type.dto';

/**
 * Service for managing institution types
 * Handles creation and retrieval of institution type data
 */
@Injectable()
export class InstitutionService {
    constructor(
        @InjectRepository(InstitutionType)
        private readonly repo: Repository<InstitutionType>

    ) { }
    /**
     * Creates a new institution type
     *
     * @param dto - Institution type creation data
     * @returns The created institution type
     * @throws BadRequestException if institution type already exists
     */
    async create(dto: CreateInstitutionTypeDto) {
        const exist = await this.repo.findOne({ where: { name: dto.name } });
        if (exist) throw new BadRequestException('Institution type already exists');
        const type = this.repo.create(dto);
        return await this.repo.save(type);

    }

    /**
     * Gets a paginated list of institution types
     *
     * @param page - Page number (default 1)
     * @param limit - Number of items per page (default 10)
     * @returns List of institution types with id and name
     */
    async findAll(page = 1, limit = 10) {
        return await this.repo.find({
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                name: true,
            }
        });
    }
}
