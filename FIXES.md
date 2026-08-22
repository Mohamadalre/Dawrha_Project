# FIXES — سجل الإصلاحات (Dawrha Backend)

> ملف تتبّع لكل خطأ اكتُشف: ما أُصلح، وما بقي، وسبب القرار. يُحدَّث مع كل جولة.
> بدء الجولة: 2026-07-08.

## أسطورة الحالة
- ✅ مُصلَح ومُتحقَّق
- 🟡 مُصلَح جزئياً / يحتاج متابعة
- ⏳ لم يُصلَح بعد (بحاجة قرار بشري أو نطاق أوسع)

---

## حرِج (Security / Correctness)

| # | المشكلة | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 1 | تجاوز التحقق من OTP في إعادة تعيين كلمة المرور (نداء `verifyOtp` الخطأ + تجاهل النتيجة + مفتاح attempts بمسافة) | `auth/auth.service.ts` `verifyResetOtp` | ✅ | استبدال بـ `mailService.verifyResetOtp` (يرمي عند الخطأ ويحسب المحاولات)، وإصدار ticket عبر `randomBytes(32)` بدل `Math.random`. |
| 2 | فشل تجديد التوكن بعد انتهاء كاش Redis (إعادة استخدام قيمة `void` من `setRedisKey`) | `auth/auth.service.ts` `refreshTokens` | ✅ | استخدام `device.refreshToken` مباشرةً كمصدر للتحقق ثم تعبئة الكاش. |
| 3 | كشف تعداد الإيميلات في «نسيت كلمة المرور» (`findByEmail` يرمي 404) | `auth/auth.service.ts` `forgotPassword` | ✅ | استجابة موحّدة دائماً + `findOne` بدل الدالة الرامية + إصلاح interpolation في اللوگ. |

## متوسط (تكامل / أداء / سلوك)

| # | المشكلة | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 4 | استدعاءات Odoo بلا timeout ولا caching للجلسة (إعادة مصادقة في كل نداء) | `odoo/odoo.module.ts`, `odoo/odoo.service.ts` | ✅ | `HttpModule.register({ timeout, maxRedirects })` + كاش جلسة في Redis (TTL 25د) + إبطالها عند خطأ Odoo لإعادة المصادقة. |
| 5 | N+1 في قائمة المستودعات (`stockSummary` لكل مستودع) | `warehouse/warehouse-admin.service.ts` | ✅ | استعلام تجميعي واحد `GROUP BY warehouse_id`. |
| 6 | لا يوجد endpoint لإعادة إرسال رمز التحقق في «نسيت كلمة المرور» | `auth/*` | ✅ | إضافة `POST /api/v1/auth/password/forgot/resend` + `resendForgotPasswordOtp` (cooldown + سقف يومي + منع كشف). |
| 7 | قصة device id + refresh token (كود معلّق ميت + سلوك الكاش) | `auth/auth.service.ts` `generateTokens` | ✅ | حذف الكتلة المعلّقة الميتة وتوضيح سلوك الجهاز الواحد؛ إصلاح دورة التجديد (#2). |

## بسيط (نظافة / ترجمة / تحقّق)

| # | المشكلة | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 8 | كود ميت في عميل Odoo (`findWarehouseByName`, `createWarehouse` legacy, `createManager`, `deleteUser`, `deleteWarehouse`) | `odoo/odoo.service.ts` | ✅ | حذف الدوال غير المستخدمة (يستعمل النظام `recycle.*` فقط). |
| 9 | `Math.random` لتوليد OTP النسيان | `core/mail/mail.service.ts` | ✅ | استبدال بـ `crypto.randomInt`. |
| 10 | `console.log` في decorator | `auth/decorators/current-user.decorator.ts` | ✅ | حذفه. |
| 11 | Joi schema ناقص (Odoo/Firebase/Cloudinary/Google/JWT_TEMPORARY/Mail) | `core/config/configuration.ts` | ✅ | إضافة كل المتغيّرات الحسّاسة (fail-fast عند الإقلاع). |
| 12 | رسالة صلاحية مضلِّلة (تقول "institutions, factories and free facilities" بينما المسموح `INSTITUTIONS` فقط) | `waste-management/category-requests/category-request.service.ts` | ✅ | توحيد الرسالة الإنجليزية مع السلوك + الترجمة. |
| 13 | ترجمات ناقصة (auth/forgot، الشاحنات، المستودعات، Odoo) | `src/i18n/{ar,en}/translation.json` | ✅ | إضافة المفاتيح المستخدمة فعلياً + مفتاح `Invalid Token`. |
| 14 | توحيد الريسبونس: تسرّب `message` داخل `data` عند غياب `result` | `common/interceptors/transform.interceptor.ts` | ✅ | تجريد `message` من الحمولة وتوحيد `{message}`→null، `{message,result}`→result، `{message,...}`→الباقي. |
| 15 | `updateStatus` يصل إلى `profile.id` بلا حارس (NPE/500 عند غياب الملف) + رسالة فحص الوسائط متناقضة | `account-management/account-management.service.ts` | ✅ | حارس على `profile`/`role` + توحيد الرسالة ("must be reviewed") + ترجمتها. أصلح اختبار كان فاشلاً. |

## يحتاج قرار بشري (لم يُلمَس)

| # | المشكلة | الملف | الحالة | السبب |
|---|---|---|---|---|
| A | مجلد هجرات مكرّر بخطأ إملائي `db/migartions/` (لا يُقرأ من data-source) | `db/migartions/1782929439082-factoryTestMigrartion.ts` | ⏳ | لمس ملفات الهجرة خطر على قاعدة الإنتاج؛ يحتاج قرارك: نقله إلى `db/migrations/` (سيعمل عند الـ deploy التالي) أم حذفه. |
| B | كتلة كود معلّقة قديمة في أماكن متفرّقة + تعليق `//DOTO` في `account-management.service.ts` | متعدّد | ⏳ | تنظيف تجميلي مؤجَّل لتقليل حجم الـ diff الحالي. |
| C | تدقيق ترجمة شامل لكل الرسائل الحرفية المتبقية | `src/i18n/*` | 🟡 | أُضيفت الأهم؛ يبقى مسح كامل لرسائل onboarding/media النادرة. |

---

## جولة 2026-07-10

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 16 | استبدال `switch` في معالج Odoo-sync بنمط handler-map (نفس نمط `MailProcessor`) | `odoo-sync/odoo-sync.processor.ts` | ✅ | خريطة `handlers: Record<jobName, (job)=>Promise>` + رفض مبكر للـ job المجهول؛ منطق التعويض/إعادة المحاولة لم يتغيّر. |
| 17 | Endpoint جديد: توافر المادة في كل مستودع (للمعامل والجهات الحرة) | `waste/catalog/*`, `waste/common/constants/permissions.ts` | ✅ | `GET /api/v1/waste/products/:id/availability` بصلاحية جديدة `waste.products.availability` (تُزرع تلقائياً لـ FACTORY وEXTERNAL_PARTNER وADMIN عبر الـ seeder). يقرأ من مرآة `warehouse_inventory` محلياً (بلا نداء Odoo لحظي)، `available = quantity - reserved` مع قصّ عند 0، ويخفي المنتجات خارج التصنيفات المُسندة للحساب المقيّد. بلا كاش عمداً (طزاجة المخزون أهم). |
| 18 | ترجمة رسائل الـ endpoint الجديد | `src/i18n/ar/translation.json` | ✅ | مفتاحا "Product availability fetched successfully" و"Product not found". |
| 19 | اختبارات وحدة للتوافر (غير موجود / غير مدفوع لـ Odoo / تجميع وقصّ / تقييد التصنيفات) | `catalog.service.spec.ts` | ✅ | 4 اختبارات جديدة. |

---

## جولة 2026-07-10 (ب) — ميزات + مراجعة موديولات

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 20 | **وحدات قياس ديناميكية** بدل enum ثابت (KG/PIECE) | `entities/measurement-unit.entity.ts`, `common/providers/units.service.ts`, `admin/*`, `catalog/*`, `cart/*`, `suggestions/*`, migration `1783100000000`, seed `unit-seed.ts` | ✅ | جدول `measurement_units` يديره الأدمن (CRUD كامل تحت `/admin/waste/units`)؛ أعمدة `unit_type` تحوّلت enum→varchar مع الحفاظ على القيم؛ التحقق صار ضد الجدول (`UnitsService.validateActiveCode` بكاش 60s)؛ `unit_label` من الجدول بدل hardcode؛ قاعدة وزن السلة عبر عَلَم `is_weight` (قابلة للتوسّع لـ TON)؛ حماية: منع تعطيل وحدة بمنتجات فعّالة ومنع حذف وحدة مستخدمة؛ KG/PIECE تُزرعان في seed (وليس migration). |
| 21 | **Webhook فوري Odoo→Backend** لتغيّرات كميات المستودعات | `odoo-sync/odoo-webhook.controller.ts`, `dto/odoo-webhook.dto.ts`, `configuration.ts` | ✅ | `POST /api/v1/odoo/webhooks/inventory` بسر مشترك (`x-odoo-webhook-secret`، مقارنة constant-time، 503 إن غير مُهيّأ، Throttle 30/د) يُجدول job `SYNC_WAREHOUSE` الموجود للمستودع المعني — التحديث يصل خلال ثوانٍ. يتطلب Automated Action في Odoo على `recycle.stock`. متغيّر بيئة جديد: `ODOO_WEBHOOK_SECRET` (اختياري، Joi min 32). |
| 22 | حذف `unit-type.enum.ts` وكل مراجعه | `enums/unit-type.enum.ts` + 4 spec files | ✅ | استبدال بـ string codes؛ تحديث كل الاختبارات. |
| 23 | ترجمات الوحدات والـ webhook | `i18n/ar/translation.json` | ✅ | 13 مفتاحاً جديداً. |
| 24 | GET `/api/v1/waste/units` للمشترين (قوائم اختيار الوحدة) | `catalog/*` | ✅ | يرجع الوحدات الفعّالة فقط. |

### مراجعة موديولات هذه الجولة (سليمة — لا تغيير)
- **maintenance**: كرونات معزولة بعملية worker (`MAINTENANCE_WORKER=true`)، حذف آمن ومحمي بشرط soft-delete، معالجة أخطاء كاملة. ملاحظة بسيطة: حلقة `cleanupGhostAccounts` بها استعلام لكل حساب (مقبول لمهمة ليلية بأعداد صغيرة).
- **media**: Transactions حقيقية (queryRunner) مع rollback + حذف صورة Cloudinary عند فشل DB — نمط صحيح ضد الملفات اليتيمة.
- **onboarding**: البنية سليمة (base service + 4 مشتقات). ملاحظات جودة: `addLocation(dto: any, profile: any)` typing ضعيف + typo `acccountRepo` (تجميلي — لم يُلمس لتقليل الـ diff).
- **shift**: الورديتان تُزرعان في seed (`shift-seed.ts`) — مطابق للمطلوب؛ الأدمن يعدّل الأوقات فقط.
- **سيناريو التسعير**: سليم (أرشفة → إدخال → إعادة تسعير السلال → job Odoo → audit → إبطال كاش). ملاحظة: الأرشفة+الإدخال ليست داخل transaction واحدة (خطر ضئيل عند انهيار في المنتصف — قابل للاسترداد يدوياً).

---

## جولة 2026-07-10 (ج) — عقد الريسبونس + المواد + الاختبارات

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 25 | **استثناءات مخصصة** بكود ثابت للفرونت | `common/exceptions/app.exception.ts` | ✅ | `AppException` + مشتقات (BusinessRule 400, ResourceNotFound 404, Duplicate 409, ForbiddenAction 403, ExternalService 502) تحمل `errorCode`؛ `AllExceptionsFilter` يضيفه للرد. |
| 26 | **توحيد نهائي للـ envelope** | `transform.interceptor.ts`, `all-exceptions.filter.ts`, `database-exception.filter.ts` | ✅ | نجاح: `{success:true, message, data, statusCode, timestamp}` · خطأ: `{success:false, message, errorCode?, data:null, ...}` — `data` صارت `null` بدل `''` في الخطأ وفي الرسائل بلا نتيجة، وفلتر قاعدة البيانات صار بنفس الشكل (كان ينقصه `data`). |
| 27 | **Endpoint موادّي**: `GET /api/v1/waste/my-materials` | `catalog/*`, `assigned-category.provider.ts`, `permissions.ts` | ✅ | يعرض التصنيفات التي اختارها المعمل/الجهة الحرة/المؤسسة في مرحلة add-material بالـ onboarding + منتجاتها (مقسّمة صفحات). Provider جديد `getSelectedCategoryIds` يقرأ جداول الربط الثلاثة (المنطق القديم كان للمؤسسات فقط). صلاحية جديدة `waste.materials.view`. |
| 28 | **اختبار تكامل/e2e لعقد الريسبونس والترجمة** | `test/response-envelope.e2e-spec.ts`, `test/jest-e2e.json` | ✅ | 6 اختبارات HTTP حقيقية (interceptor + filter + i18n حقيقي بدون DB): نجاح/خطأ/كراش بنفس الـ envelope، **وتحقق فعلي أن `x-lang: ar` يرجع الرسائل بالعربية**. أُضيف `moduleNameMapper` لـ `@src` في إعداد e2e. |
| 29 | اختبارات وحدة للمواد (3 حالات) + ترجمات جديدة | `catalog.service.spec.ts`, `i18n/ar` | ✅ | 166/166 وحدة + 6/6 تكامل. |

---

## جولة 2026-07-10 (د) — إزالة تداخلات الريسبونس نهائياً

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 30 | **تعشيش `data.data` في التسجيل** — `register` كان يرجّع `{message, data: token}` فيصير الرد `data:{data:{Token}}` | `auth/auth.service.ts` (سطران) | ✅ | تحويل المفتاح إلى `result` → الرد الآن `data:{Token}` مباشرة. |
| 31 | ريسبونسات شاذة في auth: `addFCMToken` يرجّع نصاً خاماً (يظهر في `data` والرسالة OPERATION_SUCCESS)، و`verifyResetOtp` يرجّع `resetTicket` بجانب `message` بدل `result` | `auth/auth.controller.ts`, `auth/auth.service.ts` | ✅ | `addFCMToken` → `{message}`؛ `verifyResetOtp` → `{message, result:{resetTicket}}`. |
| 32 | **قيم `''` في الـ responses** (description/image في الكتالوج والعروض) | `catalog.service.ts` (mapCategory/mapProduct/mapOffer) | ✅ | كل قيمة فارغة تظهر `null` بدل `''`. قيم `''` المتبقية في الكود كلها **كتابات DB لأعمدة NOT NULL** (fcmToken/refreshToken عند logout، slogo مؤقتة، imageCategoryURL) — ليست ريسبونس ولا تُحوَّل لـ null. |
| 33 | حارس دائم ضد التعشيش في اختبار الـ envelope | `test/response-envelope.e2e-spec.ts` | ✅ | تأكيد أن `data.data` و`data.message` لا يظهران أبداً. |

## جولة 2026-07-10 (هـ) — استثناءات مسماة لكل موديول

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 34 | **تعميم نمط `notification.exceptions` على الموديولات** | `auth/exceptions/auth.exceptions.ts` (10 فئات)، `waste-management/exceptions/waste.exceptions.ts` (13 فئة)، تحديث `notification/exceptions` | ✅ | كل استثناء يرث فئة Nest المطابقة (يحافظ على `instanceof` والحرّاس والاختبارات) ويحمل `errorCode` ثابتاً يظهر في الـ envelope. الرسائل مطابقة حرفياً للموجودة (الترجمات سليمة). استُبدلت الاستثناءات العامة في: auth.service (13 موضعاً)، admin-catalog (10)، catalog (5)، cart (1)، units (1). |
| 35 | تصحيح دلالي: منتج بتصنيف غير موجود صار 404 بدل 400 | `admin-catalog.service.ts` + spec | ✅ | `CategoryNotFoundException` في `createProduct`؛ حُدّث الاختبار. |

**العرف الجديد (يُتبع في أي كود قادم):** استثناء جديد = فئة مسماة في `<module>/exceptions/<module>.exceptions.ts` بـ `errorCode` UPPER_SNAKE ثابت، ترث فئة Nest المطابقة للحالة؛ و`common/exceptions/app.exception.ts` يبقى الأساس العام للحالات غير النمطية.

> ملاحظة قرار: مفتاح التوكن المؤقت اسمه `Token` (بحرف كبير) في ردود التسجيل — إعادة تسميته `token` أنظف لكنها **كسر لعقد الفرونت الحالي**؛ لم تُغيَّر عمداً. قرّر إن أردت توحيدها بالتنسيق مع الفرونت.

### لماذا تحسّن التقييم فعلاً (لمن يسأل)
الجولات السابقة رفعت الأمان (OTP/tokens/webhook secret) وتكامل Odoo (queue+تعويض+webhook). ما كان ينقص درجة «الاحترافية»: إثبات عقد الـ API باختبار تكامل، وأكواد أخطاء ثابتة للفرونت، وتغطية المواد من الـ onboarding — وكلها أُنجزت في هذه الجولة.

---

## جولة 2026-07-11 — استثناءات بقية الموديولات + allows_tolerance + مزامنة Odoo ثنائية الاتجاه

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 36 | **إكمال الاستثناءات المسماة لبقية الموديولات** (~68 موضعاً) | `warehouse/`, `truck/`, `shift/`, `media/`, `user/`, `account-management/` تحت `exceptions/` | ✅ | 6 ملفات جديدة (~45 فئة) بنفس عرف #34. تصحيحان دلاليان بالمرور: "Media not found" صار 404 بدل 400، و"Category not found" عند إنشاء منتج صار 404 (حُدّثت الاختبارات). المتبقي عمداً: onboarding/institution (رسائل حراسة تدفّق ستُنقل مع تنظيف typing المؤجل — بند B). |
| 37 | **حل ملاحظة `Token`** | `auth.service.ts` `generateTemporaryTokens` | ✅ | المفتاح صار `token` (lowercase) — **تغيير عقد للفرونت**: ردود التسجيل/refresh المؤقت الآن `data: { token }`. |
| 38 | **`allows_tolerance` على وحدات القياس** + مزامنتها لـ Odoo | `measurement-unit.entity.ts`, DTO, `admin-catalog.service.ts`, migration `1783200000000`, seed, `odoo.service.ts`, `odoo-sync/*` | ✅ | حقل boolean يحدد سلوك الفرز في مشروع Odoo للمستودعات: `true` = كمية الفرز قد تخالف كمية الشحنة (وزنيات: KG)، `false` = تطابق إلزامي (عدّيات: PIECE — شحنة 5 قطع تُفرز 5 بالضبط). افتراضيه = `is_weight`. كل إنشاء/تعديل وحدة يُجدول job `SYNC_UNIT` يدفع {name, code, allows_tolerance} لموديل `recycle.measurement.unit` (نفس نمط retry/تعويض التصنيفات: فشل نهائي قبل الوصول لـ Odoo → حذف + إشعار الأدمن؛ بعده → FAILED). حذف وحدة ممزامنة → `DELETE_UNIT`. |
| 39 | **انعكاس تغييرات Odoo تلقائياً: معلومات المستودع + الكميات** | `odoo-sync.processor.ts` `syncWarehouse`, `odoo.service.fetchWarehouseInfo`, `odoo-webhook.controller.ts` | ✅ | job المزامنة يقرأ الآن **بيانات المستودع** (name/code — تعديلات Odoo تفوز) ثم أسطر المخزون. route ثانٍ `POST /odoo/webhooks/warehouse` لنفس المعالج — Automated Action على `recycle.warehouse` وأخرى على `recycle.stock` كلتاهما تدفعان التغيير للـ backend خلال ثوانٍ. |
| 40 | إشعار فشل مزامنة الوحدة مترجم | `i18n/{ar,en}` | ✅ | `notifications.unitSyncFailed.*`. |

### إعداد Odoo المطلوب (مرة واحدة — يدوي من طرفك)
1. الموديل `recycle.measurement.unit` في addon المستودعات بحقول: `name` (char), `code` (char unique), `allows_tolerance` (boolean) — منطق الفرز يقرأه عند إدخال الكميات المعالَجة.
2. Automated Action على `recycle.stock` (create/write) و`recycle.warehouse` (write) تستدعي `POST <backend>/api/v1/odoo/webhooks/inventory` و`/warehouse` بهيدر `x-odoo-webhook-secret`.
3. `ODOO_WEBHOOK_SECRET` (≥32 حرفاً) في `.env`.
4. بعد السحب: `npm run migration:run` ثم `npm run seed`.

---

## جولة 2026-07-11 (ب) — تدقيق ريسبونس شامل + endpoints جديدة + تصميم الطلبيات

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 41 | **باغ: `getFactories` يرمي البيانات** — كان يحسب `data` ويرجع `{message:'Factory fetch sueessfully'}` فقط (بخطأ إملائي) | `account-management.controller.ts` | ✅ | `{ message: 'Factories fetched successfully', result: data }`. |
| 42 | مخالفات شكل الريسبونس في media (4): update/delete يرجعان نتيجة خام، `owner/:id` يرجع `{count, data}` (تداخل مفتاح data)، `GET /:id` يرجع **كيان خام** + 400 بدل 404 | `media.controller.ts` | ✅ | كلها الآن `{message, result}` + `MediaNotFoundException`. |
| 43 | **Endpoint تعديل معلومات الحساب**: `PATCH /api/v1/user/profile` | `user/*` | ✅ | name/phone/description لكل الأدوار، **ACTIVE فقط** (`AccountNotActiveException` 403 بكود `ACCOUNT_NOT_ACTIVE`)، فحص تفرد الهاتف، الإيميل غير قابل للتعديل (هوية). |
| 44 | **Endpoints المحتوى**: `GET /api/v1/content/about` و`/content/terms` | `src/content/*` | ✅ | عامة (قبل الدخول)، النصوص من ملفات i18n حسب `x-lang` — تعديل النص لا يتطلب تغيير كود. |
| 45 | **بحث تزايدي (autocomplete)**: تحقّق أنه يعمل من أول حرف ✓ + تحسين: النتائج التي **تبدأ** بالنص المكتوب تظهر أولاً | `catalog.service.ts` (تصنيفات/منتجات/عروض) | ✅ | `CASE WHEN name ILIKE 'q%'` كترتيب أول ثم الترتيب المطلوب. |
| 46 | **ORDERS_DESIGN.md**: تصميم كامل لمنظومة الطلبيات (جمع/شراء، آلة حالات، خوارزمية توزيع السائقين، تبديل الوردية، تكامل المستودعات/Odoo، sprints) | ملف جديد بالجذر | ✅ | تصميم فقط — التنفيذ بانتظار موافقتك. |

### تداخل شكل مُكتشَف في waste-management — **بانتظار قرارك قبل التعديل** (كما طلبت)
- `GET /admin/waste/categories` و`/admin/waste/products` يرجعان **كيانات TypeORM خام** داخل result (حقول camelCase مثل `imageCategoryURL`, `odooCategoryId`, `odooSyncStatus`) بينما واجهات المشتري ترجع DTOs snake_case منسقة (`image`, `unit_label`...). التوحيد يعني تغيير أسماء حقول تستهلكها لوحة الأدمن — **كسر محتمل للفرونت**. أوصي بالتوحيد إلى snake_case بنسخة mapAdminCategory/mapAdminProduct — أخبرني وأنفّذ.

### فحص موديل الإشعارات — النتيجة
- **سليم بنيوياً**: soft-delete، حالات إرسال، jsonb metadata، retry cron، تنظيف بالـ worker.
- **ملاحظة أداء واحدة**: لا يوجد فهرس مركّب على `(user_id, is_read, created_at)` وقوائم الإشعارات تستعلم به دائماً — يُحل بـ migration سطر واحد عند موافقتك.

---

## جولة 2026-07-12 — حالات المواد الديناميكية + تسعير لكل حالة

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 47 | **حالات المواد ديناميكية يديرها الأدمن** (ممتازة/جيدة/رديئة/تالفة أمثلة مزروعة في seed — ليست enum ثابتاً) | `entities/material-condition.entity.ts`, `providers/conditions.service.ts`, `admin/*`, seed `condition-seed.ts` | ✅ | CRUD كامل `/admin/waste/conditions` بنفس نمط الوحدات (حماية: لا حذف/تعطيل لحالة مستخدمة في تسعير)، كاش 60s، ودفع لـ Odoo (`SYNC_CONDITION` → موديل `recycle.material.condition`) كي تظهر لموظف الفرز. |
| 48 | **المخزون لكل حالة**: مرآة `warehouse_inventory` صارت صفاً لكل (مستودع، منتج، حالة) | entity + migration `1783300000000` + `odoo-sync.processor` + `odoo.service` | ✅ | المزامنة تقرأ `condition_code` من أسطر `recycle.stock` (غير المفروز → UNGRADED)، مع **تنظيف الصفوف الزائلة**. جرد الأدمن `GET /admin/warehouses/:id/inventory` صار مجمّعاً بالمنتج مع كسر الحالات (حالة + كمية + متاح). |
| 49 | **تسعير لكل حالة** للمعامل والجهات الحرة؛ سعر واحد للمستخدم والمؤسسات | `product_pricing(+history)` + `pricing.service` (إعادة كتابة) + DTOs | ✅ | `POST pricing` يستقبل `factory`/`free_facility` مصفوفات `[{condition, price}]` و`individual`/`company` رقماً واحداً؛ الأرشفة للمراجعة محفوظة (التاريخ يتضمن الحالة)؛ `PATCH pricing/:tier` يتطلب `condition` للشريحتين؛ إعادة تسعير السلال تطابق حالة كل سطر. |
| 50 | **Odoo يستقبل أسعار الحالات** | `odoo.service.replaceConditionPrices`, `pushTierPrices` | ✅ | استبدال أسطر `recycle.product.condition.price` (product, tier, condition_code, price) مع كل تحديث — Odoo يفوتر المعامل/الجهات الحرة بسعر الحالة. |
| 51 | **عرض المواد يشمل الحالات وأسعارها** للمعامل/الجهات الحرة | `catalog.service.ts` | ✅ | المنتج يتضمن `condition_prices: [{condition, condition_label, price}]` لشريحة المشتري؛ `pricing.factory/free_facility` صار أدنى سعر («يبدأ من»)؛ التوافر يجمع لكل مستودع كسر الحالات: كمية + متاح + **سعر الحالة**؛ `GET /waste/conditions` جديد. |
| 52 | **السلة تدعم الحالة** | `cart/*` | ✅ | `AddToCartDto.condition` (إلزامي فعلياً للمعامل/الجهات الحرة — بدونه `CONDITION_REQUIRED` 400)، snapshot في `cart_items.condition_code`، و`tierPrice` يطابق سعر الحالة. |
| 53 | تطبيق الإصلاحين المعتمَدين | `admin-catalog.service` + migration | ✅ | قوائم الأدمن (تصنيفات/منتجات) DTOs موحّدة snake_case بدل كيانات خام؛ فهرس `notifications(user_id, is_read, created_at)`. |

### إعداد Odoo الإضافي المطلوب (مرة واحدة)
- موديل `recycle.material.condition` (name, code unique, sort_order) — يُزامَن من الـ backend.
- حقل `condition_code` على `recycle.stock` يملؤه موظف الفرز.
- موديل `recycle.product.condition.price` (product_id, tier: factory|free_facility, condition_code, price) — يستبدله الـ backend مع كل تحديث تسعير والفوترة تقرأه.
- بعد السحب: `npm run migration:run` ثم `npm run seed`.

---

## جولة 2026-07-12 (ب) — الأسطول يُدار من Odoo (المهمة الثانية)

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 54 | **حذف إضافة/تعديل الشاحنات من الـ backend** — Odoo هو من يضيف الشاحنات ويربطها بمستودع | `truck.controller.ts` (أُعيدت كتابته قراءة فقط)، `truck.service.ts` (حُذفت create/update/setStatus)، entity + migration `1783400000000` | ✅ | الشاحنة تحمل `odooTruckId` + `warehouseId`؛ القوائم والتفاصيل تعرض مستودع كل شاحنة، وقائمة المستودعات تعرض `truck_count` (استعلام GROUP BY واحد)؛ فلتر `warehouseId` في `GET /trucks`. |
| 55 | **مرآة الأسطول من Odoo**: job جديد `SYNC_FLEET` + webhook `POST /odoo/webhooks/fleet` | `odoo.service.ts` (fetchShifts/fetchTrucks/fetchDriverAssignments)، `odoo-sync.processor.ts` `syncFleet` | ✅ | يزامن الورديات (بمطابقة odoo id أو الاسم للمزروعة) ثم الشاحنات (مع مستودعها) ثم إسنادات السائقين (upsert بمعرّف Odoo + حذف ما أزاله Odoo + مواءمة `collector.shiftId` + إعادة حساب حالات الشاحنات). |
| 56 | **طلبات السائقين تُقرَّر في Odoo**: عند اكتمال onboarding السائق يُدفع الطلب لـ Odoo، والقرار يعود عبر webhook | `onboarding.service.ts` `markPendingApproval` (دفع للجامعين فقط)، jobs `PUSH_DRIVER_REQUEST`/`APPLY_DRIVER_DECISION`، webhook `POST /odoo/webhooks/driver-decision` | ✅ | القبول → ACTIVE (+ إسناد فوري لشاحنة/وردية إن أرسلها أدمن Odoo) + إشعار؛ الرفض → REJECTED + سبب + إشعار. الـ backend يعرف الربط دائماً فتبقى `GET /driver/my-assignment` تعمل للتطبيق. |
| 57 | **حذف إضافة/تعديل الورديات من الـ backend** — Odoo يضيفها ويربطها | `shift.controller.ts` (حُذف PATCH)، `shift.service.ts` (حُذفت updateTimes)، مرآة ضمن `SYNC_FLEET` | ✅ | الـ backend يعرف وردية كل سائق (`collector.shiftId` + الإسناد الممرآة) للقراءة فقط. |
| 58 | **قرار تبديل الوردية في Odoo**: السائق يقدّم عبر الـ backend فيُمرَّر الطلب لـ Odoo، وwebhook يعيد القرار | `shift-change-request.service.ts` (create يدفع `PUSH_SHIFT_CHANGE`؛ حُذفت setStatus/process)، controller (حُذفت مسارات قرار الأدمن، بقيت القائمة للعرض)، `APPLY_SHIFT_CHANGE_DECISION` + webhook `POST /odoo/webhooks/shift-change-decision` | ✅ | القبول → نقل الإسناد للشاحنة/الوردية المطلوبة + مواءمة وردية السائق + إشعار (المفاتيح المترجمة الموجودة)؛ الرفض → REJECTED + سبب + إشعار. |

### عقد Odoo المطلوب لهذه الجولة (موديلات الـ addon)
- `recycle.shift` (name, start_time, end_time) و`recycle.truck` (model, year, plate_number, max_payload_kg, warehouse_id, is_active) و`recycle.driver.assignment` (backend_driver_id, truck_id, shift_id) — الـ backend يقرأها في SYNC_FLEET؛ Automated Action على الثلاثة تستدعي `POST /odoo/webhooks/fleet`.
- `recycle.driver.request` (backend_driver_id, name, email, phone) — يكتبها الـ backend؛ قرار الأدمن يستدعي `POST /odoo/webhooks/driver-decision` بـ `{backend_driver_id, approved, rejection_reason?, truck_odoo_id?, shift_odoo_id?}`.
- `recycle.shift.change.request` (backend_request_id, backend_driver_id, driver_name, truck_id, shift_id) — يكتبها الـ backend؛ القرار يستدعي `POST /odoo/webhooks/shift-change-decision` بـ `{backend_request_id, approved, rejection_reason?}`.

---

## جولة 2026-07-12 (ج) — عروض بحالة + إغلاق مسار طلبات السائقين محلياً

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 59 | **حذف endpoint عرض طلبات السائقين** من account-management (`GET /account-management/collector`) — المراجعة صارت عند أدمن Odoo (جولة #56) | `account-management.controller.ts` | ✅ | حُذف المسار مع تعليق يشرح البديل (PUSH_DRIVER_REQUEST → Odoo). بقية أدوار القوائم (معمل/مؤسسة/جهة حرة) كما هي. |
| 60 | **CRUD عروض للأدمن** (لم يكن موجوداً أصلاً!) مع **حالة المادة** اختيارية على العرض | `admin-catalog.*`, `offer.entity.ts`, migration `1783500000000` | ✅ | `GET/POST/PUT/DELETE /admin/waste/offers` — العرض يحمل `condition` اختيارياً (يُتحقق ضد جدول الحالات)؛ يظهر للمشترين في كل قوائم العروض (`condition` في mapOffer). |
| 61 | **السلة تحترم حالة العرض**: إضافة عرض (بـ `add_offer` أو `POST /cart/offers`) تُثبّت حالة العرض على سطر السلة تلقائياً (حالة العرض تفوز على ما أرسله المشتري) | `cart.service.ts` | ✅ | و**تحقق مؤكد**: المعمل/الجهة الحرة لمنتج مُسعَّر بحالات **يجب** أن يحدد `condition` عند الإضافة العادية (400 `CONDITION_REQUIRED`) — منفّذ في `tierPrice` منذ جولة #52 وسليم. |

---

## جولة 2026-07-12 (د) — استهداف العروض بالأدوار + دورة السائق من Odoo حصراً + محافظة المستودع

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 62 | **العرض قد يستهدف أدواراً محددة** (مواطن فقط، مؤسسات فقط...) | `offer.entity.ts` (`target_roles` text[])، DTOs، `admin-catalog.service`، `catalog.service`، `cart.service`، migration `1783600000000` | ✅ | الأدمن يمرر `target_roles: ["citizen"]` عند إنشاء/تعديل العرض (فارغ = للجميع). **الفلترة في كل نقاط الظهور**: قوائم العروض وبحثها (مفتاح الكاش صار يتضمن الدور)، أفضل عرض داخل حمولة المنتج، والضيوف يرون غير المستهدف فقط. **الفرض في السلة**: إضافة عرض ليس لدورك → 400 `OFFER_NOT_AVAILABLE`. |
| 63 | **دورة حياة السائق من Odoo حصراً — مؤكدة ومقفلة**: قبول الطلب، الحظر/فكه، طلب تعديل المعلومات | `account-management.service.ts` (حارسان)، `OdooDriverDecisionDto` + payload + processor | ✅ | (أ) الـ backend **يرفض** تغيير حالة/حظر حساب COLLECTOR (`DRIVER_MANAGED_IN_ODOO`). (ب) webhook `driver-decision` صار يدعم `status: ACTIVE|REJECTED|BLOCKED|NEED_CHANGES` (يتفوق على `approved`) مع إشعار مناسب لكل حالة — فالأدمن في Odoo يملك القبول والرفض والحظر وطلب التعديل. |
| 64 | **المستودع يحمل المحافظة**: `governorate` في الإنشاء وتُدفع لـ Odoo | `warehouse.entity/dto/service`, `odoo-sync.processor` (كانت `createRecycleWarehouse` تدعمها ولا يمررها أحد!) | ✅ | عمود جديد + حقل في `POST /admin/warehouses` + تظهر في `location.governorate` بالقوائم + تُدفع ضمن payload إنشاء `recycle.warehouse`. |

---

## جولة 2026-07-13 — التصنيفات كاملة + تصنيفاتي + إعادة رفع صور السائق لـ Odoo

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 65 | **`GET /waste/categories` يعرض كل التصنيفات للجميع** (أُزيل تقييد المؤسسات من القائمة؛ كاش واحد `all` للكل) | `catalog.service.ts` | ✅ | ملاحظة معمارية: تقييد المؤسسات ما زال سارياً على **المنتجات/العروض** (assertCategoryAllowed) — فقط قائمة التصنيفات صارت عامة كما طُلب. |
| 66 | **Endpoint منفصل لتصنيفات الـ onboarding**: `GET /waste/my-categories` | `catalog.*` | ✅ | يرجع التصنيفات التي أدخلها المعمل/الجهة الحرة/المؤسسة في مرحلة المواد (بصلاحية `waste.materials.view`) مع `product_count` — يقرأ من `getSelectedCategoryIds` (جداول الربط الثلاثة). |
| 67 | **إعادة رفع صور السائق تظهر في Odoo**: بعد NEED_CHANGES من أدمن Odoo، تعديل السائق للصورة (`PATCH /media/:id/reupload`) يعيد دفع طلبه لـ Odoo | `media.service.ts` + `media.module.ts` | ✅ | بعد إرجاع الحساب PENDING_APPROVAL: إن كان الدور COLLECTOR → `PUSH_DRIVER_REQUEST` تلقائياً — الطلب المحدَّث يظهر عند أدمن Odoo لإعادة المراجعة (دورة كاملة مغلقة: Odoo يطلب تعديلاً → السائق يعدّل بالتطبيق → يعود الطلب لـ Odoo). ملاحظة لعقد Odoo: `recycle.driver.request` يجب أن يميّز بـ `backend_driver_id` (تحديث السجل الموجود أو عرض الأحدث). |

## ملاحظات تحقّق
- بعد كل جولة: `npm run build` للتأكد من عدم كسر التحويل البرمجي.
- **جولة 2026-07-08:** `tsc --noEmit` نظيف · كل الاختبارات (159/159) ناجحة · JSON الترجمة صالح. أُصلح اختبار `account-management` كان فاشلاً مسبقاً.
- **جولة 2026-07-10:** `tsc --noEmit` نظيف · كل الاختبارات (163/163) ناجحة · JSON الترجمة صالح.
- **جولة 2026-07-10 (ب):** `tsc --noEmit` نظيف · كل الاختبارات ناجحة · **مطلوب بعد السحب:** `npm run migration:run` ثم `npm run seed` (لجدول الوحدات وصفوف KG/PIECE)، وإضافة `ODOO_WEBHOOK_SECRET` للـ `.env` + Automated Action في Odoo لتفعيل المزامنة الفورية.

---

## جولة 2026-07-14 — إدارة الشاحنات (Fleet) تُؤلَّف في Odoo + إشعار أدمن الباك إند

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 68 | **إشعار الأدمن عند تغيّرات الأسطول القادمة من Odoo** | `odoo-sync.processor.ts` (`syncFleet`) + `i18n/{ar,en}/translation.json` | ✅ | `SYNC_FLEET` صار يوازن الحالة السابقة/الجديدة لكل شاحنة: **شاحنة جديدة** (مسندة/غير مسندة لمستودع) أو **تغيّر إسناد المستودع** → إشعار لكل حساب `role=ADMIN` عبر `notifyAdmins(...)` (in-app + FCM + طابور). 4 مفاتيح i18n جديدة: `truckAdded / truckAddedUnassigned / truckAssignmentChanged / truckUnassigned`. الشاحنات تُؤلَّف حصراً في Odoo (سيّد الأسطول)؛ الباك إند مرآة — أُضيف حقل `notes` وبقية الحقول موجودة أصلاً في `recycle.truck` بالأودو. |
| — | **سر الـ webhook** | `.env` | ✅ | أُضيف `ODOO_WEBHOOK_SECRET` (يطابق `recycle.backend_webhook_secret` في Odoo) — بدونه نقطة `POST /api/v1/odoo/webhooks/fleet` تُرجع 503. النقطة كانت موجودة أصلاً (`OdooWebhookController.fleetChanged`)؛ الجديد أن Odoo صار **يستدعيها فعلياً** عند كل تغيير أسطول. |

**ملاحظة معمارية**: `notifyAdmins()` القائمة (كانت لإشعارات فشل المزامنة فقط) أُعيد استخدامها؛ تجنّبت إضافة دالة مكررة (كسر `tsc` بـ Duplicate function ثم أُزيل). عقد الأودو للأسطول موثّق في `D:/ite-odoo/odoo19-docker/BACKEND_INTEGRATION.md §3.4` و`PROJECT_LOG.md` (جلسة 2026-07-14 — الشاحنات).

## ملاحظات تحقّق
- **جولة 2026-07-14:** `tsc --noEmit` نظيف · **154/154 اختبار ناجح** · JSON الترجمة (ar/en) صالح ومتماثل المفاتيح. الجانب الأودو: ترقية 0 أخطاء + 12/12 اختبار + تحقق حي بالشل والمتصفح (إنشاء/تعديل شاحنة، إطلاق نداء الأسطول للمسار الصحيح بالهيدر الصحيح). **مطلوب بعد السحب**: ضبط `ODOO_WEBHOOK_SECRET` في `.env`.

---

## جولة 2026-07-16 — نوع الوردية + حذف الورديات من أودو + دورة طلبات السائقين الكاملة

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 69 | **الوردية صار لها جمهور**: `shift_type` (DRIVER/WAREHOUSE) + `is_active` | `shift.entity.ts`، هجرة `1783700000000`، `shift.service.ts`، `odoo.service.ts` (fetchShifts += shift_type)، `odoo-sync.processor.ts` | ✅ | `GET /shifts` (منتقي السائق في onboarding) يعيد **ورديات DRIVER الفعالة فقط**؛ ورديات موظفي المستودع (تُدار في أودو) لا تصل للسائق أبداً. `getDriverShiftOrThrow` يحرس onboarding + طلب تغيير الوردية. **مطلوب بعد السحب: `npm run migration:run`**. |
| 70 | **حذف وردية في أودو ينعكس هنا** | `odoo-sync.processor.ts` (`syncFleet`) | ✅ | المرايا الغائبة عن أودو تُحذف؛ إن منعها FK تاريخي (بروفايل سائق قديم) تُعطَّل `is_active=false` فتختفي من القوائم — بعد تنظيف الإسنادات بنفس دورة المزامنة. |
| 71 | **دفع طلب السائق يشمل صور مستنداته** | `odoo.service.ts` (`createDriverRequest`)، `odoo-sync.processor.ts` (+`mediaRepo`)، `odoo-sync.module.ts` | ✅ | كل صور media بمالكها profile.id (COLLECTOR) تُرسل كـ `image_ids` لنموذج `recycle.driver.request` في أودو — أدمن أودو يراها ويقرر عليها. إعادة الرفع تعيد الدفع (upsert في أودو — لا تكرار). |
| 72 | **رفض صورة واحدة من أودو**: webhook `driver-decision` + `rejected_media_ids[]` | `odoo-webhook.dto.ts`، `odoo-webhook.controller.ts`، `odoo-sync.constants.ts`، `odoo-sync.processor.ts` | ✅ | مع NEED_CHANGES: الصور المحددة تُعلَّم REJECTED (بفحص ملكية `ownerId=profile.id`، حد 20، UUID لكل عنصر) → يقبلها `PATCH /media/:id/reupload` → الحساب يعود PENDING_APPROVAL ويُعاد الدفع لأودو تلقائياً — **دورة مغلقة**. قرارات أودو **صارمة**: أودو لا يحفظ القرار إن لم يصل الـ webhook (لا انحراف حالات أبداً). |

## ملاحظات تحقّق
- **جولة 2026-07-16:** `tsc --noEmit` نظيف · **154/154 اختبار** (حُدّث fixture واحد في `shift-change-request.service.spec` ليعكس عقد DRIVER الجديد) · الجانب الأودو: ترقية 0 أخطاء + 12/12 + تحقق شل وبصري كامل (انظر `PROJECT_LOG.md` جلسة 2026-07-16). **مطلوب بعد السحب: `npm run migration:run`**.

---

## جولة 2026-07-19 — انقطاعات Redis الدورية (ECONNABORTED/ECONNRESET كل ~90 ثانية)

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 73 | **السبب الجذري بيئي وليس في الكود**: خدمة `redis-server` مثبّتة داخل WSL Ubuntu كانت في حلقة إعادة تشغيل لا نهائية (systemd: `start operation timed out` → terminate → restart كل 90 ثانية بالضبط، عداد المحاولات تجاوز 25). كل دورة كانت تخطف `127.0.0.1:6379` عبر `wslrelay` من وكيل Docker (`com.docker.backend`) ثم تموت قاطعةً **كل** اتصالات ioredis دفعة واحدة | بيئة WSL (لا ملفات مشروع) | ✅ | `wsl -u root systemctl disable --now redis-server` — تعطيل نهائي للخدمة المتروكة؛ المنفذ 6379 صار حصرياً لحاوية Docker `redis` (التي تحمل بيانات التطبيق أصلاً). للتراجع: `systemctl enable --now redis-server` داخل WSL |
| 74 | **تحصين دفاعي**: `keepAlive: 10_000` + `connectTimeout: 10_000` على اتصالي ioredis (العميل العام + BullMQ) — مجسات TCP keepalive كل 10 ثوانٍ بدل افتراضي Windows (ساعتان) كي تنجو الاتصالات الخاملة من وكيل منافذ Docker Desktop | `core/redis/redis.module.ts` · `core/queue/queue.module.ts` | ✅ | إعداد وقائي فقط — ثبت بالاختبار أنه لم يكن سبب المشكلة (الانقطاع كان يضرب الاتصالين معاً بنفس اللحظة) |

**منهجية التشخيص (للمرجع)**: اختبار خمول 4 دقائق باتصالين (default مقابل keepAlive) أظهر انقطاعاً متزامناً لكليهما كل 90 ثانية بتوقيتات ثابتة → ليس idle-timeout بل حدث خارجي دوري → `Get-NetTCPConnection -LocalPort 6379` كشف مستمعَين متنافسين (`wslrelay` + `com.docker.backend`) → `journalctl -u redis-server` داخل WSL أكّد حلقة الانهيار بنفس التوقيتات.

## ملاحظات تحقّق
- **جولة 2026-07-19:** `tsc --noEmit` نظيف · إعادة اختبار الخمول 4 دقائق بعد الإصلاح: **صفر انقطاعات** + `run_id` عبر localhost يطابق حاوية Docker (`5887b080…`) · لا حاجة لأي هجرة أو seed.

---

## جولة 2026-07-20 — إزالة راوتات تغيير الوردية + وردية السائق في الدفع لأودو + إحصائيات السائقين

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 75 | **حذف كل راوتات طلبات تغيير الوردية** (تدقيق بطلب صريح: لا راوت إضافة/تعديل وردية، لا طلب تغيير وردية، لا عرض طلبات سائقين، لا إضافة شاحنة) | حُذفت: `truck/shift-change-request.controller.ts` (الكنترولران COLLECTOR+Admin) و`shift-change-request.service.ts` و`dto/shift-change-request.dto.ts` وspec الخدمة · عُدّل `truck.module.ts` | ✅ | إسناد/تغيير وردية السائق صار **حصراً في أودو** (شاشة "إسناد سائق لشاحنة" أدمن+مدير مستودع). كيان `ShiftChangeRequest` وwebhook القرار `shift-change-decision` باقيان (بيانات تاريخية + وظائف قديمة محتملة بالطابور). تدقيق البقية: `shift.controller` قراءة فقط (GET /shifts) ✅ · `truck.controller` قراءة فقط ✅ · قائمة طلبات السائقين محذوفة أصلاً من account-management ✅ |
| 76 | **دفع طلب السائق يشمل ورديته** | `odoo-sync.processor.ts` (`pushDriverRequest`) · `odoo.service.ts` (`createDriverRequest`) | ✅ | وردية onboarding للسائق (`profile.shiftId` → `shift.odooShiftId`) تُرسل كـ `shift_odoo_id` — أودو يخزنها بـ `recycle.driver.request.shift_id` وتظهر بشاشتي Drivers وتفلتر شاشة الإسناد ("وردية السائق تأتي مع معلوماته") |
| 77 | **إحصائيات السائقين والشاحنات** | `reports/statistics.service.ts` + `statistics.controller.ts` | ✅ | `getDriverStats()` جديد: total (COLLECTOR) / active / assigned_to_truck (عدّ الإسنادات 1:1) / without_truck + راوت `GET /api/v1/admin/reports/drivers` + قسم `drivers` ضمن `overview`. عدد الشاحنات موجود أصلاً بـ `getTruckStats()` وضمن overview |

## ملاحظات تحقّق
- **جولة 2026-07-20:** `tsc --noEmit` نظيف · **148/148 اختبار (23 suites)** — الفارق عن 154/24 هو حزمة اختبارات خدمة طلبات تغيير الوردية المحذوفة عمداً مع الميزة · الجانب الأودو: ترقية 0 أخطاء + 12/12 + 15/15 فحص شل لدورة الإسناد + تحقق بصري كامل (انظر `PROJECT_LOG.md` جلسة 2026-07-20). لا هجرات جديدة.

---

## جولة 2026-07-21 — دورة طلب تغيير الوردية v2 + مرايا مستودع + مشاكل الشاحنة + حظر إجباري

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 78 | **دورة طلب تغيير الوردية (v2 — قرار المدير)** | `truck/shift-change-request.{controller,service,dto}.ts` (أُعيدت مبنيّة للسائق فقط) · `truck.module.ts` | ✅ | السائق الفعّال **الذي يملك شاحنة** يطلب وردية سائقين **من مستودعه** (ليست الحالية) بسبب إلزامي. راوتات COLLECTOR: `POST /shift-change-requests` (كل الشروط + لا طلب فعّال مكرر) · `GET /mine` (الأحدث أولاً) · `GET /available-shifts` (ورديات مستودعه عدا الحالية) · `DELETE /:id` (pending فقط → يحذف من النظامين عبر `enqueueCancelShiftChange`). القرار يتم بأودو؛ webhook `shift-change-decision` صار `{status: PROCESSING\|ACCEPTED(+truck_odoo_id)\|REJECTED}` — المعالج يحرّك الحالة وينقل الإسناد (المرآة) عند القبول |
| 79 | **مرآة مستودع السائق + مستودع الوردية** | هجرة `1784500000000` · `shift.entity.ts` (+odooWarehouseId) · `collector-profile.entity.ts` (+warehouse) · `odoo.service.ts` (fetchShifts+warehouse_id) · `odoo-sync.processor.ts` (syncFleet يملأ odooWarehouseId؛ applyDriverDecision يحل warehouse_odoo_id + warehouse_change_only) · webhook DTO (+warehouse_odoo_id/warehouse_change_only) | ✅ | قبول السائق بأودو يرسل مستودعه؛ نقل المستودع (warehouse_change_only) يحدّث المرآة بلا تغيير حالة ولا إشعار. الوردية مرتبطة بمستودع فيفلتر طلب السائق على ورديات مستودعه |
| 80 | **حظر إجباري لكل الأدوار** | `odoo-sync.processor.ts` (BLOCKED يمسح refresh+fcm لأجهزة السائق) · `account-management.service.ts` (`blockStatus` يمسح أجهزة أي حساب يحظره أدمن الباك ايند) | ✅ | تسجيل خروج فوري (فناء التوكن) + معالِج BLOCKED يمنع الدخول حتى الرفع. مطبّق على السائق (قرار أودو) وعلى المواطن/المؤسسة/المعمل/الجهة الحرة (أدمن الباك ايند) |
| 81 | **my-truck محسّن + إشعار القبول** | `truck/assignment.service.ts` (getMyAssignment: +warehouse{id,odoo,name}؛ رسالة "سيتم إسنادك قريباً") · `i18n/{ar,en}` (driverApproved + shiftChangeAccepted{+shift}) | ✅ | الشاحنة + مستودعها + الوردية بأوقاتها، وإلا رسالة الانتظار. إشعار قبول السائق: "سيتم إسنادك لسيارة قريباً" |
| 82 | **مشاكل الشاحنة** | `truck/truck-problem.{controller,service}.ts` + `entities/truck-problem.entity.ts` + هجرة `truck_problems` · `odoo.service.ts` (createTruckProblem) · processor (PUSH_TRUCK_PROBLEM) | ✅ | `POST /truck-problems` (multipart: سبب إلزامي + حتى 5 صور عبر Cloudinary) → دفع بالطابور لأودو `recycle.truck.problem` — يقرأه مدير المستودع (قراءة فقط). لا شيء يعود |

## ملاحظات تحقّق
- **جولة 2026-07-21:** `tsc --noEmit` نظيف · **148/148 اختبار (23 suite)** · هجرة `1784500000000` نُفّذت بنجاح · الجانب الأودو: ترقية 0 أخطاء + 12/12 + 16/16 فحص شل للدورة كاملة + تقرير PDF السائق (36KB) + تحقق بصري بالمتصفح (مدير+أدمن) — انظر `D:/ite-odoo/odoo19-docker/PROJECT_LOG.md` جلسة 2026-07-21.

---

## جولة 2026-07-22 — استلام/تسليم السيارة (Handover) + حضور السائقين + كرون إشعارات الوردية

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 83 | **كيان الحيازة + هجرة + tolerance للوردية** | `truck/entities/truck-handover.entity.ts` + `enums/handover-status.enum.ts` + هجرة `1784600000000` + `shift.entity.ts` (tolerance) + `odoo.service.fetchShifts` + `processor.syncFleet` | ✅ | `truck_handovers` (صف فريد driver+shift+workDate، حارسا إشعار)؛ `shifts.tolerance` مرآة من أودو (recycle.shift.tolerance) |
| 84 | **خدمة + راوتات الاستلام/التسليم** | `truck/handover.service.ts` + `shift-window.util.ts` + `driver.controller.ts` + `truck.module.ts` + استثناءات | ✅ | `POST /driver/pickup` · `POST /driver/dropoff` (سبب إلزامي) · `GET /driver/handover-status`. قيود نافذة الوردية (لا استلام قبل البدء/لا تسليم قبل النهاية) + استثناء الشاحنة المعطّلة (لا تُستلَم، وتُسلَّم بأي وقت) + منع الحيازة المزدوجة والشاحنة الممسوكة من آخر. دفع أودو عبر الطابور |
| 85 | **كرون إشعارات الوردية** | `maintenance/handover-cron.service.ts` + `maintenance.module.ts` + i18n `handoverMissedPickup`/`handoverLateDropoff` | ✅ | كل 5د (worker): بدء بلا استلام / نهاية بلا تسليم → إشعار السائق (FCM) + إشعار المدير (نداء أودو `backend_alert_manager`) مع دقائق التأخير من هامش الوردية؛ مرة واحدة لكل حدث |
| 86 | **مزامنة أودو للحيازة** | `odoo.service.ts` (createTruckHandover/closeTruckHandover/notifyHandoverAlertManager) + constants/service/processor (PUSH_HANDOVER_PICKUP/DROPOFF) | ✅ | إنشاء مرآة على الاستلام، إغلاقها على التسليم (idempotent)، وتنبيه المدير للـ missed/late |

## ملاحظات تحقّق
- **جولة 2026-07-22:** `tsc` نظيف · **148/148 اختبار** + سبك `handover.service.spec` **6/6** (بساعة مثبّتة) · هجرة `1784600000000` نُفّذت · الجانب الأودو: ترقية 0 أخطاء + 12/12 + 5/5 فحص شل + تحقق بصري لشاشة "حضور السائقين" — انظر `D:/ite-odoo/odoo19-docker/PROJECT_LOG.md` جلسة 2026-07-22.

---

## جولة 2026-07-23 — لوحة قاعدة البيانات (DB Dashboard، شبيهة phpMyAdmin) مدمجة

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 87 | **لوحة DB مدمجة بالباك ايند** (ليست مشروعاً منفصلاً) | `src/db-dashboard/*` مسجّل بـ `AppModule` | ✅ | تعيد استخدام اتصال TypeORM نفسه لـ `dawrha_db` (بلا اتصال جديد). دخول مستقل من `.env` (`DBBOARD_USER/PASSWORD`، توكن بـ `DBBOARD_SECRET`←`JWT_ACCESS_SECRET`). راوتات تحت `/api/db-admin` (VERSION_NEUTRAL): login · tables · schema · rows(بترقيم) · POST/PATCH/DELETE. القيم بارامترية + أسماء الجداول/الأعمدة مُتحقَّقة من information_schema ومقتبَسة (لا حقن). الإضافة/التعديل/الحذف تتطلب PK؛ بلا PK = عرض فقط. الواجهة **ملف React واحد** `ui.html` (CDN + Babel runtime classic، بلا build) يُخدَم من الكنترولر |

## ملاحظات تحقّق
- **جولة 2026-07-23:** `tsc` نظيف · تحقق حي على `dawrha_db` (48 جدولاً): دخول ✓، عرض الجداول والمخطط والبيانات ✓، **CRUD كامل من الواجهة** (إضافة 14→15، تعديل مع PK للقراءة فقط، حذف بتأكيد 15→14) ✓، رفض اسم جدول غير موجود 404، حذف صف غير موجود 404. الرابط: `http://localhost:3000/api/db-admin`.

---

## جولة 2026-07-24 — نطاق الوردية (عامة/خاصة) على الباك ايند

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 88 | **مرآة نطاق الوردية** | `shift/entities/shift.entity.ts` + هجرة `1784700000000` | ✅ | عمودان جديدان `is_global` (bool) + `odoo_warehouse_ids` (int[])؛ `odoo_warehouse_id` المفرد بقي خامداً. الهجرة تعبّئ من العمود القديم (بلا مستودع=عامة، بمستودع=خاصة به). نُفّذت |
| 89 | **مزامنة النطاق من أودو** | `odoo.service.fetchShifts` + `odoo-sync.processor.syncFleet` | ✅ | `fetchShifts` يقرأ `is_global`+`warehouse_ids`؛ `syncFleet` يعبّئ `isGlobal`+`odooWarehouseIds` (والمفرد للتوافق) |
| 90 | **Onboarding: العامة فقط** | `shift/shift.service.ts` (`list`+`getDriverShiftOrThrow`) | ✅ | السائق غير المقبول بلا مستودع → يرى/يقبل **الورديات السائق العامة فقط** (`isGlobal:true`) |
| 91 | **تغيير الوردية: عامة أو مستودعه** | `truck/shift-change-request.service.ts` (`availableShifts`+`create`) | ✅ | المسموح = `isGlobal` **أو** مستودع السائق ضمن `odooWarehouseIds` (بدل مقارنة المستودع المفرد) |

## ملاحظات تحقّق
- **جولة 2026-07-24:** `tsc` نظيف · **154/154 اختبار** · هجرة `1784700000000` نُفّذت. الجانب الأودو: ترقية 0 أخطاء (v19.0.1.23.0) + post-migrate + **11/11 فحص شل** لقواعد النطاق/الوقت + إصلاح CSS وصل الشريط الجانبي بالنافبار — انظر `PROJECT_LOG.md` جلسة 2026-07-24.

---

## جولة 2026-07-24 (تكملة) — راوتات ورديات السائق + متانة الربط + مرآة السائقين فقط

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 92 | **راوتا ورديات السائق (بدل القديم)** | `shift/shift.controller.ts` + `shift.service.ts` + `shift.exceptions.ts` + `shift.module.ts` | ✅ | حُذف `GET /shifts`. `GET /shifts/onboarding` (PENDING_PROFILE+COLLECTOR → العامة فقط، id لـ add-information). `GET /shifts/home` (ACTIVE+COLLECTOR → العامة+مستودعه، id لـ shift-change). حُرّاس per-route + حقن CollectorProfile. تحقق: 401 بلا توكن، 404 للقديم |
| 93 | **متانة الربط أودو→باك (تسوية)** | `odoo-sync/fleet-reconcile.service.ts` (جديد) + `odoo-sync.service.ts` (`enqueueSyncFleetReconcile`) + `odoo-sync.module.ts` | ✅ | كرون كل 10د + مزامنة عند الإقلاع (OnModuleInit) + jobId مقسّم على الدقيقة (لا تكدّس). `syncFleet` قراءة كاملة idempotent → أي انقطاع يُغلق خلال دورة. + `.env ODOO_WEBHOOK_SECRET` + بارامترا أودو |
| 94 | **إصلاح تحويل وقت الوردية** | `odoo-sync.processor.ts` (`odooFloatToTime`) | ✅ | أودو يخزن Float (8=08:00, 17.0333=17:02)؛ كان يسبب `invalid input syntax for type time` ويجمّد كل مزامنة. تقريب للدقيقة، 0 صالحة (منتصف الليل) |
| 95 | **المرآة ورديات السائقين فقط** | `odoo.service.fetchShifts` + `db/seeds/shift-seed.ts` | ✅ | دومين `shift_type=driver` (ورديات الموظفين تبقى بأودو). seed تحوّل لتنظيف الورديات اليتيمة (odooShiftId=NULL) + حُذفت الوهمية Morning/Evening |

## ملاحظات تحقّق
- **جولة 2026-07-24 (تكملة):** `tsc` نظيف · **154/154 اختبار** · الراوتان مُعرّفان والحُرّاس فعّالة. إثبات حي: إضافة وردية بأودو ظهرت بالمرآة خلال ثوانٍ، حذفها انمسح، 202/403 للسرّ. المرآة: 5 ورديات سائقين محوّلة الأوقات صحيح. أودو: 5/5 فحص تكرار طبق-الأصل. تفاصيل: `PROJECT_LOG.md` جلسة 2026-07-24 (تكملة).

---

## جولة 2026-07-25 — مراجعة/تعديل طلب الأونبوردنغ لكل دور + تدقيق الـ APIs

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 96 | **عرض الطلب المقدَّم لكل دور** | `onboarding/services/onboarding-submission.service.ts` (جديد) + 4 كنترولرات | ✅ | `GET /onboarding/{institution\|factory\|external-partner\|collector}/submission` — يرجّع التتابعية كاملة حسب الدور (steps + information + location + documents + materials) مع **اسم المحافظة** وحالة كل ملف. متاح فقط للحالات PENDING_APPROVAL / REJECTED / NEED_CHANGES. خدمة واحدة عامة عبر `ProfileResolver` + خريطة إعدادات لكل دور |
| 97 | **تعديل الموقع** | نفس الخدمة + `dto/update-location.dto.ts` | ✅ | `PATCH .../location` — PATCH جزئي (كل حقل اختياري لكن مُتحقَّق منه)، **PENDING_APPROVAL حصراً** (وإلا 403). للسائق: إعادة دفع فورية لأودو |
| 98 | **استبدال ملف مرفوع** | نفس الخدمة | ✅ | `PATCH .../documents/:mediaId` — ملكية صارمة، **PENDING_APPROVAL حصراً**، ويرفض الملفات المرفوضة (403) موجّهاً لمسار إعادة الرفع. الشريك الخارجي بلا هذا المسار (لا يملك خطوة documents) |
| 99 | **NEED_CHANGES حصراً عند رفض صورة** | `account-management/dto/update-account-status.dto.ts` | ✅ | حُذفت NEED_CHANGES من الحالات التي يضبطها الأدمن يدوياً — تُضبط فقط من `updateMediaStatus` عند رفض ملف محدد، وإلا يعلق المستخدم بحالة بلا ملف مرفوض ليعيد رفعه |
| 100 | **إصلاح: الحساب كان يغادر NEED_CHANGES مبكراً** | `media/media.service.ts` | ✅ | مع رفض عدة ملفات، إعادة رفع أولها كانت تُرجع الحساب PENDING_APPROVAL رغم بقاء ملفات مرفوضة. صار يعود للمراجعة **فقط عند عدم بقاء أي ملف مرفوض** (+ اختبار جديد) |
| 101 | **توحيد إصدار الـ API** | `media/media.controller.ts` · `notification/notification.controller.ts` | ✅ | كانا **بلا إصدار** (`/api/media`, `/api/notifications`) بينما كل المشروع `/api/v1/...`. صارا مثبَّتين على المسارين معاً عبر `VERSION_NEUTRAL + '1'` — توحيد **بلا كسر** أي عميل حالي |

## ملاحظات تحقّق
- **جولة 2026-07-25:** `tsc` نظيف · **155/155 اختبار** (+1 جديد) · 11 راوت جديد مُعرَّف. اختبار حي: عرض الطلب أرجع التتابعية والمحافظة والوردية والملفات؛ تعديل الموقع 200 و**انعكس بأودو فوراً**؛ استبدال ملف 200؛ استبدال ملف مرفوض 403؛ إعادة رفع المرفوض 200؛ إعادة رفع غير مرفوض 400؛ التعديل والحساب REJECTED 403؛ بلا توكن 401؛ المساران `/api/...` و`/api/v1/...` كلاهما 200. بيانات الاختبار أُعيدت لأصلها.

---

## جولة 2026-07-25 (تكملة) — تعديل المعلومات لكل رول + كاش قوائم الأدمن + مستودعات

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 102 | **تعديل المعلومات لكل رول** | `onboarding/dto/update-information.dto.ts` (جديد) + `onboarding-submission.service.updateInformation` + 4 كنترولرات | ✅ | `PATCH /onboarding/{role}/information` — DTO مستقل لكل دور (منع تسريب حقول دور لآخر)، خريطة DTO→عمود لكل رول، تحقق من `institutionTypeId`/`shiftId` (وردية سائق عامة فعّالة)، و409 نظيف عند تكرار قيمة فريدة. PENDING_APPROVAL حصراً |
| 103 | **السائق لا يعدّل الإحداثيات** | `onboarding-submission.service.updateLocation` | ✅ | إرسال `coordinates` من دور COLLECTOR → 403 (نقطته تُلتقط من التطبيق وتُستخدم بالتوزيع)؛ يعدّل العنوان والوصف فقط |
| 104 | **كاش قوائم طلبات الأدمن** | `account-management/providers/applications-cache.service.ts` (جديد) + `account-management.service` + `account-management.module` | ✅ | كاش بنمط **عدّاد النسخة** (نفس CatalogCacheService): المفتاح يحمل النسخة، والإبطال `INCR` واحد O(1) بلا SCAN. TTL 2د كشبكة أمان. fail-open للقاعدة عند أي خطأ Redis |
| 105 | **إبطال الكاش عند كل تغيير** | `account-management.service` (updateStatus / updateMediaStatus / blockStatus) + `onboarding-submission.service.afterEdit` | ✅ | كل قرار أدمن (قبول/رفض/رفض صورة/حظر) **وكل تعديل من الطالب نفسه** يُبطل كاش دوره — فلا يقرأ المراجِع بيانات ما قبل التعديل |
| 106 | **باك: عرض مستودع محدد + تعديله** | `warehouse/warehouse-admin.{controller,service}.ts` + `dto/update-warehouse.dto.ts` (جديد) | ✅ | كانا **ناقصين**. `GET /admin/warehouses/:id` بنفس شكل صف القائمة، و`PATCH /admin/warehouses/:id` (اسم/رمز/عنوان/محافظة/إحداثيات/سعة/تفعيل) مع 409 على تكرار الرمز. المدير ومعرّف أودو وأرقام المخزون مستثناة عمداً |
| 107 | **أودو: إدارة المستودع** | `models/warehouse.py` + `dashboard_admin.xml` + `recycle_admin_dashboard.js` + i18n | ✅ | بشاشة المستودع: **إضافة منطقة** (اسم+نوع، منع تكرار الاسم)، **حذف منطقة** (ممنوع إن كان فيها أي سجل مخزون)، **تغيير المدير** (يعرض غير المسنَدين؛ القديم يبقى دوره manager ويُفكّ عنه المستودع فلا تُفتح له لوحته)، **تعديل بيانات المستودع** (حقول بيضاء فقط). كلها admin-only |

## ملاحظات تحقّق
- **جولة 2026-07-25 (تكملة):** `tsc` نظيف · **155/155 اختبار** · 4 راوتات information + راوتا المستودع مُعرَّفة. اختبار حي: السائق يرسل إحداثيات → **403**؛ يعدّل العنوان → 200؛ يعدّل رقمه الوطني → 200 و**ظهر بأودو فوراً** (`national_id=74123569875`). أودو: **8/8 فحص شل** لإدارة المستودع (إضافة/تكرار مرفوض/نوع خاطئ مرفوض/حذف فارغة/منع حذف ذات مخزون/قائمة المدراء/تعديل/اسم فارغ مرفوض). Postman: مجلد "طلبي" بكل دور + راوتا المستودع.

---

## جولة 2026-07-25 (تكملة 2) — سجلّ السائق + كوليكشن الأدمن الكامل

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 108 | **إصلاح: زر إضافة منطقة كان يطلب اختيار مستودع** | `recycle_admin_dashboard.js` + `dashboard_admin.xml` | ✅ | كان في **دالتان بنفس الاسم** `openZoneCreate` — الثانية (كود ميت من شاشة المناطق العامة) تُظلّل الأولى بجافاسكربت، فالزر يفتح الشاشة العامة ذات قائمة المستودعات. أُعيدت تسمية الخاصة بالمستودع إلى `openWarehouseZoneCreate`/`confirmWarehouseZoneCreate` — الآن تُسنَد المنطقة تلقائياً للمستودع المفتوح بلا أي اختيار |
| 109 | **سجلّ بلاغات الشاحنة للسائق** | `truck/truck-problem.{service,controller}.ts` | ✅ | `GET /api/v1/truck-problems/mine?page&limit` — الأحدث أولاً + ترقيم، مقصور على بلاغات السائق نفسه، ويظهر `synced_with_odoo` للربط مع ما يراه المدير |
| 110 | **ترقيم سجلّ طلبات تغيير الوردية** | `truck/shift-change-request.{service,controller}.ts` | ✅ | `GET /api/v1/shift-change-requests/mine?page&limit` — كل طلباته بأي حالة، الأحدث أولاً + `pagination` (كان يرجع كل الصفوف بلا ترقيم) |
| 111 | **كوليكشن أدمن مستقل ومرتّب** | `postman/Dawrha.admin.postman_collection.json` (جديد) | ✅ | **54 راوت = كل راوتات الأدمن بلا نقص** (تحقق آلي: MISSING=0 / EXTRA=0 مقابل جدول الراوتات الحيّ)، بـ11 مجلداً **بترتيب التشغيل**: تقارير → وحدات → حالات → محافظات → تصنيفات → منتجات → تسعير → عروض → طلبات تصنيفات → مستودعات → مراجعة الطلبات. كل راوت بوصف عربي وبودي مطابق للـ DTO الفعلي، وعلامة ⚙️ لما يُزامَن مع أودو |

## ملاحظات تحقّق
- **جولة 2026-07-25 (تكملة 2):** `tsc` نظيف · **155/155 اختبار** · الراوتان الجديدان مُعرَّفان ويعملان ببيانات حقيقية مع `pagination` صحيح (`current_page/total_pages/total_count/limit/has_next/has_prev`) · مطابقة آلية بين الكوليكشن وجدول الراوتات: **54/54 بلا نقص أو زيادة**.

---

## جولة 2026-07-26 — إيقاف عاصفة الإشعارات وتوحيد Redis

**التشخيص:** ما كانت مشكلة تعدّد Redis. الفحص أثبت وجود **Redis واحدة فقط** (حاوية دوكر) — نفس `run_id` من كل المسارات، و`wslrelay` مجرد تمرير منفذ من Docker Desktop لا خادم ثانٍ. السبب الحقيقي **حلقة تغذية راجعة لا نهائية**.

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 112 | **الجذر: فشل دائم كان يُعاد 3 مرات** | `notification/processors/notification.processor.ts` | ✅ | مستخدم بلا جهاز مسجَّل **لن** يصير عنده جهاز بالمحاولة 2 أو 3. استُبدل `Error` بـ **`UnrecoverableError`** فيفشل فوراً بلا إعادة |
| 113 | **المُضخِّم: كرون يعيد جدولة المستحيل** | `notification/notification.service.ts` + `queues/notification.queue.ts` | ✅ | كرون الـ5 دقائق كان يلتقط كل FAILED ويعيد إدخالها → تفشل → يلتقطها ثانية… للأبد. أُضيفت `PERMANENT_FAILURE_REASONS` ويستثنيها الاستعلام؛ الصفوف تبقى FAILED مرئية للدعم |
| 114 | **تراكم غير محدود بالطابور** | `notification/notification.service.ts` | ✅ | `removeOnFail: false` كان يحتفظ بكل مهمة فاشلة للأبد: **31 إشعاراً ولّدت 11,651 مهمة ميتة** بـRedis. صار `{ count: 500 }` |
| 115 | **ضجيج إعادة اتصال روتينية** | `core/queue/queue.module.ts` | ✅ | بروكسي منافذ Docker Desktop على ويندوز يقطع الاتصالات الخاملة، فتعيد كل اتصالات BullMQ الاتصال وتنجح **دائماً من المحاولة 1**. صارت المحاولة 1 `debug` (روتينية) وما بعدها يبقى `warn` (مشكلة حقيقية) |
| 116 | **توحيد Redis** | البيئة | ✅ | أُزيلت حزم `redis-server`/`redis-tools` من WSL Ubuntu نهائياً (كانت معطّلة لكنها قنبلة تعارض موقوتة)، وحُذفت حاوية دوكر ميتة قديمة. **بقيت حاوية `redis` واحدة على 6379**. خدمة ويندوز Redis: Stopped+Disabled |

## ملاحظات تحقّق
- **جولة 2026-07-26:** `tsc` نظيف · **155/155 اختبار**. قياس فعلي قبل/بعد على 3 دقائق تشغيل: أخطاء FCM **مئات → 0** · تحذيرات إعادة المحاولة **مئات → 0** · تحذيرات Redis **18 → 0** · مفاتيح الطابور **11,656 → 2** · إجمالي أسطر ERROR **0**. الكرون صار يطبع «No failed notifications to retry» بدل إعادة جدولة 31 إشعاراً محكوماً بالفشل.

---

## جولة 2026-07-26 (تكملة) — إصلاح مزامنات كانت تفشل بصمت منذ البداية

**التشخيص:** الباك ايند كان يدفع لموديلات **غير موجودة** بأودو، فترجع 404 وتفشل بصمت بعد 3 محاولات — أي أن وحدات القياس وحالات المادة **لم تُزامن ولا مرة** منذ كتابة الكود.

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 117 | **موديلان وهميان بأودو** | `models/catalog_reference.py` (جديد) + `__init__.py` + `ir.model.access.csv` | ✅ | `recycle.measurement.unit` و`recycle.material.condition` **لم يكونا موجودين إطلاقاً**. أُنشئا بنفس العقد الذي يكتبه `odoo.service.ts` (name/code/allows_tolerance و name/code/sort_order) + قيد تفرّد على code + صلاحيات أدمن/قراءة. v19.0.1.25.0 |
| 118 | **المحافظة: تسمية مقابل مفتاح** | `odoo/odoo.service.ts` | ✅ | أودو يخزّن Selection **بالمفتاح** (`damascus`) والباك يرسل **التسمية** (`Damascus`) → كان يرفض إنشاء أي مستودع. أُضيف `toOdooGovernorateKey` يقبل المفتاح أو الاسم الإنكليزي أو **العربي**، والمجهول يمرّ كما هو ليبلّغ عنه أودو لا أن نخمّنه |
| 119 | **نوع المنطقة بحروف كبيرة** | نفس الملف + الكوليكشن | ✅ | `zone_type` بأودو Selection صغير الحروف — تُطبَّع الآن. وصُحّح المثال بالكوليكشن (`receiving` لا `RECEIVING`) |
| 120 | **سجلّ مضلِّل: "will retry" لما لا إعادة** | `notification/processors/notification.processor.ts` | ✅ | كان يطبع "will retry" حتى للوظائف التي استنفدت محاولاتها أو الدائمة الفشل — فيبدو السجل كحلقة لا نهائية وهي غير موجودة. صار: الفشل الدائم `info` بلا ضجيج، وإعلان الإعادة **فقط عند إعادة فعلية**، و«exhausted all N attempts» عند النفاد |

## ملاحظات تحقّق
- **جولة 2026-07-26 (تكملة):** `tsc` نظيف · **155/155 اختبار**. إثبات حي بعد الإصلاح: وحدة قياس → ظهرت بأودو (`recycle_measurement_unit`) ✓ · حالة مادة → ظهرت (`recycle_material_condition`) ✓ · مستودع بـ`governorate:"Damascus"` → خُزّن `damascus` مع 4 مناطق ✓ · تصنيف → ظهر بـ`recycle_product_category` ✓ · صفر أخطاء مزامنة جديدة. بيانات الاختبار حُذفت من النظامين.
- ⚠️ **درس تشغيلي مهم:** ترقية الموديول بـ`--stop-after-init` تعدّل قاعدة البيانات لكن **الخادم الشغّال يبقى بسجلّه القديم بالذاكرة** — لازم `docker restart odoo19` بعد أي موديل جديد وإلا استمر 404.

---

## جولة 2026-07-26 (تكملة 2) — تدقيق آلي شامل للعقد + إعادة فتح المستودع

**المنهج:** بدل ملاحقة كل خطأ وحده، بنيت **تدقيقاً آلياً**: يستخرج كل حقل يكتبه `odoo.service.ts` لكل موديل، ويقارنه بسكيما أودو الحيّة (`_fields`). كشف 12 بلاغاً — **9 إيجابيات كاذبة** (مفاتيح عابرة تُحلّ بـ`pop` داخل `create`؛ تحققت من كل واحدة يدوياً) و**3 مشاكل حقيقية**.

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 121 | **`price` غير موجود بـ`recycle.product`** | `odoo/odoo.service.ts` | ✅ | المُعالج **لا يرسل** سعراً أصلاً، لكن `createProduct` كان يضيف `price` من نفسه → أودو يرفض → 3 محاولات → **التعويض يحذف المنتج من الباك ايند**. أودو يحمل أسعاراً لكل شريحة (`price_factory`/`price_free_facility`) تُكتب عبر مزامنة التسعير. حُذف الحقل |
| 122 | **`recycle.product.condition.price` غير موجود** | `models/catalog_reference.py` | ✅ | ثالث موديل وهمي — تسعير المنتج حسب الحالة كان يفشل بصمت. أُنشئ بالعقد الحرفي (product_id, tier, condition_code, price) + تفرّد على الثلاثي + صلاحيات |
| 123 | **إعادة فتح المستودع (سيناريو كامل)** | `models/warehouse.py` + XML + JS + i18n | ✅ | `action_cancel_closing` (من `closing`) و`action_reopen_warehouse` (من `inactive` → يعيد `active=True` ويمسح `closed_at`). **القاعدة الجوهرية موثّقة بالكود: لا إعادة ربط تلقائية لأي موظف أو شاحنة** — الفترة قد تطول وقد انتقلوا لمستودعات أخرى، فالربط التلقائي يخلق تعارضاً. ولا تُستدعى دوال الإغلاق عكسياً. زر لكل حالة + رسالة تنبيه صريحة |
| 124 | **بودي التسعير خاطئ بالكوليكشن** | `postman/Dawrha.admin.postman_collection.json` | ✅ | كان `{condition, price:{...}}` والصحيح `{individual, company, factory:[{condition,price}], free_facility:[...]}` — صُحّح مع تنبيه أن الحالة يجب أن تكون موجودة فعلاً |

## ملاحظات تحقّق
- **التدقيق الآلي بعد الإصلاح: `TOTAL PROBLEMS: 0` — ✅ كل حقل يكتبه الباك موجود بأودو** (11 موديلاً).
- **إثبات حي:** منتج → وصل أودو (id=29) و**بقي بالباك بحالة SYNCED** (لم يُحذف) ✓ · حالة مادة → وصلت ✓ · تسعير → سطران بأودو (factory 150 / free_facility 90) ✓ · **صفر أخطاء مزامنة**.
- **إعادة الفتح: 18/18 فحص شل** — رفض من `active`، إلغاء الإغلاق بلا إعادة ربط، إعادة الفتح تُرجع `active=True`، قائمة الموظفين فارغة، ظهور بالاستعلامات، والتاريخ (شحنات + سجلات تعيين) لم يُمسّ.
- **Redis/الكرون:** حاوية واحدة · صفر حزم WSL · صفر `ERROR` · صفر تحذيرات Redis · الكرونات تعمل (تسوية الأسطول ×3، إشعارات ×3 «لا شيء لإعادته»).
- `tsc` نظيف · **155/155 اختبار** · بيانات الاختبار حُذفت من النظامين.

---

## جولة 2026-08-14 — تحويل الحالات (re-grade) كان يُعكَس بصمت — الإصلاح عبر النظامين

**العطل (مؤكَّد بتتبّع الكود عبر المشروعين):** `POST /api/v1/admin/waste/products/:productId/conditions/transfer-stock` ([stock-transfer.service.ts](src/waste-management/admin/stock-transfer.service.ts)) كان ينقل الكمية بين الحالتين في **مرآة الباك فقط** ثم يستدعي `enqueueSyncWarehouse` — وهو job **قراءة** يُعيد كتابة `row.quantity` من أودو ([odoo-sync.processor.ts:1123](src/odoo-sync/odoo-sync.processor.ts:1123)). وبما أن **أودو لم يُبلَّغ بأي تحويل** (لا action ولا endpoint له في `recycle.stock`/`api.py`)، كانت المزامنة التي أطلقها الروت نفسه **تُعيد المرآة إلى ما قبل التحويل خلال ثوانٍ** — أودو المالك الوحيد للكميات. الاختبار كان يـ mock الـ`odooSync` فأعطى ثقة زائفة.

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 125 | **أودو ينفّذ التحويل (المالك الوحيد للكميات)** | Odoo: `models/stock.py` `transfer_grade` | ✅ | دالة `@api.model transfer_grade(warehouse_id, product_id, from, to, qty)`: تنقل **الكمية غير المحجوزة فقط** بين حالتين لنفس المادة، **الإجمالي ثابت** (نقل داخل نفس المنطقة)، تتحقق أن الحالتين تخصّان المادة، ولا تحذف صف المصدر عند تصفيره. تُرجع `{transferred:false, movable}` عند العجز بدل الرمي |
| 126 | **الباك يدفع الكتابة عبر الطابور (لا مرآة تُدهَس)** | `odoo.service.ts` (`transferStockGrade`) · `odoo-sync.constants/service/processor` (job `TRANSFER_STOCK_GRADE`) | ✅ | الروت صار: يتحقق (منتج/حالات/مستودع ممرآ) + **pre-check ضد المرآة** لخطأ سريع + audit للنيّة + `enqueueTransferStockGrade`. **لا يلمس المرآة إطلاقاً** — المرآة تتزامن عبر ping المخزون الذي يطلقه أودو (قناة `SYNC_WAREHOUSE` القائمة، فلا مُصالِح جديد مطلوب). المعالج يُشعر الأدمن الطالب عند رفض أودو (سباق نادر) بلا إعادة محاولة عقيمة |
| 127 | إعادة كتابة اختبار الروت + مفتاحا ترجمة + إشعار مترجم | `stock-transfer.service.spec.ts` · `i18n/{ar,en}` (`gradeTransferFailed` + رسالتا الروت) | ✅ | الاختبار صار يثبت **أن المرآة لا تُكتب** + أن الكتابة تُدرَج للطابور بالحمولة الصحيحة (حارس ضد تكرار الثقة الزائفة) |

## ملاحظات تحقّق
- **الباك:** `tsc` نظيف · **الحزمة كاملة 754/754 اختبار** (شملت إصلاح تطابق مفاتيح الترجمة).
- **أودو:** اختبار جديد `tests/test_grade_transfer.py` (**9/9 ناجح** على DB نظيفة معزولة): حفظ الإجمالي، نقل غير المحجوز فقط، البقاء بنفس المنطقة، رفض حالة مادة أخرى/نفس الحالة، تطابق الرمز بلا حساسية حالة، بقاء صف المصدر عند التصفير. حُذفت DB الاختبار وأُعيد تحميل `odoo19` (دالة بايثون جديدة تتطلب `docker restart`).
- **قرار المستخدم المؤكَّد:** التحويل يجب أن **يتعدّل في أودو** ويتزامن الطرفان — لا أن يبقى في الباك وحده.

---

## جولة 2026-08-15 — سيناريو طلبات المعامل/الجهات الحرة: خوارزمية التقسيم + قرار الجزئي + تعديل الأدمن + رفض التقسيم

خمس مهام على سيناريو الطلب (بعد فحص عميق أثبت أن التوزيع/المسافات/الحجز/الحدود مبنيّة سابقاً وتطابق المطلوب).

| # | البند | الملفات | الحالة | ما تم |
|---|---|---|---|---|
| 128 | **خوارزمية التقسيم أُعيد بناؤها لتطابق المواصفة حرفياً** | `order/providers/allocation-planner.ts` + spec · `order.config.ts` | ✅ | القاعدة صارت أولوية صارمة بدل «غرامة» ناعمة: (1) مستودع واحد يغطّي = الأقرب دائماً مهما بعُد؛ (2) وإلا **أقل عدد مستودعات**؛ (3) وعند التعادل **أقل مسافة إجمالية**؛ (4) وإلا أفضل جزئي يُعرض على المشتري. حُذف `SPLIT_PENALTY_KM`. **17/17 اختبار** |
| 129 | endpoint قرار المشتري على الكمية الجزئية (رأيه: أرجع له ليقرر) | `order.controller.ts` · `order-checkout.service` (سابقاً) | ✅ | مبنيّ سابقاً (respondToPartial) — أُكمل مساره |
| 130 | **رفض التقسيم → تأكيد المشتري → رفض الطلبية (لا إعادة توزيع)** | `order-status.enum` (حالة `REJECTED_AWAITING_BUYER` + migration) · `odoo-sync.processor` · `order-checkout.confirmRejection` · `order.controller` · `latest-round-split.ts` + spec · i18n | ✅ | رفض مستودع منفرد → إعادة توزيع كالسابق. رفض **تقسيم** (قرار الأدمن الواحد) → الطلبية تنتقل لحالة لاصقة تنتظر تأكيد المشتري فقط، ثم تُغلق. التمييز من دفتر الجولات (أحدث جولة > جزء واحد). حارس نقي **6/6** + تأكيد الرفض **3/3** |
| 131 | **تعديل الأدمن للتقسيم في أودو (تبديل مستودع، لا إضافة)** | Odoo: `order.py action_admin_reassign_warehouse` + `dashboard_api` endpoint `/api/admin/order/reassign` + `backend_sync` (warehouse_odoo_id) · الباك: DTO/payload/enqueue(jobId)/processor(`applyReassignment` + إعادة تسعير الليغ + `DeliveryQuoteService` بلا دورة) | ✅ | القيود: أدمن فقط · جزء تقسيم فقط · قبل الموافقة فقط · **لا يضيف مستودعاً** (المستودع الجديد ليس لأحد الأشقّاء) · الكمية متوفرة (غير المحجوز) · الحجز ينتقل (يُحرَّر ثم يُحجز). الباك يُعيد النقطة + المسافة + سعر التوصيل + الإجماليات. **أودو 6/6** + **الباك 3/3** |
| 132 | **زر «إعادة التوزيع» في لوحة الأدمن (OWL)** | Odoo: `recycle_admin_dashboard.js` (`canReassignOrder`/`_loadReassignCandidates`/`reassignOrderPart`) + `dashboard_admin.xml` (قسم في تفاصيل الطلبية) | ✅ | يظهر فقط لجزء تقسيم قابل للتعديل (pending). قائمة المستودعات المرشّحة **تستثني الحالي والأشقّاء تلقائياً**. يستدعي دالة الموديل عبر `orm.call` (أدمن)، ثم يُعيد قراءة الطلبية ويحدّث المرشّحين. أخطاء الموديل تُعرض عبر `_err`. حقول الطلبية زيدت (`is_split_part`, `part_count`, `manager_approval`, `backend_order_id`) |

## ملاحظات تحقّق
- **الباك:** `tsc` نظيف · **الحزمة كاملة 782/782 اختبار**.
- **أودو:** فحص طلب-متكامل على DB نظيفة معزولة — **36/36 ناجح** (`TestOrderReassign` 6 + `TestSplitOrderApproval` + `TestOrderWorkflow` + `TestGradeTransfer` 9)؛ أُصلح ثغرة `uom_id` مفقود في فكستشرَي `TestOrderWorkflow`/`TestSplitOrderApproval` (عطل سابق مستقل يظهر على تنصيب نظيف).
- **زر OWL:** فحص القوالب (`TestQwebHandlerBinding`/`OwlVocabulary`/`Expressions`/`BranchChains`) **10/10 ناجح** — يثبت أن `reassignOrderPart`/`canReassignOrder` مربوطة بدوال حقيقية والمفردات صحيحة؛ + `node --check` على الـJS و parse على الـXML. (التحقق البصري بالنقر يتطلّب دخول أدمن وهو محظور عليّ.) أُعيد تحميل `odoo19`.

---

## جولة 2026-08-15 (تكملة 2) — سيناريو توصيل موظف التوصيل: محرّك التخطيط في الباك

**تحقّق حقل الوزن:** `Product.unitWeightKg` = **وزن الوحدة الواحدة بالكغ** (لوجستي، أدمن فقط، مطلوب حين الوحدة ≠ KG، null للكغ) — منفصل عن وحدة القياس. سليم، لا مشكلة.

**الموجود سابقاً ويطابق السيناريو:** الرحلة milk-run من الأبعد للمعمل، استلام لكل محطة بوقته، منع الاستلام خارج الترتيب، تعدّد الشاحنات، **والمعمل (المشتري) يؤكّد الاستلام النهائي** (موافق لرأي المستخدم).

| # | البند | الملفات | الحالة | ما تم |
|---|---|---|---|---|
| 133 | **محرّك سكور الشاحنات (توزيع عادل)** | `order/providers/truck-score.ts` + spec | ✅ | دالة نقية: بين شاحنات التوصيل النشِطة غير المشغولة للمستودع، سكور يوازن **السعة الأكبر** مع **العدالة** (أقل رحلات حديثة) — لا تُسند نفس الشاحنة دائماً. **9/9** |
| 134 | **مخطّط السعة بالوزن** | `order/providers/delivery-capacity-planner.ts` + spec | ✅ | نقي: يحسب وزن كل جزء، يعبّئ من الأبعد فالأقرب حتى سعة الشاحنة، والفائض **يبدأ رحلة من مستودعه الأقرب بشاحنته** — كلها تنتهي بالمعمل. **7/7** |
| 135 | **الدمج في `DeliveryTripService`** | `delivery-dispatch.service.ts` (مرشّحو الشاحنات من المرآة + عدّ الرحلات + المشغولية) · `delivery-trip.service.ts` | ✅ | `planForOrder` صار **يخطّط تلقائياً** بالوزن+السعة ويختار الشاحنة لكل رحلة (يبقى `truck_groups` تجاوزاً يدوياً). حساب وزن الجزء من الأسطر × `unitWeightKg`. **عرض السائق = المحطة القادمة فقط**، و**عرض الأدمن = كل المحطات بحالتها ووقت الاستلام**، وكل نقطة فيها **إحداثيات + رابط غوغل ماب**. |

## ملاحظات تحقّق
- **الباك:** `tsc` نظيف · **الحزمة كاملة 802/802 اختبار** (+20: سكور 9، سعة 7، تخطيط تلقائي/عرض سائق/عرض أدمن 4).
- **متبقٍّ (Phase 2 — أودو):** دفع الرحلة لأودو + لوحة سائق التوصيل (المحطة القادمة/الماب/تأكيد الاستلام) + واجهة مراحل التوصيل عند أدمن الطلبات + webhook تأكيدات الاستلام + إشعار السائق + resolve السائق من `recycle.delivery.driver`. المحرّك والـAPIs جاهزة؛ الواجهات والتكامل مع أودو هي المرحلة التالية.

---

## جولة 2026-08-15 (تكملة 3) — سيناريو التوصيل: تكامل أودو الكامل (Phase 2)

| # | البند | الملفات | الحالة |
|---|---|---|---|
| 136 | **موديل رحلة التوصيل بأودو** (المرآة التي يعمل عليها السائق/الأدمن) | Odoo `models/delivery_trip.py` (`recycle.delivery.trip`+`.stop`): `backend_upsert` (idempotent، يحفظ الاستلامات عبر إعادة الدفع) · `next_stop` · `action_driver_confirm_pickup` (حارس تسلسل + إشعار الباك) · `action_driver_complete` · إشعار السائق عند الإسناد · `recycle.delivery.driver.backend_driver_for_truck` | ✅ **9/9** |
| 137 | **دفع الرحلة + حلّ السائق (باك)** | `odoo.service` (`pushDeliveryTrip`/`fetchDeliveryDriverForTruck`) · job `PUSH_DELIVERY_TRIP` · `DeliveryTripService.dispatchTrip` (حلّ السائق → ASSIGNED → دفع) + إرسال تلقائي بعد التخطيط | ✅ jest |
| 138 | **webhook تأكيدات الاستلام** (أودو→باك) | Odoo `backend_sync.sync_delivery` + route `delivery` · `DeliveryWebhookController` بالباك (يستدعي confirmPickup/completeTrip، حارس السرّ نفسه، بلا دورة موديولات) | ✅ jest |
| 139 | **لوحة سائق التوصيل** (المحطة القادمة فقط + رابط ماب + تأكيد) | Odoo `dashboard_api` (`/api/recycle/my-delivery-trips`/`delivery-confirm-pickup`/`delivery-complete`) · `recycle_delivery_driver_dashboard.js`+`.xml` (تبويب «My Trips») | ✅ فحص قوالب OWL |
| 140 | **واجهة مراحل التوصيل للأدمن** | Odoo `views/delivery_trip_views.xml` (list+form مع المحطات: تسلسل/مستودع/بضاعة/حالة/وقت استلام/رابط ماب) + قائمة «Delivery Trips» | ✅ تُحمّل نظيفة |

## ملاحظات تحقّق
- **الباك:** `tsc` نظيف · **الحزمة كاملة 804/804 اختبار** (+ اختبارات dispatch/webhook/سكور/سعة).
- **أودو:** **119/119** ناجح على DB نظيفة معزولة (توصيل 9، QWeb/OWL، ترجمات اللوحات، إعادة توزيع، فرز، ضرر…). أُصلحت ثغرة `uom_id` المفقودة في فكستشرات قديمة (workflow/split/stock_reports/damage_log — عطل سابق مستقل على تنصيب نظيف) وأُضيفت ترجمات عربية لكل نصوص اللوحات الجديدة. رُقّيت `odoo19` الحيّة (جداول/عروض/قوائم الرحلة) وأُعيد تحميلها.
- **عطل سابق واحد خارج نطاقي (لم ألمسه ولم أُصلحه):** `TestProductSuggestion.test_cannot_submit_twice` (UserError غير مرفوع) — لا علاقة له بملفاتي (مؤكَّد: صفر ملفات suggestion غُيّرت).
- **قرار المستخدم:** التأكيد النهائي عند المعمل (المشتري) — كان مبنيّاً سابقاً وأنا أوافقه؛ السائق يؤكّد كل محطة، والمعمل يؤكّد الاستلام النهائي.
- **تعذّر التحقق البصري بالنقر** (يتطلّب تسجيل دخول بكلمة مرور، محظور عليّ) — اكتُفي بالاختبارات الآلية على الطرفين.

---

## جولة 2026-08-15 (تكملة 4) — تأكيد المعمل + الشكاوى + تقدير التوصيل + عرض التصنيفات

| # | البند | الملفات | الحالة |
|---|---|---|---|
| 141 | **المعمل/الجهة الحرة: تأكيد الاستلام + التقييم + الشكوى** | `order.controller` + `order-view.service` (confirm-receipt/rating/complaints) | ✅ موجود ومتحقَّق (FACTORY + EXTERNAL_PARTNER) |
| 142 | **الشكاوى عند أدمن الباك** (رأي المستخدم المعتمد) | `providers/admin-complaint.service.ts` + `admin-complaint.controller.ts` (list/filter بالحالة/المسار/النوع + detail + decide بحالة وملاحظة حلّ) | ✅ **6/6** — القيود: لا بتّ مزدوج، وملاحظة حلّ إلزامية عند الإغلاق. (المسار موجود أصلاً: SHORTAGE/QUALITY→مستودع أودو، DELIVERY/BILLING/OTHER→أدمن الباك) |
| 143 | **كلفة التوصيل من سعر الكيلومتر (أدمن الباك)** | `DeliveryRateService` + `DeliveryTripService.buildTrip` | ✅ متحقَّق: كلفة كل رحلة = المسار الفعلي × السعر + الرسم الأساسي، **مجموعة عبر كل شاحنات الطلبية** (عدد الشاحنات محسوب)، والمسافة تُقاس بين مستودعات الطلبية والمعمل |
| 144 | **روت تقدير كلفة التوصيل قبل الطلب (أفضل/أسوأ)** | `DeliveryTripService.estimateDelivery` + `GET /orders/delivery-estimate` | ✅ **2/2**: أفضل = شاحنة واحدة من الأقرب؛ أسوأ = تقسيم على أقصى عدد شاحنات (سقف النمط)، كلٌّ برحلته — بلا إنشاء طلبية، بسعر أدمن الباك |
| 145 | **عرض التصنيفات: الأدمن يرى الكل** | `CatalogService.getCategories` | ✅ الأدمن يتجاوز فلتر `isActive` و«يوجد مادة قابلة للشراء» فيرى كل التصنيفات (فعّالة أو لا، مسعّرة أو لا)؛ البُيّاع يبقى: يُخفى التصنيف إذا **كل** مواده غير مسعّرة لفئتهم/غير متوفرة |

## ملاحظات تحقّق
- **الباك:** `tsc` نظيف · **الحزمة كاملة 812/812 اختبار** (+8: تقدير 2، شكاوى 6). لا تغييرات أودو في هذه الجولة.
- **قرار المستخدم:** الشكاوى تُعرض لأدمن الباك يند (الشكوى شأن الطلبية/المشتري/التوصيل — مفاهيم الباك).

---

## جولة 2026-08-15 — سيناريو طلبات المعامل/الجهات الحرة: الخوارزمية + القرار الجزئي + وزن الكغ

سياق: فحص عميق لـ `src/order` أثبت أن معظم السيناريو مبنيّ ويطابق الطلب (Google Distance Matrix + كاش ذكي، الحجز، مستودع واحد→مدير / تقسيم→أدمن، الرفض→إعادة توزيع مع استبعاد، حدّا السلة لكل حساب). أُنجزت الفجوات الثلاث التالية بالتنفيذ والاختبار:

| # | البند | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 128 | **خوارزمية التقسيم: مستودع واحد أولاً → أقل تقسيم → الأقرب** | `providers/allocation-planner.ts` (+spec) · `order.config.ts` | ✅ | استُبدل «سكور الغرامة الناعم» (الذي كان قد يفضّل تقسيماً قريباً على مستودع منفرد بعيد) بقاعدة أولوية صارمة: (1) الأقرب المنفرد الذي يغطّي — دائماً؛ (2) وإلا **أقل عدد مستودعات** يغطّي (تعداد توليفات مقيّد بسقف الوضع)؛ (3) عند التعادل **الأقرب** (أقل مجموع مسافة)؛ (4) وإلا أفضل تعبئة جزئية للعرض على المشتري. حُذف `SPLIT_PENALTY_KM`. **17/17 اختبار** |
| 129 | **قرار المشتري على الكمية الجزئية** (رأي احترافي معتمد: أرجع للمشتري) | `order.entity`(+`requested_lines` jsonb) · `order-allocation.service` (`forcePartial`) · `order-checkout.service` (`respondToPartial`) · `order.controller` (`POST /orders/:id/partial-decision`) · `order.dto` · migration `1788300000000` | ✅ | عند العجز يُحفظ لقطة الطلب على الطلبية ويُعرَض `NEEDS_CUSTOMER_DECISION`؛ endpoint جديد: `accept` → إعادة تخطيط على المخزون **الحالي** بـ`forcePartial` → `AWAITING_APPROVAL`؛ `decline` → إلغاء (لا حجز ليُحرَّر). مقفول وموسوم-حالة ضد النقر المزدوج/سباق الإلغاء. **6/6 اختبار** |
| 130 | **وزن الوحدة بالكغ (للأدمن فقط)** لأجل سعة شاحنة التوصيل | `product.entity`(+`unit_weight_kg`) · `admin-catalog.dto` · `admin-catalog.service` (`resolveUnitWeight`+`KG_UNIT_CODE`) · migration `1788400000000` | ✅ | مطلوب حين تكون الوحدة ≠ KG (KG=1:1 → null)؛ يظهر في `mapAdminProduct` **وحده** ومحجوب عن كل الاستجابات العامة (المابرز العامة تُسقط الحقل صراحةً). التبديل إلى KG يمسحه، والتبديل عنه يطلبه. **5 اختبارات وزن ضمن admin-catalog** |

**التحقق:** `tsc` نظيف · **الحزمة كاملة 770/770 اختبار** · مفاتيح ترجمة جديدة (ar+en) للرسائل الجديدة، واختبار تطابق الترجمة أخضر · الهجرتان بُنِيتا بنجاح (تُطبَّقان تلقائياً عند إقلاع الباك، `migrationsRun:true`، idempotent).

**تحقّق فحصي لبقية السيناريو (Odoo) — مبنيّ ويعمل:** بوابة التوصيل (رحلات من أجزاء `IN_OUTPUT_ZONE` فقط) ✅ · أولوية أجزاء التقسيم في طابور الإخراج (priority=1) ✅ · توجيه القبول (منفرد→مدير / تقسيم→أدمن للكل دفعة) ✅.

**فجوتان مؤكَّدتان لم تُنفَّذا بعد** (تحتاج تأكيد نطاق — Odoo + باك):
1. **تعديل الأدمن لتقسيم** (تبديل مستودع لجزء، دون إضافة رابع، وبشرط توفر الكمية) — **لا يوجد action لها إطلاقاً**.
2. **رفض التقسيم → إشعار المشتري → رفض بتأكيده** (بدل إعادة التوزيع الحالية الموحّدة لكل الرفوضات).

---

## جولة 2026-08-15 (تكملة 3) — شكاوى/تقييم، توحيد كلفة التوصيل، تقدير مسبق، إصلاحات روتات + بحث

| # | البند | الملفات | الحالة |
|---|---|---|---|
| 136 | **توحيد كلفة التوصيل على سعر أدمن الباك** (`DeliveryRateService`) عبر التوزيع + الرحلة + إعادة التوزيع + التقدير — بدل ازدواجية (تعريفة أودو مقابل سعر الباك) | `order-allocation.service` · `odoo-sync.processor` · `odoo-sync.module` | ✅ الآن الرقم الذي يراه المشتري = الذي يُحاسب عليه، بنفس السعر |
| 137 | **روت تقدير كلفة التوصيل قبل الطلب** (أفضل = شاحنة واحدة من الأقرب / أسوأ = أقصى تقسيم) دون إنشاء طلبية | `delivery-trip.service.estimateDelivery` | ✅ |
| 138 | **عرض الشكاوى لأدمن الباك** + حالة (مفتوحة/قيد المراجعة/محلولة/مرفوضة) + رد؛ والشكاوى المُوجَّهة للمستودع (نقص/جودة) **تُشعِر مدير المستودع في أودو** (حيث سجلّ الإخراج) | `admin-complaint.{service,controller}` · `order-view.fileComplaint` · Odoo `recycle.warehouse.notify_complaint` + job `PUSH_COMPLAINT` | ✅ |
| 139 | **بحث عن مادة داخل التصنيف** (`getProductsByCategory`) — كان يتجاهل `search`؛ وبحث التصنيفات موجود أصلاً | `catalog.service` | ✅ |
| 140 | إزالة صلاحية الأدمن من روت تصنيفات الأونبردينغ + `limit`/pagination لأنواع المؤسسة | `waste-management.controller` · `institution.controller` | ✅ |
| 141 | **رسائل واضحة** بدل أكواد التوزيع الخام (`PARTIAL_NEEDS_BUYER`…) في رد إنشاء/متابعة الطلب | `order-allocation.describeAllocation` · `order-checkout.service` | ✅ |
| 142 | **عطل كامن**: `notif_type` غير صالح (`delivery_trip`/`order_complaint`) كان سيفشل إنشاء الإشعار حياً — أُضيفا للـSelection | Odoo `notification.py` | ✅ |

## تحقّق (كما طُلب)
- **خوارزمية التوزيع:** 17/17 حالة (مستودع واحد أولاً، أقل تقسيم، الأقرب، جزئي، متعدّد المواد، الحالة، السقف، فارغ).
- **استدعاء غوغل (Distance Matrix):** **لا حلقات لا نهائية** — لا `while`/تعاود/`setInterval`؛ استدعاء واحد لكل استدعاء دالة؛ كل زوج (مشتري×مستودع) يُقاس مرة ثم يُقرأ من الكاش (**صفر استدعاء لكل طلبية بعد الإحماء**)؛ الأزواج الفاشلة لها مهلة 30 دقيقة؛ المحاولات محدودة بالطابور/الكرون.
- **الباك:** `tsc` نظيف · **814/814 اختبار**. **أودو:** 11/11 (تسليم + شكاوى) وتحميل الموديول نظيف؛ أُعيد تحميل `odoo19`.

---

## جولة 2026-08-15 (تكملة 4) — مراحل المستخدم (نقاط) + اختبارات الشكاوى + بحث/عروض

| # | البند | الملفات | الحالة |
|---|---|---|---|
| 143 | **المراحل CITIZEN-only**: إنشاء **بترتيب تلقائي متزايد** (لا ترتيب يدوي) + **صورة إلزامية** + **اسم فريد** (create/update) | `stages/{service,controller,dto}` | ✅ |
| 144 | **رسالة واضحة** للمستخدم بلا مرحلة + **روت عرض السُّلَّم** للمستخدم (المراحل الفعّالة مع تعليم مرحلته) | `stages.service.{myStage,listForUser}` · `StagesController` | ✅ |
| 145 | **عدد المستخدمين بكل مرحلة** للأدمن في القائمة (لأنّ الحذف قرار لا مفاجأة) | `stages.service.list/userCounts` | ✅ |
| 146 | اختبارات: **stages 13/13** جديدة + **order-view-complaint 4/4** (توجيه الشكوى للمستودع في أودو) + admin-complaint 6/6 موجود | `*.spec.ts` | ✅ |

**قرارات (رأيي الاحترافي):**
- **تعديل الترتيب = نقل/إزاحة (move) لا تبديل (swap)** — يبقي 1..N متّصلاً بلا فراغ/تكرار؛ ولمرحلتين متجاورتين يبدو كتبديل تماماً. هذا السلوك القائم صحيح (لم أغيّره) واختبرته.
- **حذف مرحلة فيها مستخدمون آمن**: المرحلة تُحسب من النقاط (لا مفتاح أجنبي)، فالحذف يزيل النطاق فقط ومن كان فيه يُبلّغ «لا مرحلة» حتى يغطّيه نطاق آخر — لا يتم-orphaning، والفجوة في الترتيب تُغلق.
- **المجال (النطاق):** لا مشكلة — عدم التداخل و`min ≤ max` مفروضان، و«أي مرحلة لهذا الرصيد؟» له جواب واحد دائماً.

**تحقّق (طلبات سابقة):** البحث الموحّد `GET /waste/search?type=all|product|category` والعروض `GET /waste/offers` + `/offers/search` (بالاسم/المعرّف) **موجودة وتعمل ومختبَرة**. `tsc` نظيف · **831/831 اختبار**.

---

## جولة Collection (Sprint 3 + Sprint 4)

| # | المشكلة | الملف | الحالة | ما تم |
|---|---|---|---|---|
| 147 | دمج مسارات الطلبات (merge) لم يكن يكتمل النقل الفعلي للمحطة ويبقي request بدون routeId | `dispatch-engine.service.ts` `tryMergeRequest`/`bindMerged` | ✅ | نقل الطلب للطريق المستهدف + إعادة ترقيم الأقساط التالية + حدث `MERGED` للسائق. |
| 148 | لا توجد سجلّية وصول للواردات في Odoo عند إتمام الجمع | `odoo-sync/*` + `dispatch-engine.service.ts` | ✅ | Job `REGISTER_INTAKE` (idempotent على request_id) عبر `recycle.collection.request/backend_register_intake` يُدرج بعد الوزن الفعلي (proportional actuals). |
| 149 | السائق لا يُكافأ على الجمع | `points-wallet/points-wallet.service.ts` | ✅ | `awardForCollection` (floor(value/amountPerPoint)) + إشعار `collectedPointsEarned`. |
| 150 | تحويل نهاية الوردية إلى سائق شارع كان يضرب فجوة غياب السائق الأصلي | `shift-swapper.cron.ts` | ✅ | إغلاق الـ OPEN بعد نهاية الوردية+tolerance ثم `handovers.pickup(account.id)` best-effort. |
| 151 | تنفيذ الجولة بلا طوابع زمنية ولا نسبة intake لكل محطة | `route-execution.service.ts` | ✅ | طوابع `enRouteAt/arrivedAt/pickedAt/deliveredAt` + تناسبية فعلية للتسجيل إلى Odoo. |
| 152 | واجهة الأدمن للجمع (السجلّ، الإسناد اليدوي، الإلغاء، نقاط التغطية، إعدادات التوزيع، التقارير) لم تكن وُعدت في §14–18 من `COLLECTION_API` | `admin-collection.*`، `coverage-points.*`، `dispatch-config.*`، `collection-reports.*` | ✅ | 4 مُتحكّمات جديدة بصلاحيات `collection.admin.view/manage` + `collection.coverage.manage` + `collection.dispatch.manage` + `admin.reports.view`؛ الإسناد اليدوي يمرّ عبر مرشّحات الـ engine (لا تجاوز) ويسجّل OFFERED→ACCEPTED. |
| 153 | كرون الـ rebalance ثابت بنصف ساعة رغم أنّه قابل للضبط | `coverage-rebalance.cron.ts` | ✅ | `SchedulerRegistry` بفاصل `rebalance_min` + `reschedule()` عند الحفظ من `PATCH /admin/dispatch-config`. |
| 154 | **فخّ class-transformer**: `plainToInstance` يكشف الحقول غير المرسلة بصورة `undefined` — دمج الـ weights يحذف الوزن المخزّن (`{...cfg.weights, ...dto.weights}` → كل القيم undefined غير `fairness`) | `dispatch-config.controller.ts` | ✅ | فلترة `undefined` من حزمة الـ DTO قبل الدمج (اكتُشف أثناء الاختبار؛ كان JSON.stringify يخفيها فتبدو سليمة). |
| 155 | عدم تطابق مفتاحه: `CollectionRouteStatus.ACTIVE` غير موجود (الاسم `IN_PROGRESS`) | `collection-reports.service.spec.ts` | ✅ | تصحيح الاختبار؛ الاختلاف ظهر عبر `tsc --noEmit` قبل الجريان. |

**تحقّق (جولة Collection):** `tsc --noEmit` نظيف · `eslint` نظيف · **97 suites / 993 tests خضراء** (إضافة dispatch-engine assignManually 4، coverage-points 5، collection-reports 5، admin-collection 3، dispatch-config 3).
