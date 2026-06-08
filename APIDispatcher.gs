// ═══════════════════════════════════════════════════════════════
// APIDispatcher.gs — JSONP bridge for the GitHub Pages frontend
// أضف هذا الملف إلى مشروع Apps Script بجانب Code.gs
// ═══════════════════════════════════════════════════════════════

function handleApiJsonp_(e) {
  e = e || {};
  e.parameter = e.parameter || {};

  var callback = String(e.parameter.callback || 'callback').replace(/[^a-zA-Z0-9_$]/g, '');
  if (!callback) callback = 'callback';

  var out;
  try {
    var rawPayload = String(e.parameter.payload || '{}');
    var req;
    try {
      req = JSON.parse(rawPayload);
    } catch (parseErr) {
      req = JSON.parse(decodeURIComponent(rawPayload));
    }

    var action = String(req.action || '');
    var args = Array.isArray(req.args) ? req.args : [];
    var token = String(req.token || '');

    out = callPublicApi_(action, args, token);
  } catch (err) {
    out = { __error: err && err.message ? err.message : String(err) };
  }

  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(out) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/**
 * ترسل رسالة لجميع المستأجرين النشطين في مبنى معين (ساري + شارف على الانتهاء)
 * تستدعي sendToBuildingCustom مرتين وتجمع النتائج
 */
function sendToBuildingActiveCustom(bldg, msg) {
  var total = { sent: 0, failed: 0 };
  var statuses = ['ساري', 'شارف على الانتهاء', 'تشارف انتهاء'];
  if (typeof sendToBuildingCustom !== 'function') {
    return { error: 'الدالة sendToBuildingCustom غير متوفرة' };
  }
  statuses.forEach(function(st) {
    try {
      var r = sendToBuildingCustom(bldg, msg, st) || {};
      if (r.error) { total.failed += 1; return; }
      total.sent   += Number(r.sent   || 0);
      total.failed += Number(r.failed || 0);
    } catch(e) { total.failed += 1; }
  });
  return total;
}

function apiEnsureMaintenancePermissions_() {
  try {
    if (typeof ensureMaintenancePermissions_ === 'function') ensureMaintenancePermissions_();
    if (typeof ensurePaymentEditPermissions_ === 'function') ensurePaymentEditPermissions_();
  } catch (e) {}
}

function apiNormalizeSession_(sessionRaw) {
  try {
    var session = JSON.parse(sessionRaw || '{}');
    if (session && Array.isArray(session.perms) && typeof expandPerms_ === 'function') {
      session.perms = expandPerms_(session.perms);
    }
    // حقن payments.edit لأدوار الإدارة تلقائياً (لا يُحفظ في الجلسة الأصلية)
    if (session && Array.isArray(session.perms) &&
        (session.role === 'admin' || session.role === 'manager')) {
      if (session.perms.indexOf('payments.edit') < 0) session.perms.push('payments.edit');
    }
    return JSON.stringify(session);
  } catch (e) {
    return sessionRaw;
  }
}

function apiRestoreSession_(token) {
  token = String(token || '');
  if (!token) return null;

  var cached = CacheService.getScriptCache().get('API_SESSION_' + token);
  if (!cached) return null;

  cached = apiNormalizeSession_(cached);
  PropertiesService.getUserProperties().setProperty('SESSION', cached);
  return cached;
}

function callPublicApi_(action, args, token) {
  apiEnsureMaintenancePermissions_();

  if (action === 'login') {
    var result = login.apply(null, args || []);
    if (result && result.success) {
      var sessionRaw = PropertiesService.getUserProperties().getProperty('SESSION');
      var apiToken = Utilities.getUuid();

      if (sessionRaw) {
        sessionRaw = apiNormalizeSession_(sessionRaw);
        PropertiesService.getUserProperties().setProperty('SESSION', sessionRaw);
        CacheService.getScriptCache().put('API_SESSION_' + apiToken, sessionRaw, 21600);
        result.token = apiToken;
      }
    }
    return result;
  }

  if (action === 'logout') {
    if (token) apiRestoreSession_(token);
    var logoutResult = logout();
    if (token) CacheService.getScriptCache().remove('API_SESSION_' + token);
    return logoutResult;
  }

  if (action === 'whoami') {
    // whoami بدون توكن صالح = غير مسجَّل، لا نعتمد على PropertiesService وحده
    if (!token || !apiRestoreSession_(token)) return { loggedIn: false };
  } else {
    if (!token) return { error: 'الجلسة غير موجودة. سجل الدخول مرة أخرى.' };
    if (!apiRestoreSession_(token)) return { error: 'انتهت الجلسة. سجل الدخول مرة أخرى.' };
  }

  var allowed = {
    whoami: 'whoami',
    changeMyPassword: 'changeMyPassword',
    getAllData: 'getAllData',
    getContracts: 'getContracts',
    getBuildings: 'getBuildings',
    getTenantHistory: 'getTenantHistory',
    getDashboardStats: 'getDashboardStats',
    getFinancialStats: 'getFinancialStats',
    getBuildingMap: 'getBuildingMap',
    getTenantContracts: 'getTenantContracts',
    getUpcomingDueDates: 'getUpcomingDueDates',

    addContract: 'addContract',
    updateContract: 'updateContract',
    deleteContract: 'deleteContract',
    listDeletedContracts: 'listDeletedContracts',
    restoreContract: 'restoreContract',

    addPayment: 'addPayment',
    getContractPaymentHistory: 'getContractPaymentHistory',
    getPaymentLog: 'getPaymentLog',

    addBuilding: 'addBuilding',
    updateBuilding: 'updateBuilding',
    deleteBuilding: 'deleteBuilding',
    archiveBuilding: 'archiveBuilding',
    getArchivedBuildings: 'getArchivedBuildings',
    restoreBuilding: 'restoreBuilding',

    askAI: 'askAI',
    getAISettings: 'getAISettings',
    setAIModel: 'setAIModel',

    getSmsTemplates: 'getSmsTemplates',
    saveSmsTemplates: 'saveSmsTemplates',
    getAutoSmsSettings: 'getAutoSmsSettings',
    saveAutoSmsSettings: 'saveAutoSmsSettings',
    sendSingleSms: 'sendSingleSms',
    sendExpiryReminders: 'sendExpiryReminders',
    sendPaymentReminders: 'sendPaymentReminders',
    sendToBuildingCustom: 'sendToBuildingCustom',
    sendToBuildingActiveCustom: 'sendToBuildingActiveCustom',
    getMessageLog: 'getMessageLog',

    getActivityLog: 'getActivityLog',

    getUsers: 'getUsers',
    addUser: 'addUser',
    updateUser: 'updateUser',
    deleteUser: 'deleteUser',

    getBackupStatus: 'getBackupStatus',
    setupDailyBackup: 'setupDailyBackup',
    disableDailyBackup: 'disableDailyBackup',
    backupNow: 'backupNow',
    listBackupFiles: 'listBackupFiles',
    restoreBackupFromFile: 'restoreBackupFromFile',

    getMaintenanceList: 'getMaintenanceList',
    addMaintenance: 'addMaintenance',
    updateMaintenance: 'updateMaintenance',
    deleteMaintenance: 'deleteMaintenance',
    getMaintenanceBuildingNames: 'getMaintenanceBuildingNames',

    getContractPaymentHistoryAdmin: 'getContractPaymentHistoryAdmin',
    updatePayment: 'updatePayment'
  };

  var fnName = allowed[action];
  var root = typeof globalThis !== 'undefined' ? globalThis : this;
  if (!fnName || typeof root[fnName] !== 'function') {
    throw new Error('API action غير مسموح أو غير موجود: ' + action);
  }

  // ── التحقق من صلاحية النسخ الاحتياطي قبل الاستعادة ──
  if (action === 'restoreBackupFromFile') {
    if (typeof requirePerm_ === 'function') {
      var backupErr = requirePerm_('backup.run');
      if (backupErr) return backupErr;
    }
  }

  // ── التحقق من صحة بيانات المبنى على جانب الخادم (batch 2) ──
  if (action === 'addBuilding' || action === 'updateBuilding') {
    var buildingData = (action === 'updateBuilding') ? args[1] : args[0];
    if (typeof validateBuilding_ === 'function') {
      var bldgErr = validateBuilding_(buildingData || {});
      if (bldgErr) return bldgErr;
    }
  }

  // ── التحقق من صحة تواريخ العقد والجوال على جانب الخادم (batch 1 + 2) ──
  if (action === 'addContract' || action === 'updateContract') {
    var contractData = (action === 'updateContract') ? args[1] : args[0];
    if (typeof validateContractDates_ === 'function') {
      var dateErr = validateContractDates_(contractData || {});
      if (dateErr) return dateErr;
    }
    if (contractData && typeof validatePhone_ === 'function') {
      var phoneErr = validatePhone_((contractData || {}).phone);
      if (phoneErr) return phoneErr;
    }
  }

  // ── التحقق من صحة مبلغ الدفعة على جانب الخادم (batch 1) ──
  if (action === 'addPayment') {
    var payAmount = args[1];
    if (typeof validatePaymentAmount_ === 'function') {
      var amtErr = validatePaymentAmount_(payAmount);
      if (amtErr) return amtErr;
    }
  }

  return root[fnName].apply(root, args || []);
}
