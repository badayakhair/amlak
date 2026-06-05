# نظام إدارة الأملاك - GitHub Pages

الملفات الأساسية للرفع على GitHub Pages:

- index.html
- style.css
- config.js
- api.js
- app.js

## مهم في Apps Script

أضف ملف apps-script/APIDispatcher.gs إلى مشروع Apps Script.

ثم عدّل دالة doGet(e) الموجودة في code.gs لتصبح:

```js
function doGet(e) {
  if (e && e.parameter && e.parameter.payload) {
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

بعدها انشر Apps Script كـ Web App، ثم افتح رابط GitHub Pages.
