// ═══════════════════════════════════════════════════════════════
// Server-Side Validation Helpers — Batch 2
// أضف هذا الكود إلى code.gs في Google Apps Script
// ملاحظة: إذا دمجت PR batch 1 أيضاً، ادمج ملفي code.gs في ملف واحد.
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
 * التحقق من صحة رقم الجوال السعودي
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
 * التحقق من صحة بيانات المبنى
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
