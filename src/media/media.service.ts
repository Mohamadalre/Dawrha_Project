// src/media/media.service.ts
import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Media, MediaType, OwnerType } from './entities/media.entity';
import { OnboardingService } from '@src/onboarding/onboarding.service';
import { Account } from '@src/user/entities/account.entity';
import { CommonService } from '@src/common/common.service';
import { AccountStatus } from '@src/user/enums/account-status.enum';

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(Media)
    private readonly mediaRepository: Repository<Media>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly commonService: CommonService
  ) { }

  async saveFileData(
    url: string,
    ownerId: string,
    ownerType: OwnerType,
    fileType: MediaType,
    userId: string
  ) {

    const exist = await this.mediaRepository.find({ where: { ownerId, fileType } })
    if (exist.length !== 0) {
      throw new ForbiddenException(`You cannot add more than one photo to ${fileType}`)
    }
    const media = this.mediaRepository.create({
      url,
      ownerId,
      ownerType,
      fileType,
    });
    const data =await this.mediaRepository.save(media);
    const account = await this.accountRepository.findOne({ where: { id: userId } })
    await this.commonService.completeStep(account!, 'documents')
    const getnextStep = await this.commonService.getCurrentStep(account!)

    if (getnextStep === null) {
      await this.accountRepository.update(account!.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage',data }
  }
  




  async findByOwner(ownerId: string, ownerType: OwnerType) {
  return await this.mediaRepository.find({
    where: { ownerId, ownerType },
  });
}
}