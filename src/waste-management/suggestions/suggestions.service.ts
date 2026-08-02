import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import { ProductSuggestion } from '../entities/product-suggestion.entity';
import { WasteCategory } from '../entities/waste-category.entity';
import { SuggestionStatus } from '../enums/suggestion-status.enum';
import { SuggestionSource } from '../enums/suggestion-source.enum';
import { AuditService } from '@src/waste-management/common/providers/audit.service';
import { UnitsService } from '@src/waste-management/common/providers/units.service';
import { CreateSuggestionDto } from './dto/create-suggestion.dto';
import { OdooSuggestionDto } from './dto/odoo-suggestion.dto';
import {
  ListSuggestionsQuery,
  ReviewSuggestionDto,
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
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(WasteCategory)
    private readonly categoryRepo: Repository<WasteCategory>,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly units: UnitsService,
  ) {}

  async create(caller: Caller, dto: CreateSuggestionDto) {
    const unitCode = await this.units.validateActiveCode(dto.unit_type);

    const suggestion = await this.suggestionRepo.save(
      this.suggestionRepo.create({
        accountId: caller.id,
        productName: dto.product_name,
        description: dto.additional_info
          ? `${dto.description ?? ''}\n${dto.additional_info}`.trim()
          : dto.description,
        categoryId: dto.category_id,
        unitType: unitCode,
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
    const unitCode = await this.units.validateActiveCode(dto.unit_type);

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
      // Only an untouched proposal may be refreshed. Once an admin has ruled on
      // it, a late push must not quietly rewrite what was decided.
      if (existing.status !== SuggestionStatus.PENDING_REVIEW) {
        return {
          message: 'Suggestion already reviewed',
          suggestion_id: existing.id,
          status: existing.status,
        };
      }
      existing.productName = dto.product_name;
      existing.description = description || undefined;
      existing.categoryId = categoryId;
      existing.suggestedCategoryName = dto.new_category_name?.trim() || undefined;
      existing.unitType = unitCode;
      existing.suggestedByName = dto.suggested_by;
      await this.suggestionRepo.save(existing);
      return {
        message: 'Suggestion updated',
        suggestion_id: existing.id,
        status: existing.status,
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
        unitType: unitCode,
        status: SuggestionStatus.PENDING_REVIEW,
      }),
    );

    await this.notifyAdmins(suggestion.id, dto.product_name);

    return {
      message: 'Suggestion submitted successfully',
      suggestion_id: suggestion.id,
      status: suggestion.status,
      created_at: suggestion.createdAt,
    };
  }

  /** The review queue, filterable by status and by which side proposed it. */
  async listForAdmin(query: ListSuggestionsQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;

    const [rows, total] = await this.suggestionRepo.findAndCount({
      where,
      relations: ['account', 'category'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

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
   * The admin's ruling on a proposal — and NOTHING else.
   *
   * Approving does not create a material. That is deliberate: a material born
   * here would arrive with no prices, and an unpriced material is invisible to
   * every buyer, so the system would have silently produced a row that appears
   * nowhere and can be ordered by no one. The admin creates the real material
   * themselves, with its price list, when they choose to.
   *
   * Which is why the wording sent to the proposer says the idea was accepted
   * FOR STUDY, not that the material is now available: promising more than the
   * system does is how a feature becomes a support ticket.
   */
  async review(adminId: string, suggestionId: string, dto: ReviewSuggestionDto) {
    const suggestion = await this.suggestionRepo.findOne({
      where: { id: suggestionId },
    });
    if (!suggestion) throw new NotFoundException('Suggestion not found');
    if (suggestion.status !== SuggestionStatus.PENDING_REVIEW) {
      throw new ConflictException(
        `This suggestion was already ${suggestion.status.toLowerCase()}`,
      );
    }
    // A rejection with no reason tells the proposer nothing and cannot be
    // appealed or corrected — so it is not accepted as a rejection at all.
    if (dto.status === SuggestionStatus.REJECTED && !dto.admin_notes?.trim()) {
      throw new BadRequestException('A rejection must say why');
    }

    suggestion.status = dto.status;
    suggestion.adminNotes = dto.admin_notes?.trim() || undefined;
    suggestion.reviewedBy = adminId;
    suggestion.reviewedAt = new Date();
    await this.suggestionRepo.save(suggestion);

    await this.audit.record({
      userId: adminId,
      action: 'REVIEW_PRODUCT_SUGGESTION',
      entityType: 'product_suggestion',
      entityId: suggestion.id,
      newValues: { status: dto.status, notes: suggestion.adminNotes ?? null },
    });

    await this.notifyProposer(suggestion);

    return {
      message: `Suggestion ${dto.status.toLowerCase()}`,
      suggestion_id: suggestion.id,
      status: suggestion.status,
      // Stated in the response too, so no client builds a screen around a
      // material id that is never coming.
      product_created: false,
      reviewed_at: suggestion.reviewedAt,
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
      unit: row.unitType,
      estimated_price: row.estimatedPrice != null ? Number(row.estimatedPrice) : null,
      image: row.imageURL ?? null,
      source: row.source,
      suggested_by:
        row.source === SuggestionSource.ODOO
          ? { name: row.suggestedByName ?? 'Odoo administrator', account_id: null }
          : {
              name: row.account?.name ?? null,
              account_id: row.accountId ?? null,
            },
      status: row.status,
      admin_notes: row.adminNotes ?? null,
      reviewed_at: row.reviewedAt ?? null,
      created_at: row.createdAt,
    };
  }

  /** Odoo-side proposals have no app account to notify — nothing to send. */
  private async notifyProposer(suggestion: ProductSuggestion): Promise<void> {
    if (!suggestion.accountId) return;
    const approved = suggestion.status === SuggestionStatus.APPROVED;
    try {
      const notification = await this.notifications.createNotification({
        userId: suggestion.accountId,
        title: approved ? 'تمت الموافقة على اقتراحك' : 'لم يُقبل اقتراحك',
        body: approved
          ? `تمت الموافقة على اقتراحك «${suggestion.productName}» وسيُدرَس لإضافته`
          : `لم يُقبل اقتراحك «${suggestion.productName}»: ${suggestion.adminNotes ?? ''}`.trim(),
        type: NotificationType.GENERAL,
        metadata: { suggestionId: suggestion.id },
      });
      await this.notifications.enqueueNotification(notification.id);
    } catch (error) {
      this.logger.warn('Failed to notify the proposer', error as Error);
    }
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
