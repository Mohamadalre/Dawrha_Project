import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AccountProgress } from './entities/account-progress.entity';
import { Account } from '@src/user/entities/account.entity';
import { ONBOARDING_STEPS } from './config/onboarding.config';
import { InjectRepository } from '@nestjs/typeorm';
import { LocationDto } from './dto/location.dto';
import { Province } from '@src/user/entities/location/province.entity';
import { ProfileResolver } from '@src/user/providers/profile-resolver.privder';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { AuthService } from '@src/auth/auth.service';
import { InformationInstitutionDTo, WasteInstitutionDTo } from './dto/institutions-onboarding.dto';
import { profile } from 'console';
import { InstitutionProfile } from '@src/user/entities/profile/institution-profile.entity';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(AccountProgress)
    private progressRepo: Repository<AccountProgress>,
    private readonly resolver: ProfileResolver,
    @InjectRepository(Province)
    private readonly provinceRepo: Repository<Province>,
    @InjectRepository(Account)
    private readonly acccountRepo: Repository<Account>,
    @InjectRepository(InstitutionProfile)
    private readonly institutionPro: Repository<InstitutionProfile>
  ) { }

  async getCurrentStep(account: Account) {
    const steps = ONBOARDING_STEPS[account.role] || [];


    if (!steps.length) return null;

    const progress = await this.progressRepo.findOne({
      where: { accountId: account.id },
    });


    if (!progress) {
      return steps[0] || null;
    }

    const nextStep = steps.find(
      (step) => !progress.completedSteps.includes(step),
    );

    return nextStep || null;
  }

  async addLocation(dto: LocationDto, profile: any, role: Role, account: any) {
    const step = await this.getCurrentStep(account!)
    if (step !== 'location') {
      throw new ForbiddenException('You cannot add location data,you must add data from the previous');
    }
    const [lng, lat] = dto.coordinates;
    const province = await this.provinceRepo.findOne({ where: { id: dto.provinceId } })
    if (!province) {
      throw new BadRequestException('province invaild')
    }

    profile.coordinates = { type: 'Point', coordinates: [lng, lat] };
    profile.address = dto.address;
    profile.DesscriptLocation = dto.descriptionAddress;
    profile.province = province;
    await this.resolver.getRepo(role).save(profile);
    await this.completeStep(account, 'location')
    const getnextStep = await this.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', }
  }

  async completeStep(account: Account, stepInp: string) {
    const steps = ONBOARDING_STEPS[account.role] || [];

    let progress = await this.progressRepo.findOne({
      where: { accountId: account.id },
    });


    if (!progress) {
      let newprog = this.progressRepo.create({
        account: account,
        accountId: account.id
      })

      stepInp === steps[0] ? newprog.completedSteps.push[stepInp] : newprog.completedSteps = [];
      await this.progressRepo.save(newprog);
      return steps[0];
    }

    const nextStep = steps.find(
      (step) => !progress.completedSteps.includes(step),
    );
    nextStep === stepInp ? progress.completedSteps.push(stepInp) : nextStep
    await this.progressRepo.save(progress)

    return nextStep;
  }


  async getStep(account: Account, stepInp: string) {
    const steps = ONBOARDING_STEPS[account.role] || [];

    let progress = await this.progressRepo.findOne({
      where: { accountId: account.id },
    });


    if (!progress) {
      let newprog = this.progressRepo.create({
        account: account,
        accountId: account.id
      })

      stepInp === steps[0] ? newprog.completedSteps.push[stepInp] : newprog.completedSteps = [];
      await this.progressRepo.save(newprog);
      return steps[0];
    }

    const nextStep = steps.find(
      (step) => !progress.completedSteps.includes(step),
    );
    nextStep === stepInp ? progress.completedSteps.push(stepInp) : nextStep
    await this.progressRepo.save(progress)

    return nextStep;
  }

  async addInformationInstitutionSer(dto: InformationInstitutionDTo, userId: string, file: Express.Multer.File) {
    const account = await this.acccountRepo.findOne({ where: { id: userId } })
    const step = await this.getCurrentStep(account!)
    if (step !== 'information') {
      throw new ForbiddenException('You cannot add information data,you must add data from the previous');
    }
    const information = this.institutionPro.create({
      institutionName: dto.institutionName,
      institutionPhone: dto.landlinePhone,
      institutionType: dto.institutionType,
      institutionSlogo: `image/uploads/logos/${file.filename}`,
      taxNumber: dto.taxNumber,
      licenseNumber: dto.licenseNumber
    })
    await this.institutionPro.save(information);
    await this.completeStep(account!, 'information')
    const getnextStep = await this.getCurrentStep(account!)
    if (getnextStep === null) {
      await this.acccountRepo.update(account!.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', }
  }

  async addMaterialInstitutionSer(dto: WasteInstitutionDTo, profile: any, account: any) {
    const step = await this.getCurrentStep(account)
    if (step !== 'materials') {
      throw new ForbiddenException('You cannot add materials data,you must add data from the previous');
    }
    profile.wasteType = dto.wasteType
    profile.preferredCollectionTime = dto.preferredCollectionTime;
    profile.estimatedWasteQuantity = dto.estimatedWasteQuantity;
    profile.collectionFrequney = dto.collectionFrequney;
    await this.resolver.getRepo('INSITUTIONS').save(profile)
    await this.completeStep(account, 'materials')
    const getnextStep = await this.getCurrentStep(account)
    if (getnextStep === null) {
      await this.acccountRepo.update(account!.id, { accountStatus: AccountStatus.PENDING_APPROVAL });
      return { status: 'Your request has been sent,wait for it to be approved' }
    }
    return { status: 'Please enter the information in the following stage', }
  }

}
