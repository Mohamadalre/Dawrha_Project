import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";


@Injectable()
export class RefreshTokenGuarud implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService
    ) { }

    async canActivate(context: ExecutionContext) {
        const request: Request = context.switchToHttp().getRequest();
        const [type, token] = request.headers.authorization?.split(" ") ?? [];
        if (token && type == "Bearer") {
            request['user'] = token;

        } else {
            throw new UnauthorizedException("access denied, invalid token")
        }
        return true;
    }
}
