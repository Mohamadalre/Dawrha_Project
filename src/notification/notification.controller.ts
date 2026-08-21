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
import { I18nContext } from 'nestjs-i18n';
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
    // The reader's saved language localises the notification content, so the
    // in-app list comes back in their language with no header (same rule the
    // response envelope already follows).
    const result = await this.notificationService.findUserNotifications(
      user.id,
      query,
      (user as any).language,
    );
    return { message: 'Notifications fetched successfully', result };
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: Account) {
    const count = await this.notificationService.countUnread(user.id);
    // The count is part of the sentence ("You have N unread…"), so it is
    // interpolated into the translated message here — the response interceptor
    // only looks up whole keys and cannot inject an argument. The reader's saved
    // language wins over any header, exactly like everywhere else.
    const lang = (user as any).language ?? I18nContext.current()?.lang;
    const message =
      I18nContext.current()?.t(
        'translation.You have {count} unread notification(s), fetched successfully',
        { args: { count }, lang },
      ) ?? `You have ${count} unread notification(s), fetched successfully`;
    return { message, result: { count } };
  }

  @Get(':id')
  async getNotification(
    @CurrentUser() user: Account,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const result = await this.notificationService.getNotificationById(
      user.id,
      id,
      (user as any).language,
    );
    return { message: 'Notification fetched successfully', result };
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
