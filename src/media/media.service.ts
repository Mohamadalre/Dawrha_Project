// src/media/media.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Media, MediaType, OwnerType } from './entities/media.entity';

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(Media)
    private readonly mediaRepository: Repository<Media>,
  ) {}

  async saveFileData(
    url: string,
    ownerId: string,
    ownerType: OwnerType,
    fileType: MediaType,
  ) {
    const media = this.mediaRepository.create({
      url,
      ownerId,
      ownerType,
      fileType,
    });
    return await this.mediaRepository.save(media);
  }


  async findByOwner(ownerId: string, ownerType: OwnerType) {
    return await this.mediaRepository.find({
      where: { ownerId, ownerType },
    });
  }
}