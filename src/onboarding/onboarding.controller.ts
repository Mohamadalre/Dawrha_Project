import { Controller, UseGuards, Post, Body, Param, Req, UseInterceptors, UploadedFile, ForbiddenException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingAuthGuard } from './gurads/onboarding-auth.guard';
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



@Controller({
  path: 'onboarding',
  version: '1'
})
@UseGuards(OnboardingAuthGuard, RolesGuard)
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
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
    @Body('fileType') {fileType}:MediaDto,
    @Req() req
  ) {
    const role = req.user.role;
    const account = await this.acccountRepo.findOne({where:{id:req.user}})
    const step = await this.onboardingService.getCurrentStep(account!)
    if (step !== 'documents') {
      throw new ForbiddenException('You cannot add documents data,you must add data from the previous');
    }
    const fileUrl = `image/uploads/${file.filename}`;
    return await this.mediaService.saveFileData(fileUrl, req.user, role,fileType);
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
    return { message: "add Location successfully", status: data }
  }
}