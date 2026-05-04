import { Controller, UseGuards, Post, Body, Param, Req, Get, UseInterceptors, BadRequestException, UploadedFile, Query, ForbiddenException, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
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
import { DriverOptionNotSetError, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { MediaDto } from './dto/media.dto';
import { CommonService } from '@src/common/common.service';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { AccountStatusGuard } from '@src/auth/guards/account-status.guard';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { InformationFactorynDTo, WasteFactoryDTo } from './dto/factory-onboarding.dto';
import { InformationExternalPartnerDTo, WasteExternalPartnerDTo } from './dto/external-partner-onboarding.dto';
import { InformationCollectorDTo, LocationCollectorDto } from './dto/collector-onboarding.dto';
import { MediaType } from '@src/media/entities/media.entity';
//import { ValidateUUIDPipe } from '@src/common/pipes/validate-uuid.pipe';

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
  @Roles(Role.EXTERNAL_PARTNER, Role.FACTORY, Role.INSITUTIONS)
  @Post('location/:profilId')
  public async createLocation(@Param('profilId') profileId: string, @Body() dto: LocationDto, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const role = req.user.role;
    if (role === Role.CITIZEN || role === Role.COLLECTOR) {
      throw new ForbiddenException('You cannot add location')
    }
    const data = await this.onboardingService.addLocation(dto, role, profile, account.id)
    return { message: "add Location successfully", status: data }
  }






  @Get('proivces')
  async getproivces(@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {

    const result = await this.onboardingService.findAll(page);
    return { message: 'Fetch proivces  successfully', result };

  }


  @Post('institution/information')
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
    const data = await this.onboardingService.addInformationInstitutionSer(dto, req.user.id, file)
    return { message: "add information isntitution successfully", status: data }
  }


  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.INSITUTIONS)
  @Post('institution/material/:profilId')
  public async addMaterialInstitution(@Param('profilId') profileId: string, @Body() dto: WasteInstitutionDTo, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const data = await this.onboardingService.addMaterialInstitutionSer(dto, profile, account.id)
    return { message: "add material successfully", status: data }
  }

  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.INSITUTIONS)
  @Post('institution/upload-Doc/:profileId')
  @UseInterceptors(
    FileInterceptor('file', {
      ...logoMulterConfig,
      fileFilter: imageFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadFileInstitution(
    @Param('profilId') profilId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: MediaDto,
    @Req() req
  ) {
    const role = req.user.role;
    const account = await this.acccountRepo.findOne({ where: { id: req.user.id } })
    if (!file) { throw new BadRequestException('file is required') }
    const step = await this.commomService.getCurrentStep(account!)
    if (step !== 'documents') {
      throw new ForbiddenException('You cannot add documents data,you must add data from the previous');
    }
    if (role === Role.INSITUTIONS && dto.fileType !== MediaType.LICENSE) {
      throw new ForbiddenException(`You cannot add image of a type ${dto.fileType}`)
    }
    const fileUrl = `${file.filename}`;
    const data = await this.mediaService.saveFileData(fileUrl, req.profile.id, role, dto.fileType, req.user.id);
    return { messge: 'upload image successfully', data }
  }



  ///factory

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
  @Post('factory/material/:profilId')
  public async addMaterialFactory(@Param('profilId') profileId: string, @Body() dto: WasteFactoryDTo, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const data = await this.onboardingService.addMaterialFactorySer(dto, profile, account.id)
    return { message: "add material successfully", status: data }
  }


  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.FACTORY)
  @Post('factory/upload-Doc/:profileId')
  @UseInterceptors(
    FileInterceptor('file', {
      ...logoMulterConfig,
      fileFilter: imageFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadFileFactory(
    @Param('profilId') profilId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: MediaDto,
    @Req() req
  ) {
    const role = req.user.role;
    const account = await this.acccountRepo.findOne({ where: { id: req.user.id } })
    if (!file) { throw new BadRequestException('file is required') }
    const step = await this.commomService.getCurrentStep(account!)
    if (step !== 'documents') {
      throw new ForbiddenException('You cannot add documents data,you must add data from the previous');
    }
    if (role === Role.FACTORY && dto.fileType !== MediaType.INDUSTRIAL_REG || dto.fileType !== MediaType.LICENSE) {
      throw new ForbiddenException(`You cannot add image of a type ${dto.fileType}`)
    }
    const fileUrl = `${file.filename}`;
    const data = await this.mediaService.saveFileData(fileUrl, req.profile.id, role, dto.fileType, req.user.id);
    return { messge: 'upload image successfully', data }
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
    const data = await this.onboardingService.addInformationExternalPartnerSer(dto, req.user.id, file)
    return { message: "add information external-partner successfully", status: data }
  }


  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.EXTERNAL_PARTNER)
  @Post('external-partner/material/:profilId')
  public async addMaterialExternalPartner(@Param('profilId') profileId: string, @Body() dto: WasteExternalPartnerDTo, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const data = await this.onboardingService.addMaterialExternalPartnerSer(dto, profile, account.id)
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


  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.COLLECTOR)
  @Post('collector/upload-Doc/:profileId')
  @UseInterceptors(
    FileInterceptor('file', {
      ...logoMulterConfig,
      fileFilter: imageFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadFileCollector(
    @Param('profilId') profilId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: MediaDto,
    @Req() req
  ) {
    const role = req.user.role;
    const account = await this.acccountRepo.findOne({ where: { id: req.user.id } })
    if (!file) { throw new BadRequestException('file is required') }
    const step = await this.commomService.getCurrentStep(account!)
    if (step !== 'documents') {
      throw new ForbiddenException('You cannot add documents data,you must add data from the previous');
    }
    if (role === Role.COLLECTOR && dto.fileType !== MediaType.ID_CARD_BACK || dto.fileType !== MediaType.ID_CARD_FRONT) {
      throw new ForbiddenException(`You cannot add image of a type ${dto.fileType}`)
    }
    const fileUrl = `${file.filename}`;
    const data = await this.mediaService.saveFileData(fileUrl, req.profile.id, role, dto.fileType, req.user.id);
    return { messge: 'upload image successfully', data }
  }


  @UseGuards(ProfileOwnerGuard)
  @Roles(Role.COLLECTOR)
  @Post('collector/location/:profilId')
  public async createLocationCollector(@Param('profilId') profileId: string, @Body() dto: LocationCollectorDto, @Req() req: any) {
    const profile = req.profile;
    const account = req.user;
    const role = req.user.role;

    const data = await this.onboardingService.addLocation(dto, role, profile, account.id)
    return { message: "add Location successfully", status: data }
  }




}