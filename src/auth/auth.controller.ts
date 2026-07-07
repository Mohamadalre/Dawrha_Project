import { Controller, Post, Body, UseGuards, HttpCode, Put, Req, Patch } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { DeviceDto, RefreshTokenDto, RefreshTokenTemporaryDto } from './dto/auth.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/forgot-password.dto'
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
// import { RolesGuard } from './guards/roles.guard';
// import { Roles } from './decorators/roles.decorator';
import { Role } from '../user/enums/role.enum';
import { RefreshTokenGuard } from './guards/refresh-token.guard';
import { JwtTemporaryGuard } from './guards/jwt-temporary.guard';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginGoogleDto } from './dto/logoin-google.dto';
import { VerifyResetOtpDto } from './dto/verifyReset-otp.dto';
import { UpdateDeviceLanguageDto } from './dto/update-device-language.dto';




// Auth is a brute-force / enumeration target: cap every auth route at 10/min per
// IP, and tighten the login routes to 5/min individually below.
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller({
  path: 'auth',
  version: '1'
})
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  /**
   * Register a citizen account.
   * @param registerDto body payload containing fullName, email, phoneNumber, password
   * @returns temporary token object for OTP verification
   */
  @Post('register/citizen')
  async registerCitizen(@Body() registerDto: RegisterDto) {
    const result = await this.authService.register(registerDto, Role.CITIZEN);
    return result;
  }


  /**
   * Register an institution account.
   * @param registerDto body payload containing fullName, email, phoneNumber, password
   * @returns temporary token object for OTP verification
   */
  @Post('register/institution')
  async registerInstitution(@Body() registerDto: RegisterDto) {
    const result = await this.authService.register(registerDto, Role.INSTITUTIONS);
    return result;
  }

  /**
   * Register a collector account.
   * @param registerDto body payload containing fullName, email, phoneNumber, password
   * @returns temporary token object for OTP verification
   */
  @Post('register/collector')
  async registerCollector(@Body() registerDto: RegisterDto) {
    const result = await this.authService.register(registerDto, Role.COLLECTOR);
    return result
  }


  @Post('register/citizen/google')
  @HttpCode(201)
  async registerCitizenGoogle(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.registerWithGoogle(dto, Role.CITIZEN)
    return { message: 'Registration with Google successful', result: tokens };
  }


  @Post('register/institution/google')
  @HttpCode(201)
  async registerInstitutionGoogle(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.registerWithGoogle(dto, Role.INSTITUTIONS)
    return { message: 'Registration with Google successful', result: tokens };
  }


  @Post('register/collector/google')
  @HttpCode(201)
  async registerCollectorGoogle(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.registerWithGoogle(dto, Role.COLLECTOR)
    return { message: 'Registration with Google successful', result: tokens };
  }

  @Post('register/factory/google')
  @HttpCode(201)
  async registerFactoryGoogle(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.registerWithGoogle(dto, Role.FACTORY)
    return { message: 'Registration with Google successful', result: tokens };
  }


  @Post('register/external-partner/google')
  @HttpCode(201)
  async registerExternalPartnerGoogle(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.registerWithGoogle(dto, Role.EXTERNAL_PARTNER)
    return { message: 'Registration with Google successful', result: tokens };
  }


  /**
   * Login as admin.
   * @param loginDto body payload containing email and password
   * @returns JWT tokens if credentials and role match
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/admin')
  @HttpCode(200)
  async loginAdmin(@Body() loginDto: LoginDto) {
    const tokens = await this.authService.login(loginDto, 'admin');
    return { message: 'Login successful', result: tokens };
  }

  /**
   * Login as user-app.
   * @param loginDto body payload containing email and password
   * @returns JWT tokens if credentials and type-app match
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/user-app')
  @HttpCode(200)
  async loginUser(@Body() loginDto: LoginDto) {
    const tokens = await this.authService.login(loginDto, 'user_app');
    return { message: 'Login successful', result: tokens };
  }

  /**
   * Login as collector-app.
   * @param loginDto body payload containing email and password
   * @returns JWT tokens if credentials and type-app match
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/collector-app')
  @HttpCode(200)
  async loginCollector(@Body() loginDto: LoginDto) {
    const tokens = await this.authService.login(loginDto, 'collector_app');
    return { message: 'Login successful', result: tokens };
  }



  /**
   * Login as factory-app.
   * @param loginDto body payload containing email and password
   * @returns JWT tokens if credentials and type-app match
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/factory-app')
  @HttpCode(200)
  async loginFactory(@Body() loginDto: LoginDto) {
    const tokens = await this.authService.login(loginDto, 'factory_app');
    return { message: 'Login successful', result: tokens };
  }




  /**
   * Google login for user-app.
   * @param dto body payload containing Tokenid, deviceId, deviceType and optional fcmToken ant remember is true
   * @returns JWT tokens if the Google token is valid and type app matches
   */
  @Post('login/user-app/google')
  @HttpCode(200)
  async loginUserGoogle(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.loginWithGoogle({ ...dto, rememberMy: true }, 'user_app')
    return { message: 'Login with Google successful', result: tokens };
  }

  /**
   * Google login for collector-app.
   * @param dto body payload containing Tokenid, deviceId, deviceType and optional fcmToken and remember is true
   * @returns JWT tokens if the Google token is valid and type app matches
   */
  @Post('login/collector-app/google')
  @HttpCode(200)
  async LoginCollectorGoogle(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.loginWithGoogle({ ...dto, rememberMy: true }, 'collector_app')
    return { message: 'Login with Google successful', result: tokens };
  }

  @Post('login/factory-app/google')
  @HttpCode(200)
  async LoginFactoryGoogle(@Body() dto: LoginGoogleDto) {
    const tokens = await this.authService.loginWithGoogle({ ...dto, rememberMy: true }, 'factory_app')
    return { message: 'Login with Google successful', result: tokens };
  }





  /**
   * Update the notification language of the caller's device. Subsequent push
   * notifications to this device are localized accordingly.
   */
  @UseGuards(JwtAuthGuard)
  @Patch('device/language')
  @HttpCode(200)
  async updateDeviceLanguage(
    @CurrentUser() user: any,
    @Body() dto: UpdateDeviceLanguageDto,
  ) {
    const result = await this.authService.updateDeviceLanguage(user.id, dto.deviceId, dto.language);
    return { message: result.message, result };
  }




  /**
   * Confirm OTP received by email for temporary users.
   * @param user current temporary authenticated user from JwtTemporaryGuard
   * @param verifyOtpDto body payload containing otpCode, deviceId, deviceType and optional fcmToken
   * @returns full JWT access and refresh tokens
   */
  @UseGuards(JwtTemporaryGuard)
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOTP(@CurrentUser() user: any, @Body() verifyOtpDto: VerifyOtpDto) {
    const tokens = await this.authService.verifyOtpCode(verifyOtpDto, user.id, user.jti);
    return { message: 'Your account has been confirmed successfully', result: tokens };
  }

  /**
   * Resend OTP to the current temporary authenticated user.
   * @param user current temporary authenticated user from JwtTemporaryGuard
   * @returns cooldown info for OTP resending
   */
  @UseGuards(JwtTemporaryGuard)
  @Put('otp/resend')
  @HttpCode(200)
  async resendOTP(@CurrentUser() user: any) {
    const data = await this.authService.resendOtpCode(user.id)
    return { message: 'The OTP code has been sent successfully', result: data };
  }


  /**
   * Request a password reset link for the given email.
   * @param forgotPasswordDto body payload containing email
   * @returns success message when reset URL is generated
   */
  @Post('password/forgot')
  @HttpCode(200)
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    const res = await this.authService.forgotPassword(forgotPasswordDto);
    return { message: res.message };
  }


  @Post('password/verify')
  @HttpCode(200)
  async verifyReset(@Body() verifyResetOtpDto: VerifyResetOtpDto) {
    const res = await this.authService.verifyResetOtp(verifyResetOtpDto);
    return res;
  }

  /**
   * Reset the user password using a token URL.
   * @param resetDto body payload containing newPassword, confirmPassword, and tokenUrl
   * @returns success message when password is reset
   */
  @Patch('password/reset')
  @HttpCode(200)
  async resetPassword(@Body() resetDto: ResetPasswordDto) {
    const res = await this.authService.resetPassword(resetDto);
    return { message: res.message };
  }

  /**
   * Refresh user access and refresh tokens using a valid refresh token.
   * @param req request object containing authenticated user and request id from RefreshTokenGuard
   * @param refreshTokenDto body payload containing deviceId
   * @returns new access and refresh tokens
   */
  @UseGuards(RefreshTokenGuard)
  @Post('refresh-token')
  async refreshTokens(@Req() req: any, @Body() refreshTokenDto: RefreshTokenDto) {
    const tokens = await this.authService.refreshTokens(refreshTokenDto, req.user, req.id);
    return { message: 'Tokens refreshed successfully', result: tokens };
  }


  /**
   * Refresh a temporary token to a new temporary token.
   * @param token body payload containing temporary token string
   * @returns new temporary token object
   */
  @Post('temporary-token/refresh')
  @HttpCode(200)
  async refreshTemporaryToken(@Body() token: RefreshTokenTemporaryDto) {
    const tokens = await this.authService.refreshTemporaryTokens(token)
    return { message: 'Temporary token refreshed successfully', result: tokens }
  }

  /**
   * Logout the current authenticated user for a specific device.
   * @param user current authenticated user from JwtAuthGuard
   * @param deviceId body payload containing the current device ID
   * @returns success flag after clearing refresh token and fcmToken
   */
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('logout')
  async logout(@CurrentUser() user: any, @Body() { deviceId }: DeviceDto) {
    await this.authService.logout(user.id, deviceId, user.jti)
    return { message: 'Logout successfully' }
  }


  @UseGuards(JwtAuthGuard)
  @Put('FCMToken')
  @HttpCode(200)
  async addFCMToken(@CurrentUser() user: any,@Body() dto:DeviceDto){
  
    const result = await this.authService.addFCMToken(dto,user.id)
    return result.message;
  }



}
