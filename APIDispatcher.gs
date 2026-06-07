// ═══════════════════════════════════════════════════════════════
// APIDispatcher.gs — JSONP bridge for the GitHub Pages frontend
// أضف هذا الملف إلى مشروع Apps Script بجانب Code.gs
// ═══════════════════════════════════════════════════════════════

function handleApiJsonp_(e) {
  e = e || {};
  e.parameter = e.parameter || {};

  var callback = String(e.parameter.callback || 'callback').replace(/[^a-zA-Z0-9_$\.]/g, '');
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

function apiEnsureMaintenancePermissions_() {
  try {
    if (typeof ensureMaintenancePermissions_ === 'function') ensureMaintenancePermissions_();
  } catch (e) {}
}

function apiNormalizeSession_(sessionRaw) {
  apiEnsureMaintenancePermissions_();
  try {
    var session = JSON.parse(sessionRaw || '{}');
    if (session && Array.isArray(session.perms) && typeof expandPerms_ === 'function') {
      session.perms = expandPerms_(session.perms);
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

  if (action !== 'whoami') {
    if (!token) return { error: 'الجلسة غير موجودة. سجل الدخول مرة أخرى.' };
    if (!apiRestoreSession_(token)) return { error: 'انتهت الجلسة. سجل الدخول مرة أخرى.' };
  } else if (token) {
    apiRestoreSession_(token);
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
    deleteMaintenance: 'deleteMaintenance'
  };

  var fnName = allowed[action];
  var root = typeof globalThis !== 'undefined' ? globalThis : this;
  if (!fnName || typeof root[fnName] !== 'function') {
    throw new Error('API action غير مسموح أو غير موجود: ' + action);
  }

  return root[fnName].apply(root, args || []);
}
