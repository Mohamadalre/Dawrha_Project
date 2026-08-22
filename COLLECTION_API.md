# COLLECTION_API — شرح API نظام طلبات الجمع (مختصر لكل Endpoint)

> المرافق: **COLLECTION_DESIGN.md** (الخطة والتاسكات). كل الـ APIs تحت بادئة `/api` ونسخة `v1`.
> قواعد عامة: استجابة موحدة `{success, message, data, statusCode, timestamp}` · أخطاء مسماة بـ `errorCode` · ترجمة تلقائية (x-lang) · كل مسار محمي بـ JWT + حالة الحساب (AFTIVE افتراضياً).

---

## أ. المواطن / المؤسسة (منتِجو النفايات)

### 1. إنشاء طلب جمع — `POST /v1/collection-requests`
**الدور**: CITIZEN / INSTITUTIONS (ACTIVE)
**الجسم**: `{ request_type: IMMEDIATE|SCHEDULED, lines: [{product_id, quantity_kg}], province_id, latitude, longitude, address, scheduled_at? (للمجدول), notes? }`
**كيف يعمل**:
1. يتحقق من الموقع والمواد (موجودة/نشطة) ويقرأ سعر الحصول الحالي للمادة (EffectivePriceService)
2. ينشئ الطلب **بلا سلة** وينسخ الخطوط snapshot (اسم/وحدة/سعر/كمية/مجموع) — الأسعار لا تتغير لاحقاً
3. فوري → الطلب CREATED ثم يدخل الفرز مباشرة (QUEUED) ويُستدعى محرك التوزيع
4. مجدول → CREATED ويبقى عند `scheduled_at` (يدخل الفرز قبل 60 دقيقة)
5. يرد بمجموع القيمة التقديرية (`goods_total`) + النقاط المتوقعة

### 2. قائمة طلباتي — `GET /v1/collection-requests`
**الدور**: المالك (CITIZEN/INSTITUTIONS)
**كيف يعمل**: طلبات الحساب فقط، مرتّبة الأحدث أولاً، فلترة اختيارية بالحالة/النوع، مع الحالة الحالية والسائق الفائز إن وُجد ورقم المسار.

### 3. تفاصيل طلب — `GET /v1/collection-requests/:id`
**الدور**: المالك / السائق المُسند / الأدمن
**كيف يعمل**: كامل الطلب + خطوطه + مسار السائق + توقيعات الوقت + (للمالك) موقع السائق الحالي إن كان EN_ROUTE/ARRIVED.

### 4. إلغاء طلب — `PATCH /v1/collection-requests/:id/cancel`
**الدور**: المالك (CITIZEN/INSTITUTIONS)
**الجسم**: `{ reason? }`
**كيف يعمل**: يُسمح قبل **بدء التنفيذ الفعلي** (PICKING) وحسب قواعد الحالة (CTM: لا إلغاء بعد جَمْع السائق). عند الإلغاء: يُسحب الإسناد النشط (WITHDRAWN)، وإذا كان الطلب ضمن مسار → يُزال من المسار وتُعاد الترقيم، والسائق الحر يُعاد تقييمه/توزيعه. يرد سبب الإلغاء.

### 5. إنشاء/استبدال الخطة — `POST /v1/collection-plans`
**الدور**: INSTITUTIONS (ACTIVE)
**الجسم**: `{ province_id, latitude, longitude, address, frequency: DAILY|WEEKLY|MONTHLY, weekdays?[], month_days?[], collection_time: "10:00", lines: [{product_id, quantity_kg}], notes? }`
**كيف يعمل**: خطة **واحدة لكل مؤسسة** — إن وُجدت تُستبدل بالجديدة (UQ account_id). تُخزَّن مواد الخطة ثابتة (snapshot الأسعار) ويُعيد المولّد توليد الطلبات القادمة منها. لا يُنشئ طلبات لحظياً.

### 6. عرض خطتي — `GET /v1/collection-plans`
**الدور**: INSTITUTIONS
**كيف يعمل**: الخطة الوحيدة للمؤسسة + خطوطها + المواعيد القادمة المولّدة (طلبات ORG_PLAN المستقبلية بمواعيدها).

### 7. تعديل/إيقاف الخطة — `PATCH /v1/collection-plans`
**الدور**: INSTITUTIONS
**الجسم**: أي حقول (منها `is_active: false` للإيقاف)
**كيف يعمل**: تعديل المواد/المواعيد/الإيقاف. الطلبات المولّدة **المعلّقة فقط** (لم تُسند) تُحدَّث بمحتوى الخطة الجديد؛ المسنَد ينفذ كما هو.

---

## ب. السائق

### 8. قبول طلب — `PATCH /v1/driver/collection-requests/:id/accept`
**الدور**: COLLECTOR
**كيف يعمل**: خلال مهلة القبول (5 دقائق). التحقق من الصلاحية (الطلب له في OFFERED). القبول → ACCEPTED → يُنشأ/يُمدَّد مساره (`collection_routes` + `route_sequence`) → يرد بتفاصيل التوقف والتالي المطلوب. إشعار للمالك (تم إسناد سائق).

### 9. رفض طلب — `PATCH /v1/driver/collection-requests/:id/reject`
**الدور**: COLLECTOR
**الجسم**: `{ reason? }`
**كيف يعمل**: يسجّل REJECTED في الـ ledger → **المرشح التالي** يُنسد فوراً من محرك التوزيع؛ نفاد المرشحين → الطلب NEEDS_ADMIN + إشعار الأدمن.

### 10. طلعتي — `GET /v1/driver/collection-requests`
**الدور**: COLLECTOR
**كيف يعمل**: توقفات مساره الحالي (PLANNED/IN_PROGRESS) مرتبة بـ `route_sequence` — **التوقف التالي فقط مفتوح** (لم يُبدأ بعد). كل توقف: الطلب + الموقع + المواد + الوزن التقديري + موعد المؤسسة إن كان. مع حالة تغطيته الحالية (نقطة) إن كان بلا مسار.

### 11. وصلت للموقع — `PATCH /v1/driver/collection-requests/:id/arrived`
**الدور**: COLLECTOR (توقف تالٍ مفتوح)
**كيف يعمل**: الوصول → الطلب ARRIVED + توقيع `arrived_at` + (إن كان أول توقف) المسار → IN_PROGRESS. بث `request:status` للمالك + إشعار فوري.

### 12. جمع المواد — `PATCH /v1/driver/collection-requests/:id/collected`
**الدور**: COLLECTOR
**الجسم**: `{ actual_weight_kg }` (وزن فعلي — أساس الدفع/النقاط)
**كيف يعمل**: التحقق (فقط ARRIVED أو PICKING). التعليق: يسمح بتحديث الوزن قبل DELIVERED ثم يُثبَّت. الطلب → PICKING ثم جاهز للتسليم. تحديث `total_weight_kg` للمسار.

### 13. تسليم المستودع — `PATCH /v1/driver/collection-requests/:id/delivered`
**الدور**: COLLECTOR
**كيف يعمل**: إعلان الوصول للمستودع: يحدد `destination_warehouse_id` (الأقرب النشط تلقائياً أو اختيار السائق) → الطلب DELIVERED + `delivered_at` → يُجدوَل Job `REGISTER_INTAKE` في طابور Odoo (المخزون يزيد بأوزان فعلية). إذا كان آخر توقف → المسار COMPLETED → السائق حر (يعود للتغطية أو يُعاد تقييمه لطلبات الانتظار).

---

## ج. الأدمن

### 14. قائمة الطلبات — `GET /v1/admin/collection-requests`
**الدور**: ADMIN (`admin.collection.view`)
**كيف يعمل**: كل الطلبات بفلاتر (حالة/نوع/دور/سائق/تاريخ) + ترقيم. كل صف: الطلب + المالك + السائق + المسار + المدة المستغرقة.

### 15. إسناد يدوي — `POST /v1/admin/collection-requests/:id/assign`
**الدور**: ADMIN (`admin.collection.manage`)
**الجسم**: `{ driver_id }`
**كيف يعمل**: احتياطي للطلبات NEEDS_ADMIN أو لإعادة الإسناد — ينشئ assertion بـ OFFERED→ACCEPTED مباشرة (بلا مهلة قبول) ويدخل للسائق مساره. يستثني السائقين المرفوضين سابقاً.

### 16. إلغاء إجباري — `PATCH /v1/admin/collection-requests/:id/cancel`
**الدور**: ADMIN (`admin.collection.manage`)
**الجسم**: `{ reason }` (إلزامي)
**كيف يعمل**: يلغي الطلب في أي حالة غير منتهية (COMPLETED)، يسحب الإسناد، يعالج المسار (إزالة + إعادة ترقيم + إكماله إن فرغ)، ويُشعر المالك والسائق.

### 17. نقاط التغطية — `GET/POST /v1/admin/coverage-points` · `PATCH/DELETE /v1/admin/coverage-points/:id`
**الدور**: ADMIN (`admin.catalog.*` أو صلاحية `admin.coverage.manage`)
**كيف يعمل**: إنشاء/تعديل/إيقاف/حذف النقاط (الاسم/المنطقة/الإحداثيات/الأولوية). الحذف مرفوض لنقاط عليها سائقون حالياً. التغييرات تنعكس على التوزيع في الدورة القادمة.

### 18. ضبط التوزيع — `GET /v1/admin/dispatch-config` · `PATCH /v1/admin/dispatch-config`
**الدور**: ADMIN (`admin.dispatch.manage`)
**الجسم**: الأوزان الستة + النوافذ (نافذة الجدولة/مهلة القبول/حدود الدمج/هامش المؤسسة/دورية التوازن)
**كيف يعمل**: يحدّث الصف النشط — منذ لحظة الحفظ كل انتخابات جديدة تستخدم القيم الجديدة (الطلبات الجارية لا تتأثر).

---

## د. WebSocket (namespace `/tracking` — الموجود)

### 19. اشتراك صاحب الطلب — حدث `request:subscribe {requestId}`
**كيف يعمل**: يتحقق السيرفر أن المالك هو صاحب الطلب → يدخل غرفة `request:{id}` → يبدأ استقبال أحداث الطلب وموقع سائقه.

### 20. أحداث تُبث للطرفين (سائق/مالك/لوحة)
| الحدث | المعنى |
|---|---|
| `request:assigned` | إسناد سائق (المالك يرى اسمه وموقعه، السائق يرى الطلب) — حدث واحد من المحرك |
| `request:status` | أي تحول (assigned/en_route/arrived/picking/delivered/completed/cancelled) |
| `request:tracking` | موقع السائق لحظياً لصاحب الطلب أثناء EN_ROUTE/ARRIVED (المصدر `truck:location` الموجود) |

---

## هـ. كرونات في الـ Worker

| الكرون | التوقيت | الوظيفة |
|---|---|---|
| `PlanRequestGenerator` | يومياً 03:00 | توليد طلبات ORG_PLAN من الخطط النشطة المطابقة لليوم + حارس التكرار |
| `OfferAcceptanceSweeper` | كل دقيقة | إنهاء مهلة القبول المنتهية → المرشح التالي |
| `ShiftHandoverReassign` | كل 15 دقيقة | إعادة إسناد المعلّق لسائقٍ تنتهي ورديته ≤ 30 دقيقة |
| `CoverageRebalancer` | كل `rebalance_min (30)` | توازن توزيع السائقين على النقاط (منع التكدس) |
| `RequestQueueOpener` | مستمر (BullMQ مؤجل) | فتح نافذة المجدول: `scheduled_at − 60د` → QUEUED → استدعاء المحرك |

---

## و. التكامل مع Odoo (داخلي)

| الوجهة | المورد |
|---|---|
| Job جديد `REGISTER_INTAKE` في طابور waste-odoo-sync | يزيد `recycle.stock` بمستودع التسليم بالمواد والأوزان الفعلية — يفشل نهائياً → إشعار أدمن + الطلب يبقى DELIVERED للمراجعة |
| Webhook (اختياري لاحقاً) | تأكيد وزن الفرز من Odoo يحدّث `actual_weight_kg` النهائي (أساس حساب النقاط) |