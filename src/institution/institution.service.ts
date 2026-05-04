import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InstitutionType } from './entities/institution-type.entity';
import { Repository } from 'typeorm';
import { CreateInstitutionTypeDto } from './dto/Institution-type.dto';

@Injectable()
export class InstitutionService {
    constructor(
        @InjectRepository(InstitutionType)
        private readonly repo: Repository<InstitutionType>

    ) { }
    async create(dto: CreateInstitutionTypeDto) {
        const exist = await this.repo.findOne({ where: { name: dto.name } });
        if (exist) throw new BadRequestException('Institution type already exists');
        const type = this.repo.create(dto);
        return await this.repo.save(type);

    }

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
