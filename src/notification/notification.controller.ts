import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  ParseUUIDPipe,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import {
  AccountsStatus,
  TOKEN_HOLDING_STATUSES,
} from '@src/auth/decorators/account-status.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Account } from '@src/user/entities/account.entity';
import { NotificationService } from './notification.service';
import { NotificationQueryDto } from './dto/notification-query.dto';

/**
 * Mounted on BOTH `/api/notifications/...` and `/api/v1/notifications/...` —
 * VERSION_NEUTRAL keeps existing (unversioned) clients working while `'1'`
 * lines these routes up with the rest of the API. No breaking change.
 */
@UseGuards(JwtAuthGuard)
/**
 * Declared at the CLASS level, so every route here inherits it.
 *
 * These belong to the session, not to the business. An account waiting on a
 * decision — or refused one, or asked to replace a document — is exactly who
 * the notifications are addressed to, so restricting them to ACTIVE would
 * deliver every one of those messages to a status forbidden from reading it.
 */
@AccountsStatus(...TOKEN_HOLDING_STATUSES)
@Controller({ path: 'notifications', version: [VERSION_NEUTRAL, '1'] })
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async getMyNotifications(
    @CurrentUser() user: Account,
    @Query() query: NotificationQueryDto,
  ) {
    return this.notificationService.findUserNotifications(user.id, query);
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: Account) {
    return this.notificationService.countUnread(user.id);
  }

  @Get(':id')
  async getNotification(
    @CurrentUser() user: Account,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notificationService.getNotificationById(user.id, id);
  }


  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: Account) {
    return this.notificationService.markAllAsRead(user.id);
  }


  @Delete('clear-all')
  async clearAllNotifications(@CurrentUser() user: Account) {
    return this.notificationService.clearAllNotifications(user.id);
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() user: Account,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notificationService.markAsRead(user.id, id);
  }



  @Delete(':id')
  async deleteNotification(
    @CurrentUser() user: Account,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notificationService.deleteNotification(user.id, id);
  }


}
