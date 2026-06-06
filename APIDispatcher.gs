// ═══════════════════════════════════════════════════════════════
// APIDispatcher.gs — أضف هذا الكود إلى مشروع Apps Script
// يحدد الدوال المسموح باستدعائها عبر JSONP من الواجهة
// ═══════════════════════════════════════════════════════════════

var ALLOWED_ACTIONS = {
  // المصادقة
  'login':                    true,
  'logout':                   true,
  'whoami':                   true,
  'changeMyPassword':         true,

  // البيانات الرئيسية
  'getAllData':                true,

  // العقود
  'addContract':              true,
  'updateContract':           true,
  'deleteContract':           true,
  'listDeletedContracts':     true,
  'restoreContract':          true,

  // المباني
  'addBuilding':              true,
  'updateBuilding':           true,
  'archiveBuilding':          true,
  'getBuildingMap':           true,
  'getArchivedBuildings':     true,
  'restoreBuilding':          true,

  // المستأجرون
  'getTenantContracts':       true,

  // الدفعات
  'addPayment':               true,
  'getContractPaymentHistory':true,
  'getPaymentLog':            true,

  // المالية
  'getFinancialStats':        true,

  // التنبيهات والاستحقاقات
  'getUpcomingDueDates':      true,

  // الرسائل
  'getSmsTemplates':          true,
  'saveSmsTemplates':         true,
  'getAutoSmsSettings':       true,
  'saveAutoSmsSettings':      true,
  'sendExpiryReminders':      true,
  'sendPaymentReminders':     true,
  'sendToBuildingCustom':     true,
  'sendSingleSms':            true,
  'getMessageLog':            true,

  // المساعد الذكي
  'askAI':                    true,
  'setAIModel':               true,
  'getAISettings':            true,

  // المستخدمون
  'getUsers':                 true,
  'addUser':                  true,
  'updateUser':               true,
  'deleteUser':               true,

  // سجل العمليات
  'getActivityLog':           true,

  // النسخ الاحتياطي
  'getBackupStatus':          true,
  'backupNow':                true,
  'setupDailyBackup':         true,
  'disableDailyBackup':       true,
  'listBackupFiles':          true,
  'restoreBackupFromFile':    true,

  // ── قسم الصيانة (مُضاف) ──────────────────────
  'getMaintenanceList':       true,
  'addMaintenance':           true,
  'updateMaintenance':        true,
  'deleteMaintenance':        true
};

/**
 * نقطة الدخول الرئيسية لطلبات JSONP من الواجهة.
 * تتحقق من الصلاحية ثم تستدعي الدالة المطلوبة.
 */
function doGet(e) {
  var callback = e.parameter.callback || 'cb';
  var result;
  try {
    var payload = JSON.parse(decodeURIComponent(e.parameter.payload || '{}'));
    var action  = payload.action;
    var args    = payload.args || [];
    var token   = payload.token || '';

    if (!action || !ALLOWED_ACTIONS[action]) {
      result = { __error: 'الإجراء غير مسموح: ' + action };
    } else {
      // تحقق من الجلسة لجميع الطلبات عدا تسجيل الدخول
      if (action !== 'login') {
        var session = getSessionByToken_(token);
        if (!session) {
          result = { __error: 'انتهت الجلسة. يرجى تسجيل الدخول مجدداً.' };
        } else {
          setCurrentSession_(session);
          result = this[action].apply(this, args);
        }
      } else {
        result = this[action].apply(this, args);
      }
    }
  } catch (err) {
    result = { __error: err.message };
  }

  var output = ContentService
    .createTextOutput(callback + '(' + JSON.stringify(result) + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);

  return output;
}
