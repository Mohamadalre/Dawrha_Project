/**
 * Rebuilds postman/Dawrha.admin.postman_collection.json from the routes that
 * actually exist today.
 *
 * Written as a script rather than edited by hand because the collection had
 * drifted: it still listed the global condition routes that were removed when
 * grades became per-material, and listed none of the pricing-table, inventory
 * or suggestion routes added since. A hand-edited collection drifts again by
 * the next change; a generated one is re-runnable.
 */
const fs = require('fs');
const path = require('path');

const TARGET =
  process.argv[2] ||
  path.join(__dirname, 'Dawrha.admin.postman_collection.json');

let seq = 0;
const req = (name, method, rawPath, { body, description, query } = {}) => {
  const clean = rawPath.replace(/^\//, '');
  const [pathPart, queryPart] = clean.split('?');
  const item = {
    name,
    id: `adm${++seq}`,
    request: {
      method,
      header: body
        ? [{ key: 'Content-Type', value: 'application/json' }]
        : [],
      ...(description ? { description } : {}),
      url: {
        // Host and port are separate variables so one environment can point at
        // localhost:3000 and another at a staging host on 443 without editing
        // every request — a single joined URL makes the port part of the host
        // string, and changing it means find-and-replace across the file.
        raw: `{{server}}:{{port}}/${clean}`,
        host: ['{{server}}'],
        port: '{{port}}',
        path: pathPart.split('/'),
        ...(queryPart
          ? {
              query: queryPart.split('&').map((kv) => {
                const [key, value] = kv.split('=');
                return { key, value };
              }),
            }
          : {}),
      },
      auth: {
        type: 'bearer',
        bearer: [{ key: 'token', value: '{{adminToken}}', type: 'string' }],
      },
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
  return item;
};

/** A webhook request: secret header instead of the admin bearer token. */
const hook = (name, rawPath, body, description) => {
  const item = req(name, 'POST', rawPath, { body: body ?? {}, description });
  item.request.header = [
    { key: 'Content-Type', value: 'application/json' },
    { key: 'x-odoo-webhook-secret', value: '{{odooWebhookSecret}}' },
  ];
  delete item.request.auth;
  return item;
};

const collection = {
  info: {
    name: 'Dawrha — Admin (لوحة الأدمن)',
    _postman_id: 'dawrha-admin-1785500000000',
    description: [
      'راوتات الأدمن مرتّبة **بترتيب التشغيل الفعلي**: جهّز المرجعيات أولاً',
      '(وحدات → محافظات → تصنيفات → منتجات → حالات المنتج → تسعير → عروض)،',
      'ثم المستودعات والمخزون، ثم المراجعات.',
      '',
      '⚠️ **تغيير مهم:** حالات المادة صارت **تابعة للمنتج** لا عامة.',
      'راوتات `/admin/waste/conditions` القديمة لم تعد موجودة —',
      'استُبدلت بـ `/admin/waste/products/{{productId}}/conditions`.',
      '',
      '⚠️ **وتغيير ثانٍ:** المنتج لا يُضاف من أودو بعد الآن، بل يُقترَح.',
      'الاقتراحات (من التطبيق ومن أودو) تُراجَع في قسم «الاقتراحات».',
      'وقبول الاقتراح **شكليّ**: يسجّل القرار ويُشعر المقترِح ولا يُنشئ مادة.',
      '',
      'كل راوتات الأدمن تتطلب {{adminToken}}.',
      'راوتات أودو تتطلب هيدر x-odoo-webhook-secret لا التوكن.',
      '',
      '⚙️ = الراوت يُزامَن مع أودو.',
    ].join('\n'),
    schema:
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'server', value: 'http://localhost' },
    { key: 'port', value: '3000' },
    { key: 'adminToken', value: '' },
    { key: 'odooWebhookSecret', value: '' },
    { key: 'categoryId', value: '' },
    { key: 'productId', value: '' },
    { key: 'conditionId', value: '' },
    { key: 'pricingId', value: '' },
    { key: 'offerId', value: '' },
    { key: 'unitId', value: '' },
    { key: 'citizenToken', value: '' },
    { key: 'institutionToken', value: '' },
    { key: 'factoryToken', value: '' },
    { key: 'externalToken', value: '' },
    { key: 'favouriteId', value: '' },
    { key: 'provinceId', value: '' },
    { key: 'warehouseId', value: '' },
    { key: 'suggestionId', value: '' },
    { key: 'profileId', value: '' },
    { key: 'accountId', value: '' },
    { key: 'mediaId', value: '' },
    { key: 'requestId', value: '' },
    { key: 'truckId', value: '' },
    { key: 'driverId', value: '' },
    { key: 'partId', value: '' },
    { key: 'deliveryRateId', value: '' },
    { key: 'orderId', value: '' },
    { key: 'tripId', value: '' },
    { key: 'stopId', value: '' },
    { key: 'odooDriverId', value: '' },
  ],
  item: [
    {
      name: '0️⃣ الدخول',
      item: [
        req('🔑 تسجيل دخول الأدمن', 'POST', 'api/v1/auth/login/admin', {
          body: { email: 'admin@dawrha.com', password: 'Admin@123' },
          description:
            'انسخ التوكن من الرد إلى المتغيّر adminToken — كل ما بعده يعتمد عليه.',
        }),
      ],
    },
    {
      name: '1️⃣ التقارير',
      item: [
        req('📊 نظرة عامة', 'GET', 'api/v1/admin/reports/overview'),
        req('👥 الحسابات', 'GET', 'api/v1/admin/reports/accounts'),
        req('🏭 المستودعات', 'GET', 'api/v1/admin/reports/warehouses'),
        req('🚚 الشاحنات', 'GET', 'api/v1/admin/reports/trucks'),
        req('🧑‍✈️ السائقون', 'GET', 'api/v1/admin/reports/drivers'),
        req('📦 الكتالوج', 'GET', 'api/v1/admin/reports/catalog'),
      ],
    },
    {
      name: '2️⃣ المرجعيات — وحدات القياس ⚙️',
      item: [
        req('📄 عرض الوحدات', 'GET', 'api/v1/admin/waste/units'),
        req('➕ إضافة وحدة ⚙️', 'POST', 'api/v1/admin/waste/units', {
          body: {
            code: 'KG',
            name_en: 'Kilogram',
            name_ar: 'كيلوغرام',
            is_weight: true,
            allows_tolerance: true,
          },
          description:
            'الوحدة تُدفَع إلى أودو: المادة هناك لا تُقاس إلا بوحدة يعرّفها الباك ايند.',
        }),
        req('✏️ تعديل وحدة ⚙️', 'PUT', 'api/v1/admin/waste/units/{{unitId}}', {
          body: { name_ar: 'كغم', is_active: true },
        }),
        req('🗑️ حذف وحدة ⚙️', 'DELETE', 'api/v1/admin/waste/units/{{unitId}}'),
      ],
    },
    {
      name: '3️⃣ المرجعيات — المحافظات ⚙️',
      item: [
        req('📄 عرض المحافظات (بجينيشن)', 'GET',
            'api/v1/admin/provinces?page=1&limit=20&search=', {
          description:
            'قائمة الأدمن — **مصفَّحة وقابلة للبحث**، وغير قائمة التسجيل العامة ' +
            '`GET /onboarding/provinces` التي تُرجع كل الصفوف بلا تصفيح ' +
            '(قائمة منسدلة تصل نصف ممتلئة لا يمكن استخدامها).\\n\\n' +
            '`search` يطابق **الاسمين** العربي والإنجليزي: الأدمن يكتب ما يراه على شاشته، ' +
            'وأيّ لغة هي ذلك يعتمد على ضبط التطبيق عنده.',
        }),
        req('➕ إضافة محافظة ⚙️', 'POST', 'api/v1/admin/provinces', {
          body: { name_ar: 'دمشق', name_en: 'Damascus', is_active: true },
        }),
        req('✏️ تعديل محافظة ⚙️', 'PATCH', 'api/v1/admin/provinces/{{provinceId}}', {
          body: { name_en: 'Damascus City' },
        }),
        req('🗑️ حذف محافظة ⚙️', 'DELETE', 'api/v1/admin/provinces/{{provinceId}}', {
          description:
            'يُرفَض الحذف إن كان مرتبطاً بها **أي شيء** (مستودع، معمل، جهة حرّة، تعرفة توصيل) — والرد يسمّي ما يمنعه.',
        }),
      ],
    },
    {
      name: '4️⃣ الكتالوج — التصنيفات ⚙️',
      item: [
        req('📄 عرض التصنيفات', 'GET', 'api/v1/admin/waste/categories?status=all&page=1&limit=10'),
        req('➕ إضافة تصنيف ⚙️', 'POST', 'api/v1/admin/waste/categories', {
          body: { name: 'بلاستيك', description: 'مواد بلاستيكية', is_active: true },
        }),
        req('✏️ تعديل تصنيف ⚙️', 'PUT', 'api/v1/admin/waste/categories/{{categoryId}}', {
          body: { name: 'بلاستيك معاد التدوير' },
        }),
        req('🗑️ حذف تصنيف ⚙️', 'DELETE', 'api/v1/admin/waste/categories/{{categoryId}}'),
      ],
    },
    {
      name: '5️⃣ الكتالوج — المنتجات ⚙️',
      item: [
        req('📄 عرض المنتجات', 'GET', 'api/v1/admin/waste/products?status=all&page=1&limit=10'),
        req('➕ إضافة منتج ⚙️', 'POST', 'api/v1/admin/waste/products', {
          body: {
            name: 'زجاجات PET',
            description: 'زجاجات بلاستيكية شفافة',
            category_id: '{{categoryId}}',
            unit_id: '{{unitId}}',
            is_active: true,
          },
          description:
            'المنتج يُنشأ **من هنا فقط**. أودو لم يعد يُنشئ مواد — يقترحها (انظر قسم الاقتراحات).\n\n' +
            '**وحدة القياس تُرسَل بالـid** `unit_id` تماماً مثل `category_id`، و**هي الطريقة الوحيدة**. ' +
            'الرمز `unit_type` لم يعد يُقبل: الرمز تسميةٌ يمكن إعادة تسميتها وإعادة استخدامها، ' +
            'فمُناديان يرسلان «KG» قد يعنيان صفَّين مختلفين — ووحدةُ المادة تقرّر كيف تُقرأ كل كمية منها.',
        }),
        req('✏️ تعديل منتج ⚙️', 'PUT', 'api/v1/admin/waste/products/{{productId}}', {
          body: { name: 'زجاجات PET شفافة' },
        }),
        req('🗑️ حذف منتج ⚙️', 'DELETE', 'api/v1/admin/waste/products/{{productId}}'),
      ],
    },
    {
      name: '6️⃣ حالات المنتج (تابعة للمنتج) ⚙️',
      item: [
        req('📄 حالات هذا المنتج', 'GET', 'api/v1/admin/waste/products/{{productId}}/conditions', {
          description:
            'الحالات **ملك المادة**: نفس الكود يعني شيئاً مختلفاً لمادتين مختلفتين. ومادة بلا حالات أمر طبيعي.',
        }),
        req('➕ إضافة حالة ⚙️', 'POST', 'api/v1/admin/waste/products/{{productId}}/conditions', {
          body: { code: 'EXCELLENT', name_en: 'Excellent', name_ar: 'ممتازة' },
          description:
            'الترتيب **تلقائي** (آخر ترتيب + 1) ولا يُرسَل في البودي.',
        }),
        req('✏️ تعديل حالة', 'PATCH', 'api/v1/admin/waste/products/{{productId}}/conditions/{{conditionId}}', {
          body: { name_ar: 'ممتازة جداً', is_active: true },
        }),
        req('↕️ تغيير ترتيب حالة', 'PATCH', 'api/v1/admin/waste/products/{{productId}}/conditions/{{conditionId}}/position', {
          body: { position: 1 },
          description:
            'راوت منفصل للترتيب: يضع الحالة في الموضع المطلوب ويزيح البقية، والكل في معاملة واحدة.',
        }),
        req('🗑️ حذف حالة', 'DELETE', 'api/v1/admin/waste/products/{{productId}}/conditions/{{conditionId}}', {
          description:
            'الحالة التي **لا تزال تحمل مخزوناً** لا تُحذف. كانت تُفحص أمام قائمة الأسعار فقط، ' +
            'فكان يمكن حذف حالة ومستودعٌ ممتلئ بموادها بمجرد سحب سعرها — فتبقى مادة حقيقية ' +
            'تحمل اسم حالة لم تعد موجودة. طريق التفريغ هو البيع أو **نقل المخزون إلى حالة أخرى**.',
        }),
        req('🔀 نقل مخزون بين حالتين ⚙️', 'POST',
            'api/v1/admin/waste/products/{{productId}}/conditions/transfer-stock', {
          body: {
            warehouseId: '{{warehouseId}}',
            fromConditionId: '{{conditionId}}',
            toConditionId: '{{conditionId2}}',
            quantity: 50,
            reason: 'إعادة فحص: تبيّن أنها من درجة أعلى',
          },
          description:
            'إعادة الفحص تغيّر الجواب: مادة وصلت بدرجة GOOD تبيّن أنها EXCELLENT. بدون هذا الراوت ' +
            'كان المخرج الوحيد إتلافها وإعادة استلامها — أي اختراع توريد لم يحدث — أو تركها ' +
            'موسومة بدرجة خاطئة ومسعّرة بها.\n\n' +
            '**يأخذ معرّفات الحالات (ids) لا الأكواد**: الكود فريد داخل مادته فقط، فـ«GOOD» ' +
            'تعني شيئاً مختلفاً للورق عنها للنحاس. ويتحقق أن الحالتين تابعتان **لنفس المادة** — ' +
            'النقل بين حالتَي مادتين مختلفتين خطأ يُرد بـ 400.\n\n' +
            '**لا يُنقل إلا غير المحجوز**: الكمية المحجوزة موعودة لطلب لم يُشحن، ونقلها يترك ' +
            'ذلك الطلب مشيراً إلى حالة لم تعد بضاعته فيها، والنقص يظهر وقت الخصم بعد أن قيل ' +
            'للمشتري «نعم». والرد يذكر `reserved_untouched`.\n\n' +
            '**الحالة المصدر لا تُحذف عند تفريغها**: الحالة الفارغة تبقى حالة تُباع بها المادة.',
        }),
      ],
    },
    {
      name: '7️⃣ التسعير ⚙️',
      item: [
        req('📄 التسعيرة الحالية', 'GET', 'api/v1/admin/waste/products/{{productId}}/pricing'),
        req('📄 سعر واحد بالمعرّف + تاريخه', 'GET', 'api/v1/admin/waste/products/pricing/{{pricingId}}', {
          description:
            'يرجع الصف كاملاً ومعه آخر ١٠ من تاريخ فئته — «كم كان قبلاً ولماذا تغيّر؟» في نفس النداء.',
        }),
        req('📄 تاريخ الأسعار (بجينيشن + بتاريخ)', 'GET',
            'api/v1/admin/waste/products/{{productId}}/pricing/history?page=1&limit=20&as_of=', {
          description:
            'يُرجع **الأسعار النافذة والمؤرشفة معاً**، ولكل الفئات الأربع.\\n\\n' +
            'كان يُرجع الأرشيف وحده، فتظهر المعامل والجهات الحرّة **فارغة**: سعرٌ ما زال نافذاً اليوم ' +
            'كان نافذاً الشهر الماضي أيضاً وهو في الجدول **الحيّ** لا في التاريخ.\\n\\n' +
            '`as_of=2026-03-03` يجيب «بكم كنّا نبيع ذلك اليوم؟» — السعر كان نافذاً في تاريخ ' +
            'إذا بدأ **قبله أو فيه** ولم يكن قد انتهى.\\n\\n' +
            'الرد فيه شكلان لنفس الصفوف: `tiers` مجمَّعة لورقة أسعار، و`entries` مسطّحة ومصفَّحة لخطّ زمني — ' +
            'لا راوتان يمكن أن يختلفا.\\n\\n' +
            '**`currency`**: العملة التي **سُعِّر بها الصفّ**، منسوخة على كل صفّ لا مقروءة من إعداد عام — ' +
            'فيبقى الصفّ يقول العملة التي اتُّفق عليها فعلاً حتى بعد تغيير عملة المنصّة.',
        }),
        req('⏳ تحديد تاريخ انتهاء التسعيرة', 'POST',
            'api/v1/admin/waste/products/{{productId}}/pricing/expiry', {
          body: { effective_until: '2026-12-31T00:00:00.000Z', tier: 'FACTORY' },
          description:
            '**ليس حذفاً.** الحذف يوقف المادة فوراً ويسحبها من كل الكتالوجات؛ وهذا يتركها قابلة للبيع ' +
            'حتى يحلّ التاريخ ثم يتوقف — وهو ما تعنيه تسعيرة موسمية أو عقد ينتهي.\\n\\n' +
            'احذف `tier` لإنهاء الفئات كلها معاً. والتاريخ **يجب أن يكون مستقبلياً**: تأريخٌ للخلف ' +
            'يُلغي تسعير طلبيات وُضعت وسُعِّرت بالفعل.',
        }),
        req('✏️ تصحيح سعر بمعرّفه (رقم خطأ)', 'PATCH',
            'api/v1/admin/waste/products/pricing/{{pricingId}}', {
          body: { price: 9.75 },
          description:
            '**PATCH لأن الصفّ يُعدَّل في مكانه** — بلا أرشفة، لأن لا تغيير سعرٍ تجاريّ حدث: ' +
            'الرقم كُتب خطأً فحسب.\\n\\n' +
            'وهذا عكس راوتات الفئات (POST) التي **تستبدل**: هناك تُؤرشَف القديمة وتُفتح جديدة، ' +
            'لأن تغيير السعر واقعةٌ جديدة لها تاريخ بدء خاص بها.\\n\\n' +
            'ولا يمكن تصحيح سعر **مُتجاوَز**: هو ما سُعِّرت به الطلبيات السابقة فعلاً، وإعادة كتابته ' +
            'تجعل كل فاتورة قديمة غير قابلة للتفسير لمن دفعها.',
        }),
        req('➕ ضبط اللائحة كاملة ⚙️', 'POST', 'api/v1/admin/waste/products/{{productId}}/pricing', {
          body: {
            individual: { price: 5 },
            company: { price: 6 },
            factory: [
              { condition: 'EXCELLENT', price: 10 },
              { condition: 'GOOD', price: 8 },
            ],
            free_facility: [
              { condition: 'EXCELLENT', price: 9 },
              { condition: 'GOOD', price: 7 },
            ],
            currency: 'SYP',
          },
          description:
            'الشكل تفرضه **المادة**: مُدرَّجة ← سعر لكل حالة تملكها هي (للمعامل والجهات الحرّة فقط)؛ غير مُدرَّجة ← سعر واحد لكل فئة.',
        }),
        req('✏️ تعديل الجدول (أكثر من دور بنداء واحد) ⚙️', 'PATCH', 'api/v1/admin/waste/products/{{productId}}/pricing', {
          body: {
            individual: { price: 5.5 },
            factory: [{ condition: 'EXCELLENT', price: 11 }],
          },
          description:
            'الدور هو **المفتاح** لا حقل في البودي. تعديل لا استبدال: فئة لم تُرسَل تحتفظ بأسعارها. والتعديل يمسّ السلة وبداية الطلبية فقط — الطلبية المنفَّذة أسعارها مجمَّدة.',
        }),
        // ── راوت لكل فئة، وكلها POST ──
        // POST لأن ضبط سعر فئة **يستبدله**: يُؤرشَف الحيّ وتُفتح صفّ جديد،
        // لأن تغيير السعر واقعة جديدة لها تاريخ بدء خاص بها — وطلبية وُضعت
        // الأسبوع الماضي سُعِّرت بسعر ذلك الأسبوع. PATCH كان سيوحي بأن الرقم
        // القديم يُعدَّل.
        req('🏭 سعر المعامل ⚙️', 'POST',
            'api/v1/admin/waste/products/{{productId}}/pricing/factory', {
          body: { condition_id: '{{conditionId}}', price: 10.5, currency: 'SYP' },
          description:
            'مادة **مُدرَّجة** ← `condition_id` **إلزامي**، ويُتحقَّق أنه من حالات **هذه المادة**: ' +
            'الرمز فريد داخل مادته فقط، فـ«GOOD» للورق غير «GOOD» للنحاس — وتسعير حالة بمعرّف ' +
            'حالة مادة أخرى كان سيُسعّر كل طلبية عليها خطأً بصمت.\\n\\n' +
            'مادة **بلا حالات** ← يُرسَل `price` وحده، وإرسال حالة **يُرفض**.',
        }),
        req('🏢 سعر الجهات الحرّة ⚙️', 'POST',
            'api/v1/admin/waste/products/{{productId}}/pricing/free-facility', {
          body: { condition_id: '{{conditionId}}', price: 9, currency: 'SYP' },
        }),
        req('🏛️ سعر المؤسسات ⚙️', 'POST',
            'api/v1/admin/waste/products/{{productId}}/pricing/institution', {
          body: { price: 6.5, currency: 'SYP' },
          description: 'سعر واحد للمادة — **لا يُسعَّر بالحالة أبداً**.',
        }),
        req('👤 سعر المستخدم العادي ⚙️', 'POST',
            'api/v1/admin/waste/products/{{productId}}/pricing/user', {
          body: { price: 5, currency: 'SYP' },
          description: 'سعر واحد للمادة — **لا يُسعَّر بالحالة أبداً**.',
        }),
        req('🗑️ حذف اللائحة ⚙️', 'DELETE', 'api/v1/admin/waste/products/{{productId}}/pricing', {
          description:
            'حذف اللائحة **يُوقف المادة**: تختفي من كل الأدوار، وأودو يعرض إشعار التوقيف. والتاريخ يحتفظ بما كان.',
        }),
      ],
    },
    {
      name: '8️⃣ العروض',
      item: [
        req('📄 عرض العروض', 'GET', 'api/v1/admin/waste/offers?status=all&page=1&limit=10'),
        req('➕ إضافة عرض', 'POST', 'api/v1/admin/waste/offers', {
          body: {
            product_id: '{{productId}}',
            offer_price: 7.5,
            discount_percentage: 20,
            valid_from: '2026-08-01T00:00:00.000Z',
            valid_until: '2026-09-01T00:00:00.000Z',
          },
        }),
        req('✏️ تعديل عرض', 'PUT', 'api/v1/admin/waste/offers/{{offerId}}', {
          body: { discount_percentage: 25 },
        }),
        req('🗑️ حذف عرض', 'DELETE', 'api/v1/admin/waste/offers/{{offerId}}'),
      ],
    },
    {
      name: '9️⃣ المستودعات ⚙️',
      item: [
        req('📄 عرض المستودعات', 'GET',
            'api/v1/admin/warehouses?page=1&limit=10&search=&status=', {
          description:
            '**`search`** — جزء من **اسم** المستودع **أو كوده**، غير حسّاس لحالة الأحرف.' +
            ' مطابقة جزئية لا كلمة كاملة: الأدمن يكتب ثلاثة أحرف من اسم يتذكّره نصفياً،' +
            ' واشتراط الكلمة كاملة يعني معرفة جواب السؤال المطروح أصلاً.\n\n' +
            '**والاثنان معاً** لأن الأدمن يصل إلى المستودع من الاتجاهين: إمّا يتذكّر اسمه' +
            ' نصفياً، وإمّا يمسك ورقةً لا تحمل إلا الكود. صندوق بحث واحد يجيب الاثنين هو' +
            ' قرارٌ أقلّ قبل الكتابة.\n\n' +
            '**الترتيب: من الأحدث إلى الأقدم.** المستودع المقصود هو غالباً الذي أُنشئ للتوّ،' +
            ' والترتيب الأبجدي يدفنه عند الحرف الذي يبدأ به مصادفةً. (أُضيف عمود `created_at`' +
            ' للجدول في هجرة `1786600000000` — لم يكن موجوداً، فـ«الأحدث» لم يكن سؤالاً يستطيع الجدول إجابته.)\n\n' +
            '**والمستودعات المغلقة تظهر هنا.** المستودع المتوقّف ما زال يحمل مخزوناً وطلبات' +
            ' خارجة، وما زال جواب «أين مادتي» — إخفاؤه يخفي الصفوف التي يحتاجها الأدمن' +
            ' بالضبط أثناء إغلاق الموقع. و`status` متاحة لمن أراد جانباً واحداً.\n\n' +
            '**الكميات في `stock_summary` صارت لكل وحدة**: `totals_by_unit[]` وفيه' +
            ' `unit_id` · `unit_code` · `total_quantity` · `total_reserved` · `total_available`.' +
            ' كان هناك `total_quantity` واحد، وكان حساباً على أشياء لا تُجمع: ٤٠٠ كغ ورق' +
            ' + ٣٠ بطارية = «٤٣٠» — رقمٌ يتغيّر بإعادة قياس مادة بالطن دون أن يتحرّك كيلوغرام' +
            ' واحد، ولا وحدة يمكن كتابتها بجانبه.',
        }),
        req('📄 مستودع واحد', 'GET', 'api/v1/admin/warehouses/{{warehouseId}}', {
          description:
            'نفس شكل صفّ القائمة تماماً، بما فيه `totals_by_unit`.\n\n' +
            '**و`shipment_count` و`order_count`** — كم دخل هذا الموقع وكم خرج منه.\n\n' +
            'ومصدراهما مختلفان **عن قصد**: الشحنة لا وجود لها في الباك ايند إطلاقاً — ' +
            'استلامُ توريد ووزنُه وفرزُه كلّها تحدث في أودو — فالعدد **مُرآة** تصل مع بقية ' +
            'المزامنة. أمّا الطلبات فتُحسَب **هنا** من `order_parts`: الطلب يُنشأ في هذا ' +
            'الطرف، وأودو لا يرى إلا الأجزاء التي نجح دفعها إليه — فرقمُه هو هذا الرقم ' +
            'ناقصاً ما هو في الطابور أو فشل، أي مستودعٌ يبدو أن عليه عملاً أقلّ ممّا عليه.\n\n' +
            'و`order_parts` لا `orders`: الطلب المقسوم طلبٌ واحد للمشتري و**مهمّة لكل مستودع** فيه.',
        }),
        req('➕ إضافة مستودع ⚙️', 'POST', 'api/v1/admin/warehouses', {
          body: {
            name: 'مستودع الشمال',
            code: 'NH1',
            provinceId: '{{provinceId}}',
            address: 'دمشق - الطريق الشمالي',
            latitude: 33.5,
            longitude: 36.3,
            zones: [{ name: 'التخزين', type: 'storage' }],
          },
          description:
            '**`provinceId` و`address` صارا إجباريَّين**، والمحافظة تؤخذ **بالمعرّف** لا بالاسم.\n\n' +
            '**والعنوان إجباري** لأن الإحداثيات تضع دبّوساً على خريطة ولا تقول للسائق' +
            ' **أيّ بوّابة**، وطلبُ استلامٍ بعنوان فارغ لا يستطيع المشتري التصرّف به.' +
            ' كان اختيارياً، ومستودعات قائمة بلا عنوان — وهذا ليس صدفة: الحقل' +
            ' الاختياري في استمارة إنشاء هو حقلٌ يُتخطّى.\n\n' +
            'توزيع الطلبات يطابق المشتري بالمستودعات **بهذا المعرّف**، فمستودعٌ بلا محافظة' +
            ' يحمل مخزوناً لا يمكن توجيه أي طلب إليه — ويظهر العطل بعيداً عن هنا بصيغة' +
            ' «لا يوجد مستودع يستطيع تلبية هذا». وبالاسم لا بالمعرّف: نصٌّ مكتوب يُطابَق' +
            ' بقائمة لا يمكن التحقق منه أمامها، فتصير «دمشق» و«ريف دمشق» مستودعين في' +
            ' مكانين أحدهما غير موجود.\n\n' +
            '**واسم المستودع فريد** (غير حسّاس لحالة الأحرف أو المسافات): الاسم هو ما' +
            ' يستعمله البشر — على الأوراق وعلى شاشة الشحن وفي الطلب الذي يُسلَّم للسائق —' +
            ' وتكراره حمولةٌ تصل المبنى الخطأ بيد من قرأ الاسم الصحيح. القاعدة نفسها' +
            ' مطبَّقة في أودو منذ البداية، وكان الباك ايند يفحص الكود وحده، فيقبل اسماً' +
            ' يفشل بعدها إلى الأبد في طابور المزامنة.',
        }),
        req('✏️ تعديل مستودع ⚙️', 'PATCH', 'api/v1/admin/warehouses/{{warehouseId}}', {
          body: { name: 'مستودع الشمال الرئيسي', code: 'NH1', capacity: 5000 },
          description:
            '**الاسم والكود والسعة فقط.** والاسم يُفحص للتفرّد هنا أيضاً.\n\n' +
            '**المحافظة والعنوان غير قابلين للتعديل** — قصداً لا سهواً، **وفي الطرفين**.' +
            ' توزيع الطلبات يطابق بالمحافظة، وكل مسافة مخزَّنة وكل طلب مفتوح وكل سعر' +
            ' توصيل محسوب يفترض مكان المستودع. نقل مستودع بين محافظتين ليس تعديلاً، بل' +
            ' مستودعٌ جديد وإغلاق قديم.\n\n' +
            '⚠️ **وهذا لم يكن مطبَّقاً في أودو** حتى الآن: كان الباك ايند يرفض والأدمن' +
            ' في أودو يستطيع نقل المستودع بحرّية، فيعود التغيير عبر المزامنة ويتجاوز' +
            ' القاعدة من الباب الخلفي. صار الرفض في `recycle.warehouse.write` أيضاً.\n\n' +
            'والاستثناء الوحيد **ملء ما لم يُسجَّل قطّ**: مستودعات قائمة بلا' +
            ' محافظة، ورفضُ كتابتها يتركها غير قابلة للتوجيه إلى الأبد بلا سبيل لتصحيحها.' +
            ' ملءُ فراغٍ ليس نقلَ مبنى.\n\n' +
            '⚠️ **الحقول المحذوفة من الـDTO**: `governorate` · `address` · `latitude` ·' +
            ' `longitude` · `isActive` كانت **تُقبل هنا وتُهمَل بصمت** — فمن نقل مستودعاً' +
            ' إلى محافظة أخرى كان يحصل على 200، ثم تختفي قيمته عند القراءة التالية بلا' +
            ' ما يدلّه أيّ الطرفين كذب. صارت **400 تُسمّي الحقل** (`forbidNonWhitelisted`).' +
            ' والموقع ودورة الحياة يُعدَّلان في **أودو** ويعودان عبر `SYNC_WAREHOUSE`.',
        }),
        req('🔄 مزامنة المستودع من أودو ⚙️', 'POST', 'api/v1/admin/warehouses/{{warehouseId}}/sync-odoo', {
          body: { force_full_sync: false },
        }),
        req('🔄 مزامنة المدير من أودو ⚙️', 'POST', 'api/v1/admin/warehouses/{{warehouseId}}/sync-manager'),
        req('⬇️ استيراد المستودعات من أودو ⚙️', 'POST', 'api/v1/admin/warehouses/import-odoo'),
      ],
    },
    {
      name: '🔟 المخزون (مطابق لأودو)',
      item: [
        req('📄 مخزون مستودع (مُصفَّح)', 'GET', 'api/v1/admin/warehouses/{{warehouseId}}/inventory?page=1&limit=10', {
          description:
            'البجينيشن على **المواد** لا على صفوف المرآة، والملخّص يصف **المستودع** لا الصفحة.',
        }),
        req('📄 مادة في مستودع', 'GET', 'api/v1/admin/inventory/warehouses/{{warehouseId}}/products/{{productId}}', {
          description:
            'المتاح = الكمية − المحجوز، وسطر لكل حالة. المحجوز موعود لطلبية قائمة فلا يُعدّ قابلاً للبيع.',
        }),
        req('📄 مادة في كل المستودعات', 'GET', 'api/v1/admin/inventory/products/{{productId}}', {
          description:
            'المجموع الكلي + تفصيل الحالات + **أين هي**: قائمة المستودعات مرتّبة بالمتاح.',
        }),
      ],
    },
    {
      name: '1️⃣1️⃣ اقتراحات المواد',
      item: [
        req('📄 كل الاقتراحات', 'GET', 'api/v1/admin/waste/suggestions?page=1&limit=10&status=PENDING_REVIEW'),
        req('📄 اقتراحات أدمن أودو فقط', 'GET', 'api/v1/admin/waste/suggestions?source=ODOO&page=1&limit=10', {
          description:
            'قائمة الاطّلاع على ما اقترحه أدمن أودو بعد أن مُنع من إنشاء المواد.',
        }),
        req('📄 اقتراح واحد', 'GET', 'api/v1/admin/waste/suggestions/{{suggestionId}}'),
        req('✅ قبول (شكليّ)', 'PATCH', 'api/v1/admin/waste/suggestions/{{suggestionId}}/review', {
          body: { status: 'APPROVED', admin_notes: 'فكرة جيدة' },
          description:
            'القبول **لا يُنشئ مادة** — الرد يقول `product_created: false` صراحةً. والمقترِح يُبلَّغ أن اقتراحه سيُدرَس للإضافة، لا أنه أُضيف.',
        }),
        req('❌ رفض', 'PATCH', 'api/v1/admin/waste/suggestions/{{suggestionId}}/review', {
          body: { status: 'REJECTED', admin_notes: 'مادة موجودة باسم آخر' },
          description: 'الرفض **بلا سبب مرفوض**: لا يفيد المقترِح ولا يمكن تصحيحه.',
        }),
      ],
    },
    {
      name: '1️⃣2️⃣ طلبات تصنيفات جديدة',
      item: [
        req('📄 عرض الطلبات', 'GET', 'api/v1/admin/waste/category-requests?page=1&limit=10'),
        req('✅ قبول', 'PATCH', 'api/v1/admin/waste/category-requests/{{requestId}}/approve', {
          body: { admin_notes: 'مقبول' },
        }),
        req('❌ رفض', 'PATCH', 'api/v1/admin/waste/category-requests/{{requestId}}/reject', {
          body: { admin_notes: 'غير مناسب حالياً' },
        }),
      ],
    },
    {
      name: '1️⃣3️⃣ الأسطول (يُؤلَّف في أودو)',
      item: [
        req('📄 الشاحنات', 'GET', 'api/v1/trucks?page=1&limit=10'),
        req('📄 السائقون (مُصفَّح)', 'GET', 'api/v1/trucks/drivers?page=1&limit=10&assigned=false', {
          description:
            'كان يرجع **كل** السائقين بلا تصفيح — عطل بطيء يتفاقم مع نمو الأسطول.',
        }),
        req('📄 شاحنة واحدة', 'GET', 'api/v1/trucks/{{truckId}}'),
        req('📍 الشاحنات العاملة الآن', 'GET', 'api/v1/trucks/active'),
        req('📍 موقع شاحنة', 'GET', 'api/v1/trucks/{{truckId}}/location'),
        req('📍 آخر توقّف', 'GET', 'api/v1/trucks/{{truckId}}/last-stop'),
        req('📍 مسار شاحنة', 'GET', 'api/v1/trucks/{{truckId}}/history'),
      ],
    },
    {
      // Authored HERE, not in Odoo. The Odoo tariff mirror is replaced whole on
      // every sync, so a rate written into it would vanish on the next edit
      // there — two authors need two tables.
      name: '1️⃣4️⃣ تعرفة التوصيل (سعر الكيلومتر)',
      item: [
        req('💰 التعرفة الحالية + السجل', 'GET', 'api/v1/admin/delivery-rate'),
        req('➕ تحديد تعرفة جديدة', 'POST', 'api/v1/admin/delivery-rate', {
          body: {
            rate_per_km: 0.5,
            base_fee: 2,
            min_charge: 3,
            currency: 'JOD',
            note: 'ارتفاع أسعار الوقود',
          },
        }),
        req('✏️ تصحيح التعرفة النافذة', 'PATCH', 'api/v1/admin/delivery-rate/{{deliveryRateId}}', {
          body: { rate_per_km: 0.55 },
        }),
        req('🧮 احتساب كلفة مسافة', 'GET', 'api/v1/admin/delivery-rate/quote?distance_km=12'),
      ],
    },
    {
      // A split order sits in several warehouses at once. One truck starts at
      // the FARTHEST, calls at the nearer ones on the way in, and arrives
      // loaded — billed on the legs it actually drives, not on each
      // warehouse's own distance to the buyer (those overlap, and summing them
      // charges for the same road twice).
      name: '1️⃣4️⃣ب توصيل الطلبيات المجزّأة',
      item: [
        req('🗺️ تخطيط الرحلة (الأبعد أولاً)', 'POST', 'api/v1/admin/orders/{{orderId}}/delivery/plan', {
          body: {},
          description:
            'يبني المسار ويُسعّره بالتعرفة النافذة اليوم.\n\n' +
            '**شاحنة واحدة افتراضياً.** لأكثر من شاحنة أرسل `truck_groups`: مصفوفة لكل شاحنة تحمل معرّفات الأجزاء التي تحملها — ' +
            'مثال `[["part-a"],["part-b","part-c"]]`. كل رحلة تُحسب مسافتها وكلفتها **وحدها**.\n\n' +
            'النظام **لا يقسّم بنفسه**: القسمة حسب الحمولة تعني مقارنة حمل بحمولة بالكيلوغرام، وهذا الكتالوج يقيس بعض المواد بالكيلو وبعضها بالقطعة — ' +
            'ولا تحويل صادق بينهما، فنظامٌ يخمّن كان سيرسل شاحنة لحمل لا تسعه، ويظهر الفشل عند بوابة المستودع والبضاعة مجهّزة.',
        }),
        req('🚚 عرض رحلات الطلبية', 'GET', 'api/v1/admin/orders/{{orderId}}/delivery'),
        req('👷 إسناد شاحنة وسائق', 'POST', 'api/v1/admin/orders/delivery/trips/{{tripId}}/assign', {
          body: {
            odoo_truck_id: 1,
            odoo_driver_id: 1,
            driver_name: 'محمد',
            driver_phone: '0999111222',
          },
        }),
        // The driver id was hard-coded as `1` here, so the request only ever
        // worked if driver 1 happened to exist — and the id is Odoo's, not a
        // uuid, which is exactly the kind of thing a reader guesses wrong.
        req('📋 رحلات سائق التوصيل', 'GET',
            'api/v1/admin/orders/delivery/drivers/{{odooDriverId}}/trips', {
          description:
            '`odooDriverId` هو معرّف السائق **في أودو** (رقم صحيح) لا UUID الباك ايند.',
        }),
        req('✅ تأكيد استلام جزء من مستودع', 'POST', 'api/v1/admin/orders/delivery/trips/{{tripId}}/stops/{{stopId}}/pickup', {
          body: { note: 'استلمت الحمولة كاملة' },
          description:
            'هنا **تنتقل العهدة فعلاً**، فهو إجراء السائق وحده، وهو ما ينقل الجزء إلى `DISPATCHED`.\n\n' +
            'لا يمكن تأكيد محطة قبل التي تسبقها: المسار موجود كي لا تعود الشاحنة أدراجها، وسائقٌ يبلّغ عن المحطة 3 قبل 1 ' +
            'يعني إمّا أن المسار هُجر أو أن الزرّ الخطأ ضُغط — وكلاهما يستحق الرفض لا التسجيل.',
        }),
        req('🏁 إنهاء الرحلة عند المعمل', 'POST', 'api/v1/admin/orders/delivery/trips/{{tripId}}/complete', {
          description:
            'يُرفض ما دامت محطة واحدة غير مستلَمة — الوصول للمعمل بجزأين من ثلاثة وإغلاق الرحلة يترك الثالث في مستودعه ' +
            'والرحلةُ التي كان يفترض أن تجلبه **منتهية**.\n\n' +
            '**لا يُكمل الطلبية.** المعمل يؤكّد الاستلام بنفسه عبر `POST /orders/:orderId/confirm-receipt` — توقيعان على تسليم واحد ' +
            'هو ما يحمي طرفَيه.',
        }),
      ],
    },
    {
      name: '1️⃣5️⃣ مراجعة طلبات التسجيل',
      description: [
        '## ترتيب العمل',
        '',
        '`…/pending` هو **طابور المراجعة**: الحسابات بحالة `PENDING_APPROVAL` وحدها،',
        '**الأقدم أولاً**. الترتيب اقتراح لا قيد — لك أن تعالج أي صفّ — لكن الاقتراح',
        'يشير إلى أقدم دَين. والحساب الذي ذهب إلى `NEED_CHANGES` ثم عاد **يحتفظ',
        'بمكانه الأصلي**: لو رُتّب بلحظة عودته لأُرسل إلى آخر الطابور في كل مرة تطلب',
        'منه وثيقة — فيُعاقَب بانتظار أطول كلما أجاب سؤالاً أنت طرحته.',
        '',
        'أما `…/factory` و`institution` و`external-partner` (بلا `pending`) فهي',
        'نافذة عامة على الدور: تُصفَّى بـ`status`، وبدونه تُرجع **كل الحالات**.',
        '',
        '## رفض الوثيقة ≠ طلبها',
        '',
        'كانا فعلاً واحداً، وكان ذلك خطأً في الاتجاهين: المراجع لا يستطيع أن يعلّم',
        'أول وثيقة من أربع بأنها سيئة دون أن ينتهي بذلك الفحصُ ويُرسَل مقدّم الطلب',
        'ليبدأ التصحيح **قبل أن ينظر أحد في البقية**؛ ومقدّم الطلب قد يُطلب منه',
        'إصلاح شيء دون أن يُقال له أيّه.',
        '',
        '- **`PATCH media/:id/status`** — حكمٌ **صامت**. لا إشعار، ولا تتغيّر حالة الحساب.',
        '- **`POST media/:id/request-reupload`** — الفعل **الوحيد** الذي يصل مقدّم الطلب.',
        '  يشترط أن تكون الوثيقة **مرفوضة** أصلاً، فـ«أرسلها ثانية» تتبع دائماً سبباً مسجَّلاً.',
        '',
        'ويعود مقدّم الطلب إلى الطابور حين لا يبقى شيء **مطلوب** — لا حين لا يبقى شيء',
        '**مرفوض**. الفرق هو المصيدة: الوثيقة المرفوضة التي لم تُطلَب منه هي وثيقة لم',
        'يُبلَّغ بها ولا يراها، وعدّها كان سيبقيه في `NEED_CHANGES` إلى الأبد وقد أصلح',
        'كل ما طُلب منه، ولا شيء على شاشته ليصلحه.',
      ].join('\n'),
      item: [
        // ── الطابور ──
        req('⏳ طابور المعامل (الأقدم أولاً)', 'GET',
            'api/v1/account-management/factory/pending?page=1&limit=10', {
          description:
            '`PENDING_APPROVAL` **حصراً**، مرتّبة بتاريخ التقديم تصاعدياً.\n\n' +
            'كل صفّ يحمل `documents_requested` — كم وثيقة ما زال هذا المتقدّم مديناً بها —' +
            ' فلا يحتاج المراجع أن يفتح الطلب ليعرف إن كان قابلاً للمعالجة.',
        }),
        req('⏳ طابور المؤسسات (الأقدم أولاً)', 'GET',
            'api/v1/account-management/institution/pending?page=1&limit=10'),
        req('⏳ طابور الجهات الحرّة (الأقدم أولاً)', 'GET',
            'api/v1/account-management/external-partner/pending?page=1&limit=10'),

        // ── العرض حسب الحالة ──
        req('🏭 المعامل (حسب الحالة)', 'GET',
            'api/v1/account-management/factory?page=1&limit=10&status=', {
          description:
            '`status` اختيارية: `PENDING_APPROVAL` · `NEED_CHANGES` · `ACTIVE` ·' +
            ' `REJECTED` · `BLOCKED` · `PENDING_PROFILE` · `INACTIVE`.\n\n' +
            '**بدونها تُرجع كل الحالات.** ومع `BLOCKED` يظهر `admin_note` — سبب الحظر،' +
            ' وهو للأدمن وحده ولا يصل الحساب المحظور أبداً.',
        }),
        req('🏢 المؤسسات (حسب الحالة)', 'GET',
            'api/v1/account-management/institution?page=1&limit=10&status='),
        req('🤝 الجهات الحرّة (حسب الحالة)', 'GET',
            'api/v1/account-management/external-partner?page=1&limit=10&status='),

        // ── حساب واحد ──
        req('📄 تفاصيل الحساب', 'GET',
            'api/v1/account-management/account-details/{{profileId}}', {
          description:
            'كان اسمه `profile`، وهو يُرجع الحسابَ **والملفَّ والوثائق** — والمسار الذي' +
            ' يسمّي واحداً من الثلاثة يُرسل القارئ يبحث عن الاثنين الآخرين في مكان آخر.\n\n' +
            '```\n' +
            '{ role, account:{ id, name, email, account_status },\n' +
            '  profile:{ id, …معلومات التسجيل…, location,\n' +
            '            material:{ …معلومات المادة…, waste_types:[{id,name,is_active,\n' +
            '                        odoo_category_id, odoo_sync_status}] },\n' +
            '            documents:{ LICENSE:<id>, ID_CARD_FRONT:<id> } } }\n' +
            '```\n\n' +
            '`role` **خارج** `profile` لأنه يقرّر كيف يُقرأ كل ما تحته.\n\n' +
            'والوثائق **مفهرسة بنوعها** لا مصفوفة معرّفات: من يمسك مصفوفة لا يستطيع' +
            ' أن يطلب «الرخصة» دون جلب كل سجلّ ليعرف أيّها كانت.',
        }),
        req('📍 موقع الحساب', 'GET', 'api/v1/account-management/location/{{profileId}}', {
          description:
            'راوت **واحد** للمعامل والمؤسسات والجهات الحرّة — الثلاثة يرثون `LocationBase`' +
            ' نفسه، فثلاثة راوتات كانت ستكون الاستعلام نفسه مكتوباً ثلاثاً، وكان على' +
            ' المُنادي أن يعرف الدور قبل أن يسأل سؤالاً لا يعتمد عليه.\n\n' +
            'يُرجع `province` و`address` و`description` و`coordinates` **و** `latitude`/`longitude`' +
            ' مفكوكَين — الترتيب المخزَّن `[lng, lat]` وعكسه يضع دمشق في الصومال.',
        }),
        req('🖼️ وثائق الحساب', 'GET', 'api/v1/account-management/{{profileId}}/media', {
          description:
            '«تم جلب الوثائق بنجاح»، و**كل صورة كائن مستقل**:\n' +
            '`id` · `url` · `public_id` · `file_type` · `owner_id` · `owner_type` ·' +
            ' `status` · `reupload_requested_at` · `reupload_reason` · `created_at`.\n\n' +
            '**تُقرأ في كل الحالات** لا في `PENDING_APPROVAL` وحدها. القاعدة القديمة كانت' +
            ' تحجب الوثائق في الحالتين اللتين تهمّان أكثر من غيرهما: عند التفكير في إعادة' +
            ' فتح رفض، وعند التحقق مما قُبِل بعد نزاع.',
        }),
        req('🖼️ وثيقة واحدة', 'GET', 'api/v1/account-management/media/{{mediaId}}'),

        // ── القرارات ──
        req('🟡 رفض/قبول وثيقة (صامت)', 'PATCH',
            'api/v1/account-management/media/{{mediaId}}/status', {
          body: { status: 'REJECTED', description: 'الصورة غير واضحة' },
          description:
            '**لا يصل مقدّم الطلب شيء** ولا تتحرّك حالة الحساب. هذا تسجيلُ حكمٍ في ملفّ' +
            ' المراجع نفسه، لا مخاطبةٌ لمقدّم الطلب — المخاطبة هي الراوت التالي.\n\n' +
            '`status`: `APPROVED` أو `REJECTED`. و`PENDING` **مرفوضة**: إعادة الوثيقة إلى' +
            ' «قيد الانتظار» ليست نتيجة مراجعة بل تراجعٌ عنها دون قول أيّ اتجاه — ومن يعيد' +
            ' الوثيقة إلى `PENDING` شرعاً هو مقدّم الطلب حين يرفع بديلاً.\n\n' +
            '**والوثيقة المرفوضة تُقبل ثانية**: من ضغط خطأً أو أعاد قراءة المسح وغيّر رأيه' +
            ' يجب أن يستطيع قول ذلك دون إشراك مقدّم الطلب إطلاقاً.\n\n' +
            '**409** إذا كان الحساب `ACTIVE` — الوثائق هي الدليل الذي يقوم عليه القبول،' +
            ' وإعادة وسمها بعده تعيد كتابة أساس قرارٍ نُفِّذ فعلاً.',
        }),
        req('📨 طلب إعادة رفع وثيقة ⚠️', 'POST',
            'api/v1/account-management/media/{{mediaId}}/request-reupload', {
          body: { reason: 'الصورة غير واضحة — أرسل نسخة أوضح' },
          description:
            '**الفعل الوحيد في المراجعة الذي يصل مقدّم الطلب.** ينقل الحساب إلى' +
            ' `NEED_CHANGES` ويرسل له السبب.\n\n' +
            '`reason` اختيارية لكنها **كامل الرسالة التي تصله** — و«أعد رفع الرخصة» بلا' +
            ' سبب تنتج المسح غير الواضح نفسه مرّتين.\n\n' +
            '**يشترط**: الوثيقة `REJECTED` (409 خلاف ذلك) · لم يسبق طلبها (409) ·' +
            ' الحساب ما زال قيد المراجعة.\n\n' +
            '**وهو الطريق الوحيد للعودة إلى حساب مرفوض**: قبوله محجوبٌ بالوثيقة المرفوضة،' +
            ' والوثيقة لا يمكن إعادة وسمها تحت حساب مبتوتٍ فيه. طلب البديل يغيّر **الوقائع**' +
            ' لا الأوراق.',
        }),
        req('⏹️ إيقاف انتظار مقدّم الطلب', 'POST',
            'api/v1/account-management/{{accountId}}/cancel-reupload-requests', {
          body: { reason: 'سنراجع طلبك بما قدّمته سابقاً' },
          description:
            '**المخرج من الحالة الوحيدة التي لم يكن للمراجعة خروجٌ منها.**\n\n' +
            'طلبُ وثيقة ينقل الحساب إلى `NEED_CHANGES`، ولا يُتَّخذ قرار في `NEED_CHANGES`' +
            ' لأن ذلك حكمٌ على طلبٍ وصفه المراجع نفسه بأنه ناقص. فمقدّم الطلب الذي **لا يعود' +
            ' أبداً** كان يترك الطلب مفتوحاً إلى الأبد، ولا حركة أمام المراجع إطلاقاً: لا يقبل' +
            ' ولا يرفض ولا يغلق.\n\n' +
            '**والإلغاء ليس قبولاً.** تبقى الوثائق على الحالة التي أعطاها إياها المراجع،' +
            ' فالمرفوضة تبقى مرفوضة: المسحوب هو **السؤال** لا **الحكم**. وأثر ذلك مقصود:\n\n' +
            '- يعود الحساب إلى الطابور حيث **يمكن رفضه** (كل وثيقة صار مبتوتاً فيها)\n' +
            '- ولا **يمكن قبوله** فوق وثيقة وسمها المراجع بأنها غير مقبولة\n\n' +
            'وهما البابان الصحيحان: يُكسَر الجمود دون أن يتحوّل «كففتُ عن الانتظار» بصمت' +
            ' إلى «أقبل ما أرسلتَه».\n\n' +
            'على مستوى **الحساب** لا الوثيقة: قبولُ وثيقة يُغلق طلبها أصلاً، والناقص كان' +
            ' «أوقف الانتظار كلياً» — وهي واقعة عن الطلب لا عن ملف. وإلغاء واحد من ثلاثة' +
            ' كان سيبقي الحساب محجوزاً على الاثنين الآخرين، أي زرّ يبدو أنه لا يعمل.\n\n' +
            '**ويُبلَّغ مقدّم الطلب**: شاشته ما زالت تقول «أعد رفع الرخصة» — مطلبٌ لم يعد' +
            ' أحد ينتظره، وسيظل يحاول تلبيته أو يقرؤه على أنه عطل في التطبيق.\n\n' +
            '**409** إن لم يكن قد طُلب منه شيء.\n\n' +
            'ونفس الفعل موجود في أودو للسائق: زرّ **«أوقف انتظار السائق»**' +
            ' (`action_cancel_reupload_request`) في شاشة طلب السائق.',
        }),
        req('✅ قبول / رفض الحساب', 'PATCH',
            'api/v1/account-management/{{accountId}}/status', {
          body: { status: 'ACTIVE', description: '' },
          description:
            '`status`: `ACTIVE` أو `REJECTED` فقط. (`NEED_CHANGES` ليست قراراً يُتَّخذ على' +
            ' حساب بل نتيجةَ طلب وثيقة بعينها؛ و`BLOCKED` لها راوتها لأنها سؤال آخر.)\n\n' +
            '**البوّابتان مختلفتان عمداً:**\n' +
            '- **القبول** يُحجب بوثيقة **مرفوضة**. غير المبتوت فيها مقبولة، وتُقبَل مع الحساب —' +
            '  فالقبول نفسه إقرارٌ بأن الملف مقبول، فيسوّي ما بقي مفتوحاً. ما لا يجوز له' +
            '  هو أن يتجاوز حكم المراجع المسجَّل بأن وثيقة بعينها غير مقبولة.\n' +
            '- **الرفض** يُحجب بوثيقة **غير مقروءة**. الرفض يجب أن يكون قابلاً للإجابة عنه' +
            '  لاحقاً، و«رفضناك بينما ثلاث من وثائقك الأربع لم تُقرأ» ليست إجابة.\n\n' +
            '**ممنوع**: القرار والحساب `NEED_CHANGES` (409 — طُلب منه شيء ولم يجب بعد) ·' +
            ' سحب قبول (409 — الحساب يتاجر فعلاً، والإخراج هو **الحظر**).\n' +
            '**مسموح**: قبول حساب **مرفوض** سابقاً.\n\n' +
            '`description` تُحفظ في `admin_note` — عمود **لا يقرأه صاحب الحساب ولا يعدّله**.' +
            ' كانت تُكتب في `description` وهو الحقل الذي يحرّره هو نفسه في' +
            ' `PATCH /user/profile` ويقرأه في ملفّه.\n\n' +
            'ويعمل داخل معاملة **بقفل** على صفّ الحساب: مراجعان يفتحان الطلب نفسه هي الحالة' +
            ' العادية لا النادرة، وبدون القفل يمرّ كلاهما من فحص «هل ما زال غير مبتوت فيه؟»' +
            ' فيطمس القرارُ الثاني الأول — والإشعار قد أُرسل.',
        }),
        req('🚫 حظر / رفع حظر', 'PATCH',
            'api/v1/account-management/{{accountId}}/block-status', {
          body: { status: 'BLOCKED', description: 'اشتباه احتيال' },
          description:
            '`status`: `BLOCKED` أو `ACTIVE`.\n\n' +
            '**لا يُحظر إلا حساب مقبول** (409 خلاف ذلك). الحظر إخراجُ من يملك وصولاً فعلياً،' +
            ' وتطبيقه على طلب ما زال قيد المراجعة يخلط «لن ندخلك» بـ«كنتَ داخلاً فأخرجناك»،' +
            ' وهما قراران يجيب عنهما أشخاص مختلفون لأسباب مختلفة.\n\n' +
            '**سبب الحظر للأدمن وحده**: يُحفظ في `admin_note` ويظهر في عرض الحسابات' +
            ' المحظورة، **ولا يصل المحظور**. تسمية الإشارة التي أمسكت به هي المعلومة الوحيدة' +
            ' التي تساعده على تفاديها في المرة القادمة.\n\n' +
            '**والخروج فوري**: تُمسح توكنات التجديد و`fcm_token` من كل أجهزته، واستراتيجية' +
            ' الـJWT ترفض توكن الوصول الصالح في **الطلب التالي مباشرة** لأن الحساب يقرأ' +
            ' `BLOCKED` — فتنتهي الجلسة الآن لا عند انتهاء صلاحية التوكن. وعند تسجيل الدخول' +
            ' يصله: «تم حظر حسابك. يرجى التواصل مع الدعم الفني.»',
        }),
      ],
    },
    {
      name: '1️⃣5️⃣ب راوتات أدوار أخرى (ليست للأدمن) 🔸',
      description: [
        '⚠️ **هذه الراوتات ليست للأدمن.** موضوعة هنا للاطّلاع فقط — لأن الأدمن',
        'يحتاج أن يعرف ما يفعله كلّ دور ليفهم البيانات التي يراجعها، لا ليناديها.',
        '',
        'كلٌّ منها موسوم بالدور الذي يملكه، و**توكن الأدمن سيُرَدّ عليها بـ403**:',
        'الصلاحيات مبنيّة على `ROLE_PERMISSIONS_MAP`، والأدمن يملك `admin.*` وحدها',
        'ولا يملك صلاحيات المشتري.',
        '',
        'استعمِل توكن الدور المناسب:',
        '`{{citizenToken}}` · `{{institutionToken}}` · `{{factoryToken}}` · `{{externalToken}}`',
      ].join('\n'),
      item: [
        (() => {
          const r = req('⭐ المفضلة — عرض 🔸 (المواطن/المؤسسة/المصنع/الجهة الحرّة)',
            'GET', 'api/v1/favourites?page=1&limit=20', {
              description:
                '**راوتات واحدة للأدوار الأربعة.** الفعل نفسه لكلٍّ منهم، والسعر يُحسب من' +
                ' **شريحة المُنادي** — فالدور يغيّر الأرقام دون أن يغيّر الراوت.\n\n' +
                'مربوطة بـ**الحساب** لا بالبروفايل: البروفايل أوراق دورٍ واحد والمواطن يكاد' +
                ' لا يملك واحداً، أما الحساب فيملكه كل مشترٍ وهو ما يحمله التوكن.\n\n' +
                '**المادة التي سُحب سعرها لشريحتك تبقى** بـ`price: null` و`available: false`.',
            });
          r.request.auth.bearer[0].value = '{{citizenToken}}';
          return r;
        })(),
        (() => {
          const r = req('⭐ المفضلة — إضافة 🔸', 'POST', 'api/v1/favourites', {
            body: { product_id: '{{productId}}', note: 'الدرجة التي يأخذها خط حلب' },
            description:
              '**409** إن كانت موجودة بالفعل (فهرس فريد على `(account_id, product_id)`):' +
              ' ضغط القلب مرتين على اتصال بطيء يجب أن يترك صفّاً واحداً.\n\n' +
              '**404** لمادة غير موجودة أو **مُعطَّلة** — المفضلة اختصارٌ إلى شيء يمكن شراؤه.',
          });
          r.request.auth.bearer[0].value = '{{citizenToken}}';
          return r;
        })(),
        (() => {
          const r = req('⭐ المفضلة — تعديل الملاحظة 🔸', 'PATCH',
            'api/v1/favourites/{{favouriteId}}', {
              body: { note: 'اطلبها مكبوسة' },
              description:
                'الملاحظة هي ما يعنيه «التعديل»: المادة نفسها لا تتغيّر — مفضلة تشير إلى' +
                ' مادة أخرى هي مفضلة أخرى. والنصّ الفارغ يمسح الملاحظة.',
            });
          r.request.auth.bearer[0].value = '{{citizenToken}}';
          return r;
        })(),
        (() => {
          const r = req('⭐ المفضلة — حذف 🔸', 'DELETE',
            'api/v1/favourites/{{favouriteId}}', {
              description: '**404** لعنصر يخصّ مشترياً آخر — لا 403، فالردّ المختلف يؤكّد أن المعرّف حقيقي.',
            });
          r.request.auth.bearer[0].value = '{{citizenToken}}';
          return r;
        })(),
        (() => {
          const r = req('🏷️ موادّي (تصنيفات التسجيل) 🔸 (المؤسسة/المصنع/الجهة الحرّة)',
            'GET', 'api/v1/waste/my-materials?page=1&limit=10', {
              description:
                'صلاحية `waste.materials.view` — للمؤسسات والمصانع والجهات الحرّة.' +
                ' **المواطن لا يملكها**، لأنه لا يختار تصنيفات عند التسجيل أصلاً.',
            });
          r.request.auth.bearer[0].value = '{{institutionToken}}';
          return r;
        })(),
        (() => {
          const r = req('🏷️ تصنيفاتي 🔸', 'GET', 'api/v1/waste/my-categories', {
            description: 'التصنيفات المختارة في التسجيل. نفس الصلاحية أعلاه.',
          });
          r.request.auth.bearer[0].value = '{{institutionToken}}';
          return r;
        })(),
        (() => {
          const r = req('📦 توفّر مادة في المستودعات 🔸 (المصنع/الجهة الحرّة)',
            'GET', 'api/v1/waste/products/{{productId}}/availability', {
              description:
                'صلاحية `waste.products.availability` — للمصانع والجهات الحرّة وحدها،' +
                ' فهي التي تشتري بالكميات الكبيرة وتحتاج معرفة أين المادة قبل الطلب.',
            });
          r.request.auth.bearer[0].value = '{{factoryToken}}';
          return r;
        })(),
        (() => {
          const r = req('➕ طلب تصنيف إضافي 🔸 (المؤسسة وحدها)',
            'POST', 'api/v1/waste/category-requests', {
              body: { category_id: '{{categoryId}}', reason: 'بدأنا نفرز هذه المادة' },
              description:
                'صلاحية `waste.categories.request` — **للمؤسسات وحدها**، لأنها الدور' +
                ' الوحيد المقيَّد بتصنيفات اختارها عند التسجيل. القرار عليه في مجلد' +
                ' «طلبات تصنيفات جديدة» أعلاه، وذاك **للأدمن**.',
            });
          r.request.auth.bearer[0].value = '{{institutionToken}}';
          return r;
        })(),
      ],
    },
    {
      name: '1️⃣6️⃣ وِبهوكات أودو (سرّ لا توكن)',
      item: [
        hook(
          '📦 تغيّر المخزون',
          'api/v1/odoo/webhooks/inventory',
          { odoo_warehouse_id: 1 },
          'نبضة بلا حمولة فعلية: الباك ايند يعيد قراءة المستودع كاملاً، فنبضة مكررة غير ضارّة. تُطلَق عند الموافقة على تقرير تلف/تدهور.',
        ),
        hook('🏭 تغيّر مستودع', 'api/v1/odoo/webhooks/warehouse', { odoo_warehouse_id: 1 }),
        hook('🚚 تغيّر الأسطول', 'api/v1/odoo/webhooks/fleet', {}),
        hook('💰 تغيّرت تعرفة التوصيل', 'api/v1/odoo/webhooks/delivery-tariffs', {}),
        hook(
          '📋 حدث على طلبية',
          'api/v1/odoo/webhooks/orders',
          {
            part_id: '{{partId}}',
            odoo_id: 12,
            event: 'completed',
            invoice_number: 'INV-001',
            output_zone: 'منطقة الإخراج',
          },
          'طلبية أُنشئت داخل أودو لا تحمل part_id وتُقبَل وتُتجاهَل — لا تخصّ طلبية مشترٍ هنا.',
        ),
        hook(
          '💡 اقتراح مادة من أودو',
          'api/v1/odoo/webhooks/product-suggestion',
          {
            odoo_suggestion_id: 7,
            product_name: 'أسلاك نحاس',
            unit_type: 'KG',
            category_name: 'معادن',
            description: 'تخرج من خط الفرز مفصولة',
            suggested_by: 'أدمن أودو',
          },
          'idempotent على odoo_suggestion_id: إعادة الدفع بعد timeout تُحدِّث الصف نفسه ولا تودع الاقتراح مرتين.',
        ),
        hook('🧑‍✈️ قرار على سائق', 'api/v1/odoo/webhooks/driver-decision', {
          backend_driver_id: '{{driverId}}',
          approved: true,
        }),
        hook('🕐 قرار تغيير وردية', 'api/v1/odoo/webhooks/shift-change-decision', {
          backend_request_id: '{{requestId}}',
          status: 'ACCEPTED',
        }),
      ],
    },
  ],
};

fs.writeFileSync(TARGET, JSON.stringify(collection, null, 2) + '\n', 'utf8');
const count = collection.item.reduce((n, g) => n + g.item.length, 0);
console.log(`wrote ${count} requests in ${collection.item.length} folders`);
