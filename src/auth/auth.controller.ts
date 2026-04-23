import { Controller, Post, Body, UseGuards, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import {RefreshTokenDto, ForgotPasswordDto, ResetPasswordDto } from './dto/auth.dto';
import {RegisterCitizenDto} from './dto/register.dto';
import {LoginDto} from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { Role } from '../user/enums/role.enum';

@Controller({
  path:'auth',
  version:'1'
})
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('citizen/register')
  async registerCitizen(@Body() registerDto: RegisterCitizenDto) {
    const tokens = await this.authService.register(registerDto,Role.CITIZEN);
    return { message: 'Registration successful', result: tokens };
  }

  // @Post('login-citizen')
  // async login(@Body() loginDto: LoginDto) {
  //   const tokens = await this.authService.login(loginDto);
  //   return { message: 'Login successful', result: tokens };
  // }

  // @Post('refresh')
  // async refreshTokens(@Body() refreshDto: RefreshTokenDto) {
  //   const tokens = await this.authService.refreshTokens(refreshDto);
  //   return { message: 'Tokens refreshed successfully', result: tokens };
  // }

  // @Post('forgot-password')
  // async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
  //   const res = await this.authService.forgotPassword(forgotPasswordDto);
  //   return { message: res.message };
  // }

  // @Post('reset-password')
  // async resetPassword(@Body() resetDto: ResetPasswordDto) {
  //   const res = await this.authService.resetPassword(resetDto);
  //   return { message: res.message };
  // }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@CurrentUser() user: any) {
    return { message: 'Profile retrieved', result: user };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.COLLECTOR)
  @Get('driver-only')
  driverOnlyRoute() {
    return { message: 'You are an authenticated driver' };
  }
}
