/**
 * Builds postman/Dawrha.user.postman_collection.json — the CITIZEN app, on its
 * own.
 *
 * The main collection carries every role at once, which is the right shape for
 * an overview and the wrong one for working in: a citizen opening it wades past
 * fifty-eight admin routes, fifteen driver routes and four onboarding flows that
 * will never apply to them, and the ones that DO apply are scattered across
 * three folders. This file is the citizen's journey in the order they live it —
 * visitor, account, home, cart, order, after-sales.
 *
 * Generated rather than hand-written for the same reason as the admin one: a
 * hand-edited collection drifts by the next change, and a reader who tries a
 * route that no longer exists blames the backend.
 *
 *   node postman/build-user-collection.js
 *
 * Every request carries a description saying what it takes, what comes back,
 * and WHICH TABLES it reads or writes — the last part is the one no amount of
 * clicking through Postman will tell you.
 */
const fs = require('fs');
const path = require('path');

const TARGET =
  process.argv[2] || path.join(__dirname, 'Dawrha.user.postman_collection.json');

let seq = 0;

/**
 * One request.
 *
 * `auth: false` for the routes a visitor calls with no account — sending a
 * bearer token there would hide the fact that they work without one, which is
 * the single most important thing about them.
 */
const req = (name, method, rawPath, opts = {}) => {
  const { body, description, auth = true, token = 'citizenToken', form } = opts;
  const clean = rawPath.replace(/^\//, '');
  const [pathPart, queryPart] = clean.split('?');
  const item = {
    name,
    id: `usr${++seq}`,
    request: {
      method,
      header: body ? [{ key: 'Content-Type', value: 'application/json' }] : [],
      ...(description ? { description } : {}),
      url: {
        // Host and port stay separate so one environment can point at
        // localhost:3000 and another at a staging host on 443 without editing
        // every request.
        raw: `{{server}}:{{port}}/${clean}`,
        host: ['{{server}}'],
        port: '{{port}}',
        path: pathPart.split('/'),
        ...(queryPart
          ? {
              query: queryPart.split('&').map((kv) => {
                const [key, value] = kv.split('=');
                return { key, value: value ?? '' };
              }),
            }
          : {}),
      },
      ...(auth
        ? {
            auth: {
              type: 'bearer',
              bearer: [{ key: 'token', value: `{{${token}}}`, type: 'string' }],
            },
          }
        : { auth: { type: 'noauth' } }),
    },
    response: [],
  };
  if (body) {
    item.request.body = {
      mode: 'raw',
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } },
    };
  }
  if (form) {
    item.request.header = [];
    item.request.body = {
      mode: 'formdata',
      formdata: form,
    };
  }
  return item;
};

/** Joins description lines — written as arrays so they stay readable here. */
const d = (...lines) => lines.join('\n');

const collection = {
  info: {
    name: 'Dawrha — تطبيق المستخدم (Citizen)',
    _postman_id: 'dawrha-user-1785600000000',
    description: d(
      '# راوتات تطبيق المستخدم — مرتّبة بترتيب الرحلة',
      '',
      'مجموعة **مستقلّة** للمواطن وحده. المجموعة الرئيسية تحمل الأدوار كلها معاً،',
      'وهي شكلٌ صحيح للاطّلاع وخاطئ للعمل: من يفتحها ليعمل على تطبيق المستخدم',
      'يمرّ على ٥٨ راوت أدمن و١٥ راوت سائق لا تخصّه، وما يخصّه مبعثر في ثلاثة مجلدات.',
      '',
      '## الترتيب',
      'المجلدات مرتّبة كما يعيشها المستخدم: زائر ← حساب ← رئيسية ← سلة ← طلب ← ما بعد البيع.',
      '',
      '## التوكن',
      '- `{{citizenToken}}` — بعد `POST /auth/login/user-app` وتفعيل OTP.',
      '- `{{tempToken}}` — التوكن **المؤقّت** الذي يرجع من التسجيل/الدخول قبل إدخال OTP.',
      '- مجلد «زائر» بلا توكن إطلاقاً.',
      '',
      '## قواعد المسارات',
      '- البادئة `/api` وأغلب المسارات `v1` → `/api/v1/...`',
      '- **الاستثناء**: `notifications` و`media` تعملان بلا نسخة أيضاً → `/api/notifications/...`',
      '- الترويسة `x-lang: ar` أو `en` تحدّد لغة الرسائل والمحتوى الثابت.',
      '',
      '## ما ليس هنا ولماذا',
      '- `my-categories` / `my-materials` — للمؤسسات والمصانع: صلاحية `waste.materials.view`،',
      '  والمواطن لا يملكها لأنه لا يختار تصنيفات في التسجيل أصلاً.',
      '- `products/:id/availability` — للمصانع والمنشآت الحرّة: صلاحية `waste.products.availability`.',
      '- `waste/category-requests` — للمؤسسات وحدها: صلاحية `waste.categories.request`.',
      '',
      'صلاحيات المواطن كاملةً (من `ROLE_PERMISSIONS_MAP`):',
      '`waste.categories.view` · `waste.products.view` · `waste.offers.view` ·',
      '`waste.products.suggest` · `waste.products.popular` · `cart.view` · `cart.manage`',
    ),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'server', value: 'http://localhost' },
    { key: 'port', value: '3000' },
    { key: 'citizenToken', value: '' },
    { key: 'tempToken', value: '' },
    { key: 'refreshToken', value: '' },
    { key: 'deviceId', value: 'device-postman-1' },
    { key: 'categoryId', value: '' },
    { key: 'productId', value: '' },
    { key: 'offerId', value: '' },
    { key: 'itemId', value: '' },
    { key: 'orderId', value: '' },
    { key: 'partId', value: '' },
    { key: 'locationId', value: '' },
    { key: 'provinceId', value: '' },
    { key: 'notificationId', value: '' },
    { key: 'mediaId', value: '' },
    { key: 'favouriteId', value: '' },
    { key: 'accountId', value: '' },
    { key: 'resetTicket', value: '' },
  ],
  item: [
    // ══════════════════════════════════════════════════════════════════
    {
      name: '0️⃣ زائر — قبل التسجيل (بلا توكن)',
      description: d(
        'ما يراه من فتح التطبيق ولم يسجّل بعد.',
        '',
        '**تُعرَض الأسعار هنا** خلافاً لمسارات `waste/public` العامة، لأن المسار نفسه',
        '(`user-app/guest`) يقول أيّ نوع مشترٍ سيصير هذا الزائر — فالرقم المعروض هو',
        'الرقم الذي سيُدفَع له فعلاً. ولا تظهر إلا المواد التي لها **سعر نافذ** لإحدى',
        'شريحتَي التطبيق: المادة المسعّرة لأحد لا يمكن شراؤها بعد التسجيل، وعرضها وعدٌ',
        'لن يُوفى.',
        '',
        'ولا يوجد هنا أي راوت كتابة — الزائر بلا حساب تُعلَّق عليه سلّة وبلا موقع',
        'تُطابَق به المستودعات.',
      ),
      item: [
        req('🗂️ التصنيفات', 'GET', 'api/v1/user-app/guest/categories?page=1&limit=10', {
          auth: false,
          description: d(
            '**يأخذ**: `page` · `limit` (≤50) · `search` اختياري.',
            '',
            '**يرجع**: `{ categories[], pagination }`',
            'وكل تصنيف: `id` · `name` · `description` · `image` · `product_count`.',
            '',
            '**من الداتا بيز**: `waste_categories` (النشِطة وحدها)،',
            'مُصفّاة بـ `EXISTS` على `products` + `product_pricing` — أي أن التصنيف',
            'الذي كل مواده مسعّرة لشريحة أخرى **لا يظهر**. التصنيف الفارغ طريق مسدود:',
            'يضغطه الزائر فلا يجد شيئاً، ولا يتعلّم إلا أن الكتالوج ناقص.',
            '',
            '**لا يكتب شيئاً.**',
          ),
        }),
        req(
          '📦 مواد تصنيف',
          'GET',
          'api/v1/user-app/guest/categories/{{categoryId}}/products?page=1&limit=10',
          {
            auth: false,
            description: d(
              '**يأخذ**: `categoryId` في المسار (UUID) · `page` · `limit`.',
              '',
              '**يرجع**: `{ products[], pagination }` وكل مادة:',
              '`id` · `name` · `image` · `category_name` · `unit_type` · `unit_label` ·',
              '`prices` · `has_offer` · `offer_price` · `discount_percentage` ·',
              '`currency` · `requires_login_to_order: true`.',
              '',
              '**من**: `products` ⋈ `waste_categories` ⋈ `product_pricing`',
              '(+ `measurement_units` لاسم الوحدة، و`offers` لأفضل عرض مُوجَّه لهذه الشريحة).',
            ),
          },
        ),
        req('🧱 كل المواد', 'GET', 'api/v1/user-app/guest/products?page=1&limit=10&search=', {
          auth: false,
          description: d(
            '**يأخذ**: `page` · `limit` · `category_id` اختياري · `search` اختياري.',
            '',
            '**يرجع**: نفس شكل مواد التصنيف.',
            '',
            '**من**: `products` + `product_pricing` (سعر نافذ لشريحة التطبيق) + `offers`.',
          ),
        }),
        req('🔎 تفاصيل مادة', 'GET', 'api/v1/user-app/guest/products/{{productId}}', {
          auth: false,
          description: d(
            '**يأخذ**: `productId` في المسار.',
            '',
            '**يرجع**: `{ product }` بنفس حقول القائمة.',
            '',
            '**404** إذا كانت المادة غير نشِطة أو **بلا سعر نافذ** لهذه الشريحة —',
            'وجودها في الجدول لا يعني أنها معروضة للبيع.',
            '',
            '**من**: `products` + `product_pricing` + `material_conditions` (تسميات الدرجات).',
          ),
        }),
        req('🎁 العروض', 'GET', 'api/v1/user-app/guest/offers?page=1&limit=10', {
          auth: false,
          description: d(
            '**يرجع**: `{ offers[], pagination }`. الضيف لا يرى الأرقام: كل عرض',
            '`offer_id` · `product_id` · `product_name` · `requires_login: true` فقط —',
            'وجودُ عرضٍ إغراءٌ للتسجيل، وأرقامه تُكشَف بعد الدخول بشريحة معروفة.',
          ),
        }),
        req('🔍 بحث موحّد', 'GET', 'api/v1/user-app/guest/search?query=بلاستيك&page=1&limit=10', {
          auth: false,
          description: d(
            '**يأخذ**: `query` (مطلوب) · `page` · `limit`.',
            '',
            '**يرجع**: `{ query, categories[], products[], pagination: { categories, products } }`',
            '— صندوق بحث واحد فوق التصنيفات **والمواد** معاً. من يكتب «بلاستيك» لا يعرف',
            'أيّهما يسمّي، ومطالبته باختيار تبويب أولاً سؤال قاعدة البيانات لا سؤاله.',
            '',
            '**من**: `waste_categories` + `products` (بحث `ILIKE` على الاسم).',
          ),
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '1️⃣ الحساب — تسجيل ودخول',
      description: d(
        'التسجيل والدخول **لا يعطيان توكن الوصول مباشرة**: يرجع `tempToken`،',
        'ثم يُفعَّل الحساب بـ OTP في المجلد التالي فيتحوّل إلى `accessToken`.',
        '',
        'الجهاز جزءٌ من الهوية لا زينة: `deviceId` يُسجَّل في `user_devices` مع الـ',
        'refresh token و`fcmToken`، فالخروج من جهاز لا يُخرج البقية، والإشعار يصل',
        'الجهاز الصحيح.',
      ),
      item: [
        req('🆕 تسجيل مواطن', 'POST', 'api/v1/auth/register/citizen', {
          auth: false,
          body: {
            fullName: 'محمد أحمد',
            email: 'user@example.com',
            password: 'Passw0rd!',
            phoneNumber: '963931234567',
          },
          description: d(
            '**يأخذ**:',
            '- `fullName` — مطلوب.',
            '- `email` — مطلوب، صيغة بريد. **الهوية**، ولا يُعدَّل لاحقاً.',
            '- `password` — ٨–٦٤ حرفاً، وفيه حرف كبير وصغير ورقم أو رمز.',
            '- `phoneNumber` — رقم **سوري**: `9639XXXXXXXX`. يُطبَّع تلقائياً',
            '  (`09xx` و`+9639xx` تصل إلى الصيغة نفسها) قبل التحقق.',
            '',
            '**يرجع**: `{ message, result: { tempToken, ... } }` — توكن مؤقّت لا يفتح شيئاً',
            'سوى راوتَي OTP. ويُرسَل رمز التفعيل إلى البريد.',
            '',
            '**يكتب**: صفّاً في `accounts` (بحالة غير مفعّلة + `password_hash` بـ argon2)',
            'وصفّاً في `citizen_profiles`، ويسجّل الجهاز في `user_devices`.',
            'كلمة المرور **لا تُخزَّن أبداً** — يُخزَّن هاشها.',
          ),
        }),
        req('🆕 تسجيل بـ Google', 'POST', 'api/v1/auth/register/citizen/google', {
          auth: false,
          body: {
            TokenId: '<google id_token>',
            deviceId: '{{deviceId}}',
            deviceType: 'ANDROID',
            fcmToken: '<fcm>',
          },
          description: d(
            '**يأخذ**: `TokenId` — الـ `id_token` من جوجل (لا كلمة مرور) + بيانات الجهاز.',
            '',
            '**يرجع**: التوكنات مباشرة — **بلا OTP**، لأن جوجل تحقّقت من البريد فعلاً،',
            'وإعادة التحقّق منه تسأل المستخدم إثبات ما أُثبِت.',
            '',
            '**يكتب**: `accounts` (مع `google_id` وبلا `password_hash`) + `citizen_profiles` + `user_devices`.',
          ),
        }),
        req('🔑 دخول', 'POST', 'api/v1/auth/login/user-app', {
          auth: false,
          body: {
            email: 'user@example.com',
            password: 'Passw0rd!',
            deviceId: '{{deviceId}}',
            deviceType: 'ANDROID',
            fcmToken: '<fcm>',
            rememberMy: true,
          },
          description: d(
            '**يأخذ**: `email` · `password` · `deviceId` (مطلوب) ·',
            '`deviceType` · `fcmToken` · `rememberMy` (اختيارية).',
            '',
            '**يرجع**: `{ accessToken, refreshToken }` للحساب المفعّل،',
            'أو `tempToken` إن كان الحساب لم يُفعَّل بعد فيُعاد إرسال OTP.',
            '',
            '`rememberMy` تُطيل عمر الـ refresh token لهذا **الجهاز وحده**.',
            '',
            '**من/إلى**: يقرأ `accounts`، ويكتب/يحدّث صفّ الجهاز في `user_devices`',
            '(refresh token مهشوم + آخر دخول + `fcm_token`).',
            '',
            '⚠️ المسار خاصّ بتطبيق المستخدم: `login/collector-app` و`login/factory-app`',
            'أبواب أخرى، ودخول المواطن منها مرفوض.',
          ),
        }),
        req('🔑 دخول بـ Google', 'POST', 'api/v1/auth/login/user-app/google', {
          auth: false,
          body: { TokenId: '<google id_token>', deviceId: '{{deviceId}}', rememberMy: true },
          description: '**يرجع** التوكنات مباشرة. **يقرأ** `accounts` بـ `google_id` ويكتب `user_devices`.',
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '2️⃣ التفعيل واستعادة كلمة المرور',
      item: [
        req('✅ تأكيد OTP', 'POST', 'api/v1/auth/otp/verify', {
          token: 'tempToken',
          body: { otpCode: '12345', deviceId: '{{deviceId}}', rememberMy: true },
          description: d(
            '**يحتاج**: `Bearer {{tempToken}}` — التوكن المؤقّت من التسجيل/الدخول.',
            '',
            '**يأخذ**: `otpCode` — **٥ أرقام** بالضبط · `deviceId` · `rememberMy`.',
            '',
            '**يرجع**: `{ accessToken, refreshToken }` — هنا يصير الحساب مفعّلاً.',
            'انسخ `accessToken` إلى متغيّر `citizenToken`.',
            '',
            '**يكتب**: يفعّل الصفّ في `accounts` ويبطل الرمز، ويكتب refresh token في `user_devices`.',
          ),
        }),
        req('🔄 إعادة إرسال OTP', 'PUT', 'api/v1/auth/otp/resend', {
          token: 'tempToken',
          description: '**يحتاج** `{{tempToken}}` ولا يأخذ بودي. يولّد رمزاً جديداً ويرسله للبريد ويبطل السابق.',
        }),
        req('🔓 نسيت كلمة المرور', 'POST', 'api/v1/auth/password/forgot', {
          auth: false,
          body: { email: 'user@example.com' },
          description: d(
            '**يأخذ**: `email`.',
            '',
            '**يرجع**: رسالة نجاح **سواء وُجد البريد أو لا** — الردّ المختلف يكشف',
            'أيّ العناوين مسجّلة عندنا لمن يجرّب قائمة بريد.',
            '',
            '**من/إلى**: يقرأ `accounts` ويكتب رمز الاستعادة عليه مع صلاحيته.',
          ),
        }),
        req('🔄 إعادة إرسال رمز الاستعادة', 'POST', 'api/v1/auth/password/forgot/resend', {
          auth: false,
          body: { email: 'user@example.com' },
        }),
        req('✅ تأكيد رمز الاستعادة', 'POST', 'api/v1/auth/password/verify', {
          auth: false,
          body: { email: 'user@example.com', otpCode: '12345' },
          description: d(
            '**يأخذ**: `email` · `otpCode` (٥ أرقام).',
            '',
            '**يرجع**: `{ resetTicket }` — تذكرة لمرّة واحدة تُرسَل في الراوت التالي.',
            'الرمز نفسه لا يُقبَل لتغيير كلمة المرور: تذكرةٌ منفصلة تعني أن من التقط',
            'الرمز من إشعار على الشاشة لا يملك ما يكفي.',
          ),
        }),
        req('🔐 تعيين كلمة مرور جديدة', 'PATCH', 'api/v1/auth/password/reset', {
          auth: false,
          body: {
            email: 'user@example.com',
            resetTicket: '{{resetTicket}}',
            newPassword: 'NewPassw0rd!',
            confirmPassword: 'NewPassw0rd!',
          },
          description: d(
            '**يأخذ**: `email` · `resetTicket` · `newPassword` · `confirmPassword`',
            '(نفس شروط قوّة كلمة المرور في التسجيل).',
            '',
            '**يكتب**: `password_hash` جديد في `accounts` ويبطل التذكرة.',
          ),
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '3️⃣ الجلسة — التوكن والأجهزة',
      item: [
        req('♻️ تجديد التوكن', 'POST', 'api/v1/auth/refresh-token', {
          token: 'refreshToken',
          body: { deviceId: '{{deviceId}}' },
          description: d(
            '**يحتاج**: `Bearer {{refreshToken}}` لا `accessToken`.',
            '',
            '**يأخذ**: `deviceId` — والجهاز جزء من الشرط: توكن تجديد سُرِق من جهاز',
            'لا يُجدَّد على غيره.',
            '',
            '**يرجع**: زوجاً جديداً. **يحدّث** الصفّ في `user_devices`.',
          ),
        }),
        req('♻️ تجديد التوكن المؤقّت', 'POST', 'api/v1/auth/temporary-token/refresh', {
          auth: false,
          body: { token: '{{tempToken}}' },
          description: 'لمن طال بقاؤه على شاشة OTP حتى انتهت صلاحية التوكن المؤقّت.',
        }),
        req('📲 تحديث FCM Token', 'PUT', 'api/v1/auth/FCMToken', {
          body: { deviceId: '{{deviceId}}', fcmToken: '<fcm>', deviceType: 'ANDROID' },
          description: '**يكتب** `fcm_token` على صفّ الجهاز في `user_devices` — بدونه لا يصل إشعار.',
        }),
        req('🌐 لغة الجهاز', 'PATCH', 'api/v1/auth/device/language', {
          body: { deviceId: '{{deviceId}}', language: 'ar' },
          description: d(
            '**يأخذ**: `deviceId` · `language` (`ar` أو `en`).',
            '',
            '**لماذا على الجهاز لا على الحساب**: الإشعار يُرسَل والتطبيق مغلق،',
            'فلا ترويسة `x-lang` تُقرأ حينها — اللغة المحفوظة على الجهاز هي الوحيدة',
            'المتاحة وقت الإرسال. **يكتب** `user_devices.language`.',
          ),
        }),
        req('🚪 خروج', 'POST', 'api/v1/auth/logout', {
          body: { deviceId: '{{deviceId}}' },
          description: d(
            '**يأخذ**: `deviceId`.',
            '',
            '**يمسح** refresh token و`fcm_token` من صفّ **هذا الجهاز وحده** في `user_devices`.',
            'الخروج من الهاتف لا يُخرج اللوحي.',
          ),
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '4️⃣ الملف الشخصي',
      item: [
        req('👤 ملفي', 'GET', 'api/v1/user/profile', {
          description: d(
            '**يرجع** بطاقة مسطّحة (لا تعشيش):',
            '`{ message, result: { profileId, name, email, phone, profileImage, accountStatus, role } }`',
            '- `profileId` — مُعرِّف صفّ **بروفايل الدور** (citizen/factory/…)، لا مُعرِّف الحساب. للأدمن ومن لا بروفايل له = `null`.',
            '- لا `passwordHash` ولا أي حقل حسّاس تحت أي مفتاح.',
            '',
            '**كاش**: مُخزَّن لكل حساب على حدة، ويُبطَل عند أي تعديل على الملف (تعديل، صورة، هاتف غوغل).',
            '',
            '**من**: `accounts` + صفّ بروفايل الدور (مُعرِّفه فقط).',
          ),
        }),
        req('✏️ تعديل الملف', 'PATCH', 'api/v1/user/profile', {
          body: { name: 'محمد أحمد', phone: '+963931234567', description: 'نبذة قصيرة', profileImage: 'https://cdn/img.jpg' },
          description: d(
            '**يأخذ** (كلها اختيارية): `name` ≤255 · `phone` (`+` ثم ٧–١٥ رقماً) · `description` ≤1000 · `profileImage` (رابط) ≤1024.',
            '',
            '**فاليديشن الهاتف**: يُرفض إن كان مملوكاً لحساب آخر (فريد على مستوى القاعدة). يمرّ عبر `assertPhoneAvailable` — نفس الحارس المستعمل في التسجيل بغوغل.',
            '',
            '**البريد غير موجود عمداً**: هو الهوية التي يُبنى عليها الدخول والاستعادة،',
            'وتغييره من شاشة تعديل عادية يعني نقل ملكية الحساب بضغطة.',
            '',
            '**يكتب**: `accounts` (الحقول المرسَلة فقط) · **يُبطِل كاش الملف**.',
          ),
        }),
        req('🖼️ رفع صورة الملف', 'POST', 'api/v1/user/profile/image', {
          form: [{ key: 'file', type: 'file' }],
          description: d(
            '**يأخذ**: ملف صورة (`multipart/form-data`، الحقل `file`). يتطلّب حساباً **مفعّلاً (ACTIVE)** حصراً.',
            '',
            '**يرجع**: `{ message, result: { profileImage } }`.',
            '',
            '**يكتب**: `accounts.profile_image` + يرفع الصورة إلى Cloudinary · **يُبطِل كاش الملف**.',
          ),
        }),
        req('🖼️ تعديل صورة الملف', 'PATCH', 'api/v1/user/profile/image', {
          form: [{ key: 'file', type: 'file' }],
          description: d(
            '**يأخذ**: ملف صورة جديد يستبدل القديمة. حساب **مفعّل** فقط.',
            '',
            '**يكتب**: `accounts.profile_image` · يحذف القديمة من Cloudinary · **يُبطِل كاش الملف**.',
          ),
        }),
        req('🗑️ حذف صورة الملف', 'DELETE', 'api/v1/user/profile/image', {
          description: d(
            '**يمسح** الصورة: `accounts.profile_image = null` ويحذفها من Cloudinary.',
            '',
            '**يُبطِل كاش الملف**.',
          ),
        }),
        req('🔐 تغيير كلمة المرور', 'PATCH', 'api/v1/user/password', {
          body: {
            currentPassword: 'Passw0rd!',
            newPassword: 'NewPassw0rd!',
            confirmPassword: 'NewPassw0rd!',
          },
          description: d(
            '**يأخذ**: الثلاثة مطلوبة. ويُرفض إن كانت الجديدة **مطابقة للقديمة**.',
            '',
            '**لماذا كلمة المرور الحالية**: التوكن قد يكون على جهاز تُرك مفتوحاً،',
            'وبدون هذا السؤال يستطيع من يمسك الجهاز أن يقفل صاحبه خارج حسابه.',
            '',
            '**يكتب**: `accounts.password_hash` بعد تحقّق argon2.',
          ),
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '5️⃣ العناوين (للمواطن وحده)',
      description: d(
        'المواطن يملك **عدّة** عناوين — بيت وعمل — وبقيّة الأدوار تضبط عنواناً',
        'واحداً في التسجيل. الراوتات الثلاثة ترفض أي دور آخر صراحةً.',
        '',
        '**والعنوان شرطُ الطلب**: `POST /orders/checkout` يرفض بـ 400 إن لم تكن',
        'هناك محافظة، لأن المستودعات تُطابَق بالمحافظة.',
      ),
      item: [
        req('📍 عناويني', 'GET', 'api/v1/user/locations', {
          description: d(
            '**يرجع**: مصفوفة، كل عنصر:',
            '`id` · `address` · `description` · `coordinates: [lng, lat]` · `province: { id }`.',
            '',
            '**من**: `citizen_profiles` ⋈ `locations` ⋈ `provinces`.',
          ),
        }),
        req('➕ إضافة عنوان', 'POST', 'api/v1/user/locations', {
          body: {
            coordinates: [36.2765, 33.5138],
            address: 'دمشق — المزة',
            descriptionAddress: 'بجانب الحديقة',
            provinceId: '{{provinceId}}',
          },
          description: d(
            '**يأخذ**:',
            '- `coordinates` — مصفوفة **من عنصرين بالضبط**، بالترتيب `[lng, lat]`',
            '  (طول ثم عرض، ترتيب GeoJSON لا ترتيب خرائط جوجل — عكسها يضع دمشق في الصومال).',
            '- `address` — مطلوب · `descriptionAddress` — اختياري.',
            '- `provinceId` — UUID من `GET /onboarding/provinces`.',
            '',
            '**يرجع**: `{ id, message }`.',
            '',
            '**يكتب**: صفّاً في `locations` من نوع PostGIS `Point` مربوطاً بـ `citizen_profiles`،',
            'ويُنشئ ملف المواطن إن لم يكن موجوداً.',
          ),
        }),
        req('🗑️ حذف عنوان', 'DELETE', 'api/v1/user/locations/{{locationId}}', {
          description: '**يحذف** من `locations` بعد التأكّد أن العنوان **يخصّ حساب المُنادي** — وإلا 403.',
        }),
        req('🏙️ المحافظات', 'GET', 'api/v1/onboarding/provinces', {
          auth: false,
          description: '**يرجع** `provinces` كاملة لملء قائمة الاختيار. **بلا توكن**.',
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '6️⃣ الرئيسية — التصنيفات والمواد',
      description: d(
        '**الفرق الجوهري عن مجلد الزائر**: هنا الأسعار **بشريحة المُنادي**.',
        'المواطن شريحته `INDIVIDUAL`، والمادة التي لا تحمل سعراً نافذاً لهذه الشريحة',
        '**غير موجودة بالنسبة له** — تُستبعَد داخل SQL لا بعد الجلب، فيبقى العدّ',
        'وحجم الصفحة صادقَين، والأهم: لا تصل سلّته أصلاً مادة لا يمكن أن يُحاسَب عليها.',
      ),
      item: [
        req('🗂️ التصنيفات', 'GET', 'api/v1/waste/categories?page=1&limit=10&sort=name&order=asc&search=', {
          description: d(
            '**الصلاحية**: `waste.categories.view`.',
            '',
            '**يأخذ**: `page` · `limit` (≤50) · `search` · `sort` (`name` | `created_at`) · `order` (`asc` | `desc`).',
            '',
            '**يرجع**: `{ categories[], pagination: { current_page, total_pages, total_count, limit, has_next, has_prev } }`',
            'وكل تصنيف: `id` · `name` · `description` · `image` · `product_count` · `created_at` · `updated_at`.',
            '',
            '**مع `search`** يرتّب ما **يبدأ** بالنص المكتوب أولاً — ترتيب إكمال تلقائي لا ترتيب أبجدي.',
            '',
            '**من**: `waste_categories` + `EXISTS` على `products` و`product_pricing`',
            '(شريحة المُنادي وسعر نافذ الآن). النتيجة **مُخزَّنة مؤقّتاً** بمفتاح يشمل الشريحة —',
            'لولا ذلك لرأى المواطن قائمة المصنع.',
          ),
        }),
        req(
          '📦 مواد تصنيف',
          'GET',
          'api/v1/waste/categories/{{categoryId}}/products?page=1&limit=10&sort=name&order=asc&price_min=&price_max=',
          {
            description: d(
              '**الصلاحية**: `waste.products.view`.',
              '',
              '**يأخذ**: `categoryId` بالمسار · `page` · `limit` ·',
              '`sort` (`name` | `price` | `popularity`) · `order` · `price_min` · `price_max`.',
              '',
              '**يرجع**: `{ category, products[], pagination }` وكل مادة:',
              '`id` · `name` · `description` · `image` · `category_id` · `category_name` ·',
              '`unit_type` · `unit_label` · `pricing: { individual, company, factory, free_facility, currency }` ·',
              '`has_offer` · `offer_price` · `discount_percentage` · `created_at`.',
              '',
              '`pricing.individual` هو سعر المواطن. (`condition_prices` تظهر لشرائح',
              'المصانع والمنشآت الحرّة وحدها لأنها تشتري بالدرجة.)',
              '',
              '**من**: `products` ⋈ `waste_categories` ⋈ `product_pricing` ⋈ `offers`',
              '(+ `measurement_units` و`material_conditions` للتسميات).',
              '',
              '**والمادة داخل تصنيف مُعطَّل مُعطَّلة**: كان هذا ناقصاً، فكان تعطيل التصنيف',
              'يخفي العنوان وتبقى مواده تُعرَض وتُباع.',
            ),
          },
        ),
        req('⚖️ الوحدات', 'GET', 'api/v1/waste/units', {
          description: d(
            '**يرجع** الوحدات النشِطة وتسمياتها — تُملأ بها قائمة `unit_type` في السلّة والاقتراح.',
            '',
            '**من**: `measurement_units`.',
          ),
        }),
        req('🏷️ درجات مادة', 'GET', 'api/v1/waste/products/{{productId}}/conditions', {
          description: d(
            '**يرجع** درجات هذه المادة (ممتازة/جيدة…) بترتيبها.',
            '',
            '**والدرجات ملك المادة**: نفس الكود يعني شيئاً مختلفاً لمادتين مختلفتين،',
            'و**المادة بلا درجات أمر طبيعي** فيرجع مصفوفة فارغة — ليست خطأ.',
            '',
            '**من**: `material_conditions` بـ `product_id`.',
            '',
            'ℹ️ المواطن يشتري بلا درجة (شريحته مسعّرة بسعر واحد)، والراوت مفيد للعرض.',
          ),
        }),
        req('⭐ الأكثر طلباً', 'GET', 'api/v1/waste/most-ordered?limit=10', {
          description: d(
            '**الصلاحية**: `waste.products.popular`.',
            '',
            '**يأخذ**: `limit` (افتراضي ١٠).',
            '',
            '**يرجع**: المواد الأكثر طلباً، مُرتَّبة عالمياً ثم **مُصفّاة لما يستطيع',
            'المُنادي شراءه فعلاً** — الترتيب من الجميع والقائمة له.',
            '',
            '**من**: `order_part_lines` (تجميع) ⋈ `products` ⋈ `product_pricing`.',
          ),
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '7️⃣ البحث والفلترة بالسعر',
      item: [
        req('🔍 بحث', 'GET', 'api/v1/waste/search?query=بلاستيك&type=all&page=1&limit=10', {
          description: d(
            '**يأخذ**: `query` (مطلوب) · `type` (`all` | `product` | `category`) · `page` · `limit`.',
            '',
            '**يرجع**: تصنيفات و/أو مواد حسب `type`، بنفس أشكالها أعلاه، مع `pagination`.',
            '',
            '**من**: `products` و`waste_categories` بـ `ILIKE`، والمطابقات التي **تبدأ**',
            'بالنص أولاً. والتسعير يُطبَّق كما في القائمة العادية.',
          ),
        }),
        req('💰 مواد ضمن نطاق سعر', 'GET', 'api/v1/waste/products/by-price?min_price=0&max_price=50&page=1&limit=10', {
          description: d(
            '**يأخذ**: `min_price` و`max_price` — **كلاهما مطلوب** · `page` · `limit`.',
            '',
            '**يرجع**: `{ products[], pagination }` مرتَّبة تصاعدياً بالسعر.',
            '',
            '**النطاق يُقارَن بسعر شريحة المُنادي وحدها** داخل `EXISTS` في SQL،',
            'فلا يُفلتَر بعد جلب الصفحة — وإلا لأعاد العدّ رقماً لا يمكن للقارئ الوصول إليه بالتصفّح.',
            '',
            '**من**: `products` + `product_pricing`.',
          ),
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '8️⃣ العروض',
      item: [
        req('🎁 العروض', 'GET', 'api/v1/waste/offers?page=1&limit=10&active_only=true&sort=discount', {
          description: d(
            '**الصلاحية**: `waste.offers.view`.',
            '',
            '**يأخذ**: `page` · `limit` · `active_only` (افتراضي `true`) · `sort` (`discount` | `created_at`).',
            '',
            '**يرجع**: `{ offers[], pagination }` وكل عرض:',
            '`offer_id` · `product_id` · `product_name` · `audience` · `amount` ·',
            '`direction` (`INCREASE` للبائع / `DECREASE` للمشتري) · `discount_percentage` ·',
            '`base_price` · `offer_price` (محسوبان لشريحة القارئ) · `condition` ·',
            '`valid_from` · `valid_until`.',
            '',
            '`amount` **مقدار لا سعراً**: `offer_price` = سعر شريحتك ∓ المقدار حسب الاتجاه.',
            '',
            '**من**: `offers` ⋈ `products`، مُقيَّداً بـ **جمهور القارئ** (مشترٍ يرى عروض',
            'المشترين فقط) وبأدواره — فلا يُطبَّق عرض بائع كزيادة على سعر مشترٍ أبداً.',
          ),
        }),
        req('🔍 بحث في العروض', 'GET', 'api/v1/waste/offers/search?query=بلاستيك&category_id=&page=1&limit=10', {
          description: '**يأخذ**: `query` (مطلوب) · `category_id` اختياري · `page` · `limit`. نفس شكل الردّ أعلاه.',
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '9️⃣ السلة',
      description: d(
        '**السلّة تُعيد تسعير نفسها**: `unit_price` و`subtotal` يُكتبان على الصفّ',
        'وقت الإضافة، ويُحدَّثان إن غيّر الأدمن السعر — فالرقم الذي يُحاسَب عليه',
        'المشتري وقت الدفع هو الرقم النافذ فعلاً لا رقمٌ تجمّد قبل أسبوع.',
        '',
        '**حدود المواطن**: الحد الأدنى **١** وحدة، والسقف اليومي **١٠٠** وحدة.',
        '(المؤسسات ١٠ بلا سقف · المصانع والمنشآت الحرّة ٥٠ بلا سقف.)',
      ),
      item: [
        req('🛒 سلّتي', 'GET', 'api/v1/cart', {
          description: d(
            '**الصلاحية**: `cart.view`. وتُنشَأ السلّة تلقائياً إن لم تكن موجودة.',
            '',
            '**يرجع**: `{ message, result: { cart_id, items[], summary } }`',
            '',
            'كل بند: `item_id` · `product_id` · `product_name` · `product_image` ·',
            '`quantity` · `unit_type` · `condition` · `unit_price` · `subtotal` · `is_offer`.',
            '',
            '`summary`: `total_items` · `total_weight` (مجموع البنود ذات الوحدات الوزنية فقط) ·',
            '`subtotal` · `discount` · `tax` · `total` · `currency` ·',
            '`meets_minimum` · `minimum_required` · `daily_limit` · `can_checkout`.',
            '',
            '**من**: `carts` ⋈ `cart_items` ⋈ `products` (+ `measurement_units` لمعرفة أيّ الوحدات وزنية).',
          ),
        }),
        req('➕ إضافة مادة', 'POST', 'api/v1/cart/items', {
          body: {
            product_id: '{{productId}}',
            quantity: 5,
            unit_type: 'KG',
            add_offer: false,
          },
          description: d(
            '**الصلاحية**: `cart.manage`.',
            '',
            '**يأخذ**:',
            '- `product_id` — UUID.',
            '- `quantity` — ≥ 0.001.',
            '- `unit_type` — رمز الوحدة، **يُحوَّل إلى أحرف كبيرة تلقائياً** فـ`kg` و`KG` يصلان لنفس الصفّ.',
            '- `condition` — **مطلوب لشرائح المصانع والمنشآت الحرّة** على المواد المُدرَّجة، ولا يلزم المواطن.',
            '- `add_offer` — اختياري ومهمّته الحالة: يثبّت الحالة التي يسمّيها العرض.',
            '  أمّا **السعر فيُطبَّق عرضُ المادة الحيّ تلقائياً** سواءٌ رُفع أو لا — العرض',
            '  هو سعر المادة لدورك الآن، لا إضافةٌ اختيارية.',
            '',
            '**يرجع**: السلّة كاملة بعد الإضافة.',
            '',
            '**يكتب**: صفّاً في `cart_items` وفيه `unit_price` **من السعر الفعّال**',
            '(سعر شريحتك ∓ مقدار العرض الحيّ) عبر نفس المُوحِّد الذي يستخدمه الكتالوج والدفع.',
            'والسعر المفقود **يُرفض** لا يُصفَّر: مادة بلا سعر لهذه الشريحة مادةٌ لم يكن يُفترض',
            'أن يراها أصلاً.',
          ),
        }),
        req('✏️ تعديل كمية بند', 'PUT', 'api/v1/cart/items/{{itemId}}', {
          body: { quantity: 8, unit_type: 'KG' },
          description: d(
            '**يأخذ**: `quantity` (≥0.001) · `unit_type` اختياري.',
            '',
            '**يتحقّق** أن البند يخصّ سلّة المُنادي — وإلا 403.',
            '',
            '**يكتب**: `cart_items` (الكمية و`subtotal` المعاد حسابه).',
          ),
        }),
        req('🗑️ حذف بند', 'DELETE', 'api/v1/cart/items/{{itemId}}', {
          description: '**يحذف** الصفّ من `cart_items` بعد التحقّق من الملكية.',
        }),
        req('🎁 إضافة عرض', 'POST', 'api/v1/cart/offers', {
          body: { offer_id: '{{offerId}}', quantity: 5, unit_type: 'KG' },
          description: d(
            '**يأخذ**: `offer_id` · `quantity` · `unit_type`.',
            '',
            '**يكتب** بنداً في `cart_items` بـ `is_offer = true` وسعره **السعر الفعّال**',
            '(سعر شريحتك ∓ مقدار العرض) بعد التأكّد أن العرض **نافذ الآن** و**موجَّه لدورك**.',
          ),
        }),
        req('🧹 تفريغ السلّة', 'DELETE', 'api/v1/cart', {
          description: '**يحذف كل** بنود `cart_items` لهذه السلّة، ويُبقي صفّ `carts` نفسه.',
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '🔟 الطلبات',
      description: d(
        '**الطلب قد ينقسم**: إن لم يكفِ مستودع واحد، يُقسَّم إلى **أجزاء**',
        '(`order_parts`) كل جزء من مستودع. لذلك التفاصيل والتقييم والشكوى **بالجزء**',
        'لا بالطلب — في طلب مقسوم قد يكون مستودعٌ ممتازاً وآخر سيّئاً، ودرجةٌ واحدة',
        'للطلب كلّه لا تحمّل أحداً شيئاً.',
      ),
      item: [
        req('🧾 إنشاء طلب (Checkout)', 'POST', 'api/v1/orders/checkout', {
          body: { accept_partial_fulfilment: true },
          description: d(
            '**يأخذ** (كلاهما اختياري):',
            '- `fulfilment_mode` — `DELIVERY` أو `PICKUP`. **للمصانع وحدها** حقّ التوصيل؛',
            '  ومن سواها يُحوَّل الطلب إلى `PICKUP` **بلا خطأ** — إفشال طلب بسبب حقل',
            '  قد لا يكون المستخدم رآه أصلاً عدوانية بلا سبب.',
            '- `accept_partial_fulfilment` — جواب المشتري **مسبقاً** عن «هل أشحن المتوفّر',
            '  إن نقص القليل؟». يُسأل مرّة هنا فلا يُحلّ النقص لاحقاً بالتخمين ولا يكون الشحن الناقص مفاجأة.',
            '',
            '**يرجع**: `{ message, order_id, order_number, status, goods_total, currency,',
            'fulfilment_mode, delivery_available, allocation }`.',
            '',
            '**الشروط** — يُرفض بـ 400 إذا:',
            '- لا محافظة على الحساب (المستودعات تُطابَق بها) — أضف عنواناً أولاً.',
            '- السلّة فارغة.',
            '- القيمة دون الحد الأدنى لدورك (يذكر الردّ كم ينقص).',
            '',
            '**يقرأ**: `carts` · `cart_items` · `order_minimums` · `warehouses` · `warehouse_inventory`.',
            '**يكتب**: `orders` ثم `order_parts` و`order_part_lines` من التوزيع،',
            'و**يفرّغ `cart_items`**.',
            '',
            'والسلّة تُفرَّغ **بعد** إنشاء الطلب لا قبله: انهيارٌ بين الخطوتين يجب أن',
            'يُضيّع الطلب لا سلّة المشتري.',
          ),
        }),
        req('📋 طلباتي', 'GET', 'api/v1/orders?page=1&limit=10', {
          description: d(
            '**يرجع**: `{ message, orders[], pagination }` وكل طلب:',
            '`order_id` · `order_number` · `status` · `fulfilment_mode` ·',
            '`goods_total` · `delivery_total` · `grand_total` · `currency` ·',
            '`warehouse_count` · `is_split` · `created_at`.',
            '',
            '`is_split` في القائمة نفسها ليعرف المشتري من أول نظرة أن طلبه من أكثر من مكان.',
            '',
            '**من**: `orders` (بـ `buyer_account_id`) + عدّ `order_parts` الحيّة.',
          ),
        }),
        req('🔎 تفاصيل طلب', 'GET', 'api/v1/orders/{{orderId}}', {
          description: d(
            '**يرجع**: `{ message, order }` وفيه:',
            '`order_id` · `order_number` · `status` · `fulfilment_mode` ·',
            '`goods_total` · `delivery_total` (صفر إن لم يكن توصيلاً) · `grand_total` ·',
            '`is_split` · `can_cancel` · `can_confirm_receipt` ·',
            '`placed_at` · `preparing_at` · `delivered_at` · `completed_at` · `parts[]`.',
            '',
            'وكل **جزء**: `part_id` · `sequence` · `of` (٢ من ٣) · `status` ·',
            '`warehouse: { id, name, address, latitude, longitude }` — العنوان لأن',
            'طلب الاستلام يحتاج أن يعرف المشتري **إلى أين يذهب** — ·',
            '`distance_km` · `delivery_cost` · `goods_total` · `invoice_number` ·',
            '`output_zone` · `prepared_at` · `dispatched_at` · `delivered_at` ·',
            '`can_rate` · `lines[]`.',
            '',
            '**404 لطلب غيرك** — لا 403: الردّ المختلف يؤكّد أن معرّف طلب شخص آخر حقيقي.',
            '',
            '**من**: `orders` · `order_parts` ⋈ `warehouses` · `order_part_lines` · `order_part_ratings`.',
          ),
        }),
        req('❌ إلغاء طلب', 'POST', 'api/v1/orders/{{orderId}}/cancel', {
          body: { reason: 'غيّرت رأيي' },
          description: d(
            '**يأخذ**: `reason` اختياري (≤400).',
            '',
            '**متى يُسمح**: قبل `PREPARING` فقط — بعدها غادرت البضاعة الرفّ وصارت الفاتورة موجودة.',
            'الحالات المسموحة: `PENDING_ALLOCATION` · `AWAITING_APPROVAL` ·',
            '`NEEDS_CUSTOMER_DECISION` · `NEEDS_ADMIN`.',
            '',
            '**409** إن كان التحضير قد بدأ — وهو بالضبط ما يحتاج أن يُقال لمن ضغط',
            'إلغاء في اللحظة التي وافق فيها آخر مدير.',
            '',
            '**يكتب** داخل معاملة واحدة مع **قفل** على صفّ الطلب:',
            '`orders.status` و`order_parts`، ويحرّر الحجز في `warehouse_inventory`.',
          ),
        }),
        req('✅ تأكيد الاستلام', 'POST', 'api/v1/orders/{{orderId}}/confirm-receipt', {
          description: d(
            'لا بودي.',
            '',
            '**يُسمح** فقط والطلب `DELIVERED` — وإلا 409.',
            '',
            '**الكلمة الأخيرة للمشتري عمداً**: كل مدير مستودع يؤكّد أن جزءه خرج،',
            'ووحده المشتري يقول إنه وصل. نظامٌ يُغلق الطلب بشهادة البائع لا يملك أثراً',
            'للواقعة الوحيدة التي تهمّ من دفع.',
            '',
            '**يرجع**: `{ message, order_id, status: COMPLETED, grand_total, currency }`.',
            '**يكتب**: `orders.status` و`completed_at`.',
          ),
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '1️⃣1️⃣ بعد الاستلام — تقييم وشكوى',
      item: [
        req('⭐ تقييم جزء', 'POST', 'api/v1/orders/parts/{{partId}}/rating', {
          body: { stars: 5, note: 'خدمة ممتازة' },
          description: d(
            '**يأخذ**: `stars` — عدد صحيح **١..٥** · `note` اختياري (≤1000).',
            '',
            '**بالجزء لا بالطلب**: في طلب مقسوم قد يكون مستودعٌ ممتازاً وآخر سيّئاً.',
            '',
            '**409** إن لم يكن الجزء `DELIVERED` بعد.',
            '',
            '**التقييم واحد لكل جزء**: إعادة التقييم **تستبدل** الحكم السابق ولا تضيف ثانياً.',
            '',
            '**يكتب**: `order_part_ratings` (صفّ واحد لكل `part_id`).',
          ),
        }),
        req('⚠️ شكوى على جزء', 'POST', 'api/v1/orders/parts/{{partId}}/complaints', {
          body: {
            kind: 'SHORTAGE',
            description: 'وصل ٤٥ كغ بدل ٥٠',
            claimed_shortfall: 5,
          },
          description: d(
            '**يأخذ**:',
            '- `kind` — `SHORTAGE` · `QUALITY` · `DELIVERY` · `BILLING` · `OTHER`.',
            '- `description` — مطلوب (≤2000).',
            '- `claimed_shortfall` — كم نقص، اختياري: يجعل النقص قابلاً للمطابقة مع سجلّ أودو.',
            '',
            '**النوع يقرّر من يردّ**، وهذا ليس ورقيات:',
            '- `SHORTAGE` و`QUALITY` → **المستودع**، لأن الدليل هناك: سجلّ حركة المناطق',
            '  في أودو يقول ما خرج فعلاً ومن أيّ منطقة وبيد من ومتى.',
            '- `DELIVERY` و`BILLING` و`OTHER` → **الأدمن**، فليستا من فعل المستودع.',
            '',
            'أرسِل أيّهما إلى المكتب الخطأ فمن يقرأها لا دليل عنده ليقرّر، فتتحوّل إلى تبادل ادّعاءات.',
            '',
            '**409** قبل التسليم.',
            '',
            '**يرجع**: `{ message, complaint_id, routed_to }`.',
            '**يكتب**: `order_complaints` — والوجهة **تُخزَّن** لا تُشتقّ عند القراءة،',
            'فتغيير قواعد التوجيه لاحقاً لا ينقل شكاوى قيد المعالجة بصمت.',
          ),
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '1️⃣2️⃣ الإشعارات',
      description: 'تعمل **بنسخة وبلا نسخة**: `/api/notifications/...` و`/api/v1/notifications/...`.',
      item: [
        req(
          '🔔 إشعاراتي',
          'GET',
          'api/v1/notifications?page=1&limit=20&unreadOnly=false&type=&status=&sortBy=createdAt&order=DESC',
          {
            description: d(
              '**يأخذ**: `page` · `limit` (≤100) · `unreadOnly` · ',
              '`type` (`GENERAL` | `ORDER` | `RECYCLING_REQUEST` | `WAREHOUSE` | `DRIVER` | `TRUCK` | `ODOO`) ·',
              '`status` (`PENDING` | `SENT` | `FAILED`) ·',
              '`sortBy` (`createdAt` | `sentAt` | `readAt` | `updatedAt`) · `order`.',
              '',
              '**يرجع**: `{ items[], total, page, limit }`.',
              '',
              '**من**: `notifications` بـ `user_id`، **مستثنياً المحذوفة** (`deleted_at IS NULL`).',
            ),
          },
        ),
        req('🔴 عدد غير المقروء', 'GET', 'api/v1/notifications/unread-count', {
          description: '**يرجع** رقماً. للنقطة الحمراء على الأيقونة. **من**: `notifications` (`is_read = false`).',
        }),
        req('🔎 إشعار واحد', 'GET', 'api/v1/notifications/{{notificationId}}', {
          description: '**يتحقّق** أنه يخصّ المُنادي قبل الإرجاع.',
        }),
        req('✅ تعليم كمقروء', 'PATCH', 'api/v1/notifications/{{notificationId}}/read', {
          description: '**يكتب** `is_read` و`read_at` في `notifications`.',
        }),
        req('✅ تعليم الكل كمقروء', 'PATCH', 'api/v1/notifications/read-all', {
          description: '**يكتب** على كل إشعارات المُنادي غير المقروءة.',
        }),
        req('🗑️ حذف إشعار', 'DELETE', 'api/v1/notifications/{{notificationId}}', {
          description: '**حذف ناعم**: يضبط `deleted_at` ولا يمحو الصفّ.',
        }),
        req('🧹 حذف الكل', 'DELETE', 'api/v1/notifications/clear-all', {
          description: '**حذف ناعم** لكل إشعارات المُنادي.',
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '1️⃣2️⃣.5 المفضلة',
      description: d(
        'قائمة المواد المختصرة للمشتري. **راوتات واحدة للأدوار الأربعة** —',
        'المواطن والمؤسسة والمصنع والجهة الحرّة — لأنه الفعل نفسه لكلٍّ منهم،',
        'والسعر المعروض يُحسب من **شريحة المُنادي**: فالدور يغيّر الأرقام دون أن يغيّر الراوت.',
        '',
        'مربوطة بـ **الحساب** لا بالبروفايل: البروفايل أوراق دورٍ واحد والمواطن يكاد لا',
        'يملك واحداً، أما الحساب فيملكه كل مشترٍ وهو ما يحمله التوكن — ففحص الملكية',
        'مقارنةٌ بالمعرّف المسجَّل دخوله لا انضمام (join).',
      ),
      item: [
        req('⭐ مفضّلتي', 'GET', 'api/v1/favourites?page=1&limit=20', {
          description: d(
            '**يرجع**: `{ favourites[], pagination }` وكل عنصر:',
            '`favourite_id` · `product_id` · `product_name` · `product_image` ·',
            '`category_id` · `category_name` · `unit: { id, code }` · `price` ·',
            '`available` · `note` · `added_at`.',
            '',
            '**السعر بشريحتك أنت**. والمادة التي سُحب سعرها لشريحتك **تبقى** في القائمة',
            'بـ `price: null` و`available: false` — إسقاطها بصمت أسوأ: المشتري وضعها',
            'عمداً، و«اختفت» ليس شيئاً يستطيع التصرّف بناءً عليه، بخلاف «غير مسعّرة لك حالياً».',
            '',
            '**من**: `favourites` ⋈ `products` ⋈ `waste_categories` + `product_pricing`.',
          ),
        }),
        req('➕ إضافة إلى المفضلة', 'POST', 'api/v1/favourites', {
          body: { product_id: '{{productId}}', note: 'الدرجة التي يأخذها خط حلب' },
          description: d(
            '**يأخذ**: `product_id` (UUID) · `note` اختيارية (≤500).',
            '',
            '**409** إن كانت المادة في المفضلة بالفعل، ومعه `favourite_id` الموجود —',
            'الإضافة **مُتكرِّرة الاستدعاء بطبيعتها**: ضغط القلب مرتين على اتصال بطيء',
            'يجب أن يترك صفّاً واحداً، والعدّاد على الشاشة لا يعتمد على كم مرة ضُغط الزر',
            'وهو يبدو غير مستجيب. (فهرس فريد على `(account_id, product_id)`.)',
            '',
            '**404** لمادة غير موجودة **أو مُعطَّلة**: المفضلة اختصارٌ إلى شيء يمكن شراؤه،',
            'والاختصار إلى لا شيء أسوأ من غياب الاختصار.',
          ),
        }),
        req('✏️ تعديل ملاحظة', 'PATCH', 'api/v1/favourites/{{favouriteId}}', {
          body: { note: 'اطلبها مكبوسة' },
          description: d(
            '**يأخذ**: `note` (≤500). والنصّ الفارغ **يمسحها** لا يخزّنها `""`.',
            '',
            '**الملاحظة هي ما يعنيه «التعديل» هنا**: المادة نفسها لا تتغيّر — مفضلة تشير',
            'إلى مادة أخرى هي مفضلة أخرى — فبدون الملاحظة لا يكون للتعديل ما يعدّله.',
            '',
            '**404** لعنصر يخصّ مشترياً آخر (لا 403: الردّ المختلف يؤكّد أن المعرّف حقيقي).',
          ),
        }),
        req('🗑️ حذف من المفضلة', 'DELETE', 'api/v1/favourites/{{favouriteId}}', {
          description: '**404** لعنصر ليس لك. **يحذف** الصفّ من `favourites`.',
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '1️⃣3️⃣ اقتراح مادة',
      item: [
        req('💡 اقتراح مادة جديدة', 'POST', 'api/v1/waste/products/suggest', {
          body: {
            product_name: 'أغطية زجاجات',
            description: 'بولي بروبيلين ملوّن',
            category_id: '{{categoryId}}',
            unit_type: 'KG',
            estimated_price: 3.5,
            additional_info: 'تتوفر بكميات أسبوعية',
          },
          description: d(
            '**الصلاحية**: `waste.products.suggest`.',
            '**محدود المعدّل**: ١٠ طلبات في الدقيقة.',
            '',
            '**يأخذ**:',
            '- `product_name` — مطلوب (≤255) · `category_id` — UUID مطلوب.',
            '- `unit_type` — رمز وحدة **نشِط** (يُتحقَّق منه، ويُحوَّل لأحرف كبيرة).',
            '- `description` · `estimated_price` · `image` · `additional_info` — اختيارية.',
            '  (`additional_info` تُضمّ إلى `description` في صفّ واحد.)',
            '',
            '**يرجع**: `{ suggestion_id, status: PENDING_REVIEW, created_at, message }`.',
            '',
            '**يكتب**: `product_suggestions` + صفّاً في `audit_logs` يحمل **دور المقترِح**،',
            'ويُشعِر الأدمن.',
            '',
            'والقبول **لا يُنشئ مادة**: يسجّل القرار ويُشعر المقترِح — لأن المادة الموجودة',
            'والمسعّرة لأحد غير مرئية لأي مشترٍ، فـ«أُنشئت» ليست «صارت تُباع».',
          ),
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '1️⃣4️⃣ الصور (Media)',
      description: 'تعمل **بنسخة وبلا نسخة** مثل الإشعارات. الرفع `multipart/form-data` لا JSON.',
      item: [
        req('🖼️ صورة بالمعرّف', 'GET', 'api/v1/media/{{mediaId}}', {
          description: '**يرجع** صفّ `media`: الرابط والحالة والمالك.',
        }),
        req('🖼️ صور مالك', 'GET', 'api/v1/media/owner/{{accountId}}', {
          description: '**من**: `media` بـ `owner_id`.',
        }),
        req('♻️ استبدال صورة', 'PUT', 'api/v1/media/{{mediaId}}', {
          form: [
            { key: 'file', type: 'file', src: [] },
            { key: 'oldPublicId', value: 'accounts/uuid/PROFILE/1700000000', type: 'text' },
          ],
          description: d(
            '`multipart/form-data`:',
            '- `file` — الصورة الجديدة (مطلوب).',
            '- `oldPublicId` — معرّف Cloudinary للقديمة (مطلوب) لتُحذف بعد نجاح الرفع.',
            '',
            '**الترتيب مقصود**: يُرفع الجديد أولاً، ثم يُحدَّث `media`، ثم يُحذف القديم —',
            'وحذفُ القديم غير حرج، فلو فشل بقيت صورة يتيمة على Cloudinary ولم يخسر المستخدم صورته.',
          ),
        }),
        req('🔁 إعادة رفع صورة مرفوضة', 'PATCH', 'api/v1/media/{{mediaId}}/reupload', {
          form: [{ key: 'file', type: 'file', src: [] }],
          description: d(
            'للمالك وحده، و**فقط** إن كانت حالة الصورة `REJECTED`.',
            '',
            '**يكتب**: `media.status = PENDING` ويعيد الحساب إلى `PENDING_APPROVAL` في `accounts`.',
          ),
        }),
        req('🗑️ حذف صورة', 'DELETE', 'api/v1/media/{{mediaId}}', {
          description: '**يحذف** من `media` ومن Cloudinary.',
        }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════
    {
      name: '1️⃣5️⃣ محتوى ثابت (بلا توكن)',
      item: [
        req('ℹ️ من نحن', 'GET', 'api/v1/content/about', {
          auth: false,
          description: d(
            '**يرجع**: `{ message, result: { title, body, last_updated } }`.',
            '',
            '**ليس من قاعدة البيانات**: النصوص في قواميس الترجمة',
            '`src/i18n/{ar,en}/translation.json` تحت `content.*`، وتُخدَم بلغة الطلب',
            '(ترويسة `x-lang`) وتُعدَّل بلا تعديل كود.',
          ),
        }),
        req('📜 شروط الاستخدام', 'GET', 'api/v1/content/terms', {
          auth: false,
          description: 'نفس الشكل. تُعرَض قبل التسجيل، ولذلك بلا توكن.',
        }),
      ],
    },
  ],
};

fs.writeFileSync(TARGET, JSON.stringify(collection, null, 2) + '\n', 'utf8');
const count = collection.item.reduce((n, g) => n + g.item.length, 0);
console.log(`wrote ${count} requests in ${collection.item.length} folders`);
