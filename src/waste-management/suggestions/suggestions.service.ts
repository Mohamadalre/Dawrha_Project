import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { ProductSuggestion } from '../entities/product-suggestion.entity';
import { SuggestionStatus } from '../enums/suggestion-status.enum';
import { AuditService } from '@src/waste-management/common/providers/audit.service';
import { CreateSuggestionDto } from './dto/create-suggestion.dto';

interface Caller {
  id: string;
  role: Role;
}

@Injectable()
export class SuggestionsService {
  private readonly logger = new Logger(SuggestionsService.name);

  constructor(
    @InjectRepository(ProductSuggestion)
    private readonly suggestionRepo: Repository<ProductSuggestion>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  async create(caller: Caller, dto: CreateSuggestionDto) {
    const suggestion = await this.suggestionRepo.save(
      this.suggestionRepo.create({
        accountId: caller.id,
        productName: dto.product_name,
        description: dto.additional_info
          ? `${dto.description ?? ''}\n${dto.additional_info}`.trim()
          : dto.description,
        categoryId: dto.category_id,
        unitType: dto.unit_type,
        estimatedPrice: dto.estimated_price != null ? String(dto.estimated_price) : undefined,
        imageURL: dto.image,
        status: SuggestionStatus.PENDING_REVIEW,
      }),
    );

    await this.audit.record({
      userId: caller.id,
      action: 'SUGGEST_PRODUCT',
      entityType: 'product_suggestion',
      entityId: suggestion.id,
      newValues: { productName: dto.product_name, role: caller.role },
    });

    await this.notifyAdmins(suggestion.id, dto.product_name);

    return {
      suggestion_id: suggestion.id,
      status: suggestion.status,
      created_at: suggestion.createdAt,
      message: 'Suggestion submitted successfully',
    };
  }

  private async notifyAdmins(suggestionId: string, productName: string): Promise<void> {
    try {
      const admins = await this.accountRepo.find({ where: { role: Role.ADMIN } });
      for (const admin of admins) {
        const notification = await this.notifications.createNotification({
          userId: admin.id,
          title: 'اقتراح منتج جديد',
          body: `تم اقتراح منتج جديد: ${productName}`,
          type: NotificationType.GENERAL,
          metadata: { suggestionId, deepLink: `admin/suggestions/${suggestionId}` },
        });
        await this.notifications.enqueueNotification(notification.id);
      }
    } catch (error) {
      this.logger.warn('Failed to notify admins about new suggestion', error as Error);
    }
  }
}
