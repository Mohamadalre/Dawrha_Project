import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateWasteCategory } from './dto/waste-category.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { WasteCategory } from './entities/waste-category.entity';
import { Repository } from 'typeorm';

@Injectable()
export class WasteManagementService {
    constructor(
        @InjectRepository(WasteCategory)
        private readonly repo:Repository<WasteCategory>
    ){}
  async create(dto: CreateWasteCategory) {
        const exist = await this.repo.findOne({ where: { name: dto.name } });
        if (exist) throw new BadRequestException('Waste category already exists');

        const type = this.repo.create(dto);
        return await this.repo.save(type);
    }

async findAll(page = 1, limit = 10) {
  return await this.repo.find({
    skip: (page - 1) * limit,
    take: limit,
    select:{
        id:true,
        name:true,
    }
  });
}
}

