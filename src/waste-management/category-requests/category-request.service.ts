import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { AssignedCategoryProvider } from '@src/waste-management/common/providers/assigned-category.provider';
import { CatalogCacheService } from '@src/waste-management/common/providers/catalog-cache.service';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import { CategoryRequest } from './entities/category-request.entity';
import { CategoryRequestStatus } from './enums/category-request-status.enum';
import { AssignedCategoryWriter } from './providers/assigned-category.writer';
import {
  CategoryRequestQueryDto,
  CreateCategoryRequestDto,
} from './dto/category-request.dto';

interface Caller {
  id: string;
  role: Role;
}

// Only institutions are restricted to assigned categories, so only they need to
// request new ones. Factories and free facilities already see the full catalogue.
const REQUESTABLE_ROLES = [Role.INSTITUTIONS];

@Injectable()
export class CategoryRequestService {
  private readonly logger = new Logger(CategoryRequestService.name);

  constructor(
    @InjectRepository(CategoryRequest)
    private readonly requestRepo: Repository<CategoryRequest>,
    @InjectRepository(WasteCategory)
    private readonly categoryRepo: Repository<WasteCategory>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly assignedCategories: AssignedCategoryProvider,
    private readonly writer: AssignedCategoryWriter,
    private readonly notifications: NotificationService,
    private readonly cache: CatalogCacheService,
  ) {}

  // ---------------------------------------------------------------------------
  // Buyer: submit a request
  // ---------------------------------------------------------------------------
  async create(caller: Caller, dto: CreateCategoryRequestDto) {
    if (!REQUESTABLE_ROLES.includes(caller.role)) {
      throw new ForbiddenException('Only institutions, factories and free facilities can request categories');
    }

    const requested = [...new Set(dto.categoryIds)];

    // All requested categories must exist and be active.
    const found = await this.categoryRepo.find({
      where: { id: In(requested), isActive: true },
      select: { id: true },
    });
    if (found.length !== requested.length) {
      throw new BadRequestException('One or more categories are invalid or inactive');
    }

    // Drop the ones the account already holds.
    const assigned = (await this.assignedCategories.getAssignedCategoryIds(caller.id, caller.role)) ?? [];
    const newIds = requested.filter((id) => !assigned.includes(id));
    if (newIds.length === 0) {
      throw new BadRequestException('All requested categories are already assigned to your account');
    }

    const request = await this.requestRepo.save(
      this.requestRepo.create({
        accountId: caller.id,
        role: caller.role,
        categoryIds: newIds,
        status: CategoryRequestStatus.PENDING,
      }),
    );

    await this.notifyAdmins(request.id, newIds.length);

    return {
      request_id: request.id,
      status: request.status,
      requested_count: newIds.length,
      created_at: request.createdAt,
      message: 'Category request submitted successfully',
    };
  }

  // ---------------------------------------------------------------------------
  // Admin: list requests
  // ---------------------------------------------------------------------------
  async listForAdmin(query: CategoryRequestQueryDto) {
    const qb = this.requestRepo.createQueryBuilder('r');
    if (query.status !== 'all') {
      qb.where('r.status = :status', { status: query.status });
    }
    qb.orderBy('r.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();

    // Resolve category names + requester info for the page.
    const allCategoryIds = [...new Set(rows.flatMap((r) => r.categoryIds))];
    const accountIds = [...new Set(rows.map((r) => r.accountId))];
    const [categories, accounts] = await Promise.all([
      allCategoryIds.length
        ? this.categoryRepo.find({ where: { id: In(allCategoryIds) }, select: { id: true, name: true } })
        : Promise.resolve([]),
      accountIds.length
        ? this.accountRepo.find({ where: { id: In(accountIds) }, select: { id: true, name: true, email: true } })
        : Promise.resolve([]),
    ]);
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    return {
      requests: rows.map((r) => ({
        request_id: r.id,
        status: r.status,
        role: r.role,
        requester: accountById.get(r.accountId)
          ? { id: r.accountId, name: accountById.get(r.accountId)!.name, email: accountById.get(r.accountId)!.email }
          : { id: r.accountId },
        categories: r.categoryIds.map((id) => ({ id, name: categoryName.get(id) ?? null })),
        admin_reason: r.adminReason ?? null,
        created_at: r.createdAt,
        reviewed_at: r.reviewedAt ?? null,
      })),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  // ---------------------------------------------------------------------------
  // Admin: approve
  // ---------------------------------------------------------------------------
  async approve(adminId: string, requestId: string) {
    const request = await this.loadPending(requestId);

    // Link the categories to the account's material (idempotent on new ids only).
    const assigned = (await this.assignedCategories.getAssignedCategoryIds(request.accountId, request.role)) ?? [];
    const toAdd = request.categoryIds.filter((id) => !assigned.includes(id));
    await this.writer.addCategories(request.accountId, request.role, toAdd);

    request.status = CategoryRequestStatus.APPROVED;
    request.reviewedAt = new Date();
    request.reviewedBy = adminId;
    await this.requestRepo.save(request);

    // The requester now sees new categories/products/offers → drop caches.
    await this.cache.invalidate('categories', 'products', 'offers');

    await this.notifyRequester(
      request.accountId,
      'تمت الموافقة على طلب التصنيفات',
      'تمت إضافة التصنيفات المطلوبة إلى حسابك ويمكنك الآن رؤية منتجاتها وعروضها.',
    );

    return { message: 'Category request approved' };
  }

  // ---------------------------------------------------------------------------
  // Admin: reject
  // ---------------------------------------------------------------------------
  async reject(adminId: string, requestId: string, reason: string) {
    const request = await this.loadPending(requestId);

    request.status = CategoryRequestStatus.REJECTED;
    request.adminReason = reason;
    request.reviewedAt = new Date();
    request.reviewedBy = adminId;
    await this.requestRepo.save(request);

    await this.notifyRequester(
      request.accountId,
      'تم رفض طلب التصنيفات',
      `تم رفض طلب إضافة التصنيفات. السبب: ${reason}`,
    );

    return { message: 'Category request rejected' };
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------
  private async loadPending(requestId: string): Promise<CategoryRequest> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Category request not found');
    if (request.status !== CategoryRequestStatus.PENDING) {
      throw new ConflictException(`Request already ${request.status.toLowerCase()}`);
    }
    return request;
  }

  private async notifyAdmins(requestId: string, count: number): Promise<void> {
    try {
      const admins = await this.accountRepo.find({ where: { role: Role.ADMIN } });
      for (const admin of admins) {
        const n = await this.notifications.createNotification({
          userId: admin.id,
          title: 'طلب إضافة تصنيفات جديد',
          body: `هناك طلب جديد لإضافة ${count} تصنيف/تصنيفات يحتاج للمراجعة.`,
          type: NotificationType.GENERAL,
          metadata: { requestId, deepLink: `admin/category-requests/${requestId}` },
        });
        await this.notifications.enqueueNotification(n.id);
      }
    } catch (error) {
      this.logger.warn('Failed to notify admins of category request', error as Error);
    }
  }

  private async notifyRequester(accountId: string, title: string, body: string): Promise<void> {
    try {
      const n = await this.notifications.createNotification({
        userId: accountId,
        title,
        body,
        type: NotificationType.GENERAL,
      });
      await this.notifications.enqueueNotification(n.id);
    } catch (error) {
      this.logger.warn('Failed to notify requester of category decision', error as Error);
    }
  }
}
