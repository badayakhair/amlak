// ═══════════════════════════════════════════════════════════════
// Server-Side Validation Helpers — دوال تحقق مشتركة (batch 1 + batch 2)
// أضف هذا الكود إلى code.gs في Google Apps Script
// ═══════════════════════════════════════════════════════════════

// ── ثوابت الحالات (مرجع موحّد على جانب الخادم) ────────────────
var CONTRACT_STATUS_ACTIVE    = 'ساري';
var CONTRACT_STATUS_EXPIRING  = 'شارف على الانتهاء';
var CONTRACT_STATUS_EXPIRING2 = 'تشارف انتهاء';  // قيمة قديمة
var CONTRACT_STATUS_ENDED     = 'منتهي';

var VALID_CONTRACT_STATUSES = [
  CONTRACT_STATUS_ACTIVE,
  CONTRACT_STATUS_EXPIRING,
  CONTRACT_STATUS_EXPIRING2,
  CONTRACT_STATUS_ENDED
];

var VALID_MAINTENANCE_STATUSES = ['جديد', 'قيد التنفيذ', 'مكتمل', 'ملغي'];
var VALID_PRIORITIES           = ['طارئ', 'عاجل', 'عادي'];

/**
 * يتحقق من صحة تواريخ العقد: البداية والنهاية (batch 1)
 * يُعيد null إذا كان كل شيء صحيحاً، أو { error: '...' } عند وجود خطأ
 */
function validateContractDates_(data) {
  data = data || {};
  var start = String(data.start || '').trim();
  var end   = String(data.end   || '').trim();

  if (!start) return { error: 'تاريخ بداية العقد مطلوب' };
  if (!end)   return { error: 'تاريخ انتهاء العقد مطلوب' };

  var startNorm = start.replace(/\//g, '-');
  var endNorm   = end.replace(/\//g, '-');
  var startD    = new Date(startNorm);
  var endD      = new Date(endNorm);

  if (isNaN(startD.getTime())) return { error: 'تنسيق تاريخ البداية غير صحيح' };
  if (isNaN(endD.getTime()))   return { error: 'تنسيق تاريخ الانتهاء غير صحيح' };
  if (endD < startD)           return { error: 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية' };

  return null;
}

/**
 * يتحقق من صحة مبلغ الدفعة: أكبر من صفر وغير NaN (batch 1)
 * يُعيد null إذا كان صحيحاً، أو { error: '...' } عند وجود خطأ
 */
function validatePaymentAmount_(amount) {
  var amt = Number(amount);
  if (isNaN(amt) || amt <= 0) return { error: 'مبلغ الدفعة يجب أن يكون رقماً موجباً' };
  return null;
}

/**
 * يتحقق من صحة رقم الجوال السعودي (batch 2)
 * يقبل: 05XXXXXXXX أو 009665XXXXXXXX أو +9665XXXXXXXX
 * يُعيد null إذا كان صحيحاً أو فارغاً، أو { error: '...' } عند وجود خطأ
 */
function validatePhone_(phone) {
  if (!phone || !String(phone).trim()) return null; // اختياري
  var cleaned = String(phone).replace(/[\s\-]/g, '');
  var valid = /^05\d{8}$/.test(cleaned) ||
              /^009665\d{8}$/.test(cleaned) ||
              /^\+9665\d{8}$/.test(cleaned);
  if (!valid) return { error: 'رقم الجوال غير صحيح. يجب أن يبدأ بـ 05 ويكون 10 أرقام' };
  return null;
}

/**
 * يتحقق من صحة بيانات المبنى (batch 2)
 * يُعيد null إذا كانت صحيحة، أو { error: '...' } عند وجود خطأ
 */
function validateBuilding_(data) {
  data = data || {};
  if (!String(data.name || '').trim()) return { error: 'اسم المبنى مطلوب' };
  var units  = parseInt(data.totalUnits);
  var floors = parseInt(data.floors);
  if (isNaN(units)  || units  < 1) return { error: 'عدد الوحدات يجب أن يكون رقماً موجباً' };
  if (isNaN(floors) || floors < 1) return { error: 'عدد الطوابق يجب أن يكون رقماً موجباً' };
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Maintenance Functions — أضف هذا الكود إلى code.gs في Google Apps Script
// ═══════════════════════════════════════════════════════════════

var MAINTENANCE_SHEET = 'الصيانة';

// يُضاف إلى ROLES في وقت التشغيل لأن ROLES معرَّف في ملف code.gs الأصلي
function ensureMaintenancePermissions_() {
  try {
    if (typeof ROLES === 'undefined') return;
    var map = {
      admin:    ['maintenance.view','maintenance.add','maintenance.edit','maintenance.delete'],
      manager:  ['maintenance.view','maintenance.add','maintenance.edit','maintenance.delete'],
      employee: ['maintenance.view','maintenance.add','maintenance.edit'],
      viewer:   ['maintenance.view']
    };
    Object.keys(map).forEach(function(role) {
      if (!ROLES[role] || !ROLES[role].perms) return;
      map[role].forEach(function(p) { if (ROLES[role].perms.indexOf(p) < 0) ROLES[role].perms.push(p); });
    });
  } catch (e) {}
}

function requireMaintenancePerm_(perm) {
  return requirePerm_(perm);
}

// أعمدة ورقة الصيانة (تبدأ من العمود A)
// A=التاريخ  B=المبنى  C=الوحدة  D=المستأجر  E=الفئة  F=الأولوية
// G=وصف المشكلة  H=المسؤول/المقاول  I=جوال المقاول
// J=التكلفة الفعلية  K=الحالة  L=ملاحظات
// M=أنشأ بواسطة  N=تاريخ الإنشاء  O=محذوف (TRUE/FALSE)

function ensureMaintenanceSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MAINTENANCE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(MAINTENANCE_SHEET);
    sheet.appendRow([
      'التاريخ','المبنى','الوحدة','المستأجر','الفئة','الأولوية',
      'وصف المشكلة','المسؤول/المقاول','جوال المقاول',
      'التكلفة الفعلية','الحالة','ملاحظات',
      'أنشأ بواسطة','تاريخ الإنشاء','محذوف'
    ]);
    sheet.getRange(1,1,1,15).setBackground('#1A3A5C').setFontColor('#FFFFFF').setFontWeight('bold');
  }
  return sheet;
}

function getMaintenanceList() {
  try {
    var auth = requireMaintenancePerm_('maintenance.view'); if (auth) return auth;
    var sheet = ensureMaintenanceSheet_();
    var data  = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    var result = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[14] === true || row[14] === 'TRUE') continue;

      var dateVal = '';
      try {
        if (row[0]) dateVal = Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), 'yyyy/MM/dd');
      } catch(e) { dateVal = String(row[0] || ''); }

      result.push({
        row:             i + 1,
        date:            dateVal,
        building:        String(row[1]  || ''),
        unit:            String(row[2]  || ''),
        tenant:          String(row[3]  || ''),
        category:        String(row[4]  || ''),
        priority:        String(row[5]  || ''),
        description:     String(row[6]  || ''),
        contractor:      String(row[7]  || ''),
        contractorPhone: String(row[8]  || ''),
        actualCost:      Number(row[9]  || 0),
        status:          String(row[10] || ''),
        notes:           String(row[11] || ''),
        createdBy:       String(row[12] || ''),
        createdAt:       String(row[13] || '')
      });
    }
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

function addMaintenance(data) {
  var auth = requireMaintenancePerm_('maintenance.add'); if (auth) return auth;
  data = data || {};
  if (!String(data.building || '').trim()) return { error: 'المبنى مطلوب' };
  if (!String(data.description || '').trim()) return { error: 'وصف المشكلة مطلوب' };

  return withLock_(function() {
    var sheet    = ensureMaintenanceSheet_();
    var username = currentUser() || 'نظام';
    var now      = new Date();

    sheet.appendRow([
      data.date        || Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd'),
      data.building,
      data.unit        || '',
      data.tenant      || '',
      data.category    || 'أخرى',
      data.priority    || 'عادي',
      data.description,
      data.contractor  || '',
      data.contractorPhone || '',
      Number(data.actualCost) || 0,
      data.status      || 'جديد',
      data.notes       || '',
      username,
      Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd'),
      false
    ]);
    SpreadsheetApp.flush();
    try { logActivity(username, 'إضافة', 'صيانة', (data.building || '') + ' - ' + String(data.description || '').substring(0, 50)); } catch(e) {}
    return { success: true, message: 'تم إضافة طلب الصيانة' };
  });
}

function updateMaintenance(rowNum, data) {
  var auth = requireMaintenancePerm_('maintenance.edit'); if (auth) return auth;
  data = data || {};

  return withLock_(function() {
    var sheet = ensureMaintenanceSheet_();
    var maxRow = sheet.getLastRow();
    rowNum = parseInt(rowNum, 10);
    if (!rowNum || rowNum < 2 || rowNum > maxRow) return { error: 'رقم الصف غير صحيح' };

    // لا نسمح بتعديل صف محذوف
    var deleted = sheet.getRange(rowNum, 15).getValue();
    if (deleted === true || deleted === 'TRUE') return { error: 'هذا الطلب محذوف ولا يمكن تعديله' };

    sheet.getRange(rowNum, 1, 1, 12).setValues([[
      data.date        || '',
      data.building    || '',
      data.unit        || '',
      data.tenant      || '',
      data.category    || 'أخرى',
      data.priority    || 'عادي',
      data.description || '',
      data.contractor  || '',
      data.contractorPhone || '',
      Number(data.actualCost) || 0,
      data.status      || 'جديد',
      data.notes       || ''
    ]]);
    SpreadsheetApp.flush();
    var username = currentUser() || 'نظام';
    try { logActivity(username, 'تعديل', 'صيانة', (data.building || '') + ' - ' + String(data.description || '').substring(0, 50)); } catch(e) {}
    return { success: true, message: 'تم تحديث طلب الصيانة' };
  });
}

function deleteMaintenance(rowNum) {
  var auth = requireMaintenancePerm_('maintenance.delete'); if (auth) return auth;

  return withLock_(function() {
    var sheet  = ensureMaintenanceSheet_();
    var maxRow = sheet.getLastRow();
    rowNum = parseInt(rowNum, 10);
    if (!rowNum || rowNum < 2 || rowNum > maxRow) return { error: 'رقم الصف غير صحيح' };

    // تجاهل إذا كان محذوفاً مسبقاً
    var alreadyDeleted = sheet.getRange(rowNum, 15).getValue();
    if (alreadyDeleted === true || alreadyDeleted === 'TRUE') return { error: 'هذا الطلب محذوف بالفعل' };

    sheet.getRange(rowNum, 15).setValue(true);
    SpreadsheetApp.flush();
    var username = currentUser() || 'نظام';
    try { logActivity(username, 'حذف', 'صيانة', 'طلب صيانة صف ' + rowNum); } catch(e) {}
    return { success: true, message: 'تم حذف طلب الصيانة' };
  });
}

// ══════════════════════════════════════════════════════════════════
// Payment Edit — تعديل/تصحيح الدفعات (Admin/Manager)
// ══════════════════════════════════════════════════════════════════

function ensurePaymentEditPermissions_() {
  try {
    if (typeof ROLES === 'undefined') return;
    var map = { admin: ['payments.edit'], manager: ['payments.edit'] };
    Object.keys(map).forEach(function(role) {
      if (!ROLES[role] || !ROLES[role].perms) return;
      map[role].forEach(function(p) {
        if (ROLES[role].perms.indexOf(p) < 0) ROLES[role].perms.push(p);
      });
    });
  } catch(e) {}
}

// يُعيد سجل دفعات العقد مع رقم صف كل دفعة في شيت سجل_الدفعات (للمسؤولين فقط)
function getContractPaymentHistoryAdmin(rowNum) {
  ensurePaymentEditPermissions_();
  var auth = requirePerm_('payments.edit'); if (auth) return auth;
  rowNum = parseInt(rowNum, 10);
  if (!rowNum) return [];

  var contractId = '';
  try {
    var cSheet = getSheet(CFG.SHEETS.CONTRACTS);
    if (cSheet && cSheet.getLastRow() >= rowNum) {
      contractId = String(cSheet.getRange(rowNum, C.ID+1).getValue() || '');
    }
  } catch(e) {}

  var sheet = getSheet(CFG.SHEETS.PAYMENTS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getDataRange().getValues().slice(1);
  var results = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var cRow = parseInt(r[PC.ROW], 10);
    var cId = String(r[PC.CONTRACT_ID] || '');
    var match = (contractId && cId === contractId) || (!contractId && cRow === rowNum);
    if (!match) continue;
    var ts = r[PC.TIMESTAMP];
    var dateStr = (ts instanceof Date) ? fmtDatetime(ts) : String(ts || '');
    results.push({
      logRow:      i + 2,
      date:        dateStr,
      username:    String(r[PC.USERNAME]       || '—'),
      amount:      parseNum(r[PC.AMOUNT]),
      before:      parseNum(r[PC.PAID_BEFORE]),
      after:       parseNum(r[PC.PAID_AFTER]),
      remaining:   parseNum(r[PC.REMAINING_AFTER]),
      notes:       String(r[PC.NOTES]          || ''),
      tenant:      String(r[PC.TENANT]         || ''),
      contractRow: cRow
    });
  }
  results.sort(function(a, b) { return b.logRow - a.logRow; });
  return results;
}

// تعديل مبلغ دفعة محددة مع تحديث جميع الأقسام المرتبطة
function updatePayment(logRowNum, newAmount, notes) {
  ensurePaymentEditPermissions_();
  var auth = requirePerm_('payments.edit'); if (auth) return auth;

  return withLock_(function() {
    logRowNum = parseInt(logRowNum, 10);
    newAmount = parseNum(newAmount);
    if (!logRowNum || logRowNum < 2) return { error: 'رقم سجل الدفعة غير صحيح' };
    if (newAmount <= 0) return { error: 'المبلغ الجديد يجب أن يكون أكبر من صفر' };

    var paySheet = getSheet(CFG.SHEETS.PAYMENTS);
    if (!paySheet || paySheet.getLastRow() < logRowNum) return { error: 'سجل الدفعة غير موجود' };

    var payRow = paySheet.getRange(logRowNum, 1, 1, 12).getValues()[0];
    var oldAmount    = parseNum(payRow[PC.AMOUNT]);
    var contractRow  = parseInt(payRow[PC.ROW], 10);
    var tenant       = String(payRow[PC.TENANT]   || '');
    var tenantPhone  = '';

    if (!contractRow) return { error: 'لا يمكن تحديد العقد المرتبط بهذه الدفعة' };

    var delta = newAmount - oldAmount;
    if (Math.abs(delta) < 0.01) return { success: true, message: 'لا تغيير في المبلغ' };

    var contractSheet = getSheet(CFG.SHEETS.CONTRACTS);
    if (!contractSheet || contractSheet.getLastRow() < contractRow) return { error: 'العقد المرتبط غير موجود' };

    var curPaid      = parseNum(contractSheet.getRange(contractRow, C.PAID+1).getValue());
    var rent         = parseNum(contractSheet.getRange(contractRow, C.RENT+1).getValue());
    var newContractPaid = curPaid + delta;

    try { tenantPhone = String(contractSheet.getRange(contractRow, C.PHONE+1).getValue() || ''); } catch(e) {}

    if (newContractPaid < 0) {
      return { error: 'التعديل يُنتج رصيداً مدفوعاً سالباً (' + newContractPaid + ' ر.س). المسدد الحالي: ' + curPaid + ' ر.س' };
    }
    if (rent > 0 && newContractPaid > rent) {
      return { error: 'التعديل يتجاوز قيمة الإيجار (' + rent + ' ر.س). المبلغ الجديد المحسوب: ' + newContractPaid + ' ر.س' };
    }

    var who = currentUser() || 'system';
    var correctionNote = 'تصحيح: ' + oldAmount + ' ← ' + newAmount + ' ر.س (بواسطة ' + who + ')';
    if (notes) correctionNote += ' — ' + String(notes);
    var existingNotes = String(payRow[PC.NOTES] || '');
    var finalNotes = existingNotes ? existingNotes + ' || ' + correctionNote : correctionNote;

    // تحديث سجل الدفعة
    paySheet.getRange(logRowNum, PC.AMOUNT+1).setValue(newAmount);
    paySheet.getRange(logRowNum, PC.PAID_AFTER+1).setValue(parseNum(payRow[PC.PAID_AFTER]) + delta);
    paySheet.getRange(logRowNum, PC.REMAINING_AFTER+1).setValue(
      Math.max(0, parseNum(payRow[PC.REMAINING_AFTER]) - delta));
    paySheet.getRange(logRowNum, PC.NOTES+1).setValue(finalNotes);

    // تحديث عمود PAID في العقد
    contractSheet.getRange(contractRow, C.PAID+1).setValue(newContractPaid);
    if (rent > 0 && newContractPaid >= rent) {
      contractSheet.getRange(contractRow, C.REGULARITY+1).setValue('ملتزم');
    }

    // تحديث سجل المستأجر (يُعيد حساب TOTAL_PAID من جميع العقود)
    if (tenant) updateTenantRecord(tenant, tenantPhone);

    invalidateRuntimeCaches_();
    SpreadsheetApp.flush();

    try {
      logActivity(who, 'تعديل دفعة', 'دفعات',
        'تصحيح سجل صف ' + logRowNum + ': ' + oldAmount + ' ← ' + newAmount +
        ' ر.س — عقد صف ' + contractRow + (tenant ? ' (' + tenant + ')' : ''));
    } catch(e) {}

    return {
      success:  true,
      message:  'تم تعديل الدفعة من ' + oldAmount + ' إلى ' + newAmount + ' ر.س',
      newPaid:  newContractPaid,
      remaining: Math.max(0, rent - newContractPaid)
    };
  });
}

// يُعيد أسماء المباني النشطة لمستخدمي الصيانة (لا يشترط buildings.view)
function getMaintenanceBuildingNames() {
  var auth = requireMaintenancePerm_('maintenance.view'); if (auth) return auth;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('المباني');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getDataRange().getValues().slice(1);
  var names = [];
  data.forEach(function(r) {
    var name = String(r[0] || '').trim();
    if (!name || name === 'الإجمالي') return;
    // BC.ARCHIVED = index 11
    var archived = String(r[11] || '').toLowerCase().trim();
    if (archived !== 'نعم' && archived !== 'yes' && archived !== '1' && archived !== 'true') {
      names.push(name);
    }
  });
  return names;
}
