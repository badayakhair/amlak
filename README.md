# نظام إدارة الأملاك - GitHub Pages

الملفات الأساسية للرفع على GitHub Pages:

- index.html
- style.css
- config.js
- api.js
- app.js

## مهم في Apps Script

أضف الملفات التالية إلى مشروع Apps Script الحالي:

- `APIDispatcher.gs`
- محتوى `code.gs` الخاص بقسم الصيانة، أو ادمجه في ملف `Code.gs` الحالي إذا كان المشروع يحتوي الملف الأساسي مسبقاً.

ثم عدّل دالة doGet(e) الموجودة في code.gs لتصبح:

```js
function doGet(e) {
  e = e || {};
  e.parameter = e.parameter || {};

  if (e.parameter.payload || e.parameter.callback || e.parameter.api) {
    return handleApiJsonp_(e);
  }

  try { ensureUsersSheet(); } catch(err) {}

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('نظام إدارة الأملاك الذكي')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .addMetaTag('viewport','width=device-width,initial-scale=1');
}
```

بعدها انشر Apps Script كـ Web App، وضع رابط النشر في `config.js`، ثم افتح رابط GitHub Pages.

إذا كان المستخدم مسجلاً قبل إضافة قسم الصيانة، سجّل الخروج ثم ادخل مرة أخرى حتى تُحمّل صلاحيات الصيانة الجديدة.
