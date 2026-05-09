import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateWasteCategory } from './dto/waste-category.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { WasteCategory } from './entities/waste-category.entity';
import { Repository } from 'typeorm';

/**
 * Service for managing waste categories
 * Handles creation and retrieval of waste category data
 */
@Injectable()
export class WasteManagementService {
    constructor(
        @InjectRepository(WasteCategory)
        private readonly repo:Repository<WasteCategory>
    ){}
  /**
   * Creates a new waste category
   *
   * @param dto - Waste category creation data
   * @returns The created waste category
   * @throws BadRequestException if waste category already exists
   */
  async create(dto: CreateWasteCategory) {
        const exist = await this.repo.findOne({ where: { name: dto.name } });
        if (exist) throw new BadRequestException('Waste category already exists');

        const type = this.repo.create(dto);
        return await this.repo.save(type);
    }

  /**
   * Gets a paginated list of waste categories
   *
   * @param page - Page number (default 1)
   * @param limit - Number of items per page (default 10)
   * @returns List of waste categories with id and name
   */
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

