# SESSIONS_GUIDE — شرح كامل للجلسات (`SESSIONS_GUIDE.md`)

> كل «جلسة» في النظام: ما هي، متى تولد، كيف تموت، أين في الكود، وكيف تُتابع لكل مستخدم.
> التجميع العملي: `ROOMS_SESSIONS.md` · عقود الـ API: `API_USER_APP.md` / `API_DRIVER_APP.md` / `API_ADMIN_APP.md`.

## 1. جلسة المصادقة (Auth session)

**المكوّنات**: Access JWT (15د) · Refresh JWT (hash في `user_devices`) · توكن مؤقت (تسجيل/OTP) · blacklist.

| المكوّن | متى يُصدر | أين يُخزَّن | الانتهاء/الإبطال |
|---|---|---|---|
| Access token | كل تسجيل دخول / refresh | عميل التطبيق (لا سيرفر) | من env: `JWT_ACCESS_EXPIRATION`؛ يُبطل عند logout بـ `blackListToken:{userId}` (TTL 600s) — guards تفحصه |
| Refresh token | نفس اللحظة | hash في `user_devices` (صف لكل device) | من env: `JWT_REFRESH_DEFAULT_EXPIRATION` / `JWT_REFRESH_REMEMBER_ME_EXPIRATION` (rememberMy)؛ يُستبدل عند كل refresh؛ يُمسح عند logout |
| Temporary token | تسجيل / forgot-otp | عميل | يُستهلك عند OTP/verify |
| resetTicket | `password/verify` | Redis/سيرفر | 600s + استهلاك أحادي |

**الملفات**: `auth/*` (guards, strategy، handlers بحالة الحساب ACTIVE/PENDING/…) · `auth/decorators/current-user.decorator.ts`.
**لكل مستخدم**: صف device واحد لكل جهاز → خروج من جهاز لا يمسّ الآخر.

## 2. جلسة Socket.IO (غرف الـ namespaces)

### 2.1 المصافحة (الاثنان متطابقان)
JWT في `auth.token` أو `?token=` أو Authorization header؛ فحص blacklist؛ رفض → `error: Unauthorized` + `disconnect(true)`.
**الملفات**: `truck/tracking/truck-tracking.gateway.ts:76` · `collection-request/gateways/dispatch.gateway.ts:124`.

### 2.2 namespace `/tracking` (تتبّع الشاحنات)
- الغرف: `truck:{truckId}` (أدمن يدوياً) · `admins` (أدمن عبر `admin:subscribeAll`).
- الأحداث: سائق → `truck:location` (مشروط **بوجود handover مفتوح**) · `truck:stop`؛ أدمن → اشتراكات.
- انقطاع السائق → `handleDisconnect` يثبّت آخر موقع (DRIVER_DISCONNECT) و`truck:stopped`.
- **الملف**: `truck-tracking.gateway.ts` · الخدمة `truck-tracking.service.ts` (Redis: `truck:location:{id}` TTL، `truck:history:{id}` capped، `truck:active` ZSET).

### 2.3 namespace `/collection` (الجمع)
- الغرف: `driver:{accountId}` (**تلقائي** لكل COLLECTOR عند الاتصال) · `request:{requestId}` (اشتراك يدوي للمنتج) · `admins` (أدمن).
- البث: المحرك → `request:assigned` (سائق) · `request:status` (منتج) · `request:needs_admin` (أدمن).
- انقطاع المنتج/الأدمن: لا أثر (يُعاد الاشتراك).
- **الملف**: `dispatch.gateway.ts` — «باص أخرس»: البثّ حصراً من محرّك التوزيع عبر `announceToDriver/Request/Admins`.

## 3. جلسة التتبّع الحيّة (Live truck session)

محرّكها **تسليم/استلام الشاحنة** (`truck_handovers`) لا الاتصال نفسه:
1. `POST /driver/pickup` → صف handover OPEN → أدمن يُبثّ له `truck:session {status:'started'}` فوراً (يظهر على الخريطة قبل أول GPS).
2. السائق يبثّ `truck:location` (مرفوض ما لم يكن handover مفتوحاً — «استلم الشاحنة قبل بدء التتبع»).
3. `POST /driver/dropoff` (سبب إلزامي) أو انقطاع → `finalizeStop` (يُثبّت آخر موقع + `truck:stopped`) + `truck:session` ينتهي.
- **الملف**: `truck-tracking.gateway.ts` (announceSessionStarted/endSession) · `truck-tracking.service.ts` (hasActiveHandover/finalizeStop).

## 4. جلسة العرض في محرك التوزيع (Dispatch offer session)

- عند انتخاب مرشّح: إنشاء `collection_request_assignments` OFFERED + مفتاحا Redis بمدّة `accept_window_sec` (افتراضي 300s):
  - `dispatch:offer:{assignmentId}` — صلاحية العرض نفسها (سائق يقبل عبره: `offerKey`).
  - `dispatch:offer:driver:{driverId}` — المسار السريع «هل لي عرض معلّق؟».
- قبول → ACCEPTED + bindToRoute (request يصبح ASSIGNED على route)؛ رفض/انتهاء → REJECTED/EXPIRED + إعادة elect (يُنظّف كرون `offer-acceptance-sweeper` المنتهية)؛ إلغاء المنتج → تنظيف فوري للمفتاحين.
- **الملف**: `dispatch-engine.service.ts` (offer/clearOfferKeys/settleOffer) · `dispatch.constants.ts` · `offer-acceptance-sweeper.cron.ts`.

## 5. جلسة الركن (Coverage parking session)

- كرون `coverage-rebalance.cron` (فاصل `rebalance_min` من `dispatch_config`) يوزّع السائقين الخاملين على `coverage_points` → صفوف `driver_coverage_assignments` (is_active) لكل نقطة.
- الركن ينتهي عند: إسناد عرض للسائق (يُحرَّر) / تعطيل النقطة (soft delete) / كرون الـ rebalance التالي.
- **الملف**: `coverage-rebalance.cron.ts` · `coverage-points.service.ts` (عرض عدد `parked_drivers`).

## 6. جلسة Odoo (Server session cache)

- أول نداء JSON-RPC → مصادقة → كاش الجلسة في Redis (TTL **25 دقيقة**) — لا إعادة مصادقة لكل نداء.
- أي خطأ Odoo يُبطل الكاش ليعيد المصادقة عند النداء التالي (timeout 10s).
- **الملف**: `odoo/odoo.service.ts` · `odoo/odoo.module.ts`.

## 7. جلسة الجهاز/الإشعارات (Device & FCM session)

- كل device: صف `user_devices` (fcmToken, deviceType, language, refresh hash) — يُحدَّث عند كل دخول/تبديل لغة.
- الإشعارات: إنشاء + طابور BullMQ + كرون retry (فشل Firebase مؤقت يُعاد) + soft-delete.
- **الملف**: `notification/*` · `user_devices` entity.

## 8. جدول الجلسات الكامل

| # | الجلسة | النوع | تبدأ | تنتهي | TTL/مدة | المستخدم | الملف |
|---|---|---|---|---|---|---|---|
| 1 | Access token | JWT | login/refresh | logout/انتهاء | env `JWT_ACCESS_EXPIRATION` | الكل | auth |
| 2 | Refresh + device | DB | أول دخول جهاز | logout | دائم (يُحدَّث) | الكل | auth |
| 3 | Blacklist | Redis | logout | انتهاء | 600s | الكل | auth |
| 4 | resetTicket | Redis | password/verify | استهلاك | 600s | الكل | auth |
| 5 | Socket /tracking | Socket.IO | connect | disconnect | حياة الاتصال | سائق/أدمن | truck-tracking.gateway |
| 6 | Socket /collection | Socket.IO | connect | disconnect | حياة الاتصال | الكل | dispatch.gateway |
| 7 | Live tracking | Redis+DB | pickup | dropoff/انقطاع | مدّة الوردية | سائق | truck-tracking.service |
| 8 | Offer window | Redis+DB | elect | accept/reject/expire | accept_window_sec | سائق | dispatch-engine |
| 9 | Coverage parking | DB | rebalance cron | تحرير/تعطيل | حتى الـ rebalance التالي | سائق | coverage-rebalance |
| 10 | Odoo session | Redis | أول نداء | خطأ/انتهاء | 25د | (سيرفر) | odoo.service |
| 11 | Device/FCM | DB | دخول | logout/حذف | دائم | الكل | notification |
| 12 | كاش الصلاحيات | Redis | أول طلب محمي | انتهاء | 3600s | أدمن | permission |

## 9. مبادئ التصميم
- **لا مفتاح بلا موت** — كل جلسة Redis لها TTL أو سلة مفاتيح تُنظَّف (sweepers: offer/acceptance، loc-throttle، blacklist).
- **انقطاع = يُثبَّت لا يضيع** — آخر موقع يُحفظ في DB، والعرض المنتهي يُسجَّل EXPIRED في السجلّ (قابل لإعادة اللعب).
- **الجلسة الحيّة مقرونة بحالة أعمال لا باتصال** — التتبع مرتبط بـ handover، والعرض مرتبط بصف assignment.
