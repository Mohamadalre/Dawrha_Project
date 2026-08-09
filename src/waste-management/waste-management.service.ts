import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WasteCategory } from './entities/waste-category.entity';
import { Repository } from 'typeorm';

/**
 * Read side of waste categories (the onboarding pickers). Category CREATE /
 * UPDATE / DELETE are owned by the admin catalogue service.
 */
@Injectable()
export class WasteManagementService {
  constructor(
    @InjectRepository(WasteCategory)
    private readonly repo: Repository<WasteCategory>,
  ) { }

  /**
   * Deletes a  waste category
   *
   * @param id - Waste category id
   * @returns The deleted waste category name
   * @throws NotFoundException if waste category not found
   */
  async delete(id: string) {

    const exist = await this.repo.findOne({ where: { id: id } });
    if (!exist) throw new NotFoundException('Waste category not found');
    await this.repo.delete(exist.id);
    return exist.name;

  }

  /**
   * Gets a paginated list of ACTIVE waste categories — id and name only.
   *
   * Only active categories are returned: a category the admin has deactivated
   * must disappear from the pickers that buyers/sellers choose from, and an
   * active one the admin adds must appear here. The projection is deliberately
   * id + name (the minimum a selector needs), nothing else.
   *
   * @param page - Page number (default 1)
   * @param limit - Number of items per page (default 10)
   * @returns List of active waste categories with id and name
   */
  async findAllName(page = 1, limit = 10) {
    return await this.repo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name: true,
      }
    });
  }




    /**
   * Gets a paginated list of waste categories 
   *
   * @param page - Page number (default 1)
   * @param limit - Number of items per page (default 10)
   * @returns List of waste categories with id and name and image
   */
  async findAll(page = 1, limit = 10,) {
    return await this.repo.find({
      skip: (page - 1) * limit,
      take: limit,
      // where:{In()},
      select: {
        id: true,
        name: true,
        imageCategoryURL:true
      }
    });
  }
}

