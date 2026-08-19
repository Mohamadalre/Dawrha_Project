# تقرير المتطلبات غير الوظيفية (Non-Functional Requirements) — منصّة Dawrha

> كل بند أدناه **مأخوذ من الكود المطبَّق فعلاً** مع مرجعه (ملف/سطر) — لا افتراضات. حيث لا يوجد تطبيق، ذُكر ذلك صراحةً.
> تاريخ التوثيق: 2026-08-17.

---

## 1) الأمن (Security)

### 1.1 المصادقة (Authentication)
| العنصر | ما طُبِّق | الأسلوب / الدليل |
|---|---|---|
| تجزئة كلمة المرور | **Argon2** (لا bcrypt) | `argon2 ^0.44.0` — أقوى خوارزميات التجزئة الحديثة |
| رموز JWT | **ثلاثة أنواع** برموز سرّية منفصلة | `auth.service.ts` — Access / Refresh / Temporary، كلٌّ بـ`secret` و`expiresIn` مستقلّين |
| «تذكّرني» | مدّة refresh أطول عند الطلب | `JWT_REFRESH_REMEMBER_ME_EXPIRATION` مقابل `JWT_REFRESH_DEFAULT_EXPIRATION` |
| الدخول الاجتماعي | **Google OAuth** | `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` |
| تحقّق البريد | **OTP** مع حماية تخمين | `mail.service.ts` — حدّ محاولات (`MAIL_MAX_ATTEMPTS`)، قفل بعد التجاوز (429)، تهدئة (cooldown)، backoff |

### 1.2 التفويض (Authorization) — دفاع متعدّد الطبقات
- **ثلاث بوابات متتالية:** `JwtAuthGuard` (هوية) → `AccountStatusGuard` عام (الحساب فعّال) → `RolesGuard`/`PermissionsGuard` (الرول والصلاحية).
- **كتالوج صلاحيات** دقيق عبر `@Permissions('...')` + توزيع الأدوار عبر `@Roles(...)`.

### 1.3 صلابة المدخلات
- **`ValidationPipe` عام** (`main.ts:49`): `whitelist:true` + `forbidNonWhitelisted:true` + `transform:true` → يرفض أي حقل غير معرّف (يمنع Mass-Assignment) ويحوّل الأنواع.
- **`ClassSerializerInterceptor`** عام (`main.ts:73`) → يُخفي الحقول الحسّاسة (تجزئة كلمة المرور…) من الردود.

### 1.4 تحديد المعدّل (Rate Limiting)
- **Throttler موزّع على Redis** (`app.module.ts:74`): `100 طلب / 60 ثانية / IP`، تخزين `ThrottlerStorageRedisService` (مشترك بين كل النسخ).
- تشديد على المسارات الحسّاسة عبر `@Throttle()` (المصادقة، الاقتراحات = 10/دقيقة).
- **مثبت بالقياس الحقيقي:** رفَض 31,077 طلباً بـ429 تحت سيل من IP واحد (انظر تقرير الاختبارات).

### 1.5 أمن التكامل مع الأودو (Webhooks)
- **توقيع HMAC بمقارنة زمن-ثابت** (`odoo-webhook.controller.ts:258`): `timingSafeEqual` ضدّ `ODOO_WEBHOOK_SECRET` → يمنع هجمات التوقيت والاستدعاء غير المصرّح. سرّ غير مضبوط = المنفذ مُعطَّل (fail-safe).

### 1.6 إدارة الأسرار
- كل الأسرار في `.env` **خارج الكود** (DB, JWT×3, Redis, Cloudinary, Firebase, Google, Odoo، SMTP) + **تحقّق Joi** لمخطّط الإعدادات (`configuration.ts`) → فشل مبكر عند سوء الإعداد.
- الأسرار غير مرفوعة على git (`.gitignore` + `.git/info/exclude`).

> **ثغرة صريحة (صدقاً):** لا يوجد `helmet` ولا إعداد `CORS` صريح في `main.ts` — يُنصح بإضافتهما.

---

## 2) الأداء (Performance)
| الأسلوب | الدليل |
|---|---|
| **تخزين مؤقّت Redis** بـTTL لكل مورد | `catalog-cache.service.ts` — إبطال O(1) بلا SCAN/KEYS، انتهاء طبيعي بالـTTL |
| **ترقيم صفحات** في كل القوائم | `PaginationQueryDto` عبر الكتالوج/الطلبات/الحسابات… |
| **فهرسة قاعدة البيانات** | **64 `@Index`** + **~35 قيد فرادة (Unique)** عبر الكيانات |
| **تصفية على مستوى SQL** (لا في الذاكرة) | استعلامات `EXISTS`/مترابطة في `catalog.service.ts` (تسعير/مخزون/عروض) لإبقاء الترقيم والعدّ صادقين |
| **إزاحة العمل الثقيل** خارج مسار الطلب | طوابير BullMQ (أدناه) |

**أرقام مقيسة (بيئة حيّة، قاعدة مليئة):** استعلام الكتالوج مع الـjoins ≈ **p50 20.5ms / p95 41.2ms**؛ إصابة الكاش ≈ **5ms**.

---

## 3) قابلية التوسّع (Scalability)
- **مصادقة بلا حالة (Stateless JWT)** → توسّع أفقي بلا التصاق جلسة.
- **Redis مشترك** للـThrottle والكاش → سلوك متّسق عبر عدّة نسخ.
- **عملية Worker منفصلة** (`start:worker` / `main.worker`) → توسيع العمل الخلفي مستقلّاً عن HTTP.
- **مقيس:** نسخة واحدة خدمت **366–784 طلب/ثانية**.

---

## 4) الموثوقية والصمود (Reliability & Resilience)
| العنصر | الدليل |
|---|---|
| **مرشّحات استثناء عامة (3 طبقات)** | `main.ts:61-63` — Logger / All / Database exception filters |
| **معالجات على مستوى العملية** | `main.ts:92-107` — `uncaughtException` / `unhandledRejection` |
| **نمط «أفضل جهد»** (لا يكسر التدفّق الأساسي) | منح النقاط/الإشعارات لا يُفشِل استلام الطلب (`points-wallet.service.ts`) |
| **العمليات الذرّية (Transactions)** | **7 ملفات** تستخدم `dataSource.transaction` (المراحل، سعر التوصيل، …) |
| **الحتمية (Idempotency)** | دفع أجزاء الطلب يقصُر عند وجود `odooOrderId`؛ إنشاء المحفظة idempotent |
| **إعادة المحاولة مع backoff** | طوابير BullMQ (`mail.service.ts:60` backoff) |
| **مطابقة/مصالحة الأودو** | مهام cron لمصالحة المزامنة + webhook آمن |
| **هجرات مُصدَّرة (Migrations)** | نسخ مُرقّمة، آمنة ضمن transaction |

---

## 5) قابلية الصيانة (Maintainability)
- **معمارية معيارية (Modular)** بوحدات NestJS مستقلّة.
- **TypeScript** بأنواع صارمة.
- **تغطية اختبار:** **938 اختبار وحدة + 70 E2E** (تغطية أسطر 49.9%).
- **مغلّف استجابة موحّد** (`TransformInterceptor`) → عقد API ثابت.
- **تحقّق إعدادات Joi** عند الإقلاع.

---

## 6) التدويل (Internationalization / i18n)
- **`nestjs-i18n`** بلغتين (en/ar)، بثلاثة محدِّدات: `x-lang`/`lang` (Header) + Query + Accept-Language (`app.module.ts:61`).
- **اختبار آلي يفرض تغطية الترجمة**: كل رسالة/استثناء يجب أن يملك مدخلاً بالعربية والإنجليزية (`i18n/translations.spec.ts`) → يمنع تسرّب نصوص إنجليزية للواجهة العربية.

---

## 7) المراقبة والتتبّع (Observability)
- **Winston منظّم** بقنوات (channels) وفصل مخرجات (`winston.config.ts`).
- **تدوير يومي للسجلّات** (`DailyRotateFile`: `maxFiles 10d`, `maxSize 20m`)، مستوى `error` لقناة الاستثناءات.
- **اعتراض HTTP** يسجّل كل طلب/استجابة (`LoggerHttpInterceptor`).
- **سجلّ تدقيق (Audit Trail)**: `AuditService.record({action, entityType, entityId, oldValues, newValues, userId})` لكل تعديل إداري.
- **إسكات الكونسول في الإنتاج** (`NODE_ENV==='production'`).

---

## 8) تصميم الـAPI والتوافق
- **ترقيم إصدارات URI** (`/api/v1/...`) + بادئة عامة `api` (`main.ts:38-41`) → تطوّر متوافق مع الخلف.

---

## 9) المتطلبات غير الوظيفية في الأودو (ملخّص)
- **معمارية وحدة (Addon)** مستقلّة `recycle_warehouse`.
- **تكامل آمن** عبر webhooks موقّعة + مزامنة قائمة على الطوابير من الباك.
- **سلامة المخزون**: حجز (`reserve_for_order`) ثم خصم فعلي (`_deduct_from_zone`) مع تحرير الحجز — بلا خصم مزدوج.
- **تقارير PDF** (QWeb) بدعم **العربية**.
- **تغطية اختبار**: **285 اختبار وحدة** (إطار `TransactionCase`).

---

## 10) البيئة والإعدادات التي تحقّقت فيها المتطلبات

### بيئة التحقّق/القياس
| المكوّن | الإصدار/التفصيل |
|---|---|
| Node.js | v20.11.1 |
| إطار الباك | NestJS 11 |
| قاعدة البيانات | PostgreSQL 16 — `dawrha_db`@127.0.0.1:5432 |
| الكاش/الطوابير/الحدّ | Redis (منشور على :6379) |
| الأودو | Odoo Server 19.0 (حاوية Docker) |
| أداة الحِمل | k6 |

### إعدادات المتطلبات غير الوظيفية (قابلة للضبط عبر `.env`)
- **الحدّ:** `100 طلب / 60s / IP` (Redis) — `app.module.ts`.
- **JWT:** `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_DEFAULT_EXPIRATION`, `JWT_REFRESH_REMEMBER_ME_EXPIRATION`, `JWT_TEMPORARY_EXPIRATION` + ثلاثة أسرار منفصلة.
- **الكاش:** TTL لكل مورد في `catalog-cache.service.ts`.
- **السجلّات:** تدوير 10 أيام / 20MB.
- **التكاملات:** Cloudinary (وسائط/CDN)، Firebase (إشعارات دفع)، SMTP (بريد/OTP)، Odoo (`ODOO_URL/DB/USERNAME/PASSWORD/WEBHOOK_SECRET`).
- **تحقّق الإعدادات:** مخطّط Joi (`configuration.ts`).

---

## 11) ملخّص الحالة (لكل متطلّب)
| المتطلّب غير الوظيفي | الحالة |
|---|---|
| الأمن — مصادقة/تفويض/تحقّق/حدّ معدّل/أسرار | ✅ مطبَّق بقوّة |
| الأمن — Helmet/CORS | ⚠️ غير مطبَّق (موصى به) |
| الأداء — كاش/فهرسة/ترقيم/تصفية SQL | ✅ مطبَّق ومقيس |
| قابلية التوسّع — Stateless/Redis/Worker | ✅ مطبَّق |
| الموثوقية — استثناءات/معاملات/idempotency/طوابير | ✅ مطبَّق |
| قابلية الصيانة — وحدات/اختبارات/هجرات | ✅ مطبَّق |
| التدويل i18n (ar/en) | ✅ مطبَّق مع فرض تغطية |
| المراقبة — سجلّات/تدوير/تدقيق | ✅ مطبَّق |
| إصدارات API | ✅ مطبَّق |
