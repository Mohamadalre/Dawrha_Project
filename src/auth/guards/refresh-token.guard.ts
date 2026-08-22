import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { UserService } from "@src/user/user.service";
import { Request } from "express";


@Injectable()
export class RefreshTokenGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly userService:UserService
    ) { }

    async canActivate(context: ExecutionContext) {
        const request: Request = context.switchToHttp().getRequest();
        const [type, token] = request.headers.authorization?.split(" ") ?? [];
        if (token && type == "Bearer") {
            try {
                const payload = await this.jwtService.verifyAsync(
                    token, {
                    secret: this.configService.get<string>("JWT_REFRESH_SECRET")
                })
                const account = await this.userService.findById(payload.id || payload.sub)
                if (!account) {
                    throw new UnauthorizedException("invalid token")
                }
                request['user'] = token;
                request['id'] = account.id
                // The device is stamped INTO the refresh token at issue time, so
                // the caller never needs to (and no longer may) send it in the
                // body — it is read from the verified payload, where it cannot be
                // spoofed to refresh another device's session.
                request['deviceId'] = payload.deviceId
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (error) {
                throw new UnauthorizedException("invalid token")
            }
        } else {
            throw new UnauthorizedException("access denied, invalid token")
        }
        return true;
    }
}
