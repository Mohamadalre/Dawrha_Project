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
