# API — تطبيق المستخدمين والمؤسسات (`API_USER_APP.md`)

> واجهة تطبيق واحد يخدم: **المواطن** (CITIZEN) · **المؤسسات** (INSTITUTIONS) · **المعامل** (FACTORY) · **الجهات الحرة** (EXTERNAL_PARTNER) — لكل جهة واجهات منفصلة داخل التطبيق.
> البادئة العامة `/api`؛ ذوات `version:'1'` → `/api/v1`. كل رد ملفوف بـ `TransformInterceptor` (انظر API_REFERENCE.md).
> الصلاحيات تُفرض بـ `@Permissions(...)` + `PermissionsGuard` (كاش Redis ساعة).

## 1. المصادقة والحساب — `/api/v1/auth` · `/api/v1/user`

| Method · Path | الدور | يأخذ (Body) | يرجّع | السيناريو |
|---|---|---|---|---|
| POST `register/citizen` \| `register/institution` | عام | `{ fullName, email, phoneNumber, password }` | `{ token }` (مؤقت) | حساب INACTIVE + OTP؛ إعادة إرسال OTP إن كان الإيميل موجوداً غير مؤكَّد، 400 إن مؤكَّد. |
| POST `login/user-app` | عام | `LoginDto {email, password, deviceId, deviceType?, fcmToken?, rememberMy?}` | `{ details:{status, token?}, role }` | دخول تطبيق المستخدم (citizen/institution/factory/external-partner). |
| POST `login/{user-app}/google` | عام | `LoginGoogleDto` | `{ details, role }` | دخول Google. |
| POST `otp/verify` | JwtTemporaryGuard | `{ otpCode(5), deviceId, deviceType?, fcmToken? }` | `{ details, role }` | تفعيل الحساب (CITIZEN→ACTIVE، غيره→PENDING_PROFILE). |
| POST `refresh-token` | RefreshTokenGuard | `{ deviceId }` + هيدر refresh | `{ accessToken, refreshToken }` | تجديد التوكن بمطابقة hash الجهاز. |
| POST `logout` | JwtAuthGuard | `{ deviceId }` | `{ message }` | مسح fcm/refresh + blacklist التوكن (600s). |
| PATCH `device/language` | JwtAuthGuard | `{ deviceId, language }` | `{ message, language }` | لغة إشعارات الجهاز. |
| GET/PATCH `user/profile` | JwtAuthGuard | `UpdateProfileDto {name?, phone?, description?}` | `{ account, profile }` | ملفي — **حساب ACTIVE فقط**. |
| PATCH `user/password` | JwtAuthGuard | `ChangePasswordDto` | `{ message }` | تغيير كلمة المرور. |
| GET/POST/DELETE `user/locations` \| `user/locations/:locationId` | CITIZEN | `LocationDto {coordinates[2], address, descriptionAddress, provinceId}` | `{ id, message }` | المواقع المسجلة للمواطن. |

### استعادة كلمة المرور (تطبيق المستخدم)
`POST password/forgot` → `POST password/forgot/resend` → `POST password/verify` (`{email, otpCode}` → `{ resetTicket }` صالح 600s) → `PATCH password/reset`.

## 2. واجهة المواطن (CITIZEN)

| Method · Path | الصلاحية | السيناريو |
|---|---|---|
| GET `waste/categories` + `categories/:categoryId/products` + `waste/search` | `waste.products.view` | تصفح الكتالوج والبحث. |
| GET `waste/offers` \| `waste/offers/search` | `waste.offers.view` | العروض المتاحة. |
| GET/POST `cart` · POST `cart/items` · PUT/DELETE `cart/items/:itemId` · POST `cart/offers` · DELETE `cart` | `cart.view` / `cart.manage` | السلة — **حد يومي: بند واحد / 100 (افتراضي)**، وزن أدنى من وحدات `is_weight` فقط. |
| POST `waste/products/suggest` | `waste.products.suggest` · Throttle 10/د | اقتراح مادة. |
| POST `collection-requests` · GET `collection-requests?status&type&page&limit` · GET `:id` · PATCH `:id/cancel` | `collection.requests.*` | **طلب جمع** (product_id+quantity+lines، بلا سلة) — محطة على مسار سائق. |
| socket `/collection` — `collection:subscribe {requestId}` | JWT | متابعة حالة طلبي لحظياً (أحداث `request:status`). |
| GET `notifications` · `unread-count` · `:id` · PATCH `:id/read` · `read-all` · DELETE `:id` \| `clear-all` | JwtAuthGuard | إشعاراتي (in-app + FCM). |

## 3. واجهة المؤسسات (INSTITUTIONS)

| Method · Path | الصلاحية | السيناريو |
|---|---|---|
| POST `onboarding/institution/{information, material, upload-doc}` | — | إكمال الملف → PENDING_APPROVAL. |
| GET `institution/institution-type?page` | INSTITUTIONS | أنواع المنشآت. |
| GET `waste/my-categories` · `waste/my-materials` | `waste.materials.view` | تصنيفاتي/موادي (اختيارات مرحلة المواد). |
| GET `waste/categories` + `products` + `offers` | view | الكتالوج والعروض (تسعير شريحة COMPANY). |
| GET/POST/PUT/DELETE `cart…` | `cart.*` | سلة بحدود المؤسسة. |
| POST `waste/category-requests` | `waste.categories.request` | طلب إضافة تصنيفات. |
| POST `collection-requests` (بمنتجات الجمع) · GET `collection-plans` | `collection.requests.*` / `collection.plans.*` | طلبات الجمع والخطط المجدولة. |

## 4. واجهة المعامل (FACTORY)

| Method · Path | الصلاحية | السيناريو |
|---|---|---|
| POST `onboarding/factory/{information, material, upload-doc}` | — | إكمال الملف. |
| GET `waste/my-materials` + `products/:productId/availability` | `waste.materials.view` / `waste.products.availability` | موادي + **التوافر لحظي** في كل مستودع (مرآة، بلا Odoo). |
| GET/POST/PUT/DELETE `cart…` | `cart.*` | سلة بحدود المعمل؛ **شرط `condition` إلزامي** (400 CONDITION_REQUIRED). |
| POST `collection-requests` | `collection.requests.*` | طلبات جمع بكميات ونتاجات. |

## 5. واجهة الجهات الحرة (EXTERNAL_PARTNER)

نظير واجهة المعامل تماماً (`onboarding/external-partner/…`, `my-materials`, `availability`, السلة بالحالات، عروض `target_roles` الخاصة). لا يشمل طلبات الجمع.

## 6. مشترك (كل الجهات)

| Method · Path | السيناريو |
|---|---|
| GET `content/about` \| `content/terms` | نص حول/الشروط (i18n، بلا مصادقة). |
| GET `waste/units` \| `waste/conditions` | الوحدات وحالات المواد (للسلة/الطلب). |
| PUT `media/:id` · GET `media/owner/:ownerId` · GET `media/:id` · DELETE `media/:id` | مستندات الملف (رفع/عرض/حذف). |

> **ليست في هذا التطبيق**: كل مسارات `admin/*`، و`driver/*`، و`/odoo/webhooks` (انظر `API_ADMIN_APP.md`، `API_DRIVER_APP.md`).
