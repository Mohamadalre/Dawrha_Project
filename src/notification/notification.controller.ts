import { Controller,Get, Req } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('notification') 
  getMyNotifications(@Req() req) {
    return this.notificationService.getUserNotifications(req.user.id);
  }
}
