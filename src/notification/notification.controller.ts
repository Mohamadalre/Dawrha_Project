import { Controller,Get, Req,Patch,Param } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

@Get('Notification')
  getMyNotifications(@Req() req) {
    return this.notificationService.findUserNotifications(req.user.id);
  }

  @Patch(':id/read')
    markAsRead(@Param('id') id: string) {
    return this.notificationService.markAsRead(id);
  }
}
