# COLLECTION_DESIGN — نظام طلبات الجمع ومحرك التوزيع (خطة التنفيذ)

> الأحدث من ORDERS_DESIGN — مصمم خصيصاً لسيناريو المستخدمين/المؤسسات (منتِجو النفايات) والسائقين (الجمع والتسليم للمستودع).
> المرافق: **COLLECTION_API.md** (شرح كل endpoint) · مدمج مع البنية الموجودة: التتبع Socket.IO + Redis، الورديات/الإسناد، warehouse مرآة Odoo، points-wallet، الإشعارات، الطوابير.

---

## 0. الفكرة في ثلاثة أسطر

1. **المستخدم/المؤسسة** (منتِجو النفايات): ينشئون طلب جمع **بنموذج مباشر بلا سلة** (مواد + كميات + موقع + موعد) — فوري أو مجدول، والمؤسسة لها **خطة واحدة** يولّد النظام طلباتها الدورية تلقائياً.
2. **محرك التوزيع (Dispatch Engine)** ينتخب السائق الأنسب لكل طلب جاهز (سكور 6 عوامل) — لا أول سائق ولا أقرب سائق.
3. السائق يأخذ الطلب **ضمن مسار** (collection_routes) → يجمع المادة (وزن فعلي) → **يوديها للمستودع** → إدخال Odoo → COMPLETED + نقاط. بلا طلبات → Coverage Mode (نقاط تغطية + إعادة توازن).

---

## 1. القرارات المعتمدة (لا تُعاد مناقشتها)

| القرار | القيمة |
|---|---|
| إنشاء الطلب | نموذج مباشر — **بلا سلة** (كل من المواطن والمؤسسة) |
| الخطط الدورية | **خطة واحدة لكل مؤسسة** (`UQ account_id`) بمواد **ثابتة** (snapshot تُنسخ كل يوم) |
| الإسناد | تلقائي + **قبول من السائق بمهلة 5 دقائق** (يحقق APPROVE_REQUEST) |
| الرفض/انتهاء المهلة | المرشح التالي من ledger (لا يُعاد من سأل مرة)؛ نفاد المرشحين → NEEDS_ADMIN |
| أساس الدفع/النقاط | الوزن الفعلي الذي أدخله السائق (وزن Odoo يعدّله لاحقاً عند الفرز) |
| النقاط | تُمنح عند COMPLETED (تعميم points-wallet) |
| المسافة في Proximity | دقائق سفر (مخبأة) — آخر موقع لحظي من Redis عند غياب القياس |
| المسار | جدول `collection_routes` مملوك للسائق؛ الطلبات أعضاؤه عبر `route_id` + `route_sequence` |
| دمج الطلبات | ≤15 دقيقة / ≤2 كم في مسار نشط؛ واحترام موعد المؤسسة بالهامش ±20 دقيقة |
| الجدولة | المجدول/الدوري يدخل الفرز قبل موعده بـ 60 دقيقة (قابل للضبط) |
| الحالات التاريخية | `audit_logs` الموجود (لا جدول جديد) |
| Migration واحدة | `1789600000000-collectionRequestMigration.ts` (9 جداول) |

---

## 2. الجداول الجديدة (9 — في Migration واحدة)

### 2.1 `collection_requests` — الطلب
| الحقل | النوع | ملاحظات |
|---|---|---|
| id | uuid PK | |
| request_number | varchar(32) UQ | `CR-YYYYMM-#####` |
| account_id | uuid FK→accounts (CASCADE) | صاحب الطلب (مواطن/مؤسسة) |
| role | enum | CITIZEN / INSTITUTIONS (لقطة) |
| request_type | enum | IMMEDIATE / SCHEDULED / ORG_PLAN |
| status | enum | انظر §3 |
| province_id | uuid FK→provinces (SET NULL) | |
| latitude / longitude | decimal(10,7) | لقطة موقع الاستلام |
| address | varchar | لقطة |
| estimated_weight_kg | decimal(14,3) | مجموع الخطوط التقديرية |
| actual_weight_kg | decimal(14,3) NULL | يملؤه السائق عند الجمع |
| goods_total / currency | decimal(14,3) / varchar | مجموع أسعار الخطوط (ما يكسبه المزوّد) |
| points_awarded | int NULL | عند الإتمام |
| scheduled_at | timestamptz NULL | المجدول/الدوري |
| source_plan_id | uuid FK→collection_plans NULL | للطلبات المولّدة من خطة (حارس التكرار) |
| source_plan_date | date NULL | تاريخ يوم الطلب المولّد + UQ(source_plan_id, source_plan_date) |
| route_id | uuid FK→collection_routes NULL | مسار الطلب الحالي |
| route_sequence | int NULL | ترتيب الزيارة داخل المسار (1..N) |
| assigned_driver_id / assigned_truck_id | uuid NULL | الفائز الحالي |
| assigned_at / en_route_at / arrived_at / picked_at / delivered_at / completed_at | timestamptz NULL | توقيعات الخطوات |
| cancel_reason | varchar(400) NULL | |
| admin_note | text NULL | |
| notes | varchar(500) NULL | من المستخدم |
| created_at / updated_at | | |

### 2.2 `collection_request_lines` — المواد (snapshot كامل لحظة الإنشاء)
| الحقل | النوع |
|---|---|
| id | uuid PK |
| request_id | uuid FK (CASCADE) |
| product_id | uuid FK→products (RESTRICT) |
| product_name | varchar (لقطة) |
| condition_code | varchar NULL (لقطة الدرجة) |
| unit_code | varchar (لقطة) |
| quantity_kg | decimal(14,3) — تقديرية |
| unit_price | decimal(12,3) — snapshot سعر الحصول |
| subtotal | decimal(14,3) |

### 2.3 `collection_request_assignments` — سجل الإسنادات (ledger لا يُحذف — نمط order_part_offers)
| الحقل | النوع | ملاحظات |
|---|---|---|
| id | uuid PK | |
| request_id | uuid FK | |
| driver_id | uuid FK→accounts | |
| truck_id | uuid FK→trucks | |
| shift_id | uuid FK→shifts | |
| status | enum | OFFERED / ACCEPTED / REJECTED / EXPIRED / WITHDRAWN |
| reason | varchar(400) NULL | سبب رفض السائق |
| offered_at / responded_at | timestamptz | مهلة القبول تُقرأ من هنا |
| UQ(request_id, driver_id) | | سائق واحد مرة واحدة — ضمان إنهاء إعادة الإسناد |

### 2.4 `collection_routes` — المسار (يملكه السائق، الطلبات أعضاؤه)
| الحقل | النوع |
|---|---|
| id | uuid PK |
| route_number | varchar(32) UQ `RTE-YYYYMMDD-###` |
| driver_id / truck_id / shift_id | uuid FKs |
| origin_warehouse_id | uuid FK→warehouses NULL (انطلاقة السائق) |
| destination_warehouse_id | uuid FK→warehouses NULL (تسليم المواد — الأقرب النشط) |
| status | enum PLANNED / IN_PROGRESS / COMPLETED / CANCELLED |
| total_weight_kg | decimal(14,3) (يُحدَّث عند إضافة طلب) |
| route_distance_km | decimal(10,3) NULL (يُحسب عند الإتمام) |
| started_at / completed_at | timestamptz NULL |
| completed_reason | varchar(400) NULL |
| created_at / updated_at | |

### 2.5 `collection_plans` — خطة المؤسسة (واحدة لكل مؤسسة)
| الحقل | النوع | ملاحظات |
|---|---|---|
| id | uuid PK | |
| account_id | uuid FK→accounts **UQ** | خطة واحدة لكل مؤسسة |
| province_id | uuid FK | موقع الاستلام الثابت |
| latitude / longitude / address | | snapshot |
| frequency | enum | DAILY / WEEKLY / MONTHLY |
| weekdays | int[] NULL | WEEKLY: [1..7] (SUNDAY=1) |
| month_days | int[] NULL | MONTHLY: [1..31] |
| collection_time | time | موعد الطلب اليومي (مثال 10:00) |
| estimated_weight_kg | decimal(14,3) | |
| is_active | boolean | إيقاف/تشغيل |
| notes | varchar(500) NULL | |
| created_at / updated_at | | |

### 2.6 `collection_plan_lines` — مواد الخطة الثابتة
| الحقل | النوع |
|---|---|
| id | uuid PK |
| plan_id | uuid FK (CASCADE) |
| product_id | uuid FK (RESTRICT) |
| product_name | varchar (لقطة) |
| unit_code | varchar |
| quantity_kg | decimal(14,3) |
| unit_price | decimal(12,3) snapshot |
| subtotal | decimal(14,3) |

### 2.7 `coverage_points` — نقاط التغطية
| الحقل | النوع |
|---|---|
| id | uuid PK |
| name | varchar (مدرسة/سوق مزدحم/مشفى) |
| zone | varchar NULL |
| latitude / longitude | decimal(10,7) |
| is_active | boolean default true |
| priority | int (أولوية التوزيع) |
| created_at / updated_at | |

### 2.8 `driver_coverage_assignments` — سائق ↔ نقطة حالياً
| الحقل | النوع |
|---|---|
| id | uuid PK |
| driver_id | uuid FK **UQ** |
| coverage_point_id | uuid FK |
| assigned_at | timestamptz |

### 2.9 `dispatch_config` — صف واحد نشط (الأوزان والثوابت — نمط delivery_rates)
| الحقل | الافتراضي |
|---|---|
| id | uuid PK |
| weights | jsonb `{proximity:30, direction:25, load:20, vehicle:15, deadline:7, fairness:3}` |
| schedule_window_min | 60 |
| accept_window_sec | 300 |
| merge_max_min | 15 |
| merge_max_km | 2 |
| org_tolerance_min | 20 |
| rebalance_min | 30 |
| is_active | true |
| updated_by / updated_at | |

---

## 3. آلة الحالات

### الطلب
```
CREATED → QUEUED → ASSIGNED → EN_ROUTE → ARRIVED → PICKING → DELIVERED → COMPLETED
                          ↘ NEEDS_ADMIN (نفاد المرشحين)
أي حالة قبل ASSIGNED/بعدها وفق القواعد → CANCELLED (من المالك/النظام/الأدمن مع سبب)
```
- `QUEUED`: جاهز للانتخاب (فوري لحظياً، مجدول عند فتح النافذة قبل 60د)
- `DELIVERED`: المواد في المستودع (انتهاء المسار)
- `COMPLETED`: بعد تأكيد intake في Odoo + منح النقاط
- ممنوع أي تحول غير مسموح → `CollectionStateException` (نمط OrderStateService؛ التفاصيل: DERIVED من توقيعات الوقت)

### المسار
```
PLANNED → IN_PROGRESS → COMPLETED / CANCELLED
```
- IN_PROGRESS عند أول وصول للتوقف الأول · COMPLETED عند آخر توقف → السائق حر → مشغل الفرز

### الإسناد (ledger)
```
OFFERED → ACCEPTED (نهاية البحث) / REJECTED / EXPIRED / WITHDRAWN (إلغاء الطلب)
```

---

## 4. خوارزمية الفرز — Election Score

**الترشيح (Hard filters — الكل إلزامي):**
1. سائق ACTIVE + شاحنة غير DISABLED (من `trucks`)
2. إسناد شاحنة + وردية (من `truck_assignments`)، ووقت الطلب داخل `shift.startTime–endTime`
3. `maxPayloadKg − وزن مهامه الحالية ≥ وزن الطلب التقديري`
4. غير مشغول بطلب EN_ROUTE/ARRIVED/PICKING (مسار نشط غير مكتمل)
5. داخل نفس منطقة الطلب (منطق zone من إحداثيات السائق — `truck:location`)

**الترتيب (كل عامل 0–100 × وزنه):**
```
Score(d) = 30·Proximity + 25·Direction + 20·Load + 15·Vehicle + 7·Deadline + 3·Fairness  (÷100)
```
| العامل | الصيغة | المصدر |
|---|---|---|
| Proximity | هبوط خطي بالدقائق/الكم من آخر موقع (غياب موقع → 50) | Redis `truck:location:{id}` |
| Direction | تطابق اتجاه حركة السائق (heading) مع سمت الطلب | موقعان متتاليان / heading المخزّن |
| Load | `100 − مهامه النشطة × 22` | عدّ active assignments |
| Vehicle | السعة المتبقية % | maxPayloadKg − أوزان المهام |
| Deadline | فوري=100 · مجدول=`min(100, هامش الدقائق×2.5)` | scheduled_at |
| Fairness | `100 − (مهامه اليوم − 1) × 12` | عدّ completed اليوم |

**القرار**: أعلى سكور يفوز → ledger OFFERED → حفظ القرار في DB → **حدث واحد** `request:assigned`.

**المهلة**: قبول/رفض خلال `accept_window_sec` (Redis TTL) — رفض/انتهاء → المرشح التالي (ledger يستثني REJECTED/EXPIRED) حتى النفاد → NEEDS_ADMIN + إشعار الأدمن (إسناد يدوي).

**تبديل الوردية** (كرون 15 دقيقة — نمط handover-cron): الطلبات المعلّقة (OFFERED/ACCEPTED غير منفّذة) لسائق تنتهي ورديته ≤ 30 دقيقة → تعاد للإسناد لسائق الوردية التالية على نفس الشاحنة (من truck_assignments).

---

## 5. المسار والدمج (Collection Mode)

1. فوز سائق بلا مسار نشط → إنشاء `collection_routes` (PLANNED، origin = مستودعه)
2. الطلب يُضاف للتوقف التالي بـ `route_sequence` — الترتيب يُعاد حسابه بالأمثلية (أقصر مسار يحترم المواعيد)
3. طلب جديد قريب (≤ merge_max_min دقيقة / ≤ merge_max_km كم) أثناء تحركه → **يُدمج في نفس المسار** إذا لم يؤخر موعد مؤسسة في المسار أكثر من `org_tolerance_min` — وإلا يُسند لسائق آخر
4. طلعة السائق = `route_id = مساره النشط ORDER BY route_sequence` — التوقف التالي فقط مفتوح
5. اكتمال كل التوقفات → المسار COMPLETED → السائق حر → `CoverageService` يعيد توزيعه (أو مشغل فرز إن وُجد طلب)

---

## 6. وضع التغطية (Coverage Mode)

- **بداية الدوام**: كل سائق حر يُوزَّع على أفضل `coverage_points` في منطقته (تجاوب مع الكثافة)
- **بلا طلبات**: يتحرك بين النقاط ديناميكياً (لا مسار ثابت) — موقع لحظي يُبث كل 5–10 ث
- **إعادة توازن** كل `rebalance_min` دقيقة: منع التكدس (سائقان في نقطة واحدة أمام نقطة فارغة)
- **عند طلب**: السائق الفائز يخرج من التغطية مؤقتاً (حذف driver_coverage_assignments) → ينفذ → يعود لأفضل نقطة
- قراءات مستقبلية من جدول `driver_coverage_assignments` (تقارير الانتشار)

---

## 7. التقنية — REST vs WebSocket

| | القناة |
|---|---|
| تسجيل/دخول/إنشاء طلب/خطة/تعديلات | REST API |
| موقع السائق (كل 5–10 ث أو تغيّر مسافة) | `truck:location` (موجود) → يحوّل السيرفر الموقع للمستخدم مباشرة |
| أحداث الطلب (assigned/status/arrival) | WebSocket: غرفة `request:{id}` (الزمن الحقيقي) |
| التتبع | المستخدم يرى حركة السائق + ETA متجدد (من موقع Redis) |
| الإشعارات (خروج التطبيق) | FCM عبر notification queue |

**مشغلات Dispatch Engine (4):**
1. طلب دخل الـ queue (فوري/فتحت نافذة المجدول)
2. سائق تحرر (أتم طلباً/أُلغي مساره)
3. اقتراب موعد مجدول (job مؤجل BullMQ عند `scheduled_at − 60د`)
4. تحديث موقع السائق (مخفف — تقييم الطلبات المعلّقة الخاملة)

**أحداث Socket البثثة:** `request:assigned` (سائق+مالك+لوحة) · `request:status` · `request:tracking` (موقع السائق لصاحب الطلب)

---

## 8. التاسكات (Tasks) — 4 Sprints

### Sprint 1 — أساس الطلب والخطط
- [ ] T1.1 Migration `1789600000000-collectionRequestMigration.ts` (9 جداول)
- [ ] T1.2 Enums: request-type · request-status · assignment-status · route-status · plan-frequency
- [ ] T1.3 آلة الحالات: `CollectionStateService` + جداول التحولات + `CollectionStateException`
- [ ] T1.4 الاستثناءات المسماة + مفاتيح i18n (ar/en)
- [ ] T1.5 `POST /v1/collection-requests` — نموذج مباشر (مواد+كميات+موقع+موعد) + snapshot الأسطر والأسعار (بلا سلة)
- [ ] T1.6 `GET` قائمة/تفاصيل للمالك + `PATCH :id/cancel` بقواعد الحالة
- [ ] T1.7 خطط المؤسسات: `POST/GET/PATCH /v1/collection-plans` (خطة واحدة UQ)
- [ ] T1.8 المولّد `PlanRequestGenerator` (كرون يومي 03:00): إنشاء طلبات ORG_PLAN من الخطط النشطة + حارس التكرار UQ(source_plan_id, source_plan_date)
- [ ] T1.9 صلاحيات (كتالوج + خريطة seeder) + اختبارات آلة الحالات (jest)

### Sprint 2 — محرك التوزيع
- [ ] T2.1 طابور `collection-dispatch` (BullMQ)
- [ ] T2.2 المشغلات الأربعة (حدث/مؤجل/تحرر/موقع)
- [ ] T2.3 `DispatchEngineService`: الترشيح + السكور من `dispatch_config` + الانتخاب
- [ ] T2.4 ledger OFFERED + مفتاح مهلة القبول (Redis TTL 300s)
- [ ] T2.5 `PATCH /v1/driver/collection-requests/:id/accept|reject` (المرشح التالي عند الرفض/الانتهاء → NEEDS_ADMIN)
- [ ] T2.6 حدث `request:assigned` (Socket) + FCM للسائق
- [ ] T2.7 غرف Socket `request:{id}` + أحداث `request:status`
- [ ] T2.8 `CoverageService` v1: توزيع صباحي + خروج عند التنفيذ + عودة عند الفراغ
- [ ] T2.9 اختبارات: filters + score + election + reassignment

### Sprint 3 — المسار والتنفيذ والتسليم للمستودع
- [x] T3.1 `RoutePlanner` (دالة نقية بنمط allocation-planner): إنشاء المسار + الترتيب الأمثل
- [x] T3.2 دمج الطلبات (≤15د/≤2كم) + احترام موعد المؤسسة (±20د)
- [x] T3.3 Endpoints السائق: `GET /driver/collection-requests` (طلعتي مرتبة) · `PATCH arrived` · `PATCH collected` (وزن فعلي) · `PATCH delivered` (مستودع التسليم)
- [x] T3.4 دورة المسار (IN_PROGRESS→COMPLETED) + تحرر السائق → مشغل الفرز
- [x] T3.5 Job `REGISTER_INTAKE` في طابور waste-odoo-sync (المخزون يزيد بأوزان فعلية)
- [x] T3.6 `awardForCollection` (تعميم points-wallet) عند COMPLETED + إشعار النقاط
- [x] T3.7 كرون تبديل الوردية (15 دقيقة)
- [x] T3.8 اختبارات: route planner + دورة التنفيذ

### Sprint 4 — تغطية كاملة + لوحة الأدمن + الوثائق
- [x] T4.1 كرون إعادة التوازن (كل rebalance_min)
- [x] T4.2 CRUD نقاط التغطية `/v1/admin/coverage-points`
- [x] T4.3 `GET/PATCH /v1/admin/dispatch-config` (الأوزان والثوابت)
- [x] T4.4 لوحة الأدمن: قائمة/فلاتر + إسناد يدوي + إلغاء إجباري
- [x] T4.5 تقارير: طلبات اليوم · متوسط زمن التنفيذ · المسارات لكل سائق
- [x] T4.6 تحديث API_REFERENCE + FIXES + PROJECT_CONTEXT + `tsc --noEmit` + jest كامل

---

## 9. التكامل مع الموجود (إعادة استخدام — لا إعادة بناء)

| المكوّن الجديد | يعتمد على |
|---|---|
| التتبع اللحظي | gateway `/tracking` + Redis `truck:location` — بلا تغيير |
| الورديات/الإسناد | `shifts` + `truck_assignments` — قراءة فقط |
| سعة الشاحنة | `trucks.maxPayloadKg` |
| الوزن/السعر | snapshot في الخطوط + أسعار المنتجات (EffectivePriceService عند الإنشاء) |
| الإشعارات | NotificationService + FCM (نوع RECYCLING_REQUEST جاهز) |
| النقاط | points-wallet (تعميم award) |
| الكتابة لأودو | طابور waste-odoo-sync (job جديد REGISTER_INTAKE) |
| كرونات الصيانة | نمط main.worker + MAINTENANCE_WORKER |
| الصلاحيات | كتالوج + seeder (سطر لكل) |