import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateWasteCategory } from './dto/waste-category.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { WasteCategory } from './entities/waste-category.entity';
import { Repository } from 'typeorm';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';

/**
 * Service for managing waste categories
 * Handles creation and retrieval of waste category data
 */
@Injectable()
export class WasteManagementService {
  constructor(
    @InjectRepository(WasteCategory)
    private readonly repo: Repository<WasteCategory>,
    private readonly cloudinaryService: CloudinaryService,
  ) { }
  /**
   * Creates a new waste category
   *
   * @param dto - Waste category creation data
   * @returns The created waste category
   * @throws BadRequestException if waste category already exists
   */
  async create({ name }: CreateWasteCategory, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('image category is required')

    const exist = await this.repo.findOne({ where: { name: name } });
    if (exist) throw new BadRequestException('Waste category already exists');


    try {
      const folder = `waste-category/`;
      const imageURL = await this.cloudinaryService.uploadLogo(file, folder);
      const category = this.repo.create({
        name: name,
        imageCategoryURL: imageURL

      });
      return await this.repo.save(category);
    } catch (error: any) {
      throw error;
    }
  }


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

