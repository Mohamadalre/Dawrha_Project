# ORDERS_DESIGN — سيناريو منظومة الطلبيات (وثيقة تحليل وتصميم)

> المرحلة القادمة من مشروع Dawrha. مبنية بالكامل على البنية الموجودة: السلة والتسعير بالشرائح، إسناد السائقين والورديات، تتبّع الشاحنات (Socket.IO + Redis)، مرآة المستودعات، وقناة Odoo (BullMQ + Webhooks).
> آخر تحديث: 2026-07-11 · الحالة: **تصميم معتمد للتنفيذ — لم يُنفَّذ بعد**

---

## 0. الفكرة في سطرين

نوعان من الطلبيات باتجاهين معاكسين:
- **طلب جمع (Pickup)**: مواطن/مؤسسة لديهم مواد قابلة للتدوير → سائق يجمعها → **إلى** المستودع → كميات المستودع تزيد (تُسجَّل في Odoo).
- **طلب شراء (Purchase)**: معمل/جهة حرة يشترون مواد مفروزة → تُحجَز من مخزون المستودع → تُسلَّم **من** المستودع → الكميات تنقص.

السلة الحالية هي مدخل النوعين: نفس `cart_items` تتحول إلى `order_items` عند التأكيد.

## 1. الكيانات الجديدة (4 جداول)

| الجدول | الحقول الأساسية | ملاحظات |
|---|---|---|
| `orders` | id, orderNumber (تسلسلي مقروء), accountId, role, type (PICKUP/PURCHASE), status, locationId/إحداثيات (geography Point — موجود نمطها في locations), warehouseId?, totalAmount, currency, scheduledAt?, notes | الحالة enum أدناه |
| `order_items` | orderId, productId, quantity, unitType (snapshot), unitPrice (snapshot من tier السلة), subtotal, **sortedQuantity?** (يملؤها الفرز من Odoo) | snapshot كامل — تعديل التسعير لاحقاً لا يغيّر طلباً مؤكداً (نفس فلسفة `product_pricing_history`) |
| `order_assignments` | orderId, driverId, truckId, shiftId, assignedAt, status (ASSIGNED/ACCEPTED/REJECTED/COMPLETED), rejectionReason? | نفس نمط `truck_assignments`؛ يسمح بإعادة الإسناد عند الرفض |
| `order_status_history` | orderId, fromStatus, toStatus, changedBy, changedAt, metadata | نفس فلسفة أرشيف التسعير: كل تحول محفوظ للمراجعة |

**حالات الطلب (State Machine صارمة — نفس نمط shift-change):**
```
PICKUP:   PENDING → CONFIRMED → ASSIGNED → EN_ROUTE → COLLECTED → DELIVERED_TO_WAREHOUSE → SORTED → COMPLETED
PURCHASE: PENDING → CONFIRMED (حجز مخزون) → PREPARING (فرز/تجهيز في Odoo) → ASSIGNED → EN_ROUTE → DELIVERED → COMPLETED
أي حالة قبل ASSIGNED → CANCELLED (من صاحب الطلب) / REJECTED (من الأدمن مع سبب)
```
التحولات غير المسموحة تُرفض بـ `OrderStateException` (نفس عرف `ShiftChangeStateException`).

## 2. سيناريو الطلب خطوة بخطوة

### أ) طلب شراء — معمل / جهة حرة (PURCHASE)
1. المعمل يتصفح `my-materials` أو الكتالوج ويضيف للسلة (تسعيرة FACTORY/FREE_FACILITY تُثبَّت لحظة الإضافة — موجود).
2. `POST /api/v1/orders/checkout` — يتحقق: `can_proceed_to_checkout` من ملخص السلة (حد أدنى 50 موجود في `cart.config`)، ثم **التوافر**: لكل عنصر، `available = quantity - reserved` من مرآة `warehouse_inventory` (endpoint التوافر موجود). نقص التوافر → 409 `INSUFFICIENT_STOCK` مع تفاصيل العنصر.
3. إنشاء `order` (PENDING) + نسخ عناصر السلة → `order_items` + تفريغ السلة — **داخل transaction واحدة** (نمط media.service).
4. **حجز المخزون**: job جديد `RESERVE_STOCK` في طابور `waste-odoo-sync` يرفع `reserved_quantity` في Odoo (`recycle.stock`) — فشل نهائي → تعويض: إلغاء الطلب + إشعار (نفس نمط تعويض التصنيفات). نجاح → CONFIRMED + إشعار.
5. Odoo يجهّز الشحنة (الفرز يحترم `allows_tolerance` لكل وحدة — منفّذ). عند الجاهزية: Automated Action → webhook جديد `POST /odoo/webhooks/order-ready` → PREPARING→ASSIGNED (يدخل طابور الإسناد §3).
6. السائق يسلّم للمعمل → `DELIVERED` → webhook خصم فعلي للكميات في Odoo → مرآة المستودع تتحدث (القناة موجودة) → COMPLETED.

### ب) طلب جمع — مواطن / مؤسسة (PICKUP)
1. المواطن يحدد المواد والكميات التقديرية + موقع الاستلام (من `locations` المتعددة الموجودة) + وقت مفضل.
2. `POST /api/v1/orders/pickup` → PENDING → CONFIRMED (تلقائي أو مراجعة أدمن حسب حجم الكمية — قيمة قابلة للضبط).
3. يدخل طابور الإسناد (§3) → سائق يقبل → EN_ROUTE (يبث موقعه عبر `/tracking` الموجود).
4. عند الجمع: السائق يُدخل الكميات **الفعلية** الموزونة → COLLECTED (الفرق عن التقديرية طبيعي هنا).
5. تسليم المستودع → DELIVERED_TO_WAREHOUSE → إدخال في Odoo (`recycle.stock` يزيد) → موظف الفرز يعالج: الوحدات `allows_tolerance=false` يجب أن تطابق كمية السائق بالضبط، الوزنيات يُدخل الوزن بعد الفرز → webhook قائم يعكس الكميات → SORTED → COMPLETED (+ نقاط/محفظة للمواطن — مرحلة لاحقة).

## 3. خوارزمية توزيع الطلبات على السائقين

**المبدأ: ترشيح ثم ترتيب (Filter → Score)، والبيانات كلها موجودة فعلاً:**

**الترشيح (Hard filters):**
1. السائق `ACTIVE` وله `truck_assignment` (موجود في `assignment.service`).
2. **الوردية**: وقت التنفيذ داخل `shift.startTime–endTime` لوردية السائق (جدول `shifts` موجود).
3. الشاحنة ليست `DISABLED` و`maxPayloadKg` ≥ وزن الطلب التقديري (الحقل موجود على `trucks`).
4. السائق غير مشغول بطلب EN_ROUTE حالياً (من `order_assignments`).

**الترتيب (Score لكل مرشح):**
```
score = w1 · قرب_المسافة + w2 · قلة_الحمولة_الحالية + w3 · أقدمية_آخر_طلب
```
- **القرب**: آخر موقع معروف للشاحنة من Redis (تتبّع `/tracking` يخزنه أصلاً — `getLocation`). المسافة بـ Haversine أو `ST_Distance` على PostGIS (مفعّل — أعمدة geography موجودة).
- **العدالة**: `w3` يمنع تركّز الطلبات على أقرب سائق دائماً.

**التدفق:**
1. عند CONFIRMED → job `ASSIGN_ORDER` في طابور BullMQ جديد `orders` (retry/backoff بنفس عرف `odoo-sync.constants`).
2. المعالج يحسب أفضل مرشح → ينشئ `order_assignment` (ASSIGNED) → إشعار FCM للسائق (قناة الإشعارات موجودة) + حدث socket `order:assigned`.
3. السائق **يقبل خلال مهلة** (5 دقائق، مفتاح Redis بـ TTL): قبول → ACCEPTED؛ رفض/انتهاء المهلة → المرشح التالي (استثناء المرفوضين)؛ نفاد المرشحين → إشعار الأدمن لإسناد يدوي (endpoint أدمن احتياطي).
4. **نهاية الوردية أثناء طلب معلّق** (سؤالك عن تبديل السائقين): كرون كل 15 دقيقة (نمط maintenance الموجود — في الـ worker) يفحص الطلبات ASSIGNED/ACCEPTED التي لم تبدأ ووردية سائقها تنتهي خلال ≤ 30 دقيقة → **يعيد إسنادها تلقائياً** لسائق الوردية التالية على نفس الشاحنة (من `truck_assignments`: الشاحنة الواحدة لها سائق لكل وردية — البنية جاهزة لهذا بالضبط). طلب EN_ROUTE لا يُبدَّل — السائق يكمله ثم تنتهي ورديته. تبديل الوردية الدائم نفسه موجود (`shift-change-request`).

## 4. التتبع أثناء التنفيذ (مبني على الموجود حرفياً)

- gateway `/tracking` موجود: السائق يبث `truck:location`، الأدمن يشترك.
- **الإضافة**: غرفة `order:<orderId>` — صاحب الطلب يشترك بحدث جديد `order:subscribe` (تفويض: مالك الطلب فقط) فيرى شاحنته لحظياً كأوبر، + أحداث حالة `order:status` تُبث عند كل تحول.
- الانقطاع/التوقف مُعالَج أصلاً (`finalizeStop` + `truck:stopped`).

## 5. نقل الشحنة إلى المستودع (التكامل)

- **اختيار المستودع**: الأقرب النشط (إحداثيات `warehouses` موجودة) مع سعة متاحة (`capacity`/`currentLoad`).
- **الكتابة إلى Odoo حصراً عبر الطابور** (القرار المعماري الثابت): jobs جديدة `RESERVE_STOCK`, `RELEASE_STOCK`, `COMMIT_DELIVERY`, `REGISTER_INTAKE` في نفس `waste-odoo-sync` بنفس نمط retry/تعويض.
- **القراءة معاكسة عبر Webhooks** (قائمة): أي تغيير كميات من الفرز ينعكس على المرآة خلال ثوانٍ، و`sortedQuantity` في `order_items` تُملأ من webhook `order-sorted`.

## 6. الـ Endpoints المقترحة (موجز)

| Method · Path | مَن | الوظيفة |
|---|---|---|
| POST `/orders/checkout` | مشترو السلة | سلة → طلب PURCHASE |
| POST `/orders/pickup` | مواطن/مؤسسة | إنشاء طلب جمع |
| GET `/orders` + `/orders/:id` | صاحب الطلب | قائمة/تفاصيل مع الحالة والتاريخ |
| PATCH `/orders/:id/cancel` | صاحب الطلب | قبل ASSIGNED فقط |
| GET `/driver/orders` · PATCH `/driver/orders/:id/accept|reject|collected|delivered` | سائق | دورة حياة التنفيذ (كميات فعلية عند collected) |
| GET `/admin/orders` · PATCH `/admin/orders/:id/assign|reject` | أدمن | مراقبة + إسناد يدوي احتياطي |
| POST `/odoo/webhooks/order-ready|order-sorted` | Odoo | جاهزية التجهيز / نتائج الفرز |

صلاحيات جديدة تُزرع بالـ seeder الموجود: `orders.create`, `orders.view`, `driver.orders.manage`, `admin.orders.manage`.

## 7. خطة التنفيذ (Sprints)

1. **Sprint 1**: الكيانات + migrations + آلة الحالات + checkout/pickup + التاريخ — بلا إسناد (أدمن يدوي).
2. **Sprint 2**: طابور `ASSIGN_ORDER` + الخوارزمية + endpoints السائق + مهلة القبول + كرون تبديل الوردية.
3. **Sprint 3**: jobs مخزون Odoo الأربعة + الـ webhooks الجديدان + `sortedQuantity`.
4. **Sprint 4**: غرف socket للطلبات + إشعارات كل التحولات + تقارير الأدمن.
كل sprint: اختبارات وحدة للآلة والخوارزمية + تحديث API_REFERENCE/FIXES.
