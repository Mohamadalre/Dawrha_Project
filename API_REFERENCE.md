# API_REFERENCE — Dawrha Backend

> توصيف كامل لكل Endpoint: المسار، الحُرّاس/الصلاحيات، ما يأخذ، ما يرجّع، والسيناريو.
> كل رد ملفوف بـ `TransformInterceptor`: نجاح `{ success:true, message, data, statusCode, timestamp }` · خطأ `{ success:false, message, errorCode?, data:null, statusCode, timestamp }` — العمود «يرجّع» يصف محتوى `data`. الـ `errorCode` كود ثابت للفرونت من الاستثناءات المخصصة (`src/common/exceptions/app.exception.ts`). العقد مُثبت باختبار تكامل حقيقي: `test/response-envelope.e2e-spec.ts`.
> البادئة: `/api`. الموديولات ذات `version:'1'` → `/api/v1`. (media, notifications بلا نسخة → `/api`).

---

## Auth — `/api/v1/auth` (Throttle عام 10/دقيقة)

| Method · Path | حماية | يأخذ (Body) | يرجّع | السيناريو |
|---|---|---|---|---|
| POST `register/citizen` \| `register/institution` \| `register/collector` | عام | `{ fullName, email, phoneNumber, password }` | `{ token }` (temporary) | ينشئ حساب INACTIVE، يرسل OTP، يعيد توكن مؤقت. إن كان الإيميل موجوداً وغير مؤكّد يعيد إرسال OTP؛ إن كان مؤكّداً يرمي 400. |
| POST `register/{role}/google` | عام | `LoginGoogleDto {TokenId, deviceId, deviceType?, fcmToken?}` | `{ details, role }` | تسجيل عبر Google (citizen/institution/collector/factory/external-partner)؛ 400 إن الإيميل موجود. |
| POST `login/admin` \| `login/user-app` \| `login/collector-app` \| `login/factory-app` | عام · Throttle 5/د | `LoginDto {email, password, deviceId, deviceType?, fcmToken?, rememberMy?}` | `{ details:{status, token?}, role }` | يتحقق من الدور المسموح للتطبيق + كلمة المرور، ثم handler حسب حالة الحساب (ACTIVE→توكن كامل، PENDING_PROFILE→توكن+step، غيرها→status فقط). |
| POST `login/{user-app\|collector-app\|factory-app}/google` | عام | `LoginGoogleDto` | `{ details, role }` | دخول Google (rememberMy=true دائماً)؛ 404 إن لم يوجد حساب. |
| POST `otp/verify` | JwtTemporaryGuard | `VerifyOtpDto {otpCode(5 أرقام), deviceId, deviceType?, fcmToken?}` | `{ details, role }` | يؤكّد OTP، يفعّل الحساب (CITIZEN→ACTIVE، غيره→PENDING_PROFILE)، يُبطل التوكن المؤقت. |
| PUT `otp/resend` | JwtTemporaryGuard | — | `{ cooldownSeconds }` | يعيد إرسال OTP مع cooldown 120s وحد يومي 10 و429 عند التجاوز. |
| POST `password/forgot` | عام | `{ email }` | `{ message }` | يرسل OTP لإعادة التعيين باستجابة موحّدة لا تكشف وجود الإيميل (cooldown 120s). |
| POST `password/forgot/resend` | عام · Throttle 5/د | `{ email }` | `{ cooldownSeconds }` | إعادة إرسال OTP النسيان بنفس cooldown + سقف يومي، دون كشف وجود الإيميل. |
| POST `password/verify` | عام | `VerifyResetOtpDto {email, otpCode}` | `{ resetTicket }` | يتحقق فعلياً من OTP النسيان (يرمي عند الخطأ + قفل المحاولات) ويصدر ticket آمن صالح 600s. |
| PATCH `password/reset` | عام | `ResetPasswordDto {email, resetTicket, newPassword, confirmPassword}` | `{ message }` | يتحقق من الـ ticket، يحدّث كلمة المرور (argon2)، يبطل كل أجهزة الحساب، ويستهلك الـ ticket. |
| POST `refresh-token` | RefreshTokenGuard | `{ deviceId }` + Header refresh | `{ accessToken, refreshToken }` | يجدّد التوكنات بمطابقة hash المخزّن (أُصلح باگ الكاش — FIXES #2). |
| POST `temporary-token/refresh` | عام | `{ token }` | `{ token }` | يجدّد التوكن المؤقت لحساب INACTIVE فقط. |
| PATCH `device/language` | JwtAuthGuard | `{ deviceId, language }` | `{ message, language }` | يغيّر لغة إشعارات الجهاز. |
| POST `logout` | JwtAuthGuard | `{ deviceId }` | `{ message }` | يمسح fcm/refresh للجهاز ويضيف jti للـ blacklist (600s). |
| PUT `FCMToken` | JwtAuthGuard | `DeviceDto` | `{ message }` | يحدّث fcmToken/deviceType لجهاز موجود. |

## User — `/api/v1/user` (JwtAuthGuard)
| POST/GET/PATCH/DELETE | يأخذ | يرجّع | السيناريو |
|---|---|---|---|
| GET `profile` | — | `{ account, profile }` | حساب المستخدم (بلا كلمة مرور) + الملف حسب الدور. |
| PATCH `profile` | JwtAuthGuard | `UpdateProfileDto {name?, phone?, description?}` | `{ id, name, phone, description }` | تعديل المعلومات الأساسية لكل الأدوار — **حساب ACTIVE فقط** (403 `ACCOUNT_NOT_ACTIVE`)؛ فحص تفرد الهاتف؛ الإيميل غير قابل للتعديل. |
| PATCH `password` | `ChangePasswordDto {currentPassword, newPassword, confirmPassword}` | `{ message }` | يتحقق من الحالية + عدم التطابق مع القديمة. |
| GET `locations` | — | `Location[]` | مواقع المواطن (CITIZEN فقط). |
| POST `locations` | `LocationDto {coordinates[2], address, descriptionAddress, provinceId}` | `{ id, message }` | إضافة موقع (CITIZEN فقط). |
| DELETE `locations/:locationId` | — | `{ message }` | حذف موقع مملوك للمستخدم. |

## Onboarding — `/api/v1/onboarding[/…]` (JwtAuthGuard, AccountStatusGuard, RolesGuard)
تدفّق خطوة-بخطوة يتحكم به `AccountProgress.completedSteps`؛ إكمال آخر خطوة → `PENDING_APPROVAL` + إشعار.
| Path | الدور | يأخذ | يرجّع |
|---|---|---|---|
| POST `onboarding/institution/information` | INSTITUTIONS | `InformationInstitutionDto` + ملف (شعار) | `{ status, id, step? }` |
| POST `onboarding/institution/material` | INSTITUTIONS (ProfileOwnerGuard) | `WasteInstitutionDto {wasteCategoryId[], preferredCollectionTime, estimatedWasteQuantity, collectionFrequney}` | `{ status, step? }` |
| POST `onboarding/institution/upload-doc` | INSTITUTIONS | ملف | حالة الوثيقة |
| POST `onboarding/factory/{information,material,upload-doc}` | FACTORY | نظير المنشآت | نفس النمط |
| POST `onboarding/external-partner/{information,material}` | EXTERNAL_PARTNER | نظير | نفس النمط |
| POST `onboarding/collector/{information,upload-doc,location}` | COLLECTOR | معلومات/ملف/موقع | نفس النمط |
| POST `onboarding/location` | EXTERNAL_PARTNER, FACTORY, INSTITUTIONS | `LocationDto` | `{ status, step? }` |
| GET `onboarding/provinces?page` | أي مُصادَق | — | `Province[]` |

## Media — `/api/media` (JwtAuthGuard)
| Method · Path | يأخذ | يرجّع | السيناريو |
|---|---|---|---|
| PUT `:id` | ملف (multipart) | `{ status, image }` | رفع/تحديث صورة مستند (transaction + حذف من Cloudinary عند الفشل). |
| PATCH `:id/reupload` | ملف | `{ status, image }` | إعادة رفع صورة **مرفوضة** من مالكها → PENDING + الحساب PENDING_APPROVAL؛ **وللسائق**: يُعاد دفع طلبه تلقائياً لـ Odoo (PUSH_DRIVER_REQUEST) ليراجعه أدمن Odoo مجدداً. |
| DELETE `:id` | — | `{ message }` | حذف صورة. |
| GET `owner/:ownerId` | — | `{ count, images[] }` | صور مالك. |
| GET `:id` | — | `Media` (داخل result) | تفاصيل صورة؛ 404 إن غير موجودة. |

## Account Management (Admin) — `/api/v1/account-management` (JwtAuthGuard, PermissionsGuard)
| Method · Path | صلاحية | يأخذ | يرجّع | السيناريو |
|---|---|---|---|---|
| GET `{factory\|institution\|external-partner}?page&limit&status` (**collector أُزيل** — طلبات السائقين تُراجَع في Odoo) | `admin.accounts.view` | — | `{ items:[{profileId, account}], total, page, limit }` | قائمة حسابات دور، فلترة بالحالة. |
| GET `profile/:profileId` | view | — | تفاصيل الحساب+الملف+المواد+الموقع+imageIds | مراجعة ملف كامل. |
| GET `:profileId/media` | view | — | `Media[]` | صور ملف (PENDING_APPROVAL فقط). |
| GET `media/:mediaId` | view | — | `Media` | تفاصيل صورة. |
| PATCH `media/:mediaId/status` | `admin.accounts.manage` | `UpdateMediaStatusDto {status, description?}` | `{ message }` | موافقة/رفض صورة؛ الرفض → الحساب NEED_CHANGES + إشعار. |
| PATCH `:accountId/status` | manage | `UpdateAccountStatusDto {status, description?}` | `{ message }` | موافقة/رفض حساب PENDING_APPROVAL (يتطلّب عدم وجود وسائط PENDING). |
| PATCH `:accountId/block-status` | manage | `BlockedAccountStatusDto {status, description?}` | `{ message }` | حظر/فك حظر (ACTIVE↔BLOCKED فقط). |

## Waste — Catalog (قراءة) — `/api/v1/waste` (JwtAuthGuard, PermissionsGuard)
| Method · Path | صلاحية | يأخذ (Query) | يرجّع |
|---|---|---|---|
| GET `categories` | `waste.categories.view` | `CategoryQueryDto {page,limit,search?,sort,order}` | `{ categories[], pagination }` — **كل** التصنيفات الفعّالة لكل الأدوار (مكاش، بحث تزايدي). |
| GET `my-categories` | `waste.materials.view` (معمل/جهة حرة/مؤسسة) | — | `{ categories[] }` مع `product_count` — التصنيفات المُدخلة في مرحلة المواد بالـ onboarding فقط. |
| GET `categories/:categoryId/products` | `waste.products.view` | `ProductQueryDto {page,limit,sort,order,price_min?,price_max?}` | `{ category, products[], pagination }` |
| GET `search?type=all\|category\|product` | products.view | `SearchQueryDto` | `{ categories?, products? }` |
| GET `products/by-price` | products.view | `ByPriceQueryDto {min_price,max_price,page,limit}` | `{ products[], pagination }` |
| GET `units` | `waste.products.view` | — | `{ units[] }` — الوحدات الفعّالة (تشمل `allows_tolerance`). |
| GET `conditions` | `waste.products.view` | — | `{ conditions[]:{id,code,name_en,name_ar,sort_order} }` — حالات المواد الفعّالة (لاختيار الحالة عند السلة/الطلب). |
| GET `my-materials` | `waste.materials.view` (FACTORY وEXTERNAL_PARTNER وINSTITUTIONS والأدمن) | `{page?, limit?}` | `{ categories[], products[], pagination }` — **المواد التابعة للتصنيفات التي اختارها الحساب في مرحلة add-material-information بالـ onboarding** (تُقرأ من جداول ربط المواد للدور). دور بلا مرحلة مواد (مواطن) → 403 بـ `errorCode: MATERIALS_NOT_APPLICABLE`. |
| GET `products/:productId/availability` | `waste.products.availability` (FACTORY وEXTERNAL_PARTNER والأدمن فقط) | — (param: productId UUID) | `{ product:{id,name,unit_type}, total_available, in_stock, warehouses[]:{warehouse_id,name,code,address,quantity,reserved_quantity,available,synced_at} }` — الكمية المتوفرة من المادة في **كل مستودع نشط** من مرآة `warehouse_inventory` (بيانات Odoo المسحوبة بـ SYNC_WAREHOUSE، بلا نداء Odoo لحظي، بلا كاش لضمان الطزاجة). منتج غير مدفوع لـ Odoo → قائمة فارغة و`total_available: 0`. |
| ملاحظة التوافر | — | — | كل مستودع في رد availability يتضمن الآن `conditions[]:{condition, condition_label, quantity, reserved_quantity, available, price}` — الحالة وكميتها **وسعرها** لشريحة المشتري؛ وحمولة المنتج للمعامل/الجهات الحرة تتضمن `condition_prices[]` و`pricing.factory/free_facility` = أدنى سعر («يبدأ من»). سلة هذه الفئات تتطلب `condition` في `POST /cart` (بدونه 400 `CONDITION_REQUIRED`). |
| GET `offers` | `waste.offers.view` | `OfferQueryDto {page,limit,active_only,sort}` | `{ offers[], pagination }` |
| GET `offers/search` | offers.view | `OfferSearchQueryDto {query,category_id?,page,limit}` | `{ offers[], pagination }` |
| **Public** GET `/api/v1/waste/public/{categories,offers,offers/search}` | OptionalJwtAuthGuard | نفس أعلاه | نفس أعلاه (للضيوف) |

## Waste — Cart — `/api/v1/cart` (JwtAuthGuard, PermissionsGuard)
| Method · Path | صلاحية | يأخذ | يرجّع | السيناريو |
|---|---|---|---|---|
| GET `` | `cart.view` | — | `{ cart_id, items[], summary }` | عرض السلة + ملخص (min/max/checkable). |
| POST `items` | `cart.manage` | `AddToCartDto {product_id, quantity, unit_type, add_offer?}` | `{ cart_id, item_id, cart_summary }` | سعر حسب tier الدور أو العرض؛ حد يومي للمواطن. |
| PUT `items/:itemId` | manage | `UpdateCartItemDto {quantity, unit_type?}` | السلة المحدّثة | تعديل كمية بند مملوك. |
| DELETE `items/:itemId` | manage | — | `{ message }` | حذف بند. |
| POST `offers` | manage | `AddOfferToCartDto {offer_id, quantity, unit_type}` | `{ cart_id, item_id, cart_summary }` | إضافة عرض (يتحقق من صلاحية/انتهاء العرض). |
| DELETE `` | manage | — | `{ message }` | تفريغ السلة (cascade على البنود). |

## Waste — Admin Catalog — `/api/v1/admin/waste` (JwtAuthGuard, PermissionsGuard)
| Method · Path | صلاحية | يأخذ | يرجّع | السيناريو |
|---|---|---|---|---|
| GET `categories` | `admin.waste.manage` | `AdminListQueryDto` | `{ categories[], pagination }` | قائمة (مع فلترة الحالة). |
| POST `categories` | `admin.waste.create` | `CreateCategoryDto {name, description?, image?, is_active?}` | `{ category_id, odoo_status:'PENDING_SYNC' }` | إنشاء محلي PENDING + job مزامنة + audit + إبطال كاش. |
| PUT `categories/:categoryId` | `admin.waste.update` | `UpdateCategoryDto` | `{ category_id, odoo_status }` | تعديل + re-sync. |
| DELETE `categories/:categoryId` | `admin.waste.delete` | — | `{ message }` | حذف (يمنع إن به منتجات) + job حذف من Odoo. |
| GET `products` | manage | `AdminListQueryDto {…, category_id?}` | `{ products[], pagination }` | — |
| POST `products` | create | `CreateProductDto {name, category_id, unit_type, description?, image?, is_active?}` | `{ product_id, odoo_sync_status }` | إنشاء + job (يتطلّب مزامنة التصنيف أولاً). |
| PUT `products/:productId` | update | `UpdateProductDto` | `{ product_id, odoo_sync_status }` | — |
| DELETE `products/:productId` | delete | — | `{ message }` | حذف (يمنع إن بسلال نشطة). |
| GET `units` | manage | — | `{ units[]:{id,code,name_en,name_ar,is_weight,is_active} }` | كل وحدات القياس (الديناميكية) بما فيها المعطّلة. |
| POST `units` | create | `CreateUnitDto {code(A-Z0-9_), name_en, name_ar, is_weight?, allows_tolerance?}` | `{ unit }` (يشمل `allows_tolerance`, `odoo_sync_status`) | إنشاء وحدة (مثل TON) + **دفعها لـ Odoo** (job SYNC_UNIT → `recycle.measurement.unit`). `allows_tolerance`: true = كمية الفرز في Odoo قد تخالف كمية الشحنة (وزنيات)، false = تطابق إلزامي (قطعة: شحنة 5 قطع تُفرز 5 بالضبط). افتراضيه = `is_weight`. |
| PUT `units/:unitId` | update | `UpdateUnitDto {name_en?, name_ar?, is_weight?, allows_tolerance?, is_active?}` | `{ unit }` | تعديل + إعادة دفع لـ Odoo؛ يمنع التعطيل إن كانت مستخدمة بمنتجات فعّالة. |
| DELETE `units/:unitId` | delete | — | `{ message }` | حذف فقط إن لم تكن مستخدمة بأي منتج — غير ذلك عطّلها. |
| GET `conditions` | manage | — | `{ conditions[] }` (تشمل `odoo_sync_status`) | كل حالات المواد الديناميكية. |
| GET `offers` | manage | `AdminListQueryDto` | `{ offers[], pagination }` | كل العروض (مع المنتج والحالة). |
| POST `offers` | create | `{product_id, offer_price, discount_percentage?, condition?, target_roles? (مثل ["citizen"] — فارغ = للجميع), description?, valid_from?, valid_until?}` | `{ offer }` | إنشاء عرض على مادة — **`condition` اختيارية**: عرض موجّه لحالة محددة (للمعامل/الجهات الحرة). |
| PUT `offers/:offerId` | update | `UpdateOfferDto` (+`is_active`) | `{ offer }` | تعديل/تفعيل/تعطيل. |
| DELETE `offers/:offerId` | delete | — | `{ message }` | حذف العرض. |
| POST `conditions` | create | `{code(A-Z0-9_), name_en, name_ar, sort_order?}` | `{ condition }` | إنشاء حالة جديدة + دفعها لـ Odoo (SYNC_CONDITION) لتظهر لموظف الفرز. |
| PUT `conditions/:conditionId` | update | `{name_en?, name_ar?, sort_order?, is_active?}` | `{ condition }` | تعديل + إعادة دفع؛ يمنع التعطيل إن كان لها أسعار حيّة. |
| DELETE `conditions/:conditionId` | delete | — | `{ message }` | حذف فقط إن لم تكن مستخدمة بتسعير — غير ذلك عطّلها. |

## Waste — Pricing — `/api/v1/admin/waste/products` (JwtAuthGuard, PermissionsGuard, صلاحية `admin.pricing.manage`)
| Method · Path | يأخذ | يرجّع | السيناريو |
|---|---|---|---|
| POST `:productId/pricing` | `SetPricingDto {individual:number, company:number, factory:[{condition,price}], free_facility:[{condition,price}], effective_from?}` | `{ product_id, pricing, effective_from, updated_cart_items }` | يؤرشف القديم + يدخل الجديد لكل شريحة + يعيد تسعير السلال + job Odoo. |
| PATCH `:productId/pricing/:tier` | `UpdateTierPriceDto {price, condition? (إلزامي لـ FACTORY/FREE_FACILITY), currency?, effective_from?}` | `{ product_id, tier, price, … }` | تعديل شريحة واحدة فقط. |
| DELETE `:productId/pricing` | — | `{ product_id, archived_rows }` | أرشفة كل الأسعار الحيّة. |
| GET `:productId/pricing` | — | `{ product_id, pricing{4 tiers} }` | الأسعار الحالية. |
| GET `:productId/pricing/history` | — | `{ product_id, tiers{...[]} }` | تاريخ الأسعار المؤرشفة. |

## Waste — Suggestions & Category Requests
| Method · Path | حماية/صلاحية | يأخذ | يرجّع |
|---|---|---|---|
| POST `/api/v1/waste/products/suggest` | `waste.products.suggest` · Throttle 10/د | `CreateSuggestionDto {product_name, category_id, unit_type, …}` | إيصال الاقتراح |
| POST `/api/v1/waste/category-requests` | `waste.categories.request` | `CreateCategoryRequestDto {categoryIds[]}` | طلب مقدَّم |
| GET `/api/v1/admin/waste/category-requests` | `admin.categories.request.manage` | `CategoryRequestQueryDto` | قائمة الطلبات |
| PATCH `…/:requestId/approve` | manage | — | موافقة → إسناد التصنيفات |
| PATCH `…/:requestId/reject` | manage | `RejectCategoryRequestDto {reason}` | رفض |

## Trucks & Tracking & Shifts — **قراءة فقط: الأسطول يُدار في Odoo** (منذ 2026-07-12)
> أُزيلت: `POST /trucks`, `PATCH /trucks/:id`, `PATCH /trucks/:id/status`, `POST/DELETE /trucks/assign`, `PATCH /shifts/:id`, ومسارات قرار الأدمن في shift-change. الشاحنات/الورديات/الإسنادات تُنشأ في Odoo وتُمرأى هنا. `GET /trucks` يدعم `warehouseId` ويرجع مستودع كل شاحنة؛ قائمة المستودعات ترجع `truck_count`؛ السائق يقدّم طلب تبديل الوردية كما هو والقرار يأتي من Odoo.

| Method · Path | حماية/صلاحية | يأخذ | يرجّع | السيناريو |
|---|---|---|---|---|
| POST `/api/v1/trucks/assign` | `admin.trucks.manage` | `AssignDriverDto {truckId, driverId}` | إسناد | ربط سائق بشاحنة. |
| DELETE `/api/v1/trucks/assign/:driverId` | manage | — | فك إسناد | — |
| POST `/api/v1/trucks` | manage | `CreateTruckDto` + `mechanicsImage` | `{ truck_id, … }` | إنشاء شاحنة + رفع صورة. |
| GET `/api/v1/trucks?…` | `admin.trucks.view` | `ListTrucksQueryDto` | قائمة | — |
| GET `/api/v1/trucks/drivers?assigned&shiftId` | view | — | سائقون | — |
| GET/PATCH `/api/v1/trucks/:id` , `:id`, `:id/status` | view/manage | `UpdateTruckDto` / `UpdateTruckStatusDto` | — | جلب/تعديل/حالة. |
| GET `/api/v1/trucks/active` \| `:truckId/location` \| `:truckId/history` \| `:truckId/last-stop` | view | — | مواقع لحظية/تاريخ/آخر توقّف | يقرأ من Redis/DB. |
| GET `/api/v1/driver/my-truck` | RolesGuard COLLECTOR | — | شاحنة السائق | — |
| POST `/api/v1/shift-change-requests` | COLLECTOR | `CreateShiftChangeRequestDto {truckId, shiftId}` | طلب | تغيير وردية. |
| GET `…/mine` , DELETE `…/:id` | COLLECTOR | — | طلباتي / إلغاء | — |
| GET/POST/PATCH `/api/v1/admin/shift-change-requests[/process\|:id/status]` | `admin.trucks.*` | `ProcessRequestDto`/`UpdateRequestStatusDto` | معالجة | — |
| GET `/api/v1/shifts` , PATCH `:id` | JwtAuthGuard(+`admin.shifts.manage` للتعديل) | `UpdateShiftDto` | ورديات | — |

### Socket.IO — namespace `/tracking` (JWT في الـ handshake)
| Event (اتجاه) | Payload | السيناريو |
|---|---|---|
| `truck:location` (سائق→خادم) | `TruckLocationDto {truckId, lat, lng, speed?, heading?}` | السائق (COLLECTOR المُسند فقط) يبثّ موقعه؛ يُخزّن في Redis ويُبثّ للغرفة و`admins`. |
| `truck:stop` (سائق/أدمن→خادم) | `{ truckId? }` | إنهاء رحلة → تثبيت آخر موقع في DB. |
| `truck:subscribe` / `truck:unsubscribe` (أدمن) | `{ truckId }` | متابعة/إلغاء متابعة شاحنة. |
| `admin:subscribeAll` (أدمن) | — | متابعة كل الشاحنات (`active`). |
| `truck:location` / `truck:stopped` (خادم→مشترك) | موقع/توقّف | بثّ حيّ. |
| عند انقطاع السائق | — | تثبيت آخر موقع تلقائياً (`DRIVER_DISCONNECT`). |

## Warehouse (Admin) — `/api/v1/admin/warehouses` (JwtAuthGuard, PermissionsGuard)
| Method · Path | صلاحية | يأخذ | يرجّع | السيناريو |
|---|---|---|---|---|
| GET `` | `admin.warehouse.view` | `WarehouseListQuery {page,limit,status?}` | `{ warehouses[], pagination }` | قائمة + ملخص مخزون لكل مستودع. |
| POST `` | `admin.warehouse.manage` | `CreateWarehouseDto {name, code, latitude?, longitude?, address?, governorate?, zones?[]}` | `{ warehouse_id, status:'QUEUED' }` | إنشاء محلي PENDING + job دفع لـ Odoo (تعويض عند الفشل). |
| POST `:warehouseId/sync-manager` | `admin.warehouse.sync` | — | `{ warehouse_id, manager }` | سحب المدير المُسنَد داخل Odoo. |
| POST `import-odoo` | sync | — | `{ imported, created, updated }` | استيراد المستودعات+المدراء من Odoo. |
| GET `:warehouseId/inventory` | view | — | `{ inventory[], summary }` | جرد المستودع (من DB المُزامَن). |
| POST `:warehouseId/sync-odoo` | sync | `{ force_full_sync? }` | `{ sync_job_id, status:'QUEUED' }` | إضافة job سحب مخزون من Odoo. |

## Odoo Webhooks (Server-to-Server) — `/api/v1/odoo/webhooks`
| Method · Path | حماية | يأخذ | يرجّع | السيناريو |
|---|---|---|---|---|
| POST `inventory` (202) | هيدر `x-odoo-webhook-secret` (مقارنة constant-time مع `ODOO_WEBHOOK_SECRET`؛ غير مُهيّأ → 503) · Throttle 30/د | `{ odoo_warehouse_id? }` | `{ queued }` | **مزامنة فورية Odoo→Backend**: Automated Action في Odoo على `recycle.stock` (create/write) يستدعي هذا الـ endpoint عند أي تغيّر كميات، فيُجدول job `SYNC_WAREHOUSE` للمستودع المعني (أو للكل إن أُغفل المعرّف) — المرآة المحلية تتحدّث خلال ثوانٍ بدون polling وبدون انتظار sync يدوي. |
| POST `fleet` (202) | نفس الحماية | — | `{ queued }` | Automated Action على `recycle.truck`/`recycle.shift`/`recycle.driver.assignment` → مرآة كاملة للأسطول (شاحنات بمستودعاتها، ورديات، إسنادات — مع حذف ما أزاله Odoo وإعادة حساب حالات الشاحنات). |
| POST `driver-decision` (202) | نفس الحماية | `{backend_driver_id, approved?, status? (ACTIVE\|REJECTED\|BLOCKED\|NEED_CHANGES), rejection_reason?, truck_odoo_id?, shift_odoo_id?}` | `{ queued }` | **كامل دورة حياة السائق من Odoo**: قبول/رفض/حظر/طلب تعديل معلومات (+ إسناد فوري اختياري) + إشعار مناسب. الـ backend يرفض هذه الإجراءات محلياً للسائقين (`DRIVER_MANAGED_IN_ODOO`). |
| POST `shift-change-decision` (202) | نفس الحماية | `{backend_request_id, approved, rejection_reason?}` | `{ queued }` | قرار أدمن Odoo على تبديل الوردية: قبول → نقل الإسناد + مواءمة وردية السائق + إشعار؛ رفض → سبب + إشعار. |
| POST `warehouse` (202) | نفس الحماية | `{ odoo_warehouse_id? }` | `{ queued }` | نفس المعالج لتعديلات **بيانات المستودع** (Automated Action على `recycle.warehouse`): job المزامنة يسحب name/code المعدّلة في Odoo **ثم** الكميات — تعديلات Odoo تفوز وتنعكس تلقائياً. |

## Reports (Admin) — `/api/v1/admin/reports` (JwtAuthGuard, PermissionsGuard, `admin.reports.view`)
| GET `overview` \| `accounts` \| `trucks` \| `warehouses` \| `catalog` | — | إحصائيات مجمّعة | لوحة الأدمن. |

## Notifications — `/api/notifications` (JwtAuthGuard)
| GET `` (query) \| `unread-count` \| `:id` · PATCH `:id/read` \| `read-all` · DELETE `:id` \| `clear-all` | — | قوائم/عدّاد/تعليم مقروء/حذف | إشعارات المستخدم. |

## Institution — `/api/v1/institution` (JwtAuthGuard, RolesGuard)
| POST `institution-type` (ADMIN) | `CreateInstitutionTypeDto` | نوع مُنشأ |
| GET `institution-type?page` (ADMIN, INSTITUTIONS) | — | أنواع المنشآت |

## Waste-Management (legacy) — `/api/v1/waste-management`
| POST `waste-category` (`admin.waste.create`) + ملف | `CreateWasteCategory` | تصنيف |
| GET `waste-categories?page` (ADMIN, EXTERNAL_PARTNER, FACTORY, INSTITUTIONS) | — | تصنيفات |

## Content (عام — بلا مصادقة) — `/api/v1/content`
| Method · Path | يأخذ | يرجّع | السيناريو |
|---|---|---|---|
| GET `about` | هيدر `x-lang` اختياري | `{ title, body, last_updated }` | نص «حول التطبيق» من ملفات i18n بلغة الطلب — تعديل النص من `src/i18n/*/translation.json` تحت `content.about`. |
| GET `terms` | هيدر `x-lang` اختياري | `{ title, body, last_updated }` | شروط الاستخدام — `content.terms`. |
