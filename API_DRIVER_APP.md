# API — تطبيق السائقين (`API_DRIVER_APP.md`)

> واجهة تطبيق الجامع (COLLECTOR). **الأسطول/الإسنادات/الورديات تُدار في Odoo** — هذا التطبيق يقرأ المرآة ويشغّل الجمع.
> البادئة `/api`؛ ذوات `version:'1'` → `/api/v1`.

## 1. المصادقة والحساب — `/api/v1/auth` · `/api/v1/user`

| Method · Path | يأخذ (Body) | يرجّع | السيناريو |
|---|---|---|---|
| POST `register/collector` | `{ fullName, email, phoneNumber, password }` | `{ token }` (مؤقت) | تسجيل جامع → INACTIVE + OTP. |
| POST `login/collector-app` | `LoginDto {email, password, deviceId, deviceType?, fcmToken?, rememberMy?}` | `{ details, role }` | دخول تطبيق السائق. |
| POST `login/collector-app/google` | `LoginGoogleDto` | `{ details, role }` | دخول Google. |
| POST `otp/verify` | `{ otpCode, deviceId, … }` | `{ details, role }` | التفعيل → PENDING_PROFILE. |
| POST `refresh-token` · `logout` · PATCH `device/language` · GET/PATCH `user/profile` · PATCH `user/password` | كما في تطبيق المستخدم | | نفس العقود. |
| PUT `media/:id` · PATCH `media/:id/reupload` | ملف (multipart) | `{ status, image }` | إعادة رفع صورة **مرفوضة** → PENDING + **إعادة دفع طلبه لـ Odoo** (PUSH_DRIVER_REQUEST). |

## 2. ملفي وشاحنتي — `/api/v1/driver`

| Method · Path | يأخذ | يرجّع | السيناريو |
|---|---|---|---|
| GET `driver/my-truck` | — | الشاحنة + مستودعها + ورديتها (أو «سيتم إسنادك قريباً») | شاحنة السائق من المرآة. |
| POST `driver/pickup` | — | `{ message }` | استلام الشاحنة في بداية الوردية (يفتح نافذة التتبع الحيّة + `truck:session started` للأدمن). |
| POST `driver/dropoff` | `{ reason }` (إلزامي) | `{ message }` | تسليم الشاحنة (يغلق الجلسة الحيّة، `truck:session` ينتهي + `truck:stopped`). |
| GET `driver/handover-status` | — | حالة الاستلام/التسليم | قيود نافذة الوردية: لا استلام قبل البدء / لا تسليم قبل النهاية (المعطّلة تُسلَّم بأي وقت). |

## 3. الوردية ومشاكل الشاحنة — `/api/v1`

| Method · Path | يأخذ | السيناريو |
|---|---|---|
| POST `shift-change-requests` · GET `mine` · DELETE `:id` | `CreateShiftChangeRequestDto {truckId, shiftId}` | طلب تبديل وردية **قراره في Odoo** (webhook `shift-change-decision` يعكس النتيجة). |
| POST `truck-problems` | سبب + صور | بلاغ مشكلة → يراه مدير المستودع في Odoo. |
| GET `shifts` | — | ورديات DRIVER الفعّالة (قراءة فقط). |

## 4. الجمع — العروض والجولة والتنفيذ — `/api/v1/driver/collection-requests`

| Method · Path | الصلاحية | يأخذ | يرجّع | السيناريو |
|---|---|---|---|---|
| PATCH `:id/accept` \| `:id/reject` | `collection.driver.manage` | — | `{ message, result }` | قبول/رفض عرض التوزيع خلال `accept_window_sec` (بثّ `request:assigned` على غرفة السائق)؛ القبول يربط الطلب بمساره، الرفض ينتقل للترشيح التالي. |
| GET | `collection.driver.view` | — | `{ route, stops[] }` | **جولتي** — المسار النشط (PLANNED/IN_PROGRESS) بمحطاته مرتبة. |
| PATCH `:id/arrived` | `collection.driver.manage` | — | `{ request_id, status }` | وصولي للمحطة (طابعا `enRouteAt`/`arrivedAt`). |
| PATCH `:id/collected` | `collection.driver.manage` | `{ actual_weight_kg }` | `{ request_id, status }` | الوزن الفعلي → PICKING (طابع `pickedAt`) + **`REGISTER_INTAKE` إلى Odoo** (idempotent) + نقاط الجمع. |
| PATCH `:id/delivered` | `collection.driver.manage` | `{ warehouse_id? }` | `{ request_id, status }` | التسليم → DELIVERED (طابع `deliveredAt`)؛ آخر محطة تُغلق الجولة COMPLETED وتُحرَّر اليد (بث `collection.driver.freed`). |

> ترتيب اللكمات محكوم بآلة الحالات — لكمة خارج الترتيب = 409، محطة ليست في جولتك = 404.

## 5. البثّ الحي — Socket.IO

### namespace `/tracking` (مُصادقة JWT في المصافحة: `auth.token` أو `?token=` أو Authorization)
| Event (سائق→خادم) | Payload | السيناريو |
|---|---|---|
| `truck:location` | `TruckLocationDto {truckId, lat, lng, speed?, heading?}` | بثّ موقعي — **يُقبل فقط مع handover مفتوح** («استلم الشاحنة قبل بدء التتبع»)؛ يُخزَّن Redis + يُبثّ لغرفة الشاحنة و`admins` + يشغّل إعادة ترشيح بحدّ مرة/دقيقة. |
| `truck:stop` | `{ truckId? }` | إنهاء رحلتي (يُثبَّت آخر موقع في DB). |
| (انقطاع الاتصال) | — | آخر موقع يُثبَّت تلقائياً `DRIVER_DISCONNECT` + `truck:stopped`. |

### namespace `/collection` (للجمع)
- **تلقائياً عند الاتصال**: السائق (COLLECTOR) ينضم لغرفة `driver:{accountId}` — محرك التوزيع يبثّ العروض هناك (`request:assigned`).

## 6. ليس في هذا التطبيق

مسارات `admin/*` · `driver/*` الخاصة بالمستخدمين · `odoo/webhooks` · سلة/كتالوج المستخدمين.
