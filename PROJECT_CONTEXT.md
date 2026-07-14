# PROJECT_CONTEXT — Dawrha Backend

> ملف سياق يُقرأ **مرة واحدة** في بداية أي جلسة عمل بدل إعادة قراءة كل الملفات.
> آخر تحديث: 2026-07-10 (جولتان) · Stack: NestJS 11 + TypeScript 5.7 + PostgreSQL (TypeORM) + Redis (ioredis) + BullMQ + Socket.IO + Firebase + Cloudinary + Odoo.

---

## 1. نظرة عامة على المعمارية

- **نمط الطبقات:** `Controller → Service → Repository (TypeORM)`. الطبقات مفصولة بوضوح.
- **البادئة العامة:** كل المسارات تحت `/api`. الـ Controllers التي تحمل `version:'1'` تصبح `/api/v1/...`؛ التي بلا version (media, notifications) تبقى `/api/...`.
- **الاستجابة الموحّدة:** `TransformInterceptor` يلفّ كل رد بـ `{ success:true, message, data, statusCode, timestamp }`. الاصطلاح: الـ service يرجّع `{ message, result }` والـ interceptor يحوّل `result → data` (وبلا نتيجة → `data:null`) ويترجم `message` عبر i18n.
- **الأخطاء الموحّدة:** ثلاثة فلاتر عامة بالترتيب `LoggerExceptionsFilter → AllExceptionsFilter → DatabaseExceptionFilter`. الرد الموحّد `{ success:false, message, errorCode?, data:null, statusCode, timestamp }`. الاستثناءات المخصصة **مسماة لكل موديول** في `<module>/exceptions/*.exceptions.ts` (auth / waste-management / notification) — ترث فئة Nest المطابقة وتحمل `errorCode` UPPER_SNAKE ثابتاً للفرونت؛ و`src/common/exceptions/app.exception.ts` أساس عام للحالات غير النمطية. **العقد مُثبت باختبار تكامل**: `test/response-envelope.e2e-spec.ts` (يشمل تحقق الترجمة العربية فعلياً).
- **i18n:** لغة الطلب من هيدر `x-lang`/`lang` أو query `lang` أو Accept-Language. الملفات في `src/i18n/{ar,en}/translation.json`. الرسائل تُترجَم كـ مفاتيح تحت `translation.*`.
- **عمليتان منفصلتان:** `main.ts` (API + HTTP) و `main.worker.ts` (worker بلا HTTP يشغّل كرونات الصيانة فقط، مُفعّل بـ `MAINTENANCE_WORKER=true`).

## 2. خريطة الموديولات (سطر لكل موديول)

| Module | المسؤولية |
|---|---|
| `CoreModule` | يجمّع البنية التحتية: Config, Database, Redis, Mail, Queue, Cloudinary |
| `core/config` | تحميل env + تحقق Joi (`configuration.ts`) |
| `core/database` | اتصال TypeORM/Postgres، `migrationsRun:true`, `synchronize:false`, SnakeNamingStrategy |
| `core/redis` | مزوّد `REDIS_CLIENT` (Global) + `RedisService` (get/set/del) |
| `core/mail` | توليد/إرسال OTP + قائمة انتظار بريد (BullMQ) + `MailProcessor` |
| `core/queue` | إعداد BullMQ العام (Global) على Redis |
| `core/cloudinary` | رفع/حذف الصور على Cloudinary |
| `LoggerModule` | Winston (ملفات دوّارة) + Morgan middleware |
| `AuthModule` | تسجيل/دخول (محلي + Google)، OTP، JWT (access/refresh/temporary)، أجهزة، Strategy Pattern لحالات الحساب |
| `UserModule` | الملف الشخصي، تغيير كلمة المرور، مواقع المواطن المتعددة |
| `PermissionsModule` | صلاحيات role-permission + `PermissionsGuard` + كاش Redis للصلاحيات |
| `OnboardingModule` | تدرّج تسجيل المنشآت/المصانع/الشركاء/الجامعين خطوة بخطوة (base service + 4 خدمات مشتقة) |
| `MediaModule` | رفع/إعادة رفع/حذف صور المستندات مع transaction rollback ضد الملفات اليتيمة |
| `AccountManagementModule` | إدارة الأدمن للحسابات: مراجعة/موافقة/حظر + مراجعة الوسائط |
| `NotificationModule` | إشعارات in-app + Firebase push + قائمة انتظار + كرون إعادة المحاولة |
| `InstitutionModule` | أنواع المنشآت (CRUD محدود) |
| `WasteManagementModule` | تصنيفات النفايات (legacy controller) |
| `waste/catalog` | القراءة (الرئيسية): تصنيفات/منتجات/عروض/بحث، مع كاش وتقييد حسب الدور |
| `waste/catalog/public` | نفس القراءة للضيوف (OptionalJwtAuthGuard) |
| `waste/cart` | سلة الشراء، تسعير حسب tier الدور، حدود يومية للمواطن |
| `waste/admin` | إدارة الكتالوج (CRUD تصنيف/منتج) + مزامنة Odoo |
| `waste/admin/pricing` | تسعير أربع شرائح + أرشفة تاريخ الأسعار + إعادة تسعير السلال |
| `waste/suggestions` | اقتراح المستخدم لمنتجات جديدة |
| `waste/category-requests` | طلب الشركات لتصنيفات إضافية + موافقة/رفض الأدمن |
| `waste/common` | مزوّدات مشتركة: AssignedCategory, AuditService, CatalogCache, PermissionSeeder |
| `TruckModule` | **قراءة** الأسطول الممرأى من Odoo + طلبات تبديل الوردية (تقديم/عرض) + **تتبّع لحظي عبر Socket.IO** |
| `ShiftModule` | ورديات العمل (قراءة فقط — تُدار في Odoo) |
| `WarehouseModule` | المستودعات: إنشاء (backend→Odoo)، استيراد من Odoo، جرد، مزامنة |
| `OdooModule` | عميل Odoo عبر JSON-RPC (`OdooService`) — **نقطة الاتصال الوحيدة بـ Odoo** |
| `OdooSyncModule` | facade يضيف مهام مزامنة + `OdooSyncProcessor` يملك RPC + التعويض (compensation) |
| `ReportsModule` | إحصائيات لوحة الأدمن (تجميع فقط) |
| `MaintenanceModule` | كرونات تنظيف تعمل فقط في worker (حذف إشعارات/حسابات شبحية) |

## 3. نقاط التكامل الخارجية (الملف المسؤول)

| الخدمة | الملف/الموديول | البروتوكول/ملاحظات |
|---|---|---|
| **Odoo** | `src/odoo/odoo.service.ts` | JSON-RPC عبر `@nestjs/axios`؛ endpoints: `/web/session/authenticate` + `/web/dataset/call_kw`. يستهدف addon مخصص `recycle.*` (recycle.product.category / recycle.product / recycle.warehouse / recycle.stock). |
| **Odoo (تنسيق)** | `src/odoo-sync/*` | كل الكتابة إلى Odoo تمرّ عبر BullMQ (`waste-odoo-sync`)؛ الخدمات لا تنادي Odoo مباشرة — تضيف job. |
| **Redis** | `src/core/redis/*` | كاش، جلسات refresh، OTP، تتبّع الشاحنات، rate-limit، كاش الكتالوج والصلاحيات. |
| **BullMQ** | `src/core/queue/*` + queues في mail/notification/odoo-sync | `maxRetriesPerRequest:null` مطلوب لـ BullMQ. |
| **Cloudinary** | `src/core/cloudinary/cloudinary.service.ts` | رفع صور المستندات والشعارات وصور الشاحنات. |
| **Firebase (FCM)** | `src/notification/services/firebase.service.ts` | Push متعدد الأجهزة؛ يُهيّأ عبر `FIREBASE_ADMIN_APP` provider. |
| **Google OAuth** | `src/auth/utils/providers/google.provider.ts` | التحقق من `idToken` عبر google-auth-library. |
| **البريد (SMTP)** | `src/core/mail/*` | `@nestjs-modules/mailer` + قوالب EJS، عبر قائمة انتظار. |

## 4. القرارات المعمارية المتخذة (لا تُعاد مناقشتها)

- **Strategy Pattern لحالات تسجيل الدخول** بدل `if/else`: `auth/handlers/*.handler.ts` مُفهرسة في `AuthService.handlers[AccountStatus]`.
- **Odoo Write = Async فقط**: أي كتابة لـ Odoo تُضاف كـ job في `waste-odoo-sync`؛ سياسات retry/backoff لكل نوع في `odoo-sync.constants.ts`. الـ processor ينفّذ **التعويض** (حذف السجل اليتيم في backend) عند فشل المحاولة الأخيرة.
- **كاش الكتالوج بعدّاد نسخة (version counter)** بدل SCAN/KEYS: كل مفتاح يحمل `v<N>`؛ الإبطال = `INCR` للنسخة (O(1)). fail-open (أي خطأ Redis → رجوع لقاعدة البيانات). TTL: تصنيفات/منتجات 12h، عروض 6h.
- **كاش الصلاحيات في Redis** TTL يدوي = 3600s (`perm:<userId>`).
- **OTP** single-use، مُخزّن hashed (SHA-256)، TTL 600s، cooldown 120s، حد يومي 10، قفل بعد 5 محاولات، مقارنة `timingSafeEqual`. المصدر الوحيد للسياسة: `core/mail/mail.service.ts`.
- **التسعير:** الجدول الحيّ يحمل السعر الحالي فقط؛ أي تعديل ينقل القديم إلى `product_pricing_history`. Odoo يستقبل شريحتي FACTORY و FREE_FACILITY فقط (هما من يصدر أوامر مستودع).
- **تقييد الكتالوج بالدور:** فقط `INSTITUTIONS` مُقيّدة بالتصنيفات المُسندة لها؛ البقية ترى الكل (`AssignedCategoryProvider` يرجّع `null` = بلا تقييد).
- **المستودعات تُنشأ في backend وتُدفع لـ Odoo** (recycle.warehouse)، ثم الأدمن يسند المدير داخل Odoo ويُسحب بـ sync-manager.
- **وحدات القياس ديناميكية** (2026-07-10): جدول `measurement_units` يديره الأدمن — لا enum ثابت. الأعمدة تخزن `code` نصياً؛ التحقق عبر `UnitsService` (كاش 60s)؛ قاعدة وزن السلة عبر عَلَم `is_weight`. KG/PIECE تُزرعان في seed.
- **الأسطول يُدار من Odoo** (2026-07-12): الشاحنات (مع مستودعها) والورديات وإسنادات السائقين تُنشأ وتُقرَّر في Odoo وتُمرأى للـ backend عبر `SYNC_FLEET` (webhook `/odoo/webhooks/fleet`). طلبات انضمام السائقين وطلبات تبديل الوردية تُدفع من الـ backend لـ Odoo والقرار يعود عبر `driver-decision` / `shift-change-decision` webhooks. الـ backend قراءة فقط للأسطول لكنه يعرف ربط سائق↔شاحنة↔وردية لخدمة تطبيق السائق.
- **حالات المواد ديناميكية + تسعير لكل حالة** (2026-07-12): جدول `material_conditions` يديره الأدمن ويُدفع لـ Odoo؛ موظف الفرز يصنّف الكميات فتعود عبر المزامنة صفوفاً لكل (منتج، حالة) في `warehouse_inventory`؛ شريحتا FACTORY/FREE_FACILITY تُسعَّران **لكل حالة** (`product_pricing.condition_code`) وتُدفع المصفوفة لـ Odoo (`recycle.product.condition.price`)، بينما INDIVIDUAL/COMPANY سعر واحد؛ سلال المعامل/الجهات الحرة تتطلب `condition`.
- **وحدات القياس تُدفع لـ Odoo مع `allows_tolerance`** (2026-07-11): كل إنشاء/تعديل وحدة يُجدول `SYNC_UNIT` → موديل `recycle.measurement.unit` في addon المستودعات. `allows_tolerance=true` (وزنيات) = كمية موظف الفرز قد تخالف كمية الشحنة؛ `false` (قطعة) = تطابق إلزامي. الافتراضي = `is_weight`.
- **مفتاح التوكن المؤقت `token`** (lowercase — منذ 2026-07-11؛ كان `Token`): ردود التسجيل/التجديد المؤقت `data: { token }`.
- **مزامنة المخزون Odoo→Backend فورية عبر Webhook** (2026-07-10): Automated Action في Odoo على `recycle.stock` يستدعي `POST /odoo/webhooks/inventory` (سر مشترك `ODOO_WEBHOOK_SECRET`) فيُجدول `SYNC_WAREHOUSE` — لا polling. الـ sync اليدوي للأدمن ما زال متاحاً كاحتياط.
- **تتبّع الشاحنات في Redis** (ZSET للنشط + list للتاريخ) ويُثبَّت للـ DB فقط عند التوقّف/الانقطاع؛ كرون كل 5 دقائق ينظّف الشاحنات الخاملة.
- **الصيانة معزولة في worker منفصل** — لا تعمل الحذوفات على عمليات API.
- **الهجرات فقط** (`synchronize:false`, `migrationsRun:true`).

## 5. الحالة الحالية

### منتهي وسليم
Auth (محلي/Google/OTP/refresh)، Onboarding، Media، AccountManagement، Catalog+Cart+Pricing+Suggestions+CategoryRequests، Trucks+Tracking+Shifts، Notifications، Reports، Maintenance، Odoo-Sync (write via queue) والتعويض.

### أجزاء ناقصة
- **مجلد هجرات مكرر بخطأ إملائي:** `db/migartions/` بجانب `db/migrations/` (data-source يقرأ من `dist/db/migrations/*` فقط) — بانتظار قرار بشري.
- ~~دوال Odoo الميتة في `odoo.service.ts`~~ ✅ حُذفت (جولة 2026-07-08).

### Known Issues — أُصلحت في جولة 2026-07-08 (التفاصيل في [FIXES.md](FIXES.md))
1. ~~[حرج] تجاوز OTP في إعادة تعيين كلمة المرور~~ ✅ — الآن يستخدم `mailService.verifyResetOtp` + ticket عشوائي آمن.
2. ~~[حرج] فشل تجديد التوكن بعد انتهاء كاش Redis~~ ✅ — يستخدم `device.refreshToken` كمصدر للتحقق.
3. ~~[متوسط] حماية تعداد الإيميلات~~ ✅ — `forgotPassword` استجابة موحّدة + endpoint إعادة إرسال جديد `password/forgot/resend`.
4. ~~[متوسط] Odoo بلا timeout/session-cache~~ ✅ — timeout 10s + كاش جلسة في Redis.
5. ~~[متوسط] N+1 في قائمة المستودعات~~ ✅ — استعلام تجميعي واحد.
6. ~~كود ميت في `odoo.service` + `console.log` + `Math.random` + Joi ناقص~~ ✅.

**يبقى بحاجة قرارك:** مجلد `db/migartions/` المكرّر بخطأ إملائي (لا يُلمَس تلقائياً — انظر FIXES.md).

## 6. متغيرات البيئة (env)
`NODE_ENV, PORT, DB_*, REDIS_*, JWT_ACCESS_SECRET/REFRESH_SECRET/TEMPORARY_SECRET + *_EXPIRATION, GOOGLE_CLIENT_ID, FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY, CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET, ODOO_URL/DB/USERNAME/PASSWORD/GROUP_ID, ODOO_WEBHOOK_SECRET (اختياري — يفعّل webhook المخزون)` + إعداد SMTP. الـ `.env` مُهمَل في git (صحيح). `configuration.ts` يتحقق (Joi) من **كل** المتغيرات الحسّاسة (DB/Redis/JWT/Odoo/Firebase/Cloudinary/Google/Mail) — fail-fast عند الإقلاع (أُكمل في جولة 2026-07-08).

## 7. أحداث Socket.io (namespace `/tracking`)

المصدر: `src/truck/tracking/truck-tracking.gateway.ts`. المصادقة: JWT في الـ handshake (`auth.token` أو `?token=` أو Authorization header)، مع فحص blacklist في Redis. اتصال غير مصادق → حدث `error` ثم قطع.

| الحدث | مَن يُطلقه | مَن يستمع | الـ Payload |
|---|---|---|---|
| `truck:location` (إرسال) | سائق COLLECTOR (أو ADMIN) | السيرفر | `{truckId, lat, lng, speed?, heading?}` → ack `{status}` — السائق مخوَّل فقط لشاحنته المُسندة |
| `truck:location` (بث) | السيرفر | غرفة `truck:<id>` + غرفة `admins` | الموقع المخزَّن (Redis) |
| `truck:stop` | السائق أو ADMIN | السيرفر | `{truckId?}` → يثبّت آخر موقع في DB، ack `{status, savedLocation}` |
| `truck:stopped` | السيرفر | غرفة `truck:<id>` + `admins` | `{truckId, reason(MANUAL_STOP\|DRIVER_DISCONNECT), location}` |
| `truck:subscribe` / `truck:unsubscribe` | ADMIN فقط | السيرفر | `{truckId}` → ack `{status, location}` (آخر موقع معروف) |
| `admin:subscribeAll` | ADMIN فقط | السيرفر | — → ينضم لغرفة `admins`، ack `{status, active[]}` |
| `error` | السيرفر | العميل المرفوض | `{message: 'Unauthorized'}` |

> انقطاع socket السائق = `finalizeStop(DRIVER_DISCONNECT)` تلقائياً: يُثبّت آخر موقع في `truck_location_logs` ويبثّ `truck:stopped`.

## 8. مخطط قاعدة البيانات (سطر لكل جدول)

**الهوية والحسابات**
- `accounts` — الحساب المركزي (role, accountStatus, provider, googleId) · 1:N devices · 1:1 مع كل بروفايل
- `user_devices` — أجهزة الدخول: refreshToken (hashed argon2)، fcmToken، لغة الإشعارات · Unique(accountId, deviceId)
- `citizen_profiles`, `collector_profiles`, `factory_profiles`, `institution_profiles`, `external_partner_profiles` — 1:1 مع accounts (بيانات onboarding لكل دور)
- `factory_materials`, `institution_materials`, `external_partner_materials` — 1:1 مع البروفايل (كميات/جداول التوريد)
- `factory_waste_categories`, `institution_waste_categories`, `external_partner_waste_categories` — ربط material ↔ waste_categories (التصنيفات المُسندة)
- `provinces`, `locations` — مواقع المواطن (geography Point, srid 4326) · N:1 provinces
- `institution_types` — أنواع المنشآت · `account_progress` — خطوات onboarding المكتملة (json)
- `permissions`, `role_permissions` — صلاحية key لكل دور (تُزرع idempotent من `PermissionSeederService`)
- `media` — مستندات/صور polymorphic (ownerId+ownerType, status PENDING/APPROVED/REJECTED)
- `notifications` — إشعارات in-app (status, isRead, metadata jsonb, soft-delete)

**سوق النفايات (waste-management)**
- `material_conditions` — حالات المواد الديناميكية (code, name_ar/en, sort_order, odoo_condition_id) يديرها الأدمن
- `measurement_units` — وحدات القياس الديناميكية (code unique, name_ar/en, is_weight, is_active) يديرها الأدمن
- `waste_categories` — التصنيفات (odooCategoryId, odooSyncStatus) · 1:N products
- `products` — المنتجات (categoryId, unitType KG/PIECE, odooProductId, odooSyncStatus) · 1:N prices/offers
- `product_pricing` — السعر **الحالي** لكل tier (INDIVIDUAL/COMPANY/FACTORY/FREE_FACILITY, effectiveFrom/Until)
- `product_pricing_history` — أرشيف الأسعار المستبدلة (سبب الأرشفة)
- `offers` — عروض خصم على منتجات (validFrom/Until, isActive)
- `carts`, `cart_items` — السلة وعناصرها (سعر لحظة الإضافة حسب tier الدور)
- `product_suggestions` — اقتراحات منتجات من المستخدمين (status)
- `category_requests` — طلبات المنشآت لتصنيفات إضافية (categoryIds json, status, reviewedBy)
- `audit_logs` — تدقيق إجراءات الأدمن على الكتالوج

**المستودعات (مرايا Odoo)**
- `warehouses` — مرآة `recycle.warehouse` (odooWarehouseId, zones jsonb, odooSyncStatus, lastOdooSync)
- `warehouse_inventory` — مرآة `recycle.stock`: كمية كل منتج (odooProductId) في كل مستودع + reserved · Unique(warehouseId, odooProductId, conditionCode) — صف لكل حالة
- `warehouse_managers` — مدير المستودع المسحوب من Odoo (1:1 warehouses)

**الأسطول**
- `trucks` — الشاحنات (plateNumber unique, status ACTIVE/BUSY_ONE_DRIVER/FULLY_BUSY/DISABLED)
- `truck_assignments` — إسناد سائق↔شاحنة↔وردية · Unique(truck, shift) · 1:1 سائق
- `truck_location_logs` — آخر مواقع مثبّتة عند التوقف (reason)
- `shift_change_requests` — طلبات تغيير الوردية (status + سبب رفض)
- `shifts` — الورديات (name unique, start/end time)

> تفاصيل كل Endpoint (المدخلات/المخرجات/السيناريو/الصلاحيات): انظر **API_REFERENCE.md**.
