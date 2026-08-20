# PROJECT_CONTEXT — Dawrha Backend (ملف إعادة الدخول الشامل)

> **اقرأ هذا الملف وحده في بداية أي جلسة** بدل إعادة قراءة ملفات المشروع.
> المرافقون: **API_REFERENCE.md** (توصيف كل endpoint) · **API_USER_APP.md / API_DRIVER_APP.md / API_ADMIN_APP.md** (واجهات كل تطبيق) · **ROOMS_SESSIONS.md** (غرف/جلسات كل مستخدم) · **SESSIONS_GUIDE.md** (شرح الجلسات الكامل) · **FIXES.md** (سجل كل جولة إصلاح) · **ORDERS_DESIGN.md** (تصميم الطلبيات — لم يُنفَّذ).
> آخر تحديث: 2026-08-17 · Stack: NestJS 11 + TS 5.7 + PostgreSQL/TypeORM + Redis/ioredis + BullMQ + Socket.IO + Firebase + Cloudinary + **Odoo (addon مخصص `recycle_warehouse`)**.
> **آخر جولة (2026-08-17):** منظومة الجمع (Collection) — سبرينت 1–4 كاملة: الطلبات/الإسناد/الخطط/التنفيذ/نقاط التغطية/التقارير + واجهة الأدمن (§14–18). تفاصيل: FIXES #147–155 · تصميم: `COLLECTION_DESIGN.md` · عقد الـ API: `COLLECTION_API.md` + أقسام API_REFERENCE.

## 0. تشغيل وتحقق

- API: `npm run start:dev` · Worker الصيانة: `npm run start:worker:dev` (يتطلب `MAINTENANCE_WORKER=true`).
- بعد أي سحب: `npm run migration:run` ثم `npm run seed` (كلاهما idempotent).
- التحقق المعتمد بعد كل تعديل: `npx tsc --noEmit` + `npx jest` (24 suites / 154 tests) + `npx jest --config test/jest-e2e.json response-envelope` (6 — عقد الريسبونس والترجمة، بلا DB).
- env (Joi يتحقق من الكل fail-fast): `DB_*, REDIS_*, JWT_{ACCESS,REFRESH,TEMPORARY}_SECRET + *_EXPIRATION, GOOGLE_CLIENT_ID, FIREBASE_*, CLOUDINARY_*, MAIL_*, ODOO_URL/DB/USERNAME/PASSWORD/GROUP_ID, ODOO_WEBHOOK_SECRET (اختياري ≥32 حرفاً — بدونه كل الـ webhooks ترجع 503)`.

## 1. المعمارية والعقود الثابتة

- **الطبقات**: Controller → Service → Repository. البادئة `/api`؛ ذوات `version:'1'` → `/api/v1` (media وnotifications بلا نسخة → `/api`).
- **الريسبونس الموحّد** (مُثبت بـ `test/response-envelope.e2e-spec.ts`): الخدمة ترجع `{message, result}` والـ interceptor يلف: نجاح `{success:true, message(مترجمة حسب x-lang), data, statusCode, timestamp}` · خطأ `{success:false, message, errorCode?, data:null, ...}`. ممنوع `''` في القيم (null) وممنوع تعشيش data.
- **الاستثناءات**: مسماة لكل موديول في `<module>/exceptions/*.exceptions.ts` (auth/waste/warehouse/truck/shift/media/user/account-management/notification) — ترث فئة Nest المطابقة وتحمل `errorCode` UPPER_SNAKE؛ `common/exceptions/app.exception.ts` أساس عام.
- **i18n**: هيدر `x-lang`/`lang` أو Accept-Language؛ القواميس `src/i18n/{ar,en}/translation.json` (مفاتيح = الجملة الإنجليزية الحرفية). محتوى حول/الشروط تحت `content.*`.
- **الصلاحيات**: جدولا `permissions` + `role_permissions`؛ المفاتيح والخرائط في `waste-management/common/constants/permissions.ts` تُزرع idempotent عند الإقلاع (`PermissionSeederService`)؛ الفرض بـ `@Permissions('key')` + `PermissionsGuard` (كاش Redis ساعة). **إضافة صلاحية جديدة لأي موديول = سطر بالكتالوج + سطر بالخريطة فقط.**
- **عمليتان**: `main.ts` (API) و`main.worker.ts` (كرونات الصيانة فقط).

## 2. خريطة الموديولات (سطر لكل موديول)

| Module | المسؤولية |
|---|---|
| core/{config,database,redis,mail,queue,cloudinary} | env+Joi · TypeORM(migrationsRun, snake) · REDIS_CLIENT · OTP+طابور بريد · BullMQ · صور |
| LoggerModule | Winston دوّار + Morgan |
| Auth | تسجيل/دخول (محلي+Google) لكل الأدوار، OTP، JWT ثلاثي (access/refresh/temporary)، أجهزة، Strategy Pattern لحالات الحساب (`handlers[AccountStatus]`) |
| User | البروفايل، `PATCH profile` (ACTIVE فقط)، كلمة المرور، مواقع المواطن المتعددة |
| Permissions | كما في §1 |
| Onboarding | خطوات المنشآت/المعامل/الشركاء/الجامعين (base + 4 مشتقات)؛ اكتمال جامعٍ → **دفع طلبه لـ Odoo** |
| Media | مستندات مع transactions+rollback؛ إعادة رفع السائق → **إعادة دفع طلبه لـ Odoo** |
| AccountManagement | مراجعة حسابات المنشآت/المعامل/الجهات الحرة فقط (**السائقون يُدارون في Odoo** — `DriverManagedInOdooException` عند محاولة محلية، ومسار قائمة collector محذوف) |
| Notification | in-app + FCM + طابور + كرون retry + soft-delete |
| Content | `GET /content/{about,terms}` عامة من i18n |
| waste/catalog(+public) | القراءة: تصنيفات (كاملة للجميع) / my-categories + my-materials (تصنيفات الـ onboarding) / منتجات / عروض / بحث تزايدي (البادئة أولاً) / availability / conditions / units |
| waste/cart | سلة بحدود لكل دور + snapshot سعر/وحدة/**حالة** |
| waste/admin | CRUD تصنيفات/منتجات/**عروض (بحالة + target_roles)**/وحدات/حالات + Odoo jobs |
| waste/admin/pricing | تسعير: فردي+مؤسسات رقم واحد، **معمل+جهة حرة لكل حالة** + أرشيف كامل |
| waste/suggestions, category-requests, common | اقتراحات · طلبات تصنيفات المؤسسات · (Audit, AssignedCategory, CatalogCache, Units, Conditions, Seeder) |
| Truck | أسطول ممرأى من Odoo (قراءة) + تتبّع Socket.IO + **راوتات السائق فقط**: `GET /driver/my-truck` (شاحنة+مستودعها+وردية أو "سيتم إسنادك قريباً") · **استلام/تسليم**: `POST /driver/pickup` · `POST /driver/dropoff` (سبب إلزامي) · `GET /driver/handover-status` — قيود نافذة الوردية (لا استلام قبل البدء/لا تسليم قبل النهاية، والمعطّلة تُسلَّم بأي وقت) + كرون worker يُشعر السائق (FCM) والمدير (أودو) عند بدء بلا استلام/نهاية بلا تسليم؛ حضور السائقين شاشة عرض-فقط بأودو تحت الورديات · `shift-change-requests` v2 (السائق يطلب وردية مستودعه بسبب؛ `POST`/`GET mine`/`GET available-shifts`/`DELETE :id` قيد-الانتظار→حذف من النظامين؛ **القرار للمدير في أودو**) · `POST /truck-problems` (سبب+صور→ يقرأها مدير المستودع بأودو قراءة فقط، ويُشعَر). إسناد سائق↔شاحنة↔وردية + حظر/تعطيل حصراً بشاشات أودو. `SYNC_FLEET` يُعيد المرآة ويُشعر الأدمن |
| Shift | قراءة فقط (تُدار في Odoo؛ Morning/Evening seed كـ bootstrap). `shift_type` (DRIVER/WAREHOUSE) + `is_active`: `GET /shifts` يعيد ورديات DRIVER الفعالة فقط؛ حذف الوردية في Odoo يحذف/يعطّل مرآتها |
| Warehouse | إنشاء (backend→Odoo، مع governorate)، استيراد، جرد **مجمّعاً بالحالات**، sync، `truck_count` |
| Odoo / OdooSync | عميل JSON-RPC وحيد (جلسة مكاشة Redis 25د + timeout 10s) · طابور `waste-odoo-sync` (handler-map) + **كل الـ webhooks** |
| Reports / Maintenance | إحصائيات الأدمن (`overview/accounts/trucks/drivers/warehouses/catalog` — `drivers` أُضيف 2026-07-20) · كرونات تنظيف بالـ worker فقط |
| collection-request | منظومة الجمع (التصميم: `COLLECTION_DESIGN.md`): طلبات المواطنين/المنشآت (`product_id+quantity+lines` — **بلا سلة**، المحطة = request على route) · **محرك توزيع** بستة أوزان + مرشّحات أهليّة + عرض→قبول/رفض→route · دمج طرق قريب + إعادة elect عند الرفض/الانتهاء + NEEDS_ADMIN | **الأدمن**: سجلّ+إسناد يدوي+إلغاء · نقاط تغطية CRUD · `dispatch-config` (صف singleton، يضبط rebalance الدوري) · تقارير (يومي/طلبات/طرق) | **السائق**: قبول/رفض العرض · جولته · arrive/weigh/deliver (طوابع + `REGISTER_INTAKE`→Odoo + نقاط جمع) · مبدّل وردية المناوبة (كرون) | المتجر: جداول `collection_*` |

## 3. مخطط قاعدة البيانات (سطر لكل جدول — SnakeNaming)

**الهوية**: `accounts` (role, accountStatus, provider) · `user_devices` (refreshToken hashed, fcmToken, language; UQ account+device) · بروفايلات 1:1 لكل دور · materials 1:1 + جداول ربط `*_waste_category` (تصنيفات الـ onboarding) · `provinces`, `locations` (geography Point) · `institution_types` · `account_progress` · `permissions`+`role_permissions` · `media` (polymorphic + status) · `notifications` (+فهرس user,is_read,created_at).
**السوق**: `waste_categories` (odooCategoryId) · `products` (unitType code, odooProductId) · `measurement_units` (**ديناميكية**: code, is_weight, **allows_tolerance**, odooUnitId) · `material_conditions` (**ديناميكية**: code, sort_order, odooConditionId) · `product_pricing`(+`_history`) (tier + **condition_code** null للفردي/المؤسسات) · `offers` (**condition_code + target_roles[]** null=للجميع) · `carts`+`cart_items` (snapshot سعر/وحدة/**condition_code**) · `product_suggestions` · `category_requests` · `audit_logs`.
**المستودعات**: `warehouses` (odooWarehouseId, zones jsonb, **governorate**) · `warehouse_inventory` (**صف لكل مستودع+منتج+حالة**؛ UQ ثلاثي؛ UNGRADED=غير مفروز) · `warehouse_managers` · `collector_profiles.warehouse_id` (مستودع السائق، مرآة من قرار أودو — 2026-07-21).
**الأسطول (مرآة Odoo)**: `trucks` (odooTruckId UQ, **warehouse_id FK**) · `shifts` (odooShiftId, **odooWarehouseId, tolerance**) · `truck_assignments` (odooAssignmentId; UQ truck+shift; 1:1 سائق) · `shift_change_requests` (odooRequestId, **reason**, truck_id nullable — يملؤه المدير عند القبول) · `truck_problems` (odooProblemId, driver, reason, images jsonb) · `truck_handovers` (**استلام/تسليم**: driver+shift+workDate فريد، pickedUpAt/droppedOffAt/dropoffReason/lateDropoffMinutes/status، حارسا إشعار) · `truck_location_logs`.
**الجمع**: `collection_requests` (requestNumber تسلسلي يومي، type IMMEDIATE/SCHEDULED/PLAN، حالة، product خطوط `collection_request_lines`، إحداثيات نصية، تقديرات/فعليات، routeId+routeSequence — المحطة = الطلب) · `collection_routes` (routeNumber تسلسلي يومي، driverId، حالة PLANNED→COMPLETED، طوابع) · `collection_request_assignments` (سجلّ عرض كل سائق: OFFERED/ACCEPTED/REJECTED/EXPIRED + score + offerExpiresAt) · `collection_plans` (+ `_items`) للطلب المجدول المنشأ من الخطة (نافذة tolerance) · `coverage_points` (نقاط الركن: type SCHOOL/MARKET/HOSPITAL/GENERAL، إحداثيات، radius، priority، is_active — الحذف soft) · `driver_coverage_assignments` (من يقف أين + is_active) · `dispatch_config` (صف singleton: أوزان الستة، acceptWindowSec، scheduledLeadMin، routeMergeMax{Min,Km}، institutionToleranceMin، rebalanceMin، is_enabled).

## 4. تكامل Odoo — القلب (اتجاهان، كتابة عبر الطابور حصراً)

**Backend → Odoo (jobs في `waste-odoo-sync`، retry+تعويض delete-if-never-synced+إشعار):**
SYNC/DELETE لكل من CATEGORY, PRODUCT, UNIT (مع allows_tolerance), CONDITION · UPDATE_PRICING (يدفع **مصفوفة أسعار الحالات** للشريحتين عبر `replaceConditionPrices` → `recycle.product.condition.price`) · CREATE_WAREHOUSE (recycle.warehouse+zones+governorate) · PUSH_DRIVER_REQUEST (اكتمال onboarding جامع/إعادة رفع صوره) · PUSH_SHIFT_CHANGE.

**Odoo → Backend (webhooks بسر `x-odoo-webhook-secret` مقارنة constant-time، كلها تُرجع 202 وتُجدول job):**
| Webhook | يفعل |
|---|---|
| `POST /odoo/webhooks/inventory` و`/warehouse` | SYNC_WAREHOUSE: بيانات المستودع (name/code — Odoo يفوز) + أسطر المخزون لكل حالة + حذف الزائل |
| `/fleet` | SYNC_FLEET: ورديات ← شاحنات (بمستودعها) ← إسنادات (upsert بمعرف Odoo + حذف المزال + مواءمة shiftId السائق + إعادة حساب حالات الشاحنات). **يُشعِر كل أدمن** عند شاحنة جديدة أو تغيّر إسناد مستودعها. المسار الفعلي `/api/v1/odoo/webhooks/fleet` — Odoo يستدعيه من `recycle.truck`/`recycle.driver.assignment` عبر `notify_fleet_changed()` |
| `/driver-decision` | دورة حياة السائق كاملة من Odoo: `{backend_driver_id, status: ACTIVE\|REJECTED\|BLOCKED\|NEED_CHANGES (أو approved bool), rejection_reason?, truck_odoo_id?, shift_odoo_id?, rejected_media_ids?[]}` → تحديث الحساب + وسم الصور المحددة REJECTED (بفحص ملكية) + إسناد فوري اختياري + إشعار. دفع الطلب لـ Odoo يشمل صور المستندات (media id/type/url) وOdoo يعمل upsert بـ backend_driver_id |
| `/shift-change-decision` | `{backend_request_id, approved, rejection_reason?}` → نقل الإسناد أو رفض + إشعار مترجم |

**عقد الـ addon (`recycle.*`) المطلوب تنفيذه في مشروع Odoo القادم** (التفاصيل الحرفية في FIXES):
`product.category` · `product` · `measurement.unit` (code, allows_tolerance) · `material.condition` (code, sort_order) · `product.condition.price` (product, tier: factory|free_facility, condition_code, price — **الفوترة تقرأه**) · `warehouse` (+zones, governorate, manager) · `stock` (product, quantity, **condition_code** يملؤه الفرز؛ التطابق إلزامي لوحدات allows_tolerance=false) · `shift` · `truck` (warehouse_id, is_active) · `driver.assignment` (backend_driver_id) · `driver.request` (backend_driver_id — حدّث الموجود) · `shift.change.request` (backend_request_id) + Automated Actions تستدعي الـ webhooks أعلاه.

## 5. قواعد العمل السريعة

- **الأدوار→الشرائح**: CITIZEN→INDIVIDUAL، INSTITUTIONS→COMPANY، FACTORY→FACTORY، EXTERNAL_PARTNER→FREE_FACILITY.
- **التسعير**: فردي/مؤسسات سعر واحد؛ معمل/جهة حرة **سعر لكل حالة** (إجباري تحديد الحالة في السلة → 400 CONDITION_REQUIRED)؛ أي تعديل يؤرشف القديم (`_history` مع الحالة) ويعيد تسعير السلال بمطابقة الحالة.
- **العروض**: `condition` اختيارية (تثبّت الحالة على سطر السلة وتفوز على اختيار المشتري) + `target_roles` اختيارية (null=للجميع؛ غير المستهدف لا يراه ويُرفض بـ OFFER_NOT_AVAILABLE).
- **السلة**: حدود لكل دور في `cart.config.ts` (مواطن 1/100 يومي، مؤسسة 10/-, معمل وجهة حرة 50/-)؛ الوزن الأدنى يُجمع من الوحدات `is_weight` فقط.
- **OTP**: hashed SHA-256، TTL 600s، cooldown 120s، 10/يوم، قفل 5 محاولات، timingSafeEqual؛ نسيت كلمة المرور بلا كشف تعداد + resend + ticket عشوائي single-use.
- **التوكن المؤقت**: مفتاح الرد `token` (lowercase — منذ 2026-07-11).
- **التصنيفات**: القائمة كاملة للجميع؛ تقييد المؤسسات باقٍ على المنتجات/العروض؛ `my-categories`/`my-materials` = اختيارات الـ onboarding.

## 6. Socket.IO (namespace `/tracking` — JWT في handshake + blacklist)

`truck:location` (سائق→سيرفر→غرفتي `truck:<id>`+`admins`) · `truck:stop`/`truck:stopped` (يثبّت بالـ DB) · `truck:subscribe/unsubscribe` و`admin:subscribeAll` (أدمن) · انقطاع السائق = finalizeStop تلقائي. (غرف `order:<id>` مخططة في ORDERS_DESIGN).

## 7. قرارات معمارية (لا تُعاد مناقشتها بلا سبب وجيه)

Strategy لحالات الدخول · Odoo write=طابور فقط + تعويض · كاش الكتالوج بعدّاد نسخة O(1) fail-open (تصنيفات/منتجات 12h، عروض 6h) · كاش صلاحيات 3600s · وحدات وحالات **ديناميكية** بجداول admin بكاش 60s in-memory (KG/PIECE وEXCELLENT..DAMAGED تُزرع seed لا migration) · availability بلا كاش (طزاجة) · **Odoo سيد الأسطول** والـ backend مرآة+بوابة تطبيق السائق · حذف مرايا ما يزيله Odoo (stock lines/assignments) · الصيانة بالـ worker · هجرات فقط (synchronize:false).

## 8. الحالة + المعلّق

- **منجز ومختبر**: كل ما سبق + منظومة الجمع (97 suites / **993 tests** + tsc/eslint نظيفان).
- **غير منفَّذ**: منظومة الطلبيات (التصميم كامل في ORDERS_DESIGN.md — 4 sprints؛ "الأكثر استخداماً" ينتظر `order_items`).
- **بانتظار قرار المستخدم**: مجلد `db/migartions/` المكرر بخطأ إملائي (لا يُلمس) · تنظيف typing في onboarding (`dto:any` + typo `acccountRepo`) · تحويل استثناءات onboarding/institution للنمط المسمى.
- **الخطوة القادمة المعلنة**: المستخدم سيسلّم **مشروع Odoo** لتنفيذ الـ addon حسب عقد §4 (يشمل عقود `recycle.collection.request/backend_register_intake`).
