// ═══════════════════════════════════════════════════════════════
// Maintenance Functions — أضف هذا الكود إلى code.gs في Google Apps Script
// ═══════════════════════════════════════════════════════════════

var MAINTENANCE_SHEET = 'الصيانة';

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
      'التاريخ', 'المبنى', 'الوحدة', 'المستأجر', 'الفئة', 'الأولوية',
      'وصف المشكلة', 'المسؤول/المقاول', 'جوال المقاول',
      'التكلفة الفعلية', 'الحالة', 'ملاحظات',
      'أنشأ بواسطة', 'تاريخ الإنشاء', 'محذوف'
    ]);
    var header = sheet.getRange(1, 1, 1, 15);
    header.setBackground('#1A3A5C');
    header.setFontColor('#FFFFFF');
    header.setFontWeight('bold');
  }
  return sheet;
}

function getMaintenanceList() {
  try {
    var sheet = ensureMaintenanceSheet_();
    var data  = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    var result = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      // تخطّي الصفوف المحذوفة
      if (row[14] === true || row[14] === 'TRUE') continue;

      result.push({
        row:            i + 1,
        date:           row[0]  ? Utilities.formatDate(new Date(row[0]),  Session.getScriptTimeZone(), 'yyyy/MM/dd') : '',
        building:       String(row[1]  || ''),
        unit:           String(row[2]  || ''),
        tenant:         String(row[3]  || ''),
        category:       String(row[4]  || ''),
        priority:       String(row[5]  || ''),
        description:    String(row[6]  || ''),
        contractor:     String(row[7]  || ''),
        contractorPhone:String(row[8]  || ''),
        actualCost:     Number(row[9]  || 0),
        status:         String(row[10] || ''),
        notes:          String(row[11] || ''),
        createdBy:      String(row[12] || ''),
        createdAt:      row[13] ? Utilities.formatDate(new Date(row[13]), Session.getScriptTimeZone(), 'yyyy/MM/dd') : ''
      });
    }
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

function addMaintenance(data) {
  try {
    var sheet   = ensureMaintenanceSheet_();
    var session = getSession_();
    var now     = new Date();

    sheet.appendRow([
      data.date        || Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd'),
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
      data.notes       || '',
      session ? session.username : 'نظام',
      now,
      false
    ]);

    logActivity_('إضافة', 'صيانة', (data.building || '') + ' - ' + (data.description || '').substring(0, 50));
    return { success: true, message: 'تم إضافة طلب الصيانة' };
  } catch (e) {
    return { error: e.message };
  }
}

function updateMaintenance(rowNum, data) {
  try {
    var sheet = ensureMaintenanceSheet_();
    var maxRow = sheet.getLastRow();
    if (rowNum < 2 || rowNum > maxRow) return { error: 'رقم الصف غير صحيح' };

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

    logActivity_('تعديل', 'صيانة', (data.building || '') + ' - ' + (data.description || '').substring(0, 50));
    return { success: true, message: 'تم تحديث طلب الصيانة' };
  } catch (e) {
    return { error: e.message };
  }
}

function deleteMaintenance(rowNum) {
  try {
    var sheet  = ensureMaintenanceSheet_();
    var maxRow = sheet.getLastRow();
    if (rowNum < 2 || rowNum > maxRow) return { error: 'رقم الصف غير صحيح' };

    // حذف ناعم: ضع TRUE في عمود O (العمود 15)
    sheet.getRange(rowNum, 15).setValue(true);

    logActivity_('حذف', 'صيانة', 'طلب صيانة صف ' + rowNum);
    return { success: true, message: 'تم حذف طلب الصيانة' };
  } catch (e) {
    return { error: e.message };
  }
}
