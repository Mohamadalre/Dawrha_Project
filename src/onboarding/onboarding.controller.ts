import { Controller, UseGuards, Post, Body, Param, Req, UseInterceptors, UploadedFile, ForbiddenException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { ProfileOwnerGuard } from './gurads/profile-owner.guard';
import { LocationDto } from './dto/location.dto';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { logoMulterConfig } from '@src/common/config/multer/logo.config';
import { imageFilter } from '@src/common/config/multer/image-filter';
import { InformationInstitutionDTo, WasteInstitutionDTo } from './dto/institutions-onboarding.dto';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { MediaService } from '@src/media/media.service';
import { Account } from '@src/user/entities/account.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { MediaDto } from './dto/media.dto';
import { CommonService } from '@src/common/common.service';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { AccountStatusGuard } from '@src/auth/guards/account-status.guard';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { InformationFactorynDTo, WasteFactoryDTo } from './dto/factory-onboarding.dto';
import { InformationExternalPartnerDTo, WasteExternalPartnerDTo } from './dto/external-partner-onboarding.dto';
import { InformationCollectorDTo } from './dto/collector-onboarding.dto';

@AccountsStatus(AccountStatus.PENDING_PROFILE)
@UseGuards(JwtAuthGuard, AccountStatusGuard, RolesGuard)
@Controller({
  path: 'onboarding',
  version: '1'
})
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly commomService: CommonService,
    private readonly mediaService: MediaService,
    @InjectRepository(Account)
    private readonly acccountRepo: Repository<Account>,
  ) { }

  @UseGuards(ProfileOwnerGuard)
  @Post('location/:profileId')
  public async createLocation(@Param('profilId') profileId: string, @Body() dto: LocationDto, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const role = req.user.role;
    if (role === Role.CITIZEN) {
      throw new ForbiddenException('You cannot add location')
    }
    const data = await this.onboardingService.addLocation(dto, role, profile, account)
    return { message: "add Location successfully", status: data }
  }

  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.COLLECTOR, Role.FACTORY, Role.INSITUTIONS)
  @Post('upload-Doc/:profileId')
  @UseInterceptors(
    FileInterceptor('file', {
      ...logoMulterConfig,
      fileFilter: imageFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('fileType') { fileType }: MediaDto,
    @Req() req
  ) {
    const role = req.user.role;
    const account = await this.acccountRepo.findOne({ where: { id: req.user } })
    const step = await this.commomService.getCurrentStep(account!)
    if (step !== 'documents') {
      throw new ForbiddenException('You cannot add documents data,you must add data from the previous');
    }
    const fileUrl = `image/uploads/${file.filename}`;
    return await this.mediaService.saveFileData(fileUrl, req.user, role, fileType);
  }



  @Post('institutions/information')
  @Roles(Role.INSITUTIONS)
  @UseInterceptors(
    FileInterceptor('file', {
      ...logoMulterConfig,
      fileFilter: imageFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async addInformationInstitution(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: InformationInstitutionDTo,
    @Req() req,
  ) {
    const data = await this.onboardingService.addInformationInstitutionSer(dto, req.user, file)
    return { message: "add information isntitution successfully", status: data }
  }


  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.INSITUTIONS)
  @Post('institutions/material/:profileId')
  public async addMaterialInstitution(@Param('profilId') profileId: string, @Body() dto: WasteInstitutionDTo, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const data = await this.onboardingService.addMaterialInstitutionSer(dto, profile, account)
    return { message: "add material successfully", status: data }
  }


  @Post('factory/information')
  @Roles(Role.FACTORY)
  @UseInterceptors(
    FileInterceptor('file', {
      ...logoMulterConfig,
      fileFilter: imageFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async addInformationFactory(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: InformationFactorynDTo,
    @Req() req,
  ) {
    const data = await this.onboardingService.addInformationFactorySer(dto, req.user, file)
    return { message: "add information factory successfully", status: data }
  }


  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.FACTORY)
  @Post('factory/material/:profileId')
  public async addMaterialFactory(@Param('profilId') profileId: string, @Body() dto: WasteFactoryDTo, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const data = await this.onboardingService.addMaterialFactorySer(dto, profile, account)
    return { message: "add material successfully", status: data }
  }


  @Post('external-partner/information')
  @Roles(Role.EXTERNAL_PARTNER)
  @UseInterceptors(
    FileInterceptor('file', {
      ...logoMulterConfig,
      fileFilter: imageFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async addInformationExternalPartner(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: InformationExternalPartnerDTo,
    @Req() req,
  ) {
    const data = await this.onboardingService.addInformationExternalPartnerSer(dto, req.user, file)
    return { message: "add information external-partner successfully", status: data }
  }


  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.EXTERNAL_PARTNER)
  @Post('external-partner/material/:profileId')
  public async addMaterialExternalPartner(@Param('profilId') profileId: string, @Body() dto: WasteExternalPartnerDTo, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const data = await this.onboardingService.addMaterialExternalPartnerSer(dto, profile, account)
    return { message: "add material successfully", status: data }
  }



  @Post('collector/information')
  @Roles(Role.COLLECTOR)
  async addInformationCollector(
    @Body() dto: InformationCollectorDTo,
    @Req() req,
  ) {
    const data = await this.onboardingService.addInformationCollectorSer(dto, req.user.id)
    return { message: "add information collector successfully", status: data }
  }

}