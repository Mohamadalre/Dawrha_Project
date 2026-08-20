# API — تطبيق الأدمن (`API_ADMIN_APP.md`)

> واجهة لوحة التحكم (ADMIN). البادئة `/api`؛ ذوات `version:'1'` → `/api/v1`.
> **القاعدة**: السائقون والأسطول والورديات تُدار في Odoo؛ هنا مراجعة/قراءة/أدوات تشغيل محلية فقط.

## 1. المصادقة — `/api/v1/auth`
| Method · Path | يأخذ | يرجّع | السيناريو |
|---|---|---|---|
| POST `login/admin` | `LoginDto` | `{ details, role }` | دخول الأدمن (تطبيق منفصل). |
| POST `refresh-token` · `logout` · PATCH `device/language` | | | نفس عقود التطبيقين الآخرين. |

## 2. إدارة الحسابات — `/api/v1/account-management`
| Method · Path | الصلاحية | السيناريو |
|---|---|---|
| GET `{factory\|institution\|external-partner}?page&limit&status` | `admin.accounts.view` | قائمة حسابات دور (السائقون **لا يُراجَعون محلياً** — في Odoo). |
| GET `profile/:profileId` · GET `:profileId/media` · GET `media/:mediaId` | view | مراجعة ملف كامل + صوره. |
| PATCH `media/:mediaId/status` | `admin.accounts.manage` | موافقة/رفض صورة (رفض → NEED_CHANGES + إشعار). |
| PATCH `:accountId/status` · PATCH `:accountId/block-status` | manage | موافقة/رفض حساب / حظر أو فك (ACTIVE↔BLOCKED فقط). |

## 3. الكتالوج — `/api/v1/admin/waste`
| Method · Path | الصلاحية | السيناريو |
|---|---|---|
| GET/POST/PUT/DELETE `categories` \| `products` \| `units` \| `conditions` | `admin.waste.manage/create/update/delete` | CRUD كامل — كل كتابة تُجدول job دفع إلى Odoo (`recycle.*`) + audit + إبطال كاش. |
| GET/POST/PUT/DELETE `offers` | `admin.waste.*` | العروض (مع `condition` اختيارية و`target_roles`). |
| GET `category-requests` · PATCH `:requestId/approve` \| `reject` | `admin.categories.request.manage` | طلبات تصنيفات المؤسسات. |

## 4. التسعير — `/api/v1/admin/waste/products/:productId/pricing`
| Method | الصلاحية | السيناريو |
|---|---|---|
| POST (ضبط 4 شرائح كاملة) · PATCH `:tier` · DELETE · GET · GET `history` | `admin.pricing.manage` | تسعير فردي/مؤسسات رقم واحد + معمل/جهة حرة لكل حالة + أرشفة + إعادة تسعير السلال + job Odoo. |

## 5. المستودعات — `/api/v1/admin/warehouses`
| Method · Path | الصلاحية | السيناريو |
|---|---|---|
| GET · POST · POST `:warehouseId/sync-manager` · POST `import-odoo` · GET `:warehouseId/inventory` · POST `:warehouseId/sync-odoo` | `admin.warehouse.view/manage/sync` | مرآة المستودعات + جرد مجمّع بالحالات + مزامنة Odoo (jobs). |

## 6. الأسطول (قراءة + أدوات) — `/api/v1`
| Method · Path | الصلاحية | السيناريو |
|---|---|---|
| GET `trucks?…` · GET `trucks/drivers?assigned&shiftId` · GET `trucks/:id` · GET `trucks/active` · GET `trucks/:truckId/{location,history,last-stop}` | `admin.trucks.view` | الشاحنات + مواقعها اللحظية (Redis/DB). |
| POST/DELETE `trucks/assign` · POST `trucks` · PATCH `trucks/:id` · PATCH `trucks/:id/status` | `admin.trucks.manage` | إنشاء/تعديل/إسناد (دفع إلى Odoo). |
| GET/POST/PATCH `admin/shift-change-requests[/process\|:id/status]` | `admin.trucks.*` | متابعة طلبات تبديل الوردية (المعالجة في Odoo). |
| GET/PATCH `shifts` | `admin.shifts.manage` (للتعديل) | الورديات. |
| PATCH `media/:mediaId/status` (سائق مُعاد رفعه) | `admin.accounts.manage` | توثيق السائق → إعادة دفع طلبه لـ Odoo. |

## 7. التقارير — `/api/v1/admin/reports`
| GET `overview` \| `accounts` \| `trucks` \| `warehouses` \| `catalog` | `admin.reports.view` | لوحة الإحصائيات. |

## 8. الجمع — سجلّ وإسناد وإعدادات — `/api/v1/admin`
| Method · Path | الصلاحية | السيناريو |
|---|---|---|
| GET `collection-requests?status&type&from&to&driver_id&page&limit` | `collection.admin.view` | سجلّ كامل + إجماليات وزن/قيمة. |
| POST `collection-requests/:id/assign` | `collection.admin.manage` | **إسناد يدوي**: يمرّ عبر مرشّحات الـ engine (غير مؤهل → 409)؛ NEEDS_ADMIN يُعاد للطابور أولاً؛ السجلّ يحفظ OFFERED→ACCEPTED. |
| PATCH `collection-requests/:id/cancel` | `collection.admin.manage` | إلغاء إداري (نفس تدفّق المنتِج بلا فحص ملكية). |
| GET/POST `coverage-points` · PATCH/DELETE `coverage-points/:id` | `collection.coverage.manage` | نقاط التغطية (مدارس/أسواق/مستشفيات) + عدد الركن الحالي؛ الحذف soft. |
| GET/PATCH `dispatch-config` | `collection.dispatch.manage` | إعدادات محرّك التوزيع (صف singleton: أوزان، نوافذ، حدود دمج، **rebalance_min** → يعيد جدولة كرون الـ rebalance). |
| GET `reports/collection/daily?date` · `reports/collection/requests` · `reports/collection/routes` | `admin.reports.view` | ملخص اليوم / سجلّ الطلبات / سجلّ المسارات (COMPLETED فقط). |


## 9. الإشعارات — `/api/notifications` (بلا نسخة)
GET (query) · `unread-count` · `:id` · PATCH `:id/read` · `read-all` · DELETE `:id` · `clear-all`.

## 10. البثّ الحي — Socket.IO
### namespace `/tracking` (أدمن)
| Event | السيناريو |
|---|---|
| `truck:subscribe {truckId}` | غرفة الشاحنة → أحداث `truck:location`/`truck:stopped` + آخر موقع معروف. |
| `truck:unsubscribe {truckId}` | إلغاء المتابعة. |
| `admin:subscribeAll` | غرفة `admins` → **كل** الشاحنات + `active`. |
| (استقبال) `truck:session {truckId, driverId, plateNumber, status}` | بدء/انتهاء جلسة التتبع الحيّة (من تدفّق الاستلام/التسليم). |

### namespace `/collection` (أدمن)
| Event | السيناريو |
|---|---|
| `collection:subscribeAll` | غرفة `admins` → تنبيهات `request:needs_admin` (طلب عالق بلا مرشّحين). |

## 11. خادم لخادم — Odoo Webhooks — `/api/v1/odoo/webhooks`
(ليست من واجهة التطبيق لكنها عمود الأدمن التشغيلي — توقيع `x-odoo-webhook-secret` constant-time، 503 إن لم يُهيّأ، كلها 202 + job)
`inventory` · `warehouse` · `fleet` · `driver-decision` · `shift-change-decision`.

## 12. ليس في هذا التطبيق
`login/user-app` · `login/collector-app` · `register/*` · `driver/*` · سلة/كتالوج المستخدمين · `content/*` (عامة).
