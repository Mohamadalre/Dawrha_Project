import { Controller, Post, Body, UseGuards, Get, HttpCode, Put, Req, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { DeviceDto, RefreshTokenDto, RefreshTokenTemporayDto } from './dto/auth.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/forgot-password.dto'
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { Role } from '../user/enums/role.enum';
import { RefreshTokenGuarud } from './guards/refresh-token.guard';
import { JwtTemporaryGuard } from './guards/jwt-temporary.guard';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginGoogleDto } from './dto/logoin-google.dto';


@Controller({
  path: 'auth',
  version: '1'
})
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('citizen/register')
  async registerCitizen(@Body() registerDto: RegisterDto) {
    const tokens = await this.authService.register(registerDto, Role.CITIZEN);
    return { message: 'Registration successful', result: tokens };
  }


  @Post('institution/register')
  async registerInstitution(@Body() registerDto: RegisterDto) {
    const tokens = await this.authService.register(registerDto, Role.INSITUTIONS);
    return { message: 'Registration successful', result: tokens };
  }

  @Post('collector/register')
  async registerCollector(@Body() registerDto: RegisterDto) {
    const tokens = await this.authService.register(registerDto, Role.COLLECTOR);
    return { message: 'Registration successful', result: tokens };
  }

  @Post('login/citizen')
  @HttpCode(200)
  async login(@Body() loginDto: LoginDto) {
    const tokens = await this.authService.login(loginDto, Role.CITIZEN);
    return { message: 'Login successful', result: tokens };
  }

  @Post('login/collector')
  @HttpCode(200)
  async logincollector(@Body() loginDto: LoginDto) {
    const tokens = await this.authService.login(loginDto, Role.COLLECTOR);
    return { message: 'Login successful', result: tokens };
  }

  @Post('login/externalPartner')
  @HttpCode(200)
  async loginExternalPartner(@Body() loginDto: LoginDto) {
    const tokens = await this.authService.login(loginDto, Role.EXTERNAL_PARTNER);
    return { message: 'Login successful', result: tokens };
  }

  @Post('login/factory')
  @HttpCode(200)
  async loginfactory(@Body() loginDto: LoginDto) {
    const tokens = await this.authService.login(loginDto, Role.FACTORY);
    return { message: 'Login successful', result: tokens };
  }
  @Post('login/insitutions')
  @HttpCode(200)
  async logininsitution(@Body() loginDto: LoginDto) {
    const tokens = await this.authService.login(loginDto, Role.INSITUTIONS);
    return { message: 'Login successful', result: tokens };
  }

  @Post('google/citizen/login')
  @HttpCode(200)
  async googleLogin(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.googleLogin(dto, Role.CITIZEN)
    return { message: 'Login with Google successful', result: tokens };
  }

  @Post('google/collector/login')
  @HttpCode(200)
  async googleLoginCollector(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.googleLogin(dto, Role.COLLECTOR)
    return { message: 'Login with Google successful', result: tokens };
  }

  @Post('google/external-partiner/login')
  @HttpCode(200)
  async googleLoginexternal(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.googleLogin(dto, Role.EXTERNAL_PARTNER)
    return { message: 'Login with Google successful', result: tokens };
  }

  @Post('google/factory/login')
  @HttpCode(200)
  async googleLoginfactory(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.googleLogin(dto, Role.FACTORY)
    return { message: 'Login with Google successful', result: tokens };
  }

  @Post('google/insitutions/login')
  @HttpCode(200)
  async googleLogininstution(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.googleLogin(dto, Role.INSITUTIONS)
    return { message: 'Login with Google successful', result: tokens };
  }
  @UseGuards(JwtTemporaryGuard)
  @Post('verification-otp')
  @HttpCode(200)
  async verifiyOTP(@CurrentUser() user: any, @Body() verifyOtpDto: VerifyOtpDto) {
    const tokens = await this.authService.verifyOtpServ(verifyOtpDto, user.id);
    return { message: 'Your account confirm successfull', result: tokens };
  }

  @UseGuards(JwtTemporaryGuard)
  @Put('resend-otp')
  @HttpCode(200)
  async resendOTP(@CurrentUser() user: any) {
    const data = await this.authService.resendOtpServ(user.id)
    return { message: 'The Otp code send successfully', result: data };
  }


  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    const res = await this.authService.forgotPassword(forgotPasswordDto);
    return { message: res.message };
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() resetDto: ResetPasswordDto) {
    const res = await this.authService.resetPassword(resetDto);
    return { message: res.message };
  }

  @UseGuards(RefreshTokenGuarud)
  @Post('refresh-token')
  async gereateRefreshTokens(@CurrentUser() user: string, @Body() refreshTokenDto: RefreshTokenDto) {
    const tokens = await this.authService.refreshTokens(refreshTokenDto, user);
    return { message: 'Tokens refreshed successfully', result: tokens };
  }



  @Post('/refresh/tokenTemploaray')
  @HttpCode(200)
  async generateToken(@Body() token: RefreshTokenTemporayDto) {
    const tokens = await this.authService.refreshTokensTemporary(token)
    return { message: 'Token-Tempoarary refreshed successfully', result: tokens }
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@CurrentUser() user: any, { deviceId }: DeviceDto) {
    const data = await this.authService.logoutServ(user.id, deviceId)
  }




}
