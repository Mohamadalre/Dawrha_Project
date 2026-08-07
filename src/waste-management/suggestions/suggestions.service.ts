import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import { ProductSuggestion } from '../entities/product-suggestion.entity';
import { WasteCategory } from '../entities/waste-category.entity';
import { SuggestionSource } from '../enums/suggestion-source.enum';
import { AuditService } from '@src/waste-management/common/providers/audit.service';
import { CreateSuggestionDto } from './dto/create-suggestion.dto';
import { OdooSuggestionDto } from './dto/odoo-suggestion.dto';
import {
  ListSuggestionsQuery,
} from './dto/review-suggestion.dto';

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
    @InjectRepository(WasteCategory)
    private readonly categoryRepo: Repository<WasteCategory>,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * A material suggestion from any buyer role: a NAME, an EXISTING category, and
   * one or more images (already uploaded to Cloudinary by the controller).
   *
   * The proposer is told the idea is under review and thanked — nothing here
   * creates a material, and there is no status for them to chase.
   */
  async create(caller: Caller, dto: CreateSuggestionDto, imageUrls: string[]) {
    const category = await this.categoryRepo.findOne({
      where: { id: dto.category_id },
    });
    if (!category) {
      throw new BadRequestException('The chosen category does not exist');
    }
    if (!imageUrls.length) {
      throw new BadRequestException('At least one image is required');
    }

    const suggestion = await this.suggestionRepo.save(
      this.suggestionRepo.create({
        accountId: caller.id,
        productName: dto.product_name,
        description: dto.description?.trim() || undefined,
        categoryId: dto.category_id,
        imageUrls,
      }),
    );

    await this.audit.record({
      userId: caller.id,
      action: 'SUGGEST_PRODUCT',
      entityType: 'product_suggestion',
      entityId: suggestion.id,
      newValues: { productName: dto.product_name, role: caller.role },
    });

    // The proposer hears back at once — the whole acknowledgement of their
    // contribution — while the admin picks it up from the review queue.
    await this.notifySubmitter(
      caller.id,
      'تم استلام اقتراحك',
      `طلبك «${dto.product_name}» قيد الدراسة. شكراً على مشاركتك.`,
      suggestion.id,
    );

    return {
      suggestion_id: suggestion.id,
      created_at: suggestion.createdAt,
      message: 'Your suggestion is under review — thank you for your contribution',
    };
  }

  /**
   * A proposal made by the Odoo administrator.
   *
   * Odoo can no longer create a material outright — a material that exists but
   * is priced for nobody is invisible to every buyer, so "created in Odoo" was
   * never the same thing as "on sale". It proposes instead, and the proposal
   * joins the same queue a buyer's does.
   *
   * Idempotent on the Odoo record id: a push retried after a timeout must
   * refresh the existing row, never file the proposal twice.
   */
  async ingestFromOdoo(dto: OdooSuggestionDto) {
    let categoryId: string | undefined;
    if (dto.category_name) {
      const category = await this.categoryRepo.findOne({
        where: { name: dto.category_name },
      });
      // An unmatched name is kept in the description rather than dropped: the
      // reviewer still needs to read what the proposer actually typed.
      categoryId = category?.id;
    }

    const existing = await this.suggestionRepo.findOne({
      where: { odooSuggestionId: dto.odoo_suggestion_id },
    });

    const description = [dto.description, categoryId ? null : dto.category_name]
      .filter(Boolean)
      .join('\n')
      .trim();

    if (existing) {
      // A retried push refreshes the same row rather than filing a second copy.
      // There is no status to guard any more — the admin reads and replies, they
      // do not "rule" — so a later push simply carries the newest values.
      existing.productName = dto.product_name;
      existing.description = description || undefined;
      existing.categoryId = categoryId;
      existing.suggestedCategoryName = dto.new_category_name?.trim() || undefined;
      if (dto.image_urls?.length) existing.imageUrls = dto.image_urls;
      existing.suggestedByName = dto.suggested_by;
      await this.suggestionRepo.save(existing);
      return {
        message: 'Suggestion updated',
        suggestion_id: existing.id,
      };
    }

    const suggestion = await this.suggestionRepo.save(
      this.suggestionRepo.create({
        accountId: undefined,
        source: SuggestionSource.ODOO,
        odooSuggestionId: dto.odoo_suggestion_id,
        suggestedByName: dto.suggested_by,
        productName: dto.product_name,
        description: description || undefined,
        categoryId,
        // Recorded as text and never auto-created: categories are the shape of
        // the whole catalogue, and one created from a free-typed string would be
        // spelled differently by the next proposer with nothing to merge them.
        // The reviewer reads the name and decides.
        suggestedCategoryName: dto.new_category_name?.trim() || undefined,
        imageUrls: dto.image_urls?.length ? dto.image_urls : undefined,
      }),
    );

    return {
      message: 'Suggestion submitted successfully',
      suggestion_id: suggestion.id,
      created_at: suggestion.createdAt,
    };
  }

  /**
   * The admin's review queue — OLDEST first, so the longest-waiting proposal is
   * dealt with first — filterable by WHO submitted it (a buyer role, or `ODOO`
   * for the Odoo administrator's proposals).
   */
  async listForAdmin(query: ListSuggestionsQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const qb = this.suggestionRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.account', 'account')
      .leftJoinAndSelect('s.category', 'category')
      .orderBy('s.createdAt', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query.submitted_by === 'ODOO') {
      qb.andWhere('s.source = :src', { src: SuggestionSource.ODOO });
    } else if (query.submitted_by) {
      // App proposals from that role — join to the submitter's account.
      qb.andWhere('account.role = :role', { role: query.submitted_by });
    }

    const [rows, total] = await qb.getManyAndCount();

    return {
      message: 'Suggestions fetched successfully',
      suggestions: rows.map((row) => this.shape(row)),
      pagination: buildPagination(total, page, limit),
    };
  }

  async detailForAdmin(suggestionId: string) {
    const row = await this.suggestionRepo.findOne({
      where: { id: suggestionId },
      relations: ['account', 'category'],
    });
    if (!row) throw new NotFoundException('Suggestion not found');
    return { message: 'Suggestion fetched successfully', suggestion: this.shape(row) };
  }

  /**
   * The admin's reply to a proposer — a free-text message, delivered to them as
   * a notification. The admin does NOT approve, reject, or change any status:
   * they read the proposal and answer it. Nothing here creates a material.
   *
   * Odoo proposals have no app account to answer, so a reply to one is refused
   * rather than silently dropped.
   */
  async reply(adminId: string, suggestionId: string, message: string) {
    const suggestion = await this.suggestionRepo.findOne({
      where: { id: suggestionId },
    });
    if (!suggestion) throw new NotFoundException('Suggestion not found');
    if (!suggestion.accountId) {
      throw new BadRequestException(
        'This proposal came from Odoo and has no app account to reply to',
      );
    }

    suggestion.adminReply = message.trim();
    suggestion.repliedBy = adminId;
    suggestion.repliedAt = new Date();
    await this.suggestionRepo.save(suggestion);

    await this.audit.record({
      userId: adminId,
      action: 'REPLY_PRODUCT_SUGGESTION',
      entityType: 'product_suggestion',
      entityId: suggestion.id,
      newValues: { reply: suggestion.adminReply },
    });

    await this.notifySubmitter(
      suggestion.accountId,
      'رد على اقتراحك',
      `بخصوص اقتراحك «${suggestion.productName}»: ${suggestion.adminReply}`,
      suggestion.id,
    );

    return {
      message: 'Reply sent to the submitter',
      suggestion_id: suggestion.id,
      replied_at: suggestion.repliedAt,
    };
  }

  private shape(row: ProductSuggestion) {
    return {
      id: row.id,
      product_name: row.productName,
      description: row.description ?? null,
      category: row.category
        ? { id: row.category.id, name: row.category.name }
        : null,
      // A category the proposer says does not exist yet. Distinct from
      // `category` being null, which only means none was chosen — this says one
      // was ASKED FOR, and it is the reviewer's second decision on the proposal.
      suggested_category_name: row.suggestedCategoryName ?? null,
      images: row.imageUrls ?? [],
      source: row.source,
      suggested_by:
        row.source === SuggestionSource.ODOO
          ? { name: row.suggestedByName ?? 'Odoo administrator', account_id: null, role: 'ODOO' }
          : {
              name: row.account?.name ?? null,
              account_id: row.accountId ?? null,
              role: row.account?.role ?? null,
            },
      admin_reply: row.adminReply ?? null,
      replied_at: row.repliedAt ?? null,
      created_at: row.createdAt,
    };
  }

  /**
   * Sends one notification to the proposer. Odoo-side proposals have no app
   * account, so there is nothing to send; a failure to notify never fails the
   * caller's action.
   */
  private async notifySubmitter(
    accountId: string | undefined,
    title: string,
    body: string,
    suggestionId: string,
  ): Promise<void> {
    if (!accountId) return;
    try {
      const notification = await this.notifications.createNotification({
        userId: accountId,
        title,
        body,
        type: NotificationType.GENERAL,
        metadata: { suggestionId },
      });
      await this.notifications.enqueueNotification(notification.id);
    } catch (error) {
      this.logger.warn('Failed to notify the submitter', error as Error);
    }
  }
}
