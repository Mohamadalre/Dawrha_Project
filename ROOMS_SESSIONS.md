# Rooms & Sessions — متابعة لكل مستخدم (`ROOMS_SESSIONS.md`)

> مرجع المطوّر: **أين يجلس كل مستخدم، وأي غرف/مفاتيح جلسة تنبثق عنه، ومن يديرها، ومتى تنتهي.**
> الشرح الكامل للمفاهيم والدورة: `SESSIONS_GUIDE.md`. عقود الـ API: `API_USER_APP.md` · `API_DRIVER_APP.md` · `API_ADMIN_APP.md`.

## 1. المواطن / المؤسسة / المعمل / الجهة الحرة (تطبيق المستخدمين)

| الغرفة/المفتاح | النوع | متى يُنشأ | من يبثّ إليه | المدة | الملف |
|---|---|---|---|---|---|
| `request:{requestId}` (غرفة) | Socket.IO `/collection` | بالاشتراك اليدوي `collection:subscribe` | محرّك التوزيع: `request:status` (ASSIGNED/EN_ROUTE/…/CANCELLED) | حتى `collection:unsubscribe` / انقطاع | `dispatch.gateway.ts` |
| `blackListToken:{userId}` | Redis | عند `logout` (jti) | — | 600s | auth |
| `user_devices` (صف) | DB | أول دخول لكل device | — | دائم (يُحدَّث refresh/expiry) | auth |
| OTP + ticket | Redis/DB | forgot-password / verify | — | OTP 600s · resetTicket 600s | mail/auth |

## 2. السائق (تطبيق السائقين)

| الغرفة/المفتاح | النوع | متى يُنشأ | من يبثّ إليه | المدة | الملف |
|---|---|---|---|---|---|
| `driver:{accountId}` (غرفة) | Socket.IO `/collection` | **تلقائياً عند الاتصال** | محرّك التوزيع: `request:assigned` (عرض جديد) | حياة الاتصال | `dispatch.gateway.ts:54` |
| `truck:location:{truckId}` | Redis | كل بثّ `truck:location` | — | `LOCATION_TTL` | `truck-tracking.service.ts` |
| `truck:history:{truckId}` | Redis (list محدودة) | كل بثّ موقع | — | `HISTORY_LIMIT` عنصر | `truck-tracking.service.ts` |
| `truck:active` | Redis ZSET | أول بثّ موقع | — | حتى انتهاء الوردية | `truck-tracking.service.ts` |
| `dispatch:offer:{assignmentId}` | Redis | إنشاء عرض | — | `accept_window_sec` (افتراضي 300s) | `dispatch.constants.ts` |
| `dispatch:offer:driver:{driverId}` | Redis | إنشاء عرض (مسار سريع) | — | `accept_window_sec` | `dispatch.constants.ts` |
| `dispatch:loc-throttle:{driverId}` | Redis | كل بثّ موقع (NX) | — | 60s | `dispatch.constants.ts` |
| `driver_coverage_assignments` (صف) | DB | الركن في نقطة تغطية | — | حتى إلغاء الركن | coverage service |
| `truck_handovers` (صف) | DB | `POST /driver/pickup` | — | حتى `dropoff` | truck |
| FCM device (user_devices.fcmToken) | DB | تسجيل الدخول | الإشعارات | دائم | notification |

## 3. الأدمن (تطبيق الأدمن)

| الغرفة/المفتاح | النوع | متى يُنشأ | من يبثّ إليه | المدة | الملف |
|---|---|---|---|---|---|
| `admins` (غرفة) | Socket.IO `/tracking` | `admin:subscribeAll` | كل `truck:location` / `truck:stopped` / `truck:session` | حياة الاتصال | `truck-tracking.gateway.ts` |
| `admins` (غرفة) | Socket.IO `/collection` | `collection:subscribeAll` | `request:needs_admin` | حياة الاتصال | `dispatch.gateway.ts:94` |
| `truck:{truckId}` (غرفة) | Socket.IO `/tracking` | `truck:subscribe` | بثّ الشاحنة المحددة | حتى unsubscribe | `truck-tracking.gateway.ts:245` |
| كاش الصلاحيات | Redis | عند أول طلب (خلف PermissionsGuard) | — | 3600s | permission |
| جلسة Odoo | Redis | أول نداء Odoo | — | 25 دقيقة | `odoo.service.ts` |

## 4. مصفوفة التلخيص

| المستخدم | غرف Socket.IO | مفاتيح Redis | صفوف DB جلسة | يُدار بواسطة |
|---|---|---|---|---|
| مواطن/مؤسسة/معمل/جهة | `request:*` (اشتراك يدوي) | blacklist, OTP | user_devices | auth + dispatch.gateway |
| سائق | `driver:*` (تلقائي) + بثّ تلقائي | truck:location/history/active, dispatch:offer*, loc-throttle | handovers, coverage_assignments, user_devices | tracking.gateway + dispatch engine + truck |
| أدمن | `admins` + `truck:*` (يدوي) | كاش صلاحيات، جلسة Odoo | user_devices | tracking.gateway + dispatch.gateway + permission |

## 5. قواعد مفتاحية
- **انقطاع السائق** (`/tracking`): `handleDisconnect` يُثبّت آخر موقع (DRIVER_DISCONNECT) ويبثّ `truck:stopped` — لا يتيم.
- **انقطاع منتج/أدمن** (`/collection`): لا أثر جانبي (غرف فقط، يعاد الاشتراك عند العودة).
- **كل مفاتيح الجلسة TTL أو lifecycle واضح** — لا مفتاح بلا انتهاء (عدا صفوف DB التي تُحدَّث لا تُحذف: user_devices, handovers, coverage_assignments للتاريخ).
