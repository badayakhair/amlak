// ═══════════════════════════════════════════════════════════════
// نظام إدارة الأملاك الذكي v2 — Google Apps Script
// ═══════════════════════════════════════════════════════════════

const CFG = {
  AI_KEY:       () => PropertiesService.getScriptProperties().getProperty('AI_KEY') || '',
  AI_PROVIDER:  () => PropertiesService.getScriptProperties().getProperty('AI_PROVIDER') || 'auto',
  AI_MODEL:     () => PropertiesService.getScriptProperties().getProperty('AI_MODEL') || '',
  OURSMS_TOKEN: () => PropertiesService.getScriptProperties().getProperty('OURSMS_TOKEN') || '',
  OURSMS_SENDER:() => PropertiesService.getScriptProperties().getProperty('OURSMS_SENDER') || 'الجمعية',
  SHEETS: {
    CONTRACTS: 'عقود_الإيجار',
    BUILDINGS: 'المباني',
    TENANTS:   'سجل_المستأجرين',
    LOG:       'سجل_الرسائل',
    USERS:     'المستخدمون',
    ACTIVITY:  'سجل_العمليات',
    PAYMENTS:  'سجل_الدفعات',
    SMS_TEMPLATES: 'قوالب_الرسائل',
  }
};

// أعمدة شيت العقود
const C = {
  ID:0, BUILDING:1, UNIT:2, TENANT:3, PHONE:4,
  START:5, END:6, STATUS:7, TYPE:8, RENT:9, PAID:10,
  REMAINING:11, PAY_PCT:12, SCHEDULE:13, REGULARITY:14, ATTACHMENT:15, NOTES:16,
  ID_NO:17,  // عمود اختياري — يُضاف في النهاية لتفادي كسر البيانات الموجودة
  DELETED:18, DELETED_AT:19, DELETED_BY:20
};
// أعمدة شيت المباني
// المباني: NAME, TYPE, FLOORS, TOTAL_UNITS, [محسوبة...], NOTES
const BC = { NAME:0, TYPE:1, FLOORS:2, TOTAL_UNITS:3, NOTES:10, ARCHIVED:11, ARCHIVED_AT:12, ARCHIVED_BY:13 };
// أعمدة المستخدمون
const UC = {
  USERNAME:0, PASSWORD:1, NAME:2, ROLE:3, EMAIL:4, ACTIVE:5, CREATED:6, LAST_LOGIN:7,
  CUSTOM_PERMS:8  // صلاحيات مخصصة (JSON) — اختياري
};

// أعمدة سجل العمليات
const AC = {
  TIMESTAMP:0, USERNAME:1, ACTION:2, ENTITY:3, DETAILS:4, IP:5
};

// أعمدة سجل الدفعات — سجل محاسبي مستقل لا يغيّر بنية العقود الحالية
const PC = {
  TIMESTAMP:0, USERNAME:1, CONTRACT_ID:2, ROW:3, TENANT:4, BUILDING:5, UNIT:6, AMOUNT:7, PAID_BEFORE:8, PAID_AFTER:9, REMAINING_AFTER:10, NOTES:11
};

// أعمدة سجل المستأجرين
const TC = {
  NAME:0, PHONE:1, CONTRACTS_COUNT:2, LAST_BUILDING:3, LAST_UNIT:4,
  LAST_START:5, LAST_END:6, LAST_STATUS:7, TOTAL_PAID:8, REGULARITY_SCORE:9, NOTES:10,
  ID_NO:11  // اختياري — يُضاف في النهاية
};

// كاش داخل نفس طلب Apps Script فقط لتقليل قراءة الشيتات المتكررة في getAllData/askAI.
// لا يُخزَّن بين المستخدمين ولا بين الطلبات.
var __CONTRACTS_CACHE = null;
var __BUILDINGS_CACHE = null;
var __PAYMENTS_CACHE = null;
// كاش الجلسة على مستوى الطلب الواحد: كل طلب HTTP في Apps Script = نسخة VM جديدة،
// فيُحَلّ مرة واحدة ويُعاد استخدامه؛ يوفّر قراءات/كتابات PropertiesService المتكررة (الأبطأ).
var __SESSION_CACHE = undefined; // undefined = لم يُحَلّ بعد ، null = حُلّ ولا توجد جلسة

// ── كاش CacheService للبيانات الثابتة نسبياً (مشترك بين جميع الطلبات) ──
function _scGet_(k){try{var v=CacheService.getScriptCache().get(k);return v?JSON.parse(v):null;}catch(e){return null;}}
function _scSet_(k,v,ttl){try{var s=JSON.stringify(v);if(s.length<90000)CacheService.getScriptCache().put(k,s,ttl);}catch(e){}}
function _scDel_(k){try{CacheService.getScriptCache().remove(k);}catch(e){}}
function _scDelAll_(keys){try{CacheService.getScriptCache().removeAll(keys);}catch(e){}}
function cloneData_(v) {
  if (v === null || v === undefined) return v;
  if (Object.prototype.toString.call(v) === '[object Date]') return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(function(x){ return cloneData_(x); });
  if (typeof v === 'object') {
    var o = {};
    Object.keys(v).forEach(function(k){ o[k] = cloneData_(v[k]); });
    return o;
  }
  return v;
}

// ═══════════════════════════════════════════════════════════════
// حماية من حقن الصيغ في Google Sheets (CSV / Formula Injection)
// أي نص يبدأ بـ = + - @ أو محرف tab/CR قد يُنفَّذ كصيغة حيّة عند فتح
// الجدول من الأدمن (=IMPORTRANGE / =HYPERLINK / =WEBSERVICE …).
// نضيف فاصلة عليا ' في البداية لتحييده مع إبقاء العرض كنص عادي.
// تُطبَّق فقط على الحقول النصية القادمة من المستخدم — لا على الصيغ النظامية ولا الأرقام.
// ═══════════════════════════════════════════════════════════════
function sanitizeCell_(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  var s = String(v);
  if (s.length && /^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

// ───────────────────────────────────────────────
// Web App entry
// ───────────────────────────────────────────────
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
// ───────────────────────────────────────────────
// قراءة البيانات الأساسية
// ───────────────────────────────────────────────
function getContracts() {
  const auth = requirePerm_('contracts.view'); if (auth) return [];
  if (__CONTRACTS_CACHE) return cloneData_(__CONTRACTS_CACHE);
  var _sc = _scGet_('ctr_v1'); if (_sc) { __CONTRACTS_CACHE = _sc; return cloneData_(__CONTRACTS_CACHE); }
  const sheet = getSheet(CFG.SHEETS.CONTRACTS);
  if (!sheet) { __CONTRACTS_CACHE = []; return []; }
  const rows  = sheet.getDataRange().getValues().slice(1);
  const today = new Date();
  __CONTRACTS_CACHE = rows.map((r,i) => {
    if (isContractDeletedRow_(r)) return null;
    const end      = r[C.END] ? new Date(r[C.END]) : null;
    const daysLeft = end ? Math.round((end - today)/86400000) : null;
    const rent     = parseNum(r[C.RENT]);
    const paid     = parseNum(r[C.PAID]);
    return {
      row:        i+2,
      id:         str(r[C.ID]),
      building:   str(r[C.BUILDING]),
      unit:       str(r[C.UNIT]),
      tenant:     str(r[C.TENANT]),
      idNo:       r.length > C.ID_NO ? str(r[C.ID_NO]) : '',
      phone:      cleanPhoneValue_(r[C.PHONE]),
      start:      fmtDate(r[C.START]),
      end:        fmtDate(r[C.END]),
      endDefaulted: !!(r[C.START] && !r[C.END]),
      status:     autoContractStatus_(str(r[C.STATUS]) || 'غير محدد', r[C.START], r[C.END]),
      type:       str(r[C.TYPE]) || 'سكني',
      rent, paid,
      remaining:  rent - paid,
      payPct:     rent>0 ? Math.round(paid/rent*100) : 0,
      schedule:   str(r[C.SCHEDULE]),
      regularity: str(r[C.REGULARITY]),
      notes:      str(r[C.NOTES]),
      daysLeft,
    };
  }).filter(c => c && c.tenant);
  _scSet_('ctr_v1', __CONTRACTS_CACHE, 120);
  return cloneData_(__CONTRACTS_CACHE);
}

function getBuildings() {
  const auth = requirePerm_('buildings.view'); if (auth) return [];
  if (__BUILDINGS_CACHE) return cloneData_(__BUILDINGS_CACHE);
  var _sc = _scGet_('bld_v1'); if (_sc) { __BUILDINGS_CACHE = _sc; return cloneData_(__BUILDINGS_CACHE); }
  let sheet = getSheet(CFG.SHEETS.BUILDINGS);
  if (!sheet) { __BUILDINGS_CACHE = inferBuildingsFromContracts(); return cloneData_(__BUILDINGS_CACHE); }
  const rows = sheet.getDataRange().getValues().slice(1);
  __BUILDINGS_CACHE = rows.map((r,i) => {
    if (isBuildingArchivedRow_(r)) return null;
    return {
      row:        i+2,
      name:       str(r[BC.NAME]),
      type:       str(r[BC.TYPE]) || 'سكني',
      floors:     parseInt(r[BC.FLOORS]) || 1,
      totalUnits: parseInt(r[BC.TOTAL_UNITS]) || 0,
      notes:      str(r[BC.NOTES]),
    };
  }).filter(b => b && b.name && b.name !== 'الإجمالي');
  _scSet_('bld_v1', __BUILDINGS_CACHE, 120);
  return cloneData_(__BUILDINGS_CACHE);
}


function inferBuildingsFromContracts() {
  // إذا شيت المباني غير موجود، استخرج المباني من العقود
  const cSheet = getSheet(CFG.SHEETS.CONTRACTS);
  if (!cSheet) return [];
  const data = cSheet.getDataRange().getValues().slice(1);
  const map = {};
  data.forEach(r => {
    const name = String(r[C.BUILDING]||'').trim();
    if (!name) return;
    if (!map[name]) map[name] = { units: new Set(), type: 'سكني' };
    if (r[C.UNIT]) map[name].units.add(String(r[C.UNIT]).trim());
    // إذا كان أي عقد تجاري، اعتبر المبنى مختلطاً (أو تجارياً)
    const t = String(r[C.TYPE]||'').trim();
    if (t === 'تجاري') {
      map[name].type = map[name].type === 'سكني' ? 'تجاري' : map[name].type;
    }
  });
  return Object.entries(map).map(([name, d], i) => ({
    row: i+2, name, type: d.type, floors: 1, totalUnits: d.units.size,
    notes: 'مُستخرج تلقائياً'
  }));
}


function inferTenantsFromContracts() {
  const contracts = getContracts();
  const map = {};
  contracts.forEach(c => {
    if (!c.tenant) return;
    if (!map[c.tenant]) map[c.tenant] = { phone:c.phone, idNo:c.idNo, contracts:[] };
    if (c.idNo && !map[c.tenant].idNo) map[c.tenant].idNo = c.idNo;
    map[c.tenant].contracts.push(c);
  });
  return Object.entries(map).map(([name, d], i) => {
    const last  = d.contracts.sort((a,b)=>compareDates(b.start,a.start))[0];
    const total = d.contracts.reduce((s,c)=>s+c.paid,0);
    const good  = d.contracts.filter(c=>c.regularity==='ملتزم').length;
    return {
      row: i+2, name, idNo: d.idNo||'', phone: d.phone||last.phone||'',
      contractsCount: d.contracts.length,
      lastBuilding: last.building, lastUnit: last.unit,
      lastStart: last.start, lastEnd: last.end,
      lastStatus: last.status,
      totalPaid: total,
      regularityScore: d.contracts.length>0 ? Math.round(good/d.contracts.length*100)+'%' : '—',
      notes: ''
    };
  });
}

function getTenantHistory() {
  const auth = requirePerm_('tenants.view'); if (auth) return [];
  var _sc = _scGet_('tnt_v1'); if (_sc) return _sc;
  const sheet = getSheet(CFG.SHEETS.TENANTS);
  // إذا الشيت غير موجود، استخرج تلقائياً من العقود
  if (!sheet) return inferTenantsFromContracts();
  const rows = sheet.getDataRange().getValues().slice(1);
  var _result = rows.map((r,i) => ({
    row:            i+2,
    name:           str(r[TC.NAME]),
    phone:          cleanPhoneValue_(r[TC.PHONE]),
    contractsCount: parseInt(r[TC.CONTRACTS_COUNT]) || 0,
    lastBuilding:   str(r[TC.LAST_BUILDING]),
    lastUnit:       str(r[TC.LAST_UNIT]),
    lastStart:      fmtDate(r[TC.LAST_START]),
    lastEnd:        fmtDate(r[TC.LAST_END]),
    // الحالة تُحسب حياً من تاريخ الانتهاء (مثل العقود) — حتى لا تبقى "شارف على الانتهاء"
    // مجمّدة في الشيت بعد تجاوز العقد تاريخ انتهائه فعلياً
    lastStatus:     autoContractStatus_(str(r[TC.LAST_STATUS]), r[TC.LAST_START], r[TC.LAST_END]),
    totalPaid:      parseNum(r[TC.TOTAL_PAID]),
    regularityScore:str(r[TC.REGULARITY_SCORE]),
    notes:          str(r[TC.NOTES]),
  })).filter(t => t.name);
  _scSet_('tnt_v1', _result, 120);
  return _result;
}

// ───────────────────────────────────────────────
// لوحة التحكم — إحصائيات شاملة
// ───────────────────────────────────────────────

// =====================================================================
// Occupancy Core Fix — توحيد حساب الشاغر/المشغول في كل النظام
// =====================================================================

function occNormText_(v) {
  return String(v == null ? '' : v)
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function occNormKey_(v) {
  return occNormText_(v).toLowerCase();
}

function isOccupiedContract_(c) {
  return !!c && (c.status === 'ساري' || c.status === 'شارف على الانتهاء');
}

function isActiveOnlyContract_(c) {
  return !!c && c.status === 'ساري';
}

function isExpiringContract_(c) {
  return !!c && c.status === 'شارف على الانتهاء';
}

function getContractComparableEnd_(c) {
  if (!c || !c.end) return new Date(8640000000000000);
  var d = new Date(String(c.end).replace(/-/g, '/'));
  if (isNaN(d.getTime())) return new Date(8640000000000000);
  return d;
}

function pickBestUnitContract_(current, candidate) {
  if (!current) return candidate;
  var curOcc = isOccupiedContract_(current);
  var candOcc = isOccupiedContract_(candidate);

  // العقد المشغول أهم من المنتهي دائماً
  if (candOcc && !curOcc) return candidate;
  if (!candOcc && curOcc) return current;

  // إذا الاثنين مشغولين أو الاثنين غير مشغولين، اختر الأحدث نهاية
  var cEnd = getContractComparableEnd_(current);
  var nEnd = getContractComparableEnd_(candidate);
  return nEnd >= cEnd ? candidate : current;
}

function buildOccupancySummary_(contracts, buildings) {
  contracts = contracts || [];
  buildings = buildings || [];

  var buildingInfoByKey = {};
  buildings.forEach(function(b) {
    var key = occNormKey_(b && b.name);
    if (!key) return;
    buildingInfoByKey[key] = b;
  });

  var summaryByKey = {};

  function ensureSummary_(buildingName) {
    var cleanName = occNormText_(buildingName);
    var key = occNormKey_(cleanName);
    if (!key) return null;

    if (!summaryByKey[key]) {
      var bInfo = buildingInfoByKey[key] || null;
      summaryByKey[key] = {
        key: key,
        name: bInfo ? bInfo.name : cleanName,
        totalUnits: bInfo && bInfo.totalUnits > 0 ? Number(bInfo.totalUnits) : 0,
        activeContracts: 0,
        expiringContracts: 0,
        expiredContracts: 0,
        occupiedContracts: 0,
        occupiedUnitsSet: {},
        allUnitsSet: {},
        duplicateOccupiedUnits: [],
        conflicts: [],
        annualRent: 0,
        monthlyRent: 0,
        paid: 0
      };
    }
    return summaryByKey[key];
  }

  // أضف كل المباني حتى التي لا تحتوي عقود
  buildings.forEach(function(b) { if (b && b.name) ensureSummary_(b.name); });

  contracts.forEach(function(c) {
    var s = ensureSummary_(c.building);
    if (!s) return;

    var unitKey = occNormKey_(c.unit);
    if (unitKey) s.allUnitsSet[unitKey] = occNormText_(c.unit);

    if (isActiveOnlyContract_(c)) s.activeContracts++;
    else if (isExpiringContract_(c)) s.expiringContracts++;
    else if (c.status === 'منتهي') s.expiredContracts++;

    if (isOccupiedContract_(c)) {
      s.occupiedContracts++;
      if (unitKey) {
        if (s.occupiedUnitsSet[unitKey]) {
          s.duplicateOccupiedUnits.push(occNormText_(c.unit));
          s.conflicts.push({
            building: s.name,
            unit: occNormText_(c.unit),
            tenant: c.tenant,
            row: c.row
          });
        }
        s.occupiedUnitsSet[unitKey] = occNormText_(c.unit);
      }
    }
  });

  var out = {};
  Object.keys(summaryByKey).forEach(function(key) {
    var s = summaryByKey[key];
    var allUnitsCount = Object.keys(s.allUnitsSet).length;
    var occupiedUnitsCount = Object.keys(s.occupiedUnitsSet).length;
    var totalUnits = s.totalUnits > 0 ? s.totalUnits : allUnitsCount;
    // حتى لا يظهر الشاغر بالسالب إذا كانت بيانات المبنى ناقصة
    if (occupiedUnitsCount > totalUnits) totalUnits = occupiedUnitsCount;

    out[s.name] = {
      key: key,
      name: s.name,
      totalUnits: totalUnits,
      occupiedUnits: occupiedUnitsCount,
      vacantUnits: Math.max(0, totalUnits - occupiedUnitsCount),
      occupancyPct: totalUnits > 0 ? Math.round(occupiedUnitsCount / totalUnits * 100) : 0,
      active: s.activeContracts,
      expiring: s.expiringContracts,
      expired: s.expiredContracts,
      occupiedContracts: s.occupiedContracts,
      duplicateOccupiedUnits: s.duplicateOccupiedUnits,
      conflicts: s.conflicts
    };
  });

  return out;
}


// مجموعة معرّفات/صفوف العقود القائمة (getContracts يستبعد المحذوف مبدئياً).
// تُستخدم لاستبعاد دفعات العقود المحذوفة من حسابات المحصّل عند القراءة فقط،
// دون حذف أي صف من سجل الدفعات — فإذا اُسترجع العقد عادت دفعاته للاحتساب.
function _liveContractSets_(contracts) {
  var ids = {}, rows = {};
  (contracts || []).forEach(function(c) {
    if (c.id) ids[String(c.id)] = true;
    if (c.row) rows[String(c.row)] = true;
  });
  return { ids: ids, rows: rows };
}
function _paymentOnLiveContract_(p, live) {
  if (!p) return false;
  if (p.contractId) return !!live.ids[String(p.contractId)];   // المفتاح الأساسي: معرّف العقد
  return !!(p.row && live.rows[String(p.row)]);                 // دفعات قديمة بلا معرّف: مطابقة بالصف
}

// حساب موحّد لمالية السنة الحالية — يُستخدم في لوحة التحكم (getDashboardStats) وقسم المالية
// (getFinancialStats) لضمان تطابق الأرقام في كل الشاشات.
// • المتوقع: من كل العقود، موزّعاً على الأشهر بنسبة الأيام النشطة (يشمل الجزء المستحق من
//   العقود المنتهية خلال السنة) — بنفس منطق قسم المالية.
// • المحصّل: مجموع الدفعات المؤرَّخة في السنة الحالية من سجل الدفعات، للعقود القائمة فقط
//   (المصدر الوحيد للحقيقة) — لا يُحتسب رصيد افتتاحي أُدخل في حقل "المدفوع" دون دفعة مؤرَّخة،
//   ولا دفعات عقود محذوفة/تجريبية.
function computeYearFinancials_(contracts, payments, thisYear, monthOneBased) {
  var live = _liveContractSets_(contracts);
  var annualExpectedRaw = 0, monthlyExpectedRaw = 0;
  (contracts || []).forEach(function(c) {
    if (!c.start || !c.rent) return;
    for (var m = 1; m <= 12; m++) {
      var e = contractExpectedForMonth_(c, thisYear, m);
      annualExpectedRaw += e;
      if (m === monthOneBased) monthlyExpectedRaw += e;
    }
  });
  var collectedRaw = 0;
  (payments || []).forEach(function(p) {
    if (!_paymentOnLiveContract_(p, live)) return;   // تجاهل دفعات العقود المحذوفة
    var d = parseStoredDate_(p.date);
    if (d && d.getFullYear() === thisYear) collectedRaw += p.amount;
  });
  return {
    annualExpected:  Math.round(annualExpectedRaw),
    monthlyExpected: Math.round(monthlyExpectedRaw),
    collected:       Math.round(collectedRaw),
    remaining:       Math.round(annualExpectedRaw - collectedRaw),
    collectRate:     annualExpectedRaw > 0 ? Math.round(collectedRaw / annualExpectedRaw * 100) : 0
  };
}

function getDashboardStats() {
  const auth = requireLogin_(); if (auth) return auth;
  var _dck = 'dash_v1_' + (hasPermission('finance.view') ? '1' : '0');
  var _dcached = _scGet_(_dck); if (_dcached) return _dcached;

  const contracts = getContracts();
  const buildings = getBuildings();

  const occupiedContracts = contracts.filter(isOccupiedContract_);
  const active   = contracts.filter(isActiveOnlyContract_);
  const expiring = contracts.filter(isExpiringContract_);
  const expired  = contracts.filter(function(c){ return c.status === 'منتهي'; });
  const noPay    = occupiedContracts.filter(function(c){ return c.paid === 0 && c.rent > 0; });
  const urgent   = contracts.filter(function(c){ return c.daysLeft !== null && c.daysLeft <= 30 && c.daysLeft >= -7; });

  const thisYear = new Date().getFullYear();
  const thisMonth = new Date().getMonth() + 1;
  const payments = getPaymentsRows_();
  const hasPaymentLog = payments.length > 0;
  const paidThisYearByContractId = {};
  const paidThisYearByRow = {};

  payments.forEach(function(p) {
    const d = parseStoredDate_(p.date);
    if (!d || d.getFullYear() !== thisYear) return;
    if (p.contractId) paidThisYearByContractId[p.contractId] = (paidThisYearByContractId[p.contractId] || 0) + p.amount;
    if (p.row) paidThisYearByRow[p.row] = (paidThisYearByRow[p.row] || 0) + p.amount;
  });

  function expectedForCurrentYear_(c) {
    var total = 0;
    for (var m = 1; m <= 12; m++) total += contractExpectedForMonth_(c, thisYear, m);
    return total;
  }

  function paidForCurrentYear_(c) {
    if (!hasPaymentLog) return 0;
    return (c.id && paidThisYearByContractId[c.id]) || paidThisYearByRow[c.row] || 0;
  }

  // مالية السنة موحّدة مع قسم المالية (نفس الأساس ونفس الأرقام في كل الشاشات):
  // المتوقع من كل العقود موزّعاً شهرياً، والمحصّل الفعلي من سجل الدفعات لهذا العام.
  const _yf = computeYearFinancials_(contracts, payments, thisYear, thisMonth);
  const annualRent  = _yf.annualExpected;
  const monthlyRent = _yf.monthlyExpected;
  const totalPaid   = _yf.collected;

  // ملخص إشغال موحّد لكل النظام
  const occupancy = buildOccupancySummary_(contracts, buildings);

  // أضف الأرقام المالية لكل مبنى إلى نفس الملخص
  occupiedContracts.forEach(function(c) {
    var bKey = occNormKey_(c.building);
    var targetName = null;
    Object.keys(occupancy).some(function(name) {
      if (occupancy[name].key === bKey) { targetName = name; return true; }
      return false;
    });
    if (!targetName) return;
    occupancy[targetName].annualRent = (occupancy[targetName].annualRent || 0) + expectedForCurrentYear_(c);
    occupancy[targetName].monthlyRent = (occupancy[targetName].monthlyRent || 0) + contractExpectedForMonth_(c, thisYear, thisMonth);
    occupancy[targetName].paid = (occupancy[targetName].paid || 0) + paidForCurrentYear_(c);
  });

  const bldgStats = {};
  Object.keys(occupancy).forEach(function(name) {
    var d = occupancy[name];
    var annual = Math.round(d.annualRent || 0);
    var paid = Math.round(d.paid || 0);
    bldgStats[name] = {
      active: d.active,
      expiring: d.expiring,
      expired: d.expired,
      occupiedContracts: d.occupiedContracts,
      annualRent: annual,
      monthlyRent: Math.round(d.monthlyRent || 0),
      paid: paid,
      remaining: Math.round(annual - paid),
      collectRate: annual > 0 ? Math.round(paid / annual * 100) : 0,
      totalUnits: d.totalUnits,
      occupiedUnits: d.occupiedUnits,
      vacantUnits: d.vacantUnits,
      occupancyPct: d.occupancyPct,
      rent: annual,
      duplicateOccupiedUnits: d.duplicateOccupiedUnits || [],
      conflicts: d.conflicts || []
    };
  });

  const canViewFinance = hasPermission('finance.view');
  if (!canViewFinance) {
    Object.keys(bldgStats).forEach(function(k) {
      bldgStats[k].annualRent = 0;
      bldgStats[k].monthlyRent = 0;
      bldgStats[k].paid = 0;
      bldgStats[k].remaining = 0;
      bldgStats[k].collectRate = 0;
      bldgStats[k].rent = 0;
    });
  }

  var _dashResult = {
    canViewFinance: canViewFinance,
    counts: {
      // واضح ومترابط: الساري وحده، وشارف وحده، والمنتهي وحده
      active: active.length,
      expiring: expiring.length,
      expired: expired.length,
      occupiedContracts: occupiedContracts.length,
      noPay: noPay.length,
      urgent: urgent.length,
      total: contracts.length
    },
    financials: canViewFinance ? {
      annualRent: annualRent,
      monthlyRent: monthlyRent,
      totalRent: annualRent,
      totalPaid: totalPaid,
      remaining: _yf.remaining,
      collectRate: _yf.collectRate
    } : {
      annualRent: 0, monthlyRent: 0, totalRent: 0, totalPaid: 0, remaining: 0, collectRate: 0
    },
    byBuilding: bldgStats,
    urgentContracts: canViewFinance ? urgent.slice(0,15) : urgent.slice(0,15).map(function(c){ c.rent=0; c.paid=0; c.remaining=0; c.payPct=0; return c; }),
    noPayContracts:  canViewFinance ? noPay.slice(0,15) : noPay.slice(0,15).map(function(c){ c.rent=0; c.paid=0; c.remaining=0; c.payPct=0; return c; }),
  };
  _scSet_(_dck, _dashResult, 300);
  return _dashResult;
}

function getFinancialStats() {
  const auth = requirePerm_('finance.view'); if (auth) return auth;
  var _fcached = _scGet_('fin_v1'); if (_fcached) return _fcached;
  const contracts = getContracts();
  const payments = getPaymentsRows_();
  const today     = new Date();
  const thisYear  = today.getFullYear();
  const thisMonth = today.getMonth();

  // مبدأ v9.8 المالي:
  // حقل "الإيجار" في العقود يُعامل كإجمالي قيمة العقد كاملة، وليس شهرياً ولا سنوياً.
  // لذلك المتوقع الشهري = قيمة العقد موزعة على مدة العقد الفعلية ومحتسبة بنسبة الأيام النشطة داخل الشهر.
  const monthlyData = {};
  for (let m = 1; m <= 12; m++) {
    monthlyData[m] = { name: getArMonth(m), expected: 0, collected: 0, contracts: 0 };
  }

  const years = {};
  for (let y = thisYear - 4; y <= thisYear + 1; y++) {
    years[y] = { rent: 0, paid: 0, contracts: 0 };
  }

  const contractYearSeen = {};
  contracts.forEach(function(c) {
    if (!c.start || !c.rent) return;
    Object.keys(years).forEach(function(yStr) {
      const y = parseInt(yStr, 10);
      let contractExpectedInYear = 0;
      for (let m = 1; m <= 12; m++) {
        const expected = contractExpectedForMonth_(c, y, m);
        if (expected > 0) {
          contractExpectedInYear += expected;
          if (y === thisYear) {
            monthlyData[m].expected += expected;
            monthlyData[m].contracts++;
          }
        }
      }
      if (contractExpectedInYear > 0) {
        years[y].rent += contractExpectedInYear;
        const key = (c.id || c.row || c.tenant || '') + '_' + y;
        if (!contractYearSeen[key]) { years[y].contracts++; contractYearSeen[key] = true; }
      }
    });
  });

  // التحصيل الشهري والسنوي من سجل الدفعات الفعلي فقط حسب تاريخ الدفعة، وللعقود القائمة فقط
  // (تُستبعد دفعات العقود المحذوفة/التجريبية حتى لا يتضخّم المحصّل — نفس أساس لوحة التحكم).
  // إذا كان سجل الدفعات فارغاً، لا نخمن ولا ننقل أرصدة قديمة إلى الشهر الحالي.
  const _liveFin = _liveContractSets_(contracts);
  const hasPaymentLog = payments.length > 0;
  if (hasPaymentLog) {
    payments.forEach(function(p) {
      if (!_paymentOnLiveContract_(p, _liveFin)) return;
      const pDate = parseStoredDate_(p.date);
      if (!pDate) return;
      const y = pDate.getFullYear();
      if (years[y]) years[y].paid += p.amount;
      if (y === thisYear) {
        const m = pDate.getMonth() + 1;
        monthlyData[m].collected += p.amount;
        monthlyData[m].contracts++;
      }
    });
  } else {
    // لا يوجد سجل دفعات موثوق: لا نخمّن تاريخ التحصيل من حقل "ما تم سداده".
    // يبقى المحصل الشهري/السنوي صفراً حتى تُسجل الدفعات في سجل_الدفعات.
  }

  // المحصّل الفعلي لكامل السنة الحالية (كل الأشهر) — لا يُقصَر على الشهر الحالي حتى يتطابق
  // مع لوحة التحكم وجدولَي الأشهر/السنوات، ولا تُستبعد أي دفعة مؤرَّخة في السنة نفسها.
  let yearCollected = 0;
  for (let m = 1; m <= 12; m++) yearCollected += monthlyData[m].collected;
  let yearExpected = 0;
  for (let m = 1; m <= 12; m++) yearExpected += monthlyData[m].expected;

  // حسب المبنى — نفس أساس السنة الحالية: المتوقع لهذه السنة + المحصل الفعلي لهذه السنة.
  const paidByContractId = {};
  const paidByRow = {};
  payments.forEach(function(p){
    const d = parseStoredDate_(p.date); if (!d || d.getFullYear() !== thisYear) return;
    if (p.contractId) paidByContractId[p.contractId] = (paidByContractId[p.contractId] || 0) + p.amount;
    if (p.row) paidByRow[p.row] = (paidByRow[p.row] || 0) + p.amount;
  });
  const byBuilding = {};
  const tenantSums = {};
  contracts.forEach(function(c) {
    if (!c.tenant && !c.building) return;
    let expectedYear = 0;
    for (let m = 1; m <= 12; m++) expectedYear += contractExpectedForMonth_(c, thisYear, m);
    const paidYear = hasPaymentLog
      ? ((c.id && paidByContractId[c.id]) || paidByRow[c.row] || 0)
      : 0;
    if (c.building) {
      if (!byBuilding[c.building]) byBuilding[c.building] = { rent: 0, paid: 0, contracts: 0 };
      byBuilding[c.building].rent += expectedYear;
      byBuilding[c.building].paid += paidYear;
      if (expectedYear > 0 || paidYear > 0) byBuilding[c.building].contracts++;
    }
    if (c.tenant) {
      if (!tenantSums[c.tenant]) tenantSums[c.tenant] = { rent: 0, paid: 0, contracts: 0 };
      tenantSums[c.tenant].rent += expectedYear;
      tenantSums[c.tenant].paid += paidYear;
      if (expectedYear > 0 || paidYear > 0) tenantSums[c.tenant].contracts++;
    }
  });

  const topTenants = Object.entries(tenantSums)
    .map(([n, d]) => ({ name: n, rent: Math.round(d.rent), paid: Math.round(d.paid), contracts: d.contracts }))
    .sort((a, b) => b.paid - a.paid)
    .slice(0, 10);

  const currentMonthExpected = monthlyData[thisMonth + 1] ? monthlyData[thisMonth + 1].expected : 0;
  const currentYearPaid = yearCollected;

  var _finResult = {
    summary: {
      annualRent: Math.round(yearExpected),
      monthlyRent: Math.round(currentMonthExpected),
      totalPaid: Math.round(currentYearPaid),
      remaining: Math.round(yearExpected - currentYearPaid),
      collectRate: yearExpected > 0 ? Math.round(currentYearPaid / yearExpected * 100) : 0,
      activeContracts: contracts.filter(function(c){ return contractExpectedForMonth_(c, thisYear, thisMonth + 1) > 0; }).length,
      avgContractValue: contracts.length > 0 ? Math.round(yearExpected / Math.max(1, contracts.length)) : 0
    },
    currentYear: {
      year: thisYear,
      collected: Math.round(yearCollected),
      expected: Math.round(yearExpected),
      remaining: Math.round(yearExpected - yearCollected),
      progress: yearExpected > 0 ? Math.round(yearCollected / yearExpected * 100) : 0,
      monthsPassed: thisMonth + 1
    },
    yearly: Object.entries(years).map(([y, d]) => ({
      year: parseInt(y, 10), rent: Math.round(d.rent), paid: Math.round(d.paid), contracts: d.contracts,
      collectRate: d.rent > 0 ? Math.round(d.paid / d.rent * 100) : 0
    })),
    monthly: Object.entries(monthlyData).map(([m, d]) => ({
      month: parseInt(m, 10), name: d.name,
      expected: Math.round(d.expected),
      collected: Math.round(d.collected),
      contracts: d.contracts,
      isPast: parseInt(m, 10) <= thisMonth + 1
    })),
    byBuilding: Object.entries(byBuilding).map(([n, d]) => ({
      name: n, rent: Math.round(d.rent), paid: Math.round(d.paid), remaining: Math.round(d.rent - d.paid),
      contracts: d.contracts,
      collectRate: d.rent > 0 ? Math.round(d.paid / d.rent * 100) : 0
    })),
    topTenants: topTenants,
    meta: {
      hasPaymentLog: hasPaymentLog,
      warning: hasPaymentLog ? '' : 'لا يوجد سجل دفعات فعلي؛ تم عرض التحصيلات الشهرية والسنوية بصفر بدلاً من تخمين تاريخ الدفعات من الرصيد القديم.'
    },
    aging: getAgingReport()
  };
  _scSet_('fin_v1', _finResult, 300);
  return _finResult;
}

function getArMonth(m) {
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return names[m-1] || String(m);
}

function getBuildingMap(buildingName) {
  const auth = requirePerm_('buildings.view'); if (auth) return auth;

  buildingName = occNormText_(buildingName);
  const buildingKey = occNormKey_(buildingName);

  const contracts = getContracts();
  const buildings = getBuildings();
  const bInfo = buildings.find(function(b){ return occNormKey_(b.name) === buildingKey; }) || null;
  const bContracts = contracts.filter(function(c){ return occNormKey_(c.building) === buildingKey; });

  // عقد واحد ممثل لكل وحدة، مع تفضيل العقد المشغول على المنتهي
  const unitMap = {};
  const unitHistory = {};
  const duplicateOccupied = {};

  bContracts.forEach(function(c) {
    const unitClean = occNormText_(c.unit);
    const unitKey = occNormKey_(unitClean);
    if (!unitKey) return;

    if (!unitHistory[unitClean]) unitHistory[unitClean] = [];
    unitHistory[unitClean].push({
      tenant: c.tenant,
      start: c.start,
      end: c.end,
      status: c.status,
      rent: c.rent,
      paid: c.paid,
      row: c.row
    });

    if (isOccupiedContract_(c) && unitMap[unitKey] && isOccupiedContract_(unitMap[unitKey])) {
      duplicateOccupied[unitKey] = true;
    }

    unitMap[unitKey] = pickBestUnitContract_(unitMap[unitKey], c);
  });

  const totalUnits = bInfo && bInfo.totalUnits > 0 ? Number(bInfo.totalUnits) : Object.keys(unitMap).length;
  const units = [];
  const knownUnits = {};

  if (bInfo && bInfo.totalUnits > 0) {
    for (let i = 1; i <= bInfo.totalUnits; i++) {
      const uStr = String(i);
      const uKey = occNormKey_(uStr);
      knownUnits[uKey] = true;
      if (!unitMap[uKey]) {
        units.push({
          unit: uStr,
          status: 'فارغة',
          tenant: '',
          phone: '',
          rent: 0,
          end: '',
          daysLeft: null,
          row: null,
          type: ''
        });
      }
    }
  }

  Object.keys(unitMap).forEach(function(unitKey) {
    const c = unitMap[unitKey];
    const u = occNormText_(c.unit);
    knownUnits[unitKey] = true;

    let uStatus = 'فارغة';
    if (c.status === 'ساري') uStatus = 'مشغولة';
    else if (c.status === 'شارف على الانتهاء') uStatus = 'تشارف انتهاء';
    else if (c.status === 'منتهي') uStatus = 'فارغة';

    units.push({
      unit: u,
      status: uStatus,
      tenant: isOccupiedContract_(c) ? c.tenant : '',
      phone: isOccupiedContract_(c) ? c.phone : '',
      rent: isOccupiedContract_(c) ? c.rent : 0,
      end: c.end,
      daysLeft: c.daysLeft,
      row: c.row,
      type: c.type,
      contractId: c.id,
      hasDuplicateOccupiedContract: !!duplicateOccupied[unitKey]
    });
  });

  units.sort(function(a,b) {
    const an = parseInt(a.unit, 10);
    const bn = parseInt(b.unit, 10);
    const av = isNaN(an) ? 999999 : an;
    const bv = isNaN(bn) ? 999999 : bn;
    if (av !== bv) return av - bv;
    return String(a.unit).localeCompare(String(b.unit), 'ar');
  });

  Object.keys(unitHistory).forEach(function(u) {
    unitHistory[u].sort(function(a,b){ return compareDates(b.start, a.start); });
  });

  const occupiedUnits = units.filter(function(u){ return u.status === 'مشغولة' || u.status === 'تشارف انتهاء'; }).length;
  const expiringUnits = units.filter(function(u){ return u.status === 'تشارف انتهاء'; }).length;
  const vacantUnits = units.filter(function(u){ return u.status === 'فارغة'; }).length;

  return {
    buildingName: bInfo ? bInfo.name : buildingName,
    units: units,
    unitHistory: unitHistory,
    totalUnits: totalUnits,
    bInfo: bInfo,
    summary: {
      occupiedUnits: occupiedUnits,
      expiringUnits: expiringUnits,
      vacantUnits: vacantUnits,
      occupancyPct: units.length > 0 ? Math.round(occupiedUnits / units.length * 100) : 0,
      duplicateOccupiedUnits: Object.keys(duplicateOccupied).length
    }
  };
}


// ───────────────────────────────────────────────
// سجل المستأجر — كل عقوده
// ───────────────────────────────────────────────
function getTenantContracts(tenantName) {
  const auth = requirePerm_('tenants.view'); if (auth) return auth;
  const contracts = getContracts();
  const history   = contracts.filter(c => c.tenant===tenantName)
    .sort((a,b) => compareDates(b.start, a.start));
  const totalPaid = history.reduce((s,c)=>s+c.paid,0);
  const totalRent = history.reduce((s,c)=>s+c.rent,0);
  return { tenantName, history, totalPaid, totalRent, contractsCount:history.length };
}


// ───────────────────────────────────────────────
// تواريخ الاستحقاق — حساب من جدولة السداد
// ───────────────────────────────────────────────
// [تم حذف نسخة مكررة قديمة من الدالة: calculateDueDates]
// [تم حذف نسخة مكررة قديمة من الدالة: getUpcomingDueDates]


// ───────────────────────────────────────────────
// CRUD — العقود
// ───────────────────────────────────────────────
// [تم حذف نسخة مكررة قديمة من الدالة: addContract]


function checkUnitOccupied(building, unit, excludeRow) {
  const contracts = getContracts();
  return contracts.find(c =>
    c.building === building &&
    String(c.unit).trim() === String(unit).trim() &&
    (c.status === 'ساري' || c.status === 'شارف على الانتهاء') &&
    c.row !== excludeRow
  );
}


// يضمن وجود عمود "رقم الهوية" في الموقع 18 من شيت العقود
function ensureIdNoColumn(sheet) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 18) {
    const cell = sheet.getRange(1, 18);
    cell.setValue('رقم الهوية');
    cell.setBackground('#1A3A5C').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.setColumnWidth(18, 110);
  } else if (sheet.getRange(1, 18).getValue() !== 'رقم الهوية') {
    // إذا العمود 18 موجود بقيمة أخرى، لا نعدله — الهوية ستذهب بعده
  }
}

function ensureBuildingExists(name, type) {
  if (!name) return;
  const bSheet = getSheet(CFG.SHEETS.BUILDINGS);
  if (!bSheet) return;
  const buildings = getBuildings();
  if (buildings.find(b => b.name === name)) return;
  // أضف المبنى تلقائياً بقيم افتراضية
  bSheet.appendRow([sanitizeCell_(name), sanitizeCell_(type || 'سكني'), 1, 1, 'أُضيف تلقائياً']);
  SpreadsheetApp.flush();
}
// [تم حذف نسخة مكررة قديمة من الدالة: updateContract]
// [تم حذف نسخة مكررة قديمة من الدالة: deleteContract]
// [تم حذف نسخة مكررة قديمة من الدالة: addPayment]

// ───────────────────────────────────────────────
// CRUD — المباني
// ───────────────────────────────────────────────
function addBuilding(data) {
  const auth = requirePerm_('buildings.add'); if (auth) return auth;
  if (!data || !str(data.name)) return {error:'اسم المبنى مطلوب'};
  return withLock_(function(){
  // ينشئ الشيت تلقائياً إذا لم يكن موجوداً (بالبنية الكاملة)
  const sheet = getOrCreateSheet(CFG.SHEETS.BUILDINGS,
    ['اسم المبنى','النوع','عدد الأدوار','الوحدات الإجمالية',
     'مشغولة حالياً','فارغة','نسبة الإشغال',
     'إيجار العقود السارية','إجمالي المحصّل','نسبة التحصيل','ملاحظات'], '#276749');
  // تحقق من عدم التكرار
  const existing = getBuildings();
  if (existing.find(b=>b.name===data.name)) return {error:'المبنى موجود مسبقاً'};
  // الصف الجديد: نضع 0 في الإحصائيات (تُحسَب من الصيغ أو الداشبورد)
  const row = sheet.getLastRow() + 1;
  sheet.appendRow([
    sanitizeCell_(data.name), sanitizeCell_(data.type||'سكني'),
    parseInt(data.floors)||1, parseInt(data.totalUnits)||0,
    0,  // مشغولة (تُحدَّث من Backend)
    '=D'+row+'-E'+row,  // فارغة (صيغة)
    '=IF(D'+row+'>0,E'+row+'/D'+row+',0)',  // نسبة الإشغال
    0, 0,  // إيجار، محصّل (تُحدَّث من Backend)
    '=IF(H'+row+'>0,I'+row+'/H'+row+',0)',  // نسبة التحصيل
    sanitizeCell_(data.notes||'')
  ]);
  SpreadsheetApp.flush();
  invalidateRuntimeCaches_();
  try { logActivity(currentUser() || 'system', 'إضافة', 'مباني', 'مبنى جديد: ' + (data.name||'')); } catch(e) {}
  return {success:true, message:'تمت إضافة المبنى بنجاح'};
  });
}

function updateBuilding(rowNum, data) {
  const auth = requirePerm_('buildings.edit'); if (auth) return auth;
  if (!data || !str(data.name)) return {error:'اسم المبنى مطلوب'};
  return withLock_(function(){
  rowNum = safeRowNum_(rowNum);
  const sheet = getSheet(CFG.SHEETS.BUILDINGS);
  // نحدّث الأعمدة القابلة للتحرير فقط (نترك الصيغ كما هي)
  [
    [BC.NAME, sanitizeCell_(data.name)],
    [BC.TYPE, sanitizeCell_(data.type)],
    [BC.FLOORS, parseInt(data.floors)||1],
    [BC.TOTAL_UNITS, parseInt(data.totalUnits)||0],
    [BC.NOTES, sanitizeCell_(data.notes||'')]
  ].forEach(([col,val]) => sheet.getRange(rowNum, col+1).setValue(val));
  SpreadsheetApp.flush();
  invalidateRuntimeCaches_();
  try { logActivity(currentUser() || 'system', 'تعديل', 'مباني', 'تعديل مبنى صف ' + rowNum); } catch(e) {}
  return {success:true, message:'تم تحديث المبنى'};
  });
}

function deleteBuilding(rowNum) {
  // للمحافظة على التقارير والعقود، لا نحذف المبنى نهائياً. الأرشفة متاحة للمدير فقط.
  return archiveBuilding(rowNum);
}

function archiveBuilding(rowNum) {
  const authAdmin = requirePerm_('users.manage'); if (authAdmin) return authAdmin;
  const auth = requirePerm_('buildings.delete'); if (auth) return auth;
  return withLock_(function(){
    rowNum = safeRowNum_(rowNum);
    const sheet = getSheet(CFG.SHEETS.BUILDINGS);
    if (!sheet) return {error:'شيت المباني غير موجود'};
    ensureBuildingArchiveColumns_(sheet);
    const name = str(sheet.getRange(rowNum, BC.NAME+1).getValue());
    if (!name) return {error:'المبنى غير موجود'};
    const hasContracts = getContracts().some(function(c){ return c.building === name; });
    const archivedAt = fmtDatetime(new Date());
    const archivedBy = currentUser() || 'system';
    sheet.getRange(rowNum, BC.ARCHIVED+1).setValue('نعم');
    sheet.getRange(rowNum, BC.ARCHIVED_AT+1).setValue(archivedAt);
    sheet.getRange(rowNum, BC.ARCHIVED_BY+1).setValue(archivedBy);
    invalidateRuntimeCaches_();
    try { logActivity(archivedBy, 'أرشفة', 'مباني', 'أرشفة مبنى: ' + name + (hasContracts ? ' — توجد عقود مرتبطة، لذلك لم يتم الحذف النهائي' : '')); } catch(e) {}
    return {success:true, message:'تمت أرشفة المبنى دون حذف العقود المرتبطة'};
  });
}

// ───────────────────────────────────────────────
// تحديث سجل المستأجرين تلقائياً
// ───────────────────────────────────────────────
// [تم حذف نسخة مكررة قديمة من الدالة: updateTenantRecord]

function rebuildTenantRecords() {
  const auth = requirePerm_('contracts.edit'); if (auth) return auth;
  return withLock_(function(){
  const sheet = getOrCreateSheet(CFG.SHEETS.TENANTS,
    ['اسم المستأجر','رقم الجوال','عدد العقود','آخر مبنى','آخر وحدة',
     'آخر بداية','آخر نهاية','الحالة الحالية','إجمالي المدفوع','نسبة الانتظام','ملاحظات','رقم الهوية'], '#92400E');
  // تأكد من وجود عمود الهوية
  if (sheet.getLastColumn() < 12) {
    sheet.getRange(1, 12).setValue('رقم الهوية')
      .setBackground('#1A3A5C').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  }
  const lastRow = sheet.getLastRow();
  if (lastRow>1) sheet.getRange(2, 1, lastRow-1, 12).clearContent();

  const contracts = getContracts();
  const tenantMap = {};
  contracts.forEach(c => {
    if (!c.tenant) return;
    if (!tenantMap[c.tenant]) tenantMap[c.tenant] = { phone:c.phone, idNo:c.idNo, contracts:[] };
    if (c.idNo && !tenantMap[c.tenant].idNo) tenantMap[c.tenant].idNo = c.idNo;
    tenantMap[c.tenant].contracts.push(c);
  });

  Object.entries(tenantMap).forEach(([name, d]) => {
    const last  = d.contracts.sort((a,b)=>compareDates(b.start,a.start))[0];
    const total = d.contracts.reduce((s,c)=>s+c.paid,0);
    const good  = d.contracts.filter(c=>c.regularity==='ملتزم').length;
    const score = d.contracts.length>0 ? Math.round(good/d.contracts.length*100)+'%' : '—';
    sheet.appendRow([
      sanitizeCell_(name), sanitizeCell_(d.phone||''), d.contracts.length,
      sanitizeCell_(last.building), sanitizeCell_(last.unit), sanitizeCell_(last.start||''), sanitizeCell_(last.end||''),
      sanitizeCell_(last.status), total, score, '', sanitizeCell_(d.idNo||'')
    ]);
  });
  SpreadsheetApp.flush();
  _scDel_('tnt_v1');
  return {success:true, count:Object.keys(tenantMap).length};
  });
}

// ───────────────────────────────────────────────
// تسوية أولية آلية للأرصدة الافتتاحية
// ───────────────────────────────────────────────
// تُشغَّل لمرة واحدة من محرِّر Apps Script (Run) — لا تحتاج جلسة، وليست مُسجَّلة في APIDispatcher
// فلا يمكن استدعاؤها من الويب. تقرأ الشيتات مباشرةً.
//
// الغرض: المبالغ التي أُدخلت في حقل "المدفوع" عند كتابة العقد (أرصدة افتتاحية) لا تظهر في
// "ما تم تحصيله" لأنها ليست دفعات مؤرَّخة في سجل الدفعات. هذه الدالة تسجّلها كدفعات بتاريخ
// بداية كل عقد، فتظهر في المحصّل ضمن سنة بداية العقد.
//
// آمنة وقابلة للتكرار (idempotent): تسجّل فقط الفرق غير المسجَّل = المدفوع − المسجَّل مسبقاً،
// فتشغيلها مرتين لا يُكرّر أي مبلغ. تعمل على العقود القائمة فقط (تتجاهل المحذوفة مبدئياً).
// خطوات آمنة قبل التشغيل: خذ نسخة احتياطية (backupNow). الإدخالات تحمل ملاحظة مميّزة
// "رصيد افتتاحي (تسوية أولية آلية)" لتمييزها/إزالتها يدوياً عند الحاجة.
function backfillOpeningBalances() {
  const cSheet = getSheet(CFG.SHEETS.CONTRACTS);
  if (!cSheet || cSheet.getLastRow() < 2) return { success: false, error: 'لا توجد عقود' };
  const cRows = cSheet.getDataRange().getValues();

  // اجمع المبالغ المسجَّلة مسبقاً لكل عقد من سجل الدفعات (بالمعرّف أساساً، وبالصف احتياطاً)
  const pSheet = getSheet(CFG.SHEETS.PAYMENTS);
  const loggedById = {}, loggedByRow = {};
  if (pSheet && pSheet.getLastRow() >= 2) {
    const pRows = pSheet.getDataRange().getValues();
    for (let i = 1; i < pRows.length; i++) {
      const cid = String(pRows[i][PC.CONTRACT_ID] || '');
      const rw  = String(pRows[i][PC.ROW] || '');
      const amt = parseNum(pRows[i][PC.AMOUNT]);
      if (cid) loggedById[cid] = (loggedById[cid] || 0) + amt;
      if (rw)  loggedByRow[rw] = (loggedByRow[rw] || 0) + amt;
    }
  }

  const newRows = [];
  let count = 0, total = 0;
  for (let i = 1; i < cRows.length; i++) {
    const r = cRows[i];
    if (isContractDeletedRow_(r)) continue;
    const paid = parseNum(r[C.PAID]);
    if (paid <= 0) continue;
    const id = String(r[C.ID] || '');
    const rowNum = i + 1; // صف الشيت (الرأس في الصف 1)
    const logged = (id && loggedById[id]) || loggedByRow[String(rowNum)] || 0;
    const opening = paid - logged;
    if (opening <= 0.01) continue; // مُسجَّل بالكامل — لا شيء نضيفه
    const rent = parseNum(r[C.RENT]);
    const sd = r[C.START] ? new Date(r[C.START]) : null;
    const ts = (sd && !isNaN(sd.getTime())) ? fmtDatetime(sd) : fmtDatetime(new Date());
    newRows.push([
      ts, 'system', sanitizeCell_(id), rowNum, sanitizeCell_(str(r[C.TENANT])),
      sanitizeCell_(str(r[C.BUILDING])), sanitizeCell_(str(r[C.UNIT])),
      opening, logged, paid, Math.max(0, rent - paid),
      'رصيد افتتاحي (تسوية أولية آلية)'
    ]);
    count++; total += opening;
  }

  if (newRows.length) {
    const ps = ensurePaymentsSheet();
    ps.getRange(ps.getLastRow() + 1, 1, newRows.length, 12).setValues(newRows);
    SpreadsheetApp.flush();
  }
  __PAYMENTS_CACHE = null;
  invalidateRuntimeCaches_();
  try { logActivity('system', 'تسوية', 'دفعات', 'تسجيل أرصدة افتتاحية: ' + count + ' عقد — إجمالي ' + Math.round(total) + ' ر.س'); } catch(e) {}
  return { success: true, count: count, total: Math.round(total) };
}
// [تم حذف نسخة مكررة قديمة من الدالة: askAI]

function craftMsg(name, situation, rent, days) {
  const r = askAI(`اكتب رسالة SMS (أقل من 155 حرف) للمستأجر: ${name}. الموقف: ${situation}.${rent?' الإيجار: '+rent+' ر.س.':''}${days!==null?' الأيام: '+days:''} اكتب الرسالة فقط.`);
  return r.error ? `عزيزي ${name}، ${situation}. إدارة الأملاك.` : r.text.trim();
}


// ───────────────────────────────────────────────
// إرسال رسائل SMS عبر OurSMS
// ───────────────────────────────────────────────

function defaultSmsTemplates_() {
  return {
    renewal: 'عزيزي المستأجر، نود إعلامكم باقتراب نهاية عقد الإيجار. نرجو التواصل لتجديده. إدارة الأملاك.',
    payment: 'عزيزي المستأجر، نذكّركم بسداد الإيجار المستحق. شكراً لتعاونكم. إدارة الأملاك.',
    welcome: 'أهلاً بكم في مجمعنا. يسعدنا انضمامكم. للاستفسار تواصلوا مع الإدارة.',
    expire: 'عزيزي المستأجر، انتهى عقد إيجاركم. نرجو التواصل مع الإدارة لترتيب الإجراءات.',
    maintenance: 'عزيزي المستأجر، ستُجرى أعمال صيانة قريباً. نأسف على أي إزعاج. الإدارة.'
  };
}

function ensureSmsTemplatesSheet_() {
  const sheet = getOrCreateSheet(CFG.SHEETS.SMS_TEMPLATES, ['المفتاح','اسم القالب','نص الرسالة','آخر تعديل','بواسطة'], '#92400E');

  if (sheet.getLastRow() <= 1) {
    const labels = { renewal:'تجديد عقد', payment:'تذكير دفع', welcome:'ترحيب', expire:'إنهاء عقد', maintenance:'صيانة' };
    const d = defaultSmsTemplates_();
    Object.keys(d).forEach(function(k) {
      sheet.appendRow([k, labels[k] || k, d[k], fmtDatetime(new Date()), 'system']);
    });
  }
  return sheet;
}

function getSmsTemplates() {
  const auth = requirePerm_('sms.send'); if (auth) return defaultSmsTemplates_();
  const out = defaultSmsTemplates_();
  try {
    const sheet = ensureSmsTemplatesSheet_();
    const rows = sheet.getDataRange().getValues().slice(1);
    rows.forEach(function(r) {
      const key = str(r[0]);
      const text = str(r[2]);
      if (key && text) out[key] = text;
    });
  } catch(e) {}
  return out;
}

function saveSmsTemplates(templates) {
  const auth = requirePerm_('sms.send'); if (auth) return auth;
  templates = templates || {};
  const defaults = defaultSmsTemplates_();
  const labels = { renewal:'تجديد عقد', payment:'تذكير دفع', welcome:'ترحيب', expire:'إنهاء عقد', maintenance:'صيانة' };
  const keys = Object.keys(defaults);

  return withLock_(function() {
    const sheet = ensureSmsTemplatesSheet_();
    const existing = sheet.getDataRange().getValues();
    const rowByKey = {};
    for (let i = 1; i < existing.length; i++) {
      const k = str(existing[i][0]);
      if (k) rowByKey[k] = i + 1;
    }

    keys.forEach(function(k) {
      let text = str(templates[k]);
      if (!text) text = defaults[k];
      if (text.length > 500) text = text.slice(0, 500);
      const row = [k, labels[k] || k, sanitizeCell_(text), fmtDatetime(new Date()), currentUser() || 'system'];
      if (rowByKey[k]) sheet.getRange(rowByKey[k], 1, 1, row.length).setValues([row]);
      else sheet.appendRow(row);
    });
    SpreadsheetApp.flush();
    try { logActivity(currentUser() || 'system', 'تعديل', 'رسائل', 'تحديث قوالب الرسائل'); } catch(e) {}
    return {success:true, message:'تم حفظ قوالب الرسائل'};
  });
}

function sendSingleSms(phone, message) {
  const auth = requirePerm_('sms.send'); if (auth) return auth;
  const rl = checkRateLimit_('SMS', SECURITY.SMS_LIMIT_PER_HOUR); if (rl) return rl;
  const formatted = formatPhone(phone);
  if (!formatted) return { success: false, reason: 'رقم غير صالح' };

  try {
    const res = UrlFetchApp.fetch('https://api.oursms.com/msgs/sms', {
      method:  'post',
      headers: {
        'Authorization': 'Bearer ' + CFG.OURSMS_TOKEN(),
        'Content-Type':  'application/json'
      },
      payload: JSON.stringify({
        src: CFG.OURSMS_SENDER(),
        dests: [formatted],
        body: message,
        priority: 0, delay: 0, validity: 60, maxParts: 3,
        transliteration: 'NONE'
      }),
      muteHttpExceptions: true
    });
    const ok = res.getResponseCode() === 200;
    logMessage({
      name: '', phone: formatted, message: message,
      status: ok ? '✅ أُرسلت' : '❌ فشل',
      building: '', unit: ''
    });
    try {
      logActivity(currentUser() || 'system', 'sms', 'message',
        'رسالة لـ ' + formatted + ' — ' + (ok ? 'نجح' : 'فشل'));
    } catch (e) {}
    return { success: ok, phone: formatted, code: res.getResponseCode() };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}
// [تم حذف نسخة مكررة قديمة من الدالة: sendBulkSms]
// [تم حذف نسخة مكررة قديمة من الدالة: sendExpiryReminders]
// [تم حذف نسخة مكررة قديمة من الدالة: sendPaymentReminders]

function sendToBuildingCustom(building, message, statusFilter) {
  const auth = requirePerm_('sms.send'); if (auth) return auth;
  const contracts = getContracts().filter(c =>
    (building === 'الكل' || c.building === building) &&
    (statusFilter === 'الكل' || c.status === statusFilter) &&
    c.phone && c.phone !== 'nan'
  );
  const targets = contracts.map(c => ({
    name: c.tenant, phone: c.phone, message: message,
    building: c.building, unit: c.unit
  }));
  const results = sendBulkSms(targets);
  return {
    sent:   results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    total:  targets.length
  };
}

// ───────────────────────────────────────────────
// سجل الرسائل
// ───────────────────────────────────────────────
function logMessage(d) {
  const sheet = getOrCreateSheet(CFG.SHEETS.LOG, ['التاريخ','الاسم','الجوال','الرسالة','الحالة','المبنى','الوحدة']);
  sheet.appendRow([fmtDatetime(new Date()), sanitizeCell_(d.name), sanitizeCell_(d.phone), sanitizeCell_(d.message), d.status, sanitizeCell_(d.building), sanitizeCell_(d.unit)]);
  _scDel_('MSG_LOG');
}

function getMessageLog() {
  const auth = requirePerm_('log.view'); if (auth) return [];
  var cached = _scGet_('MSG_LOG'); if (cached) return cached;
  const sheet = getSheet(CFG.SHEETS.LOG);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  var result = data.slice(1).reverse().slice(0,100).map(r=>({date:r[0],name:r[1],phone:r[2],message:r[3],status:r[4],building:r[5],unit:r[6]}));
  _scSet_('MSG_LOG', result, 180);
  return result;
}

// ───────────────────────────────────────────────
// استيراد البيانات المدمجة
// ───────────────────────────────────────────────
function importBuiltInData() {
  const auth = requireSetupAdmin_(); if (auth) return auth;
  // تم تعطيل بيانات الاستيراد المضمنة لحماية خصوصية المستأجرين.
  // استخدم Google Sheets أو ملف استيراد خارجي بدلاً من حفظ بيانات حقيقية داخل الكود.
  return { error: 'تم تعطيل الاستيراد المضمن لحماية البيانات. استخدم ملف الشيت المعتمد بدلاً من بيانات داخل الكود.' };
}



// ───────────────────────────────────────────────
// إعداد الشيتات (أول مرة)
// ───────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════
// إدارة المستخدمين والصلاحيات
// ═══════════════════════════════════════════════════════════════

const ROLES = {
  admin: {
    label: 'مدير عام',
    perms: [
      'contracts.view','contracts.add','contracts.edit','contracts.delete',
      'buildings.view','buildings.add','buildings.edit','buildings.delete',
      'tenants.view',
      'payments.add',
      'finance.view',
      'sms.send',
      'ai.use',
      'reports.export',
      'alerts.view',
      'log.view',
      'users.manage',   // إدارة المستخدمين
      'backup.run',     // النسخ الاحتياطي
      'activity.view'  // سجل العمليات
    ]
  },
  manager: {
    label: 'مدير فرعي',
    perms: [
      'contracts.view','contracts.add','contracts.edit','contracts.delete',
      'buildings.view','buildings.add','buildings.edit',
      'tenants.view',
      'payments.add',
      'finance.view',
      'sms.send',
      'ai.use',
      'reports.export',
      'alerts.view',
      'log.view'
    ]
  },
  employee: {
    label: 'موظف',
    perms: [
      'contracts.view','contracts.add','contracts.edit',
      'buildings.view',
      'tenants.view',
      'payments.add',
      'sms.send',
      'ai.use',
      'alerts.view'
    ]
  },
  viewer: {
    label: 'مشاهد',
    perms: [
      'contracts.view',
      'buildings.view',
      'tenants.view',
      'finance.view'
    ]
  }
};


// ═══════════════════════════════════════════════════════════════
// طبقة الأمان المركزية — لا تعتمد على إخفاء الأزرار فقط
// ═══════════════════════════════════════════════════════════════
const SECURITY = {
  SESSION_HOURS: 8,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCK_MINUTES: 10,
  AI_LIMIT_PER_HOUR: 30,
  SMS_LIMIT_PER_HOUR: 100
};

function getAuthSalt_() {
  const p = PropertiesService.getScriptProperties();
  let salt = p.getProperty('AUTH_SALT');
  if (!salt) {
    salt = Utilities.getUuid() + '_' + Date.now();
    p.setProperty('AUTH_SALT', salt);
  }
  return salt;
}

function hashPassword_(text) {
  if (!text) return '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, getAuthSalt_() + '_' + text);
  return bytes.map(b => ((b & 0xFF) + 0x100).toString(16).slice(1)).join('');
}

function legacyHashPassword_(text) {
  if (!text) return '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'jamiya2026_' + text);
  return bytes.map(b => ((b & 0xFF) + 0x100).toString(16).slice(1)).join('');
}

function isAccountLocked_(username) {
  username = String(username || '').toLowerCase().trim();
  if (!username) return false;
  const key = 'LOCK_' + username;
  const raw = CacheService.getScriptCache().get(key);
  return !!raw;
}

function registerFailedLogin_(username) {
  username = String(username || '').toLowerCase().trim();
  if (!username) return;
  const cache = CacheService.getScriptCache();
  const key = 'FAIL_' + username;
  const current = parseInt(cache.get(key) || '0', 10) + 1;
  cache.put(key, String(current), SECURITY.LOCK_MINUTES * 60);
  if (current >= SECURITY.MAX_LOGIN_ATTEMPTS) {
    cache.put('LOCK_' + username, '1', SECURITY.LOCK_MINUTES * 60);
    cache.remove(key);
  }
}

function clearFailedLogin_(username) {
  username = String(username || '').toLowerCase().trim();
  if (!username) return;
  const cache = CacheService.getScriptCache();
  cache.remove('FAIL_' + username);
  cache.remove('LOCK_' + username);
}

function rolePerms_(role) {
  return expandPerms_(ROLES[role] ? ROLES[role].perms : ROLES.employee.perms);
}


function allKnownPerms_() {
  var out = [];
  Object.keys(ROLES).forEach(function(role) {
    (ROLES[role].perms || []).forEach(function(p) {
      if (out.indexOf(p) < 0) out.push(p);
    });
  });
  return out;
}

function addPerm_(list, perm) {
  if (perm && list.indexOf(perm) < 0) list.push(perm);
}

// يضيف الصلاحيات التابعة الضرورية حتى لا نعطي صلاحية تنفيذ بلا صلاحية قراءة لازمة للتشغيل.
// مثال: من لديه إضافة عقد يحتاج عرض العقود لقراءة القائمة، وعرض المباني لاختيار المبنى.
function expandPerms_(perms) {
  var out = [];
  (perms || []).forEach(function(p) { addPerm_(out, String(p || '').trim()); });

  if (out.indexOf('contracts.add') >= 0 || out.indexOf('contracts.edit') >= 0 ||
      out.indexOf('contracts.delete') >= 0 || out.indexOf('payments.add') >= 0) {
    addPerm_(out, 'contracts.view');
  }
  if (out.indexOf('contracts.add') >= 0 || out.indexOf('contracts.edit') >= 0) {
    addPerm_(out, 'buildings.view');
    addPerm_(out, 'tenants.view');
  }
  if (out.indexOf('buildings.add') >= 0 || out.indexOf('buildings.edit') >= 0 ||
      out.indexOf('buildings.delete') >= 0) {
    addPerm_(out, 'buildings.view');
  }
  if (out.indexOf('sms.send') >= 0) {
    addPerm_(out, 'contracts.view');
    addPerm_(out, 'tenants.view');
  }
  if (out.indexOf('users.manage') >= 0) addPerm_(out, 'activity.view');
  return out;
}

function sanitizePerms_(perms) {
  if (!perms || !perms.length) return [];
  var allowed = allKnownPerms_();
  var clean = [];
  perms.forEach(function(p) {
    p = String(p || '').trim();
    // لا نحفظ مفاتيح التوافق القديمة مثل read/write/sms لأنها توسّع الصلاحيات بدون قصد.
    if (allowed.indexOf(p) >= 0 && clean.indexOf(p) < 0) clean.push(p);
  });
  clean = expandPerms_(clean);
  return clean.filter(function(p) { return allowed.indexOf(p) >= 0; });
}

function hasPermInList_(perms, perm) {
  if (!perm) return true;
  perms = perms || [];
  if (perms.indexOf('admin') >= 0) return true;
  if (perms.indexOf(perm) >= 0) return true;

  // توافق محدود جداً مع السجلات القديمة فقط:
  // إذا كانت القائمة تحتوي صلاحيات جديدة بصيغة module.action فلا نستخدم read/write/sms إطلاقاً.
  // هذا يمنع رجوع صلاحيات مثل المالية أو الرسائل بسبب مفاتيح قديمة محفوظة مع التخصيص.
  var hasNewStylePerm = perms.some(function(p) { return String(p).indexOf('.') > 0; });
  if (hasNewStylePerm) return false;

  var legacyMap = {
    'contracts.view':   ['read'],
    'contracts.add':    ['write'],
    'contracts.edit':   ['write'],
    'contracts.delete': ['delete'],
    'buildings.view':   ['read'],
    'buildings.add':    ['write'],
    'buildings.edit':   ['write'],
    'buildings.delete': ['delete'],
    'tenants.view':     ['read'],
    'payments.add':     ['write'],
    'sms.send':         ['sms'],
    'ai.use':           ['ai'],
    'reports.export':   ['export'],
    'alerts.view':     [],
    'log.view':        [],
    'users.manage':     ['users','admin'],
    'backup.run':       ['backup','admin'],
    'activity.view':    ['admin']
    // finance.view لا تُمنح تلقائياً من read حتى لا تظهر المالية للمستخدمين محدودي الصلاحية.
  };
  var legacy = legacyMap[perm] || [];
  for (var i = 0; i < legacy.length; i++) if (perms.indexOf(legacy[i]) >= 0) return true;
  return false;
}

function requireLogin_() {
  const session = getCurrentSession();
  if (!session) return { error: 'انتهت الجلسة أو لم يتم تسجيل الدخول. الرجاء تسجيل الدخول مرة أخرى.' };
  return null;
}

function requirePerm_(perm) {
  const session = getCurrentSession();
  if (!session) return { error: 'انتهت الجلسة أو لم يتم تسجيل الدخول. الرجاء تسجيل الدخول مرة أخرى.' };
  if (!hasPermInList_(session.perms || [], perm)) return { error: 'ليس لديك صلاحية لتنفيذ هذه العملية' };
  return null;
}


function checkRateLimit_(kind, maxPerHour) {
  const session = getCurrentSession();
  const user = session && session.username ? session.username : 'anonymous';
  const hourKey = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyyMMddHH');
  const key = 'RL_' + kind + '_' + user + '_' + hourKey;
  const cache = CacheService.getScriptCache();
  const current = parseInt(cache.get(key) || '0', 10);
  if (current >= maxPerHour) {
    return { error: 'تم الوصول للحد الأقصى خلال هذه الساعة. حاول لاحقاً.' };
  }
  cache.put(key, String(current + 1), 3700);
  return null;
}

function contractMonths_(startValue, endValue) {
  const start = startValue ? new Date(startValue) : null;
  if (!start || isNaN(start.getTime())) return 12;
  const end = endValue ? new Date(endValue) : new Date(start.getFullYear() + 1, start.getMonth(), start.getDate());
  if (isNaN(end.getTime()) || end < start) return 1;
  start.setHours(0,0,0,0);
  end.setHours(0,0,0,0);
  // حساب تقويمي محافظ لمدة العقد بالأشهر، مع اعتبار نهاية العقد شاملة.
  // أمثلة: 2026/01/18 إلى 2026/04/16 = 3 أشهر، 2026/01/01 إلى 2026/12/31 = 12 شهر.
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() >= start.getDate()) months += 1;
  return Math.max(1, months);
}

function contractMonthlyRent_(c) {
  const rent = parseNum(c && c.rent);
  if (!rent) return 0;
  return rent / contractMonths_(c.start, c.end);
}


function contractDateRange_(c) {
  const start = c && c.start ? new Date(c.start) : null;
  if (!start || isNaN(start.getTime())) return null;
  const end = c.end ? new Date(c.end) : new Date(start.getFullYear() + 1, start.getMonth(), start.getDate());
  if (!end || isNaN(end.getTime()) || end < start) return null;
  start.setHours(0,0,0,0); end.setHours(0,0,0,0);
  return {start:start, end:end};
}

function contractExpectedForMonth_(c, year, monthOneBased) {
  const range = contractDateRange_(c);
  if (!range || !parseNum(c.rent)) return 0;
  const monthStart = new Date(year, monthOneBased - 1, 1);
  const monthEnd = new Date(year, monthOneBased, 0);
  monthStart.setHours(0,0,0,0); monthEnd.setHours(0,0,0,0);
  const overlapStart = range.start > monthStart ? range.start : monthStart;
  const overlapEnd = range.end < monthEnd ? range.end : monthEnd;
  if (overlapEnd < overlapStart) return 0;
  const activeDays = Math.floor((overlapEnd - overlapStart) / 86400000) + 1;
  const daysInMonth = monthEnd.getDate();
  return contractMonthlyRent_(c) * (activeDays / daysInMonth);
}

function parseStoredDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  const s = String(v).trim().replace(/-/g,'/');
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0));
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function getPaymentsRows_() {
  if (__PAYMENTS_CACHE) return cloneData_(__PAYMENTS_CACHE);
  var _sc = _scGet_('pay_v1'); if (_sc) { __PAYMENTS_CACHE = _sc; return cloneData_(__PAYMENTS_CACHE); }
  const sheet = getSheet(CFG.SHEETS.PAYMENTS);
  if (!sheet || sheet.getLastRow() < 2) { __PAYMENTS_CACHE = []; return []; }
  __PAYMENTS_CACHE = sheet.getDataRange().getValues().slice(1).map(function(r, i){
    return { logRow: i + 2, date: parseStoredDate_(r[PC.TIMESTAMP]), amount: parseNum(r[PC.AMOUNT]), row: r[PC.ROW], tenant: str(r[PC.TENANT]), building: str(r[PC.BUILDING]), unit: str(r[PC.UNIT]), username: str(r[PC.USERNAME]), contractId: str(r[PC.CONTRACT_ID]), before: parseNum(r[PC.PAID_BEFORE]), after: parseNum(r[PC.PAID_AFTER]), remaining: parseNum(r[PC.REMAINING_AFTER]), notes: str(r[PC.NOTES]) };
  }).filter(function(p){ return p.date && p.amount !== 0; });
  _scSet_('pay_v1', __PAYMENTS_CACHE, 120);
  return cloneData_(__PAYMENTS_CACHE);
}

function cleanPhoneValue_(p) {
  p = str(p);
  if (!p || /^(nan|undefined|null)$/i.test(p)) return '';
  return p.replace(/\.0$/, '');
}


// يتعامل مع دوال الإعداد/الصيانة القديمة: لا يسمح بتشغيلها من الويب إلا لمن لديه إدارة مستخدمين.
// إذا لم يكن شيت المستخدمين موجوداً أصلاً، يسمح بالتشغيل الأولي حتى لا يتعطل إعداد النظام لأول مرة.
function requireSetupAdmin_() {
  const uSheet = getSheet(CFG.SHEETS.USERS);
  if (!uSheet || uSheet.getLastRow() < 2) return null;
  return requirePerm_('users.manage');
}

function safeRowNum_(rowNum, minRow) {
  rowNum = parseInt(rowNum, 10);
  minRow = minRow || 2;
  if (!rowNum || rowNum < minRow) throw new Error('رقم الصف غير صالح');
  return rowNum;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    return fn();
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}


function normalizeDigits_(value) {
  return String(value || '')
    .replace(/[٠-٩]/g, function(d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); })
    .replace(/[۰-۹]/g, function(d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); });
}

function validateUnitInBuilding_(buildingName, unitValue) {
  buildingName = str(buildingName);
  unitValue = str(unitValue);
  if (!buildingName || !unitValue) return '';

  const building = getBuildings().find(function(b) { return b.name === buildingName; });
  if (!building) return 'المبنى "' + buildingName + '" غير موجود في سجل المباني. أضف المبنى أولاً من قسم المباني.';

  const totalUnits = parseInt(building.totalUnits, 10) || 0;
  if (totalUnits <= 0) return '';

  const normalized = normalizeDigits_(unitValue).trim();
  // نتحقق فقط من الوحدات الرقمية الصريحة مثل 1 أو 20 أو 100.
  // الوحدات النصية مثل "محل 5" أو "مستودع" تبقى مسموحة لأن بعض المباني فيها وحدات تجارية بأسماء غير رقمية.
  if (/^\d+$/.test(normalized)) {
    const n = parseInt(normalized, 10);
    if (n < 1 || n > totalUnits) {
      return 'الوحدة رقم ' + unitValue + ' غير موجودة في "' + buildingName + '". عدد الوحدات المسجل لهذا المبنى هو ' + totalUnits + ' فقط.';
    }
  }
  return '';
}

function validateContractData_(data, isUpdate) {
  data = data || {};
  if (!str(data.tenant)) return 'اسم المستأجر مطلوب';
  if (!str(data.building)) return 'اسم المبنى مطلوب';
  if (!str(data.unit)) return 'رقم الوحدة مطلوب';
  const unitValidation = validateUnitInBuilding_(data.building, data.unit);
  if (unitValidation) return unitValidation;
  const rent = parseNum(data.rent), paid = parseNum(data.paid);
  if (rent < 0 || paid < 0) return 'مبالغ الإيجار والسداد لا يمكن أن تكون سالبة';
  if (paid > rent && rent > 0) return 'المبلغ المسدد لا يمكن أن يتجاوز إجمالي الإيجار';
  if (data.start && data.end) {
    const sd = new Date(data.start), ed = new Date(data.end);
    if (!isNaN(sd.getTime()) && !isNaN(ed.getTime()) && ed < sd) return 'تاريخ نهاية العقد لا يمكن أن يكون قبل بدايته';
  }
  return '';
}

function ensurePaymentsSheet() {
  return getOrCreateSheet(CFG.SHEETS.PAYMENTS,
    ['الوقت','المستخدم','رقم العقد','صف العقد','المستأجر','المبنى','الوحدة','مبلغ الدفعة','المسدد قبل','المسدد بعد','المتبقي بعد','ملاحظات'], '#2B6CB0');
}

function logPayment_(d) {
  try {
    __PAYMENTS_CACHE = null;
    const sheet = ensurePaymentsSheet();
    sheet.appendRow([
      fmtDatetime(new Date()), currentUser(), sanitizeCell_(d.contractId || ''), d.row || '', sanitizeCell_(d.tenant || ''), sanitizeCell_(d.building || ''), sanitizeCell_(d.unit || ''),
      parseNum(d.amount), parseNum(d.before), parseNum(d.after), parseNum(d.remaining), sanitizeCell_(d.notes || '')
    ]);
  } catch(e) {}
}

// يسجل تسوية في سجل الدفعات عند تعديل قيمة المسدد يدوياً من نافذة تعديل العقد.
// هذا يضمن أن صفحة المالية تقرأ التعديل تلقائياً ولا تبقى على مبلغ الدفعة القديم.
// [تم حذف نسخة مكررة قديمة من الدالة: reconcilePaymentLogAfterPaidEdit_]



function getPaymentLog(limit) {
  const auth = requirePerm_('finance.view'); if (auth) return [];
  limit = parseInt(limit, 10) || 200;
  return getPaymentsRows_().reverse().slice(0, limit).map(function(p){
    return {
      date: fmtDatetime(p.date), username: p.username || '—', contractId: p.contractId || '', row: p.row || '',
      tenant: p.tenant || '—', building: p.building || '—', unit: p.unit || '—', amount: p.amount,
      before: p.before, after: p.after, remaining: p.remaining, notes: p.notes || ''
    };
  });
}
// [تم حذف نسخة مكررة قديمة من الدالة: getContractPaymentHistory]

function getArchivedBuildings() {
  const authAdmin = requirePerm_('users.manage'); if (authAdmin) return [];
  const auth = requirePerm_('buildings.delete'); if (auth) return [];
  const sheet = getSheet(CFG.SHEETS.BUILDINGS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  ensureBuildingArchiveColumns_(sheet);
  return sheet.getDataRange().getValues().slice(1).map(function(r,i){
    if (!isBuildingArchivedRow_(r)) return null;
    return {row:i+2, name:str(r[BC.NAME]), type:str(r[BC.TYPE]), totalUnits:parseInt(r[BC.TOTAL_UNITS])||0, archivedAt:str(r[BC.ARCHIVED_AT]), archivedBy:str(r[BC.ARCHIVED_BY])};
  }).filter(function(x){ return x && x.name; });
}

function restoreBuilding(rowNum) {
  const authAdmin = requirePerm_('users.manage'); if (authAdmin) return authAdmin;
  const auth = requirePerm_('buildings.delete'); if (auth) return auth;
  return withLock_(function(){
    rowNum = safeRowNum_(rowNum);
    const sheet = getSheet(CFG.SHEETS.BUILDINGS);
    if (!sheet) return {error:'شيت المباني غير موجود'};
    ensureBuildingArchiveColumns_(sheet);
    const name = str(sheet.getRange(rowNum, BC.NAME+1).getValue());
    sheet.getRange(rowNum, BC.ARCHIVED+1).setValue('');
    sheet.getRange(rowNum, BC.ARCHIVED_AT+1).setValue('');
    sheet.getRange(rowNum, BC.ARCHIVED_BY+1).setValue('');
    invalidateRuntimeCaches_();
    try { logActivity(currentUser() || 'system', 'استرجاع', 'مباني', 'استرجاع مبنى مؤرشف: ' + name + ' — الصف: ' + rowNum); } catch(e) {}
    return {success:true, message:'تم استرجاع المبنى وعودته للقوائم النشطة'};
  });
}

function userPermVersionKey_(username) {
  return 'USER_PERM_VERSION_' + str(username).toLowerCase();
}
function getUserPermVersion_(username) {
  return parseInt(PropertiesService.getScriptProperties().getProperty(userPermVersionKey_(username)) || '0', 10) || 0;
}
function bumpUserPermVersion_(username) {
  if (!username) return;
  const key = userPermVersionKey_(username);
  const next = getUserPermVersion_(username) + 1;
  PropertiesService.getScriptProperties().setProperty(key, String(next));
}

function ensureUsersSheet() {
  const sheet = getOrCreateSheet(CFG.SHEETS.USERS,
    ['اسم المستخدم','كلمة المرور','الاسم الكامل','الدور','البريد الإلكتروني','نشط','تاريخ الإنشاء','آخر دخول','صلاحيات مخصصة'], '#9B1C1C');

  // إنشاء حساب admin افتراضي إذا لم يوجد أي مستخدم
  if (sheet.getLastRow() <= 1) {
    sheet.appendRow(['admin', hashPassword_('admin123'), 'المدير العام', 'admin', '', 'نعم', fmtDatetime(new Date()), '', '']);
    SpreadsheetApp.flush();
  }
  return sheet;
}

function getUsers() {
  const auth = requirePerm_('users.manage'); if (auth) return [];
  var cached = _scGet_('USERS_LIST'); if (cached) return cached;
  const sheet = getSheet(CFG.SHEETS.USERS);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues().slice(1);
  var result = rows.map((r, i) => {
    var customPermsRaw = str(r[UC.CUSTOM_PERMS]);
    var customPerms = [];
    if (customPermsRaw) {
      try { customPerms = sanitizePerms_(JSON.parse(customPermsRaw)); } catch(e) {}
    }
    return {
      row:         i + 2,
      username:    str(r[UC.USERNAME]),
      name:        str(r[UC.NAME]),
      role:        str(r[UC.ROLE]) || 'employee',
      email:       str(r[UC.EMAIL]),
      active:      str(r[UC.ACTIVE]) === 'نعم',
      created:     str(r[UC.CREATED]),
      lastLogin:   str(r[UC.LAST_LOGIN]),
      customPerms: customPerms
    };
  }).filter(u => u.username);
  _scSet_('USERS_LIST', result, 600);
  return result;
}
// [تم حذف نسخة مكررة قديمة من الدالة: login]

function logout() {
  const session = getCurrentSession();
  try { if (session && session.username) logActivity(session.username, 'خروج', 'مستخدم', 'تسجيل خروج'); } catch(e) {}
  PropertiesService.getUserProperties().deleteProperty('SESSION');
  invalidateSessionCache_();
  return { success: true };
}

// ⚠️ قيد معماري معروف (C1 — مؤجَّل عمداً، موثّق للمراجعة المستقبلية):
// عند نشر تطبيق الويب بوضع «تنفيذ كـ: أنا (المالك)» — وهو إجباري لعمل JSONP المجهول —
// يتشارك جميع المستخدمين نفس مخزن getUserProperties() الخاص بالمالك. لذلك يكتب الـ
// APIDispatcher الجلسة في SESSION ثم تقرؤها هذه الدالة، ما يفتح نافذة سباق نظرية بين
// طلبين متزامنين من مستخدمَين مختلفين. الخطر العملي منخفض لفريق صغير موثوق (المهاجم لا
// يتحكم بتوقيت طلب الأدمن). الإصلاح الجذري المقترح مستقبلاً: تمرير الجلسة عبر متغيّر
// داخل الطلب (module-global) بدل المخزن المشترك، أو LockService حول الاستعادة+التنفيذ.
function getCurrentSession() {
  if (__SESSION_CACHE !== undefined) return __SESSION_CACHE;
  __SESSION_CACHE = _resolveCurrentSession_();
  return __SESSION_CACHE;
}

// يُستدعى بعد أي تغيير مباشر لخاصية SESSION داخل نفس الطلب (دخول/خروج) لإبطال الكاش
function invalidateSessionCache_() { __SESSION_CACHE = undefined; }

function _resolveCurrentSession_() {
  const raw = PropertiesService.getUserProperties().getProperty('SESSION');
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session.expiresAt || Date.now() > session.expiresAt) {
      PropertiesService.getUserProperties().deleteProperty('SESSION');
      return null;
    }
    if ((session.permVersion || 0) !== getUserPermVersion_(session.username)) {
      PropertiesService.getUserProperties().deleteProperty('SESSION');
      return null;
    }
    // تجديد الجلسة عند النشاط بدون تغيير طريقة الدخول الحالية.
    session.expiresAt = Date.now() + SECURITY.SESSION_HOURS * 60 * 60 * 1000;
    PropertiesService.getUserProperties().setProperty('SESSION', JSON.stringify(session));
    return session;
  } catch (e) { return null; }
}

// مساعد: اسم المستخدم الحالي (متوافق مع كل إصدارات V8)
function currentUser() {
  var s = getCurrentSession();
  return s ? s.username : 'system';
}


function whoami() {
  const session = getCurrentSession();
  if (!session) return { loggedIn: false };
  return {
    loggedIn: true,
    username: session.username,
    name:     session.name,
    role:     session.role,
    roleLabel: ROLES[session.role] ? ROLES[session.role].label : '',
    perms:    session.perms || []
  };
}

function hasPermission(perm) {
  const session = getCurrentSession();
  if (!session) return false;
  return hasPermInList_(session.perms || [], perm);
}
// [تم حذف نسخة مكررة قديمة من الدالة: addUser]
// [تم حذف نسخة مكررة قديمة من الدالة: updateUser]

function deleteUser(rowNum) {
  const auth = requirePerm_('users.manage'); if (auth) return auth;
  rowNum = safeRowNum_(rowNum);
  const sheet = getSheet(CFG.SHEETS.USERS);
  const username = str(sheet.getRange(rowNum, UC.USERNAME+1).getValue());
  if (username === 'admin') return { error: 'لا يمكن حذف حساب الأدمن الافتراضي' };
  sheet.deleteRow(rowNum);
  SpreadsheetApp.flush();
  _scDel_('USERS_LIST');
  logActivity(currentUser() || 'system', 'delete', 'user', 'حذف المستخدم: ' + username);
  return { success: true };
}

function changeMyPassword(oldPass, newPass) {
  if (!newPass || String(newPass).length < 8) return {error:'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف'};
  const session = getCurrentSession();
  if (!session) return { error: 'يجب تسجيل الدخول أولاً' };
  const sheet = getSheet(CFG.SHEETS.USERS);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (str(rows[i][UC.USERNAME]) === session.username) {
      if (str(rows[i][UC.PASSWORD]) !== simpleHash(oldPass)) return { error: 'كلمة المرور القديمة غير صحيحة' };
      sheet.getRange(i+1, UC.PASSWORD+1).setValue(simpleHash(newPass));
      SpreadsheetApp.flush();
      logActivity(session.username, 'update', 'user', 'تغيير كلمة المرور');
      return { success: true, message: 'تم تغيير كلمة المرور' };
    }
  }
  return { error: 'المستخدم غير موجود' };
}

// تشفير بسيط (SHA-256 + salt)
function simpleHash(text) {
  return hashPassword_(text);
}


// ═══════════════════════════════════════════════════════════════
// سجل العمليات
// ═══════════════════════════════════════════════════════════════

function ensureActivitySheet() {
  return getOrCreateSheet(CFG.SHEETS.ACTIVITY,
    ['الوقت','المستخدم','الإجراء','النوع','التفاصيل','عنوان IP'], '#4A5568');
}

function logActivity(username, action, entity, details) {
  try {
    const sheet = ensureActivitySheet();
    sheet.appendRow([
      new Date(),   // لحظة فعلية غير ملتبسة؛ تُنسَّق عند العرض بتوقيت الرياض (+3)
      sanitizeCell_(username || '—'),
      sanitizeCell_(action || ''),
      sanitizeCell_(entity || ''),
      sanitizeCell_(details || ''),
      ''
    ]);
    _scDel_('ACTIVITY_LOG');
    // قلّم السجل لـ 5000 سجل لتجنب التضخم
    const lastRow = sheet.getLastRow();
    if (lastRow > 5001) {
      sheet.deleteRows(2, lastRow - 5001);
    }
  } catch (e) {
    // تجاهل أخطاء التسجيل لتجنب كسر العمليات الأصلية
  }
}

function getAllData() {
  const auth = requireLogin_(); if (auth) return auth;

  const canAlerts = hasPermission('alerts.view');
  const canContracts = hasPermission('contracts.view');
  const canBuildings = hasPermission('buildings.view');
  const canTenants = hasPermission('tenants.view');

  return {
    stats: getDashboardStats(),
    // التنبيهات تُحسب مرة واحدة فقط وتستخدم في الداشبورد والتوب بار
    dueAlerts: canAlerts ? getUpcomingDueDates(14) : [],
    contracts: canContracts ? getContracts() : [],
    buildings: canBuildings ? getBuildings() : [],
    tenants: canTenants ? getTenantHistory() : [],
    // سجل الدفعات المضغوط — يُحمّل مرة واحدة ليُعرض سجل أي عقد فوراً بلا طلب منفصل
    // يُتاح لمن يملك عرض العقود (السجل العادي) أو تعديل الدفعات (سجل الأدمن)
    payments: (canContracts || hasPermission('payments.edit')) ? getPaymentsForClient_() : [],
    topbarAlerts: getTopbarAlerts()
  };
}

// نسخة مضغوطة ومنسّقة من الدفعات للعرض الفوري في الواجهة (بدون طلب منفصل لكل عقد)
function getPaymentsForClient_() {
  return getPaymentsRows_().map(function(p){
    return {
      logRow:     p.logRow,
      row:        p.row,
      contractId: p.contractId || '',
      date:       fmtDatetime(p.date),
      username:   p.username || '—',
      amount:     p.amount,
      remaining:  p.remaining,
      notes:      p.notes || ''
    };
  });
}
// [تم حذف نسخة مكررة قديمة من الدالة: getActivityLog]

// ═══════════════════════════════════════════════════════════════
// النسخ الاحتياطي
// ═══════════════════════════════════════════════════════════════

function backupNow() {
  const auth = requirePerm_('backup.run'); if (auth) return auth;
  var errors = [];
  var result = { success: false };

  // المحاولة 1: SpreadsheetApp.copy() — الأبسط
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var stamp = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd_HH-mm');
    var newName = ss.getName() + ' [نسخة ' + stamp + ']';
    var copy = ss.copy(newName);
    try { var folder = getOrCreateBackupFolder(); DriveApp.getFileById(copy.getId()).moveTo(folder); pruneBackups(folder, 30); } catch(moveErr) {}
    try { logActivity(currentUser(), 'نسخ احتياطي', 'نظام', newName); } catch(e) {}
    return {
      success:  true,
      message:  'تم إنشاء النسخة الاحتياطية بنجاح',
      fileName: newName,
      fileUrl:  copy.getUrl()
    };
  } catch(e1) {
    errors.push('copy: ' + e1.message);
  }

  // المحاولة 2: DriveApp مع طلب الإذن صراحةً
  try {
    var ss2   = SpreadsheetApp.getActiveSpreadsheet();
    var stamp2 = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd_HH-mm');
    var newName2 = ss2.getName() + ' [نسخة ' + stamp2 + ']';
    var file  = DriveApp.getFileById(ss2.getId());
    var folder2 = getOrCreateBackupFolder();
    var copy2 = file.makeCopy(newName2, folder2);
    pruneBackups(folder2, 30);
    try { logActivity(currentUser(), 'نسخ احتياطي', 'نظام', newName2); } catch(e) {}
    return {
      success:  true,
      message:  'تم إنشاء النسخة الاحتياطية',
      fileName: newName2,
      fileUrl:  copy2.getUrl()
    };
  } catch(e2) {
    errors.push('drive: ' + e2.message);
  }

  return {
    error: 'فشل النسخ الاحتياطي. ' +
           'الحل: من Apps Script افتح Resources > Advanced Google Services وفعّل Drive API. ' +
           'التفاصيل: ' + errors.join(' | ')
  };
}

function getOrCreateBackupFolder() {
  const folderName = 'نسخ احتياطية - نظام الأملاك';
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}
// [تم حذف نسخة مكررة قديمة من الدالة: pruneBackups]

function setupDailyBackup() {
  const auth = requirePerm_('backup.run'); if (auth) return auth;
  try {
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === 'runDailyBackup') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('runDailyBackup')
      .timeBased()
      .everyDays(1)
      .atHour(23)
      .create();
    PropertiesService.getScriptProperties().setProperty('AUTO_BACKUP', 'on');
    return { success: true, message: 'تم تفعيل النسخ التلقائي اليومي (11 مساءً)' };
  } catch(e) {
    return { error: 'تعذّر إنشاء المؤقت — يرجى تفعيله يدوياً من: Triggers في Apps Script' };
  }
}

function disableDailyBackup() {
  const auth = requirePerm_('backup.run'); if (auth) return auth;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runDailyBackup') ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getScriptProperties().setProperty('AUTO_BACKUP', 'off');
  return { success: true, message: 'تم إيقاف النسخ التلقائي' };
}

function getBackupStatus() {
  const auth = requirePerm_('backup.run'); if (auth) return auth;
  const auto = PropertiesService.getScriptProperties().getProperty('AUTO_BACKUP') || 'off';
  // احسب عدد النسخ من سجل العمليات
  var count = 0;
  var lastBackup = '';
  try {
    const sheet = getSheet(CFG.SHEETS.ACTIVITY);
    if (sheet) {
      const rows = sheet.getDataRange().getValues().slice(1);
      rows.reverse().forEach(function(r) {
        if (String(r[2]||'') === 'نسخ احتياطي') {
          count++;
          if (!lastBackup) lastBackup = fmtDatetime(parseStoredDate_(r[0]));
        }
      });
    }
  } catch(e) {}

  var folderUrl = ''; try { folderUrl = getOrCreateBackupFolder().getUrl(); } catch(e) {}
  return { autoEnabled: auto === 'on', folderUrl: folderUrl, count: count, lastBackup: lastBackup };
}

// تُستدعى من الـ trigger

function runDailyBackup() {
  try {
    const ss     = SpreadsheetApp.getActiveSpreadsheet();
    const stamp  = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd');
    const newName = '📦 ' + ss.getName() + ' — تلقائي ' + stamp;
    const folder = getOrCreateBackupFolder();
    const file = DriveApp.getFileById(ss.getId());
    file.makeCopy(newName, folder);
    pruneBackups(folder, 30);
    try { logActivity('system', 'نسخ احتياطي', 'تلقائي', newName); } catch(e) {}
  } catch (e) {
    try { logActivity('system', 'نسخ احتياطي', 'خطأ', e.message); } catch(ex) {}
  }
}


function setupSheets() {
  const auth = requireSetupAdmin_(); if (auth) return auth;
  // إذا كان شيت العقود موجود برأس قديم "العمارة" نحدّثه إلى "المبنى"
  const existingC = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.SHEETS.CONTRACTS);
  if (existingC) {
    const headerVal = existingC.getRange(1, 2).getValue();
    if (headerVal === 'العمارة') existingC.getRange(1, 2).setValue('المبنى');
    // تحقق أن ترتيب الأعمدة صحيح (النوع في العمود 9 بعد الحالة)
    const col9 = existingC.getRange(1, 9).getValue();
    if (col9 === 'إجمالي الإيجار') {
      // ترتيب قديم — أبلغ المستخدم
      SpreadsheetApp.getUi().alert('⚠️ تنبيه: ترتيب الأعمدة في شيت العقود مختلف عن الملف المُحسَّن.\nيُنصح برفع الملف الجديد من الداشبورد.');
    }
    // أضف عمود النوع إذا كان مفقوداً
    const lastCol = existingC.getLastColumn();
    if (lastCol < 15 || existingC.getRange(1, 15).getValue() !== 'النوع') {
      existingC.getRange(1, 15).setValue('النوع');
    }
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const cSheet = getOrCreateSheet(CFG.SHEETS.CONTRACTS,
    ['رقم العقد','المبنى','الشقة','اسم المستأجر','رقم الجوال','بداية العقد','نهاية العقد',
     'حالة العقد','النوع','إجمالي الإيجار','ما تم سداده','المبلغ المتبقي','نسبة السداد',
     'جدولة السداد','انتظام السداد','مرفق العقد','ملاحظات','رقم الهوية']);
  cSheet.setRightToLeft(true);
  cSheet.setFrozenRows(1);
  cSheet.setTabColor('#1A3A5C');
  addValidation(cSheet, 'H', ['ساري','منتهي','شارف على الانتهاء']);
  addValidation(cSheet, 'I', ['سكني','تجاري']);
  addValidation(cSheet, 'N', ['شهري','3 أشهر','6 أشهر','سنوي']);
  addValidation(cSheet, 'O', ['ملتزم','غير منتظم','متأخر']);
  addConditionalFormat(cSheet, 'H2:H500', 'ساري',              '#C6F6D5','#276749');
  addConditionalFormat(cSheet, 'H2:H500', 'شارف على الانتهاء', '#FEF3C7','#92400E');
  addConditionalFormat(cSheet, 'H2:H500', 'منتهي',             '#F1EFE8','#718096');
  const cWidths = [130,130,70,200,110,100,100,130,100,100,90,110,90,200,80];
  cWidths.forEach((w,i)=>cSheet.setColumnWidth(i+1,w));

  const bSheet = getOrCreateSheet(CFG.SHEETS.BUILDINGS,
    ['اسم المبنى','النوع','عدد الأدوار','الوحدات الإجمالية',
     'مشغولة حالياً','فارغة','نسبة الإشغال',
     'إيجار العقود السارية','إجمالي المحصّل','نسبة التحصيل','ملاحظات']);
  bSheet.setRightToLeft(true);
  bSheet.setFrozenRows(1);
  bSheet.setTabColor('#276749');
  addValidation(bSheet, 'B', ['سكني','تجاري','مختلط']);
  // المباني الافتراضية بالبنية الكاملة (الترتيب: اسم,نوع,أدوار,إجمالي,مشغولة,فارغة,نسبة,إيجار,محصّل,نسبة تحصيل,ملاحظات)
  if (bSheet.getLastRow()<=1) {
    const def = [
      ['عمارة الايتام','سكني',4,18,0,'=D2-E2','=IF(D2>0,E2/D2,0)',0,0,'=IF(H2>0,I2/H2,0)',''],
      ['برج 1','سكني',7,27,0,'=D3-E3','=IF(D3>0,E3/D3,0)',0,0,'=IF(H3>0,I3/H3,0)',''],
      ['برج 2','سكني',10,45,0,'=D4-E4','=IF(D4>0,E4/D4,0)',0,0,'=IF(H4>0,I4/H4,0)',''],
      ['برج 3','سكني',10,45,0,'=D5-E5','=IF(D5>0,E5/D5,0)',0,0,'=IF(H5>0,I5/H5,0)',''],
      ['استراحة وقف الصانع','تجاري',1,3,0,'=D6-E6','=IF(D6>0,E6/D6,0)',0,0,'=IF(H6>0,I6/H6,0)',''],
      ['استراحة الراحة','تجاري',1,1,0,'=D7-E7','=IF(D7>0,E7/D7,0)',0,0,'=IF(H7>0,I7/H7,0)',''],
      ['شركة فنون اشبيليا للصناعة','تجاري',1,1,0,'=D8-E8','=IF(D8>0,E8/D8,0)',0,0,'=IF(H8>0,I8/H8,0)',''],
      ['هبة المزيني','سكني',1,2,0,'=D9-E9','=IF(D9>0,E9/D9,0)',0,0,'=IF(H9>0,I9/H9,0)',''],
    ];
    bSheet.getRange(2,1,def.length,11).setValues(def);
  }

  const tSheet = getOrCreateSheet(CFG.SHEETS.TENANTS,
    ['اسم المستأجر','رقم الجوال','عدد العقود','آخر مبنى','آخر وحدة',
     'آخر بداية','آخر نهاية','الحالة الحالية','إجمالي المدفوع','نسبة الانتظام','ملاحظات']);
  tSheet.setRightToLeft(true);
  tSheet.setFrozenRows(1);
  tSheet.setTabColor('#92400E');

  getOrCreateSheet(CFG.SHEETS.LOG,['التاريخ','الاسم','الجوال','الرسالة','الحالة','المبنى','الوحدة']);
  ensurePaymentsSheet();

  SpreadsheetApp.getUi().alert('✅ تم إعداد جميع الشيتات!\n\nالخطوة التالية: من القائمة اضغط "استيراد البيانات".');
}

// ───────────────────────────────────────────────
// القائمة
// ───────────────────────────────────────────────

// ───────────────────────────────────────────────
// مزامنة شيت المباني من العقود الموجودة
// ───────────────────────────────────────────────
function syncBuildingsFromContracts() {
  const auth = requireSetupAdmin_(); if (auth) return auth;
  const bSheet = getOrCreateSheet(CFG.SHEETS.BUILDINGS,
    ['اسم المبنى','النوع','عدد الأدوار','الوحدات الإجمالية',
     'مشغولة حالياً','فارغة','نسبة الإشغال',
     'إيجار العقود السارية','إجمالي المحصّل','نسبة التحصيل','ملاحظات']);
  bSheet.setRightToLeft(true);
  bSheet.setTabColor('#276749');
  addValidation(bSheet, 'B', ['سكني','تجاري','مختلط']);

  const inferred = inferBuildingsFromContracts();
  const existing = bSheet.getLastRow() > 1
    ? bSheet.getRange(2, 1, bSheet.getLastRow()-1, 1).getValues().map(r => String(r[0]).trim())
    : [];

  let added = 0;
  inferred.forEach(b => {
    if (!existing.includes(b.name)) {
      const row = bSheet.getLastRow() + 1;
      bSheet.appendRow([
        sanitizeCell_(b.name), sanitizeCell_(b.type), b.floors||1, b.totalUnits,
        0, '=D'+row+'-E'+row, '=IF(D'+row+'>0,E'+row+'/D'+row+',0)',
        0, 0, '=IF(H'+row+'>0,I'+row+'/H'+row+',0)',
        'مُستخرج تلقائياً'
      ]);
      added++;
    }
  });

  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('✅ تمت المزامنة!\nأُضيف ' + added + ' مبنى جديد، وإجمالي ' + inferred.length + ' مبنى في النظام.');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🏢 نظام الأملاك')
    .addItem('🚀 فتح لوحة التحكم','openDashboard')
    .addSeparator()
    .addItem('⚙️ إعداد الشيتات (أول مرة)','setupSheets')
    .addItem('📥 استيراد البيانات','importBuiltInData')
    .addItem('🔄 إعادة بناء سجل المستأجرين','rebuildTenantRecords')
    .addItem('🔧 مزامنة المباني من العقود','syncBuildingsFromContracts')
    .addSeparator()
    .addItem('🔑 حفظ مفاتيح API','saveApiKeys')
    .addToUi();
}

function openDashboard() {
  const url = ScriptApp.getService().getUrl();
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;direction:rtl;padding:16px">' +
    '<p style="font-size:14px;margin-bottom:10px">رابط لوحة التحكم:</p>' +
    '<p style="font-size:12px;word-break:break-all;background:#f0f4f8;padding:8px;border-radius:6px;margin-bottom:10px">' + url + '</p>' +
    '<a href="' + url + '" target="_blank" style="display:inline-block;background:#1A3A5C;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px">فتح الآن</a>' +
    '</div>'
  ).setWidth(500).setHeight(150);
  SpreadsheetApp.getUi().showModalDialog(html, 'نظام إدارة الأملاك');
}

function saveApiKeys() {
  const auth = requireSetupAdmin_(); if (auth) return auth;
  const ui = SpreadsheetApp.getUi(), p = PropertiesService.getScriptProperties();
  const ai = ui.prompt('🔑 مفتاح المساعد الذكي','الصق مفتاح OpenAI (sk-...) أو Anthropic (sk-ant-...):',ui.ButtonSet.OK_CANCEL);
  if (ai.getSelectedButton()===ui.Button.OK && ai.getResponseText().trim()) {
    const key = ai.getResponseText().trim();
    p.setProperty('AI_KEY', key);
    if (key.indexOf('sk-ant-') === 0)  p.setProperty('AI_PROVIDER', 'anthropic');
    else if (key.indexOf('sk-') === 0) p.setProperty('AI_PROVIDER', 'openai');
  }
  const sms = ui.prompt('🔑 مفتاح OurSMS','الصق المفتاح:',ui.ButtonSet.OK_CANCEL);
  if (sms.getSelectedButton()===ui.Button.OK && sms.getResponseText().trim()) p.setProperty('OURSMS_TOKEN',sms.getResponseText().trim());
  const sender = ui.prompt('📤 اسم المرسل','اسم المرسل:',ui.ButtonSet.OK_CANCEL);
  if (sender.getSelectedButton()===ui.Button.OK && sender.getResponseText().trim()) p.setProperty('OURSMS_SENDER',sender.getResponseText().trim());
  ui.alert('✅ تم حفظ المفاتيح.');
}



// دوال مساعدة للواجهة
function getAISettings() {
  const auth = requirePerm_('ai.use'); if (auth) return {hasKey:false, provider:'', model:''};
  const p = PropertiesService.getScriptProperties();
  const key = p.getProperty('AI_KEY') || '';
  let provider = p.getProperty('AI_PROVIDER') || 'auto';
  if (provider === 'auto' && key) {
    provider = key.indexOf('sk-ant-') === 0 ? 'anthropic' : key.indexOf('sk-') === 0 ? 'openai' : 'auto';
  }
  return {
    hasKey:   !!key,
    keyHint:  key ? key.substring(0, 10) + '...' : '',
    provider: provider,
    model:    p.getProperty('AI_MODEL') || ''
  };
}

function setAIModel(model) {
  const auth = requirePerm_('ai.use'); if (auth) return auth;
  PropertiesService.getScriptProperties().setProperty('AI_MODEL', model || '');
  return { success: true };
}



// ═══════════════════════════════════════════════════════════════
// تحسينات v9 — حوكمة ومحاسبة بدون كسر البيانات القديمة
// ═══════════════════════════════════════════════════════════════

function ensureBuildingArchiveColumns_(sheet) {
  if (!sheet) return;
  const headers = sheet.getRange(1,1,1,Math.max(sheet.getLastColumn(), BC.ARCHIVED_BY+1)).getValues()[0];
  const wanted = [
    [BC.ARCHIVED+1, 'مؤرشف'],
    [BC.ARCHIVED_AT+1, 'تاريخ الأرشفة'],
    [BC.ARCHIVED_BY+1, 'أرشفة بواسطة']
  ];
  wanted.forEach(function(x){
    if (!headers[x[0]-1]) sheet.getRange(1, x[0]).setValue(x[1]).setBackground('#1A3A5C').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  });
}
function isBuildingArchivedRow_(r) {
  const v = String((r && r.length > BC.ARCHIVED ? r[BC.ARCHIVED] : '') || '').trim().toLowerCase();
  return v === 'نعم' || v === 'yes' || v === 'true' || v === '1' || v === 'مؤرشف';
}

function ensureSoftDeleteColumns_(sheet) {
  if (!sheet) return;
  const headers = sheet.getRange(1,1,1,Math.max(sheet.getLastColumn(), C.DELETED_BY+1)).getValues()[0];
  const wanted = [
    [C.DELETED+1, 'محذوف'],
    [C.DELETED_AT+1, 'تاريخ الحذف'],
    [C.DELETED_BY+1, 'حذف بواسطة']
  ];
  wanted.forEach(function(x){
    if (!headers[x[0]-1]) {
      sheet.getRange(1, x[0]).setValue(x[1]).setBackground('#1A3A5C').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
    }
  });
}
function isContractDeletedRow_(r) {
  const v = String((r && r.length > C.DELETED ? r[C.DELETED] : '') || '').trim().toLowerCase();
  return v === 'نعم' || v === 'yes' || v === 'true' || v === '1' || v === 'محذوف';
}
function listDeletedContracts() {
  const authAdmin = requirePerm_('users.manage'); if (authAdmin) return [];
  const auth = requirePerm_('contracts.delete'); if (auth) return [];
  const sheet = getSheet(CFG.SHEETS.CONTRACTS); if (!sheet) return [];
  ensureSoftDeleteColumns_(sheet);
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows.map(function(r,i){
    if (!isContractDeletedRow_(r)) return null;
    return {row:i+2,id:str(r[C.ID]),tenant:str(r[C.TENANT]),building:str(r[C.BUILDING]),unit:str(r[C.UNIT]),deletedAt:str(r[C.DELETED_AT]),deletedBy:str(r[C.DELETED_BY])};
  }).filter(Boolean).reverse();
}
// [تم حذف نسخة مكررة قديمة من الدالة: restoreContract]
function autoContractStatus_(status, startVal, endVal) {
  const today = new Date(); today.setHours(0,0,0,0);
  if (!startVal && !endVal) return status || 'غير محدد';
  let end = endVal ? new Date(endVal) : null;
  if ((!end || isNaN(end.getTime())) && startVal) {
    const s = new Date(startVal);
    if (!isNaN(s.getTime())) { end = new Date(s); end.setFullYear(end.getFullYear()+1); }
  }
  if (!end || isNaN(end.getTime())) return status || 'غير محدد';
  end.setHours(0,0,0,0);
  const daysLeft = Math.round((end - today) / 86400000);
  if (daysLeft < 0) return 'منتهي';
  if (daysLeft <= 60) return 'شارف على الانتهاء';
  return 'ساري';
}
function contractRowToAudit_(r) {
  return {
    'المبنى': str(r[C.BUILDING]), 'الوحدة': str(r[C.UNIT]), 'المستأجر': str(r[C.TENANT]), 'الجوال': str(r[C.PHONE]),
    'بداية العقد': fmtDate(r[C.START]), 'نهاية العقد': fmtDate(r[C.END]), 'الحالة': str(r[C.STATUS]), 'النوع': str(r[C.TYPE]),
    'الإيجار': parseNum(r[C.RENT]), 'المسدد': parseNum(r[C.PAID]), 'الجدولة': str(r[C.SCHEDULE]), 'الانتظام': str(r[C.REGULARITY]),
    'الملاحظات': str(r[C.NOTES]), 'رقم الهوية': str(r[C.ID_NO])
  };
}
function diffObjectsForAudit_(before, after) {
  const diffs = [];
  Object.keys(before).forEach(function(k){
    const a = String(before[k] == null ? '' : before[k]);
    const b = String(after[k] == null ? '' : after[k]);
    if (a !== b) diffs.push(k + ': ' + (a || '—') + ' ← ' + (b || '—'));
  });
  return diffs.slice(0, 12).join('، ') + (diffs.length > 12 ? '…' : '');
}
function getAgingReport() {
  const auth = requirePerm_('finance.view'); if (auth) return auth;
  const today = new Date(); today.setHours(0,0,0,0);
  const buckets = {
    b0_30:{label:'0-30 يوم', amount:0, count:0, items:[]},
    b31_60:{label:'31-60 يوم', amount:0, count:0, items:[]},
    b61_90:{label:'61-90 يوم', amount:0, count:0, items:[]},
    b90:{label:'أكثر من 90 يوم', amount:0, count:0, items:[]}
  };
  const payments = getPaymentsRows_();
  const paidByContractId = {};
  const paidByRow = {};
  payments.forEach(function(p){
    if (p.contractId) paidByContractId[p.contractId] = (paidByContractId[p.contractId] || 0) + p.amount;
    if (p.row) paidByRow[p.row] = (paidByRow[p.row] || 0) + p.amount;
  });
  getContracts().forEach(function(c){
    if (!c.start || !c.rent || !c.schedule) return;
    const dueDates = calculateDueDates(c.start, c.end, c.schedule).filter(function(d){ const x=new Date(d); x.setHours(0,0,0,0); return x < today; });
    if (!dueDates.length) return;
    const stepMap = {'شهري':1,'3 أشهر':3,'6 أشهر':6,'سنوي':12};
    const installment = Math.max(0, contractMonthlyRent_(c) * (stepMap[c.schedule] || 1));
    if (!installment) return;
    // المدفوعات تغطي أقدم الاستحقاقات أولاً. إذا لم يوجد سجل دفعات، نستخدم paid الحالي كرصيد انتقالي.
    let paidCredit = payments.length ? ((c.id && paidByContractId[c.id]) || paidByRow[c.row] || 0) : parseNum(c.paid);
    dueDates.sort(function(a,b){ return a-b; }).forEach(function(d){
      let unpaid = installment;
      if (paidCredit > 0) {
        const covered = Math.min(unpaid, paidCredit);
        unpaid -= covered;
        paidCredit -= covered;
      }
      if (unpaid <= 0) return;
      const dd = new Date(d); dd.setHours(0,0,0,0);
      const age = Math.round((today - dd)/86400000);
      const key = age <= 30 ? 'b0_30' : age <= 60 ? 'b31_60' : age <= 90 ? 'b61_90' : 'b90';
      buckets[key].amount += unpaid;
      buckets[key].count++;
      if (buckets[key].items.length < 10) buckets[key].items.push({tenant:c.tenant,building:c.building,unit:c.unit,amount:Math.round(unpaid),age:age,phone:c.phone});
    });
  });
  return Object.keys(buckets).map(function(k){ const b=buckets[k]; return {key:k,label:b.label,amount:Math.round(b.amount),count:b.count,items:b.items}; });
}
function cleanPhoneFields() {
  const auth = requirePerm_('users.manage'); if (auth) return auth;
  let changed = 0;
  [[CFG.SHEETS.CONTRACTS, C.PHONE+1], [CFG.SHEETS.TENANTS, TC.PHONE+1]].forEach(function(pair){
    const sh = getSheet(pair[0]); if (!sh || sh.getLastRow()<2) return;
    const rg = sh.getRange(2, pair[1], sh.getLastRow()-1, 1);
    const vals = rg.getValues();
    vals.forEach(function(row){ const old=row[0]; const cleaned=cleanPhoneValue_(old); if (String(old||'') !== cleaned) { row[0]=cleaned; changed++; } });
    rg.setValues(vals);
  });
  try { logActivity(currentUser() || 'system', 'تنظيف', 'بيانات', 'تنظيف أرقام الجوال — عدد الخلايا المعدلة: ' + changed); } catch(e) {}
  return {success:true, changed:changed};
}
function getTopbarAlerts() {
  const auth = requireLogin_(); if (auth) return {urgent:0,overdue:0,expiredToday:0};
  const contracts = getContracts();
  const today = new Date(); today.setHours(0,0,0,0);
  let expiredToday = 0;

  contracts.forEach(function(c){
    const e = c.end ? new Date(String(c.end).replace(/-/g, '/')) : null;
    if (e && !isNaN(e.getTime())) {
      e.setHours(0,0,0,0);
      if (e.getTime() === today.getTime()) expiredToday++;
    }
  });

  // لا تستدع getUpcomingDueDates إذا لا يملك المستخدم صلاحية التنبيهات؛ هذا يقلل وقت الدخول.
  let overdue = 0;
  if (hasPermission('alerts.view')) {
    overdue = getUpcomingDueDates(14).filter(function(x){ return x.daysUntil < 0; }).length;
  }

  return {urgent: expiredToday + overdue, overdue: overdue, expiredToday: expiredToday};
}


// ── utils ──────────────────────────────────────
function getSheet(name){ return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }

function getOrCreateSheet(name, headers, tabColor) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh   = ss.getSheetByName(name);
  const isNew = !sh;
  if (!sh) { sh = ss.insertSheet(name); }
  if (headers && sh.getLastRow()===0) {
    sh.appendRow(headers);
    sh.getRange(1,1,1,headers.length).setBackground('#1A3A5C').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
    sh.setFrozenRows(1);
  }
  // التنسيق (RTL ولون التبويب) يُطبَّق مرة واحدة فقط عند الإنشاء — تجنّب كتابات تنسيق
  // بطيئة على كل عملية حفظ (كانت تُستدعى مع كل سجل نشاط/تحديث مستأجر).
  if (isNew) {
    sh.setRightToLeft(true);
    if (tabColor) sh.setTabColor(tabColor);
  }
  return sh;
}

function addValidation(sheet, col, values) {
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(values,true).build();
  sheet.getRange(col+'2:'+col+'500').setDataValidation(rule);
}

function addConditionalFormat(sheet, range, text, bg, fg) {
  const rules = sheet.getConditionalFormatRules();
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(text).setBackground(bg).setFontColor(fg)
    .setRanges([sheet.getRange(range)]).build());
  sheet.setConditionalFormatRules(rules);
}

function buildContractRow(d) {
  // ترتيب الأعمدة: ID, مبنى, شقة, مستأجر, جوال, بداية, نهاية, حالة, نوع,
  // إيجار, مدفوع, [متبقي-formula], [نسبة-formula], جدولة, انتظام, مرفق, ملاحظات
  const sheet = getSheet(CFG.SHEETS.CONTRACTS);
  const nextRow = sheet ? sheet.getLastRow() + 1 : 2;
  return [
    sanitizeCell_(d.id||genId()), sanitizeCell_(d.building), sanitizeCell_(d.unit), sanitizeCell_(d.tenant), sanitizeCell_(d.phone),
    sanitizeCell_(d.start), sanitizeCell_(d.end), sanitizeCell_(d.status||'ساري'), sanitizeCell_(d.type||'سكني'),
    parseNum(d.rent), parseNum(d.paid),
    '=J'+nextRow+'-K'+nextRow,
    '=IF(J'+nextRow+'>0,K'+nextRow+'/J'+nextRow+',0)',
    sanitizeCell_(d.schedule||''), sanitizeCell_(d.regularity||''), '', sanitizeCell_(d.notes||''),
    sanitizeCell_(d.idNo||'')  // العمود الأخير — رقم الهوية
  ];
}

function str(v)      { return v===null||v===undefined?'':String(v).trim(); }
function parseNum(v) { return parseFloat(String(v||0).replace(/,/g,''))||0; }
// [تم حذف نسخة مكررة قديمة من الدالة: genId]
function formatPhone(p) {
  p = String(p).replace(/\D/g,'');
  if (p.startsWith('05')&&p.length===10) p='966'+p.slice(1);
  else if (p.startsWith('5')&&p.length===9) p='966'+p;
  return p.length>=10?p:'';
}
function fmtDate(d) {
  if (!d) return '';
  try { return Utilities.formatDate(new Date(d),'Asia/Riyadh','yyyy/MM/dd'); } catch(e){ return str(d); }
}
function fmtDatetime(d) {
  try { return Utilities.formatDate(d,'Asia/Riyadh','yyyy/MM/dd HH:mm'); } catch(e){ return ''; }
}
function compareDates(a,b) {
  const da=a?new Date(a):new Date(0), db=b?new Date(b):new Date(0);
  return da-db;
}

// ═══════════════════════════════════════════════════════════════
// v9.5 Stabilization Patch — إصلاحات حرجة بدون تغيير جذري
// ═══════════════════════════════════════════════════════════════

function genId() {
  // معرّف أقل عرضة للتصادم من الاعتماد على Date.now فقط
  return '10' + Utilities.getUuid().replace(/-/g, '').slice(0, 14);
}

function invalidateRuntimeCaches_() {
  __CONTRACTS_CACHE = null;
  __BUILDINGS_CACHE = null;
  __PAYMENTS_CACHE = null;
  // مسح كل مفاتيح الكاش المشتق في نداء شبكي واحد (removeAll) بدل عدة نداءات — أسرع للعمليات
  _scDelAll_(['ctr_v1','bld_v1','tnt_v1','pay_v1','dash_v1_0','dash_v1_1','fin_v1',
              'due_v1_0','due_v1_7','due_v1_14','due_v1_30','due_v1_60']);
}

function validatePasswordPolicy_(password) {
  password = String(password || '');
  if (password.length < 8) return 'كلمة المرور يجب ألا تقل عن 8 أحرف';
  return '';
}

function addUser(data) {
  const auth = requirePerm_('users.manage'); if (auth) return auth;
  data = data || {};
  ensureUsersSheet();
  const sheet = getSheet(CFG.SHEETS.USERS);
  const existing = getUsers();
  if (existing.find(u => u.username === data.username)) return { error: 'اسم المستخدم موجود مسبقاً' };
  if (!data.username || !data.password) return { error: 'اسم المستخدم وكلمة المرور مطلوبان' };
  const pwErr = validatePasswordPolicy_(data.password); if (pwErr) return { error: pwErr };
  var customPermsJson = '';
  if (data.customPerms && data.customPerms.length) {
    try { customPermsJson = JSON.stringify(sanitizePerms_(data.customPerms)); } catch(e) {}
  }
  sheet.appendRow([
    sanitizeCell_(data.username), hashPassword_(data.password), sanitizeCell_(data.name || ''),
    sanitizeCell_(data.role || 'employee'), sanitizeCell_(data.email || ''),
    data.active === false ? 'لا' : 'نعم',
    fmtDatetime(new Date()), '', customPermsJson
  ]);
  SpreadsheetApp.flush();
  _scDel_('USERS_LIST');
  logActivity(currentUser() || 'system', 'add', 'user', 'إضافة مستخدم: ' + data.username);
  return { success: true, message: 'تم إنشاء المستخدم' };
}

function updateUser(rowNum, data) {
  const auth = requirePerm_('users.manage'); if (auth) return auth;
  data = data || {};
  if (data.password) { const pwErr = validatePasswordPolicy_(data.password); if (pwErr) return { error: pwErr }; }
  rowNum = safeRowNum_(rowNum);
  const sheet = getSheet(CFG.SHEETS.USERS);
  const targetUsername = str(sheet.getRange(rowNum, UC.USERNAME+1).getValue()).toLowerCase();
  if (data.name !== undefined)   sheet.getRange(rowNum, UC.NAME+1).setValue(sanitizeCell_(data.name));
  if (data.role !== undefined)   sheet.getRange(rowNum, UC.ROLE+1).setValue(sanitizeCell_(data.role));
  if (data.email !== undefined)  sheet.getRange(rowNum, UC.EMAIL+1).setValue(sanitizeCell_(data.email));
  if (data.active !== undefined) sheet.getRange(rowNum, UC.ACTIVE+1).setValue(data.active ? 'نعم' : 'لا');
  if (data.password)             sheet.getRange(rowNum, UC.PASSWORD+1).setValue(hashPassword_(data.password));
  if (data.customPerms !== undefined) {
    var cp = '';
    if (data.customPerms && data.customPerms.length) {
      try { cp = JSON.stringify(sanitizePerms_(data.customPerms)); } catch(e) {}
    }
    sheet.getRange(rowNum, UC.CUSTOM_PERMS+1).setValue(cp);
  }
  SpreadsheetApp.flush();
  _scDel_('USERS_LIST');
  bumpUserPermVersion_(targetUsername);
  logActivity(currentUser() || 'system', 'update', 'user', 'تعديل مستخدم في الصف ' + rowNum + ' — تم إبطال جلساته القديمة');
  return { success: true, message: 'تم تحديث المستخدم' };
}

function login(username, password) {
  ensureUsersSheet();
  username = str(username).toLowerCase();
  if (!username || !password) return { success: false, error: 'اسم المستخدم وكلمة المرور مطلوبان' };
  if (isAccountLocked_(username)) {
    try { logActivity(username, 'فشل دخول', 'مستخدم', 'محاولة دخول لحساب مقفل مؤقتاً'); } catch(e) {}
    return { success: false, error: 'تم إيقاف المحاولة مؤقتاً لكثرة المحاولات الخاطئة. حاول بعد 10 دقائق.' };
  }

  const sheet = getSheet(CFG.SHEETS.USERS);
  const rows  = sheet.getDataRange().getValues();
  const hash  = hashPassword_(password);
  const legacyHash = legacyHashPassword_(password);
  for (let i = 1; i < rows.length; i++) {
    const rowUser = str(rows[i][UC.USERNAME]).toLowerCase();
    const storedHash = str(rows[i][UC.PASSWORD]);
    if (rowUser === username &&
        (storedHash === hash || storedHash === legacyHash) &&
        str(rows[i][UC.ACTIVE]) === 'نعم') {
      clearFailedLogin_(username);
      if (storedHash === legacyHash) sheet.getRange(i+1, UC.PASSWORD+1).setValue(hash);
      sheet.getRange(i+1, UC.LAST_LOGIN+1).setValue(fmtDatetime(new Date()));
      const role = str(rows[i][UC.ROLE]) || 'employee';
      var customPermsRaw = str(rows[i][UC.CUSTOM_PERMS]);
      var perms = rolePerms_(role);
      if (customPermsRaw) {
        try { perms = sanitizePerms_(JSON.parse(customPermsRaw)); } catch(e) {}
      }
      const now = Date.now();
      const session = {
        username: username,
        name:     str(rows[i][UC.NAME]),
        role:     role,
        perms:    perms,
        token:    Utilities.getUuid(),
        issuedAt: now,
        expiresAt: now + SECURITY.SESSION_HOURS * 60 * 60 * 1000,
        permVersion: getUserPermVersion_(username)
      };
      PropertiesService.getUserProperties().setProperty('SESSION', JSON.stringify(session));
      invalidateSessionCache_();
      try { logActivity(username, 'دخول', 'مستخدم', 'تسجيل دخول ناجح'); } catch(e) {}
      return { success: true, warning: (username === 'admin' && password === 'admin123') ? 'تنبيه أمني: لا تزال كلمة مرور admin الافتراضية مستخدمة. يُفضّل تغييرها فوراً من زر تغيير كلمة المرور.' : '', user: { username, name: session.name, role, perms: session.perms } };
    }
  }
  registerFailedLogin_(username);
  try { logActivity(username || 'غير معروف', 'فشل دخول', 'مستخدم', 'اسم مستخدم أو كلمة مرور غير صحيحة'); } catch(e) {}
  return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
}



function calculateDueDates(startDate, endDate, schedule) {
  if (!startDate || !schedule) return [];
  const start = new Date(startDate);
  const end   = endDate ? new Date(endDate) : new Date(start.getFullYear() + 1, start.getMonth(), start.getDate());
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];

  const monthsBetween = { 'شهري':1, '3 أشهر':3, '6 أشهر':6, 'سنوي':12 };
  const step = monthsBetween[schedule];
  if (!step) return [];

  const dates = [];
  // الاستحقاق القادم يبدأ بعد فترة الجدولة، وليس في يوم بداية العقد.
  // إذا كان العقد السنوي ينتهي قبل تاريخ +12 شهر بيوم أو أيام، نستخدم تاريخ نهاية العقد
  // حتى لا تضيع تنبيهات العقود السنوية.
  let current = new Date(start);
  current.setMonth(current.getMonth() + step);

  if (current > end) {
    dates.push(new Date(end));
    return dates;
  }

  while (current <= end) {
    dates.push(new Date(current));
    const next = new Date(current);
    next.setMonth(next.getMonth() + step);
    if (next <= current) break;
    current = next;
  }
  return dates;
}

function getUpcomingDueDates(daysAhead) {
  daysAhead = daysAhead || 14;
  var _ck = 'due_v1_' + daysAhead;
  var _cached = _scGet_(_ck); if (_cached) return _cached;
  const today = new Date();
  today.setHours(0,0,0,0);
  const contracts = getContracts().filter(c => c.status === 'ساري' || c.status === 'شارف على الانتهاء');

  // لتحديد الأقساط الفائتة غير المسددة فعلاً: نوزّع الدفعات على الاستحقاقات
  // الأقدم أولاً (نفس منطق تقرير أعمار الديون) حتى لا تظهر الأقساط المدفوعة كمتأخرة.
  const payments = getPaymentsRows_();
  const paidByContractId = {};
  const paidByRow = {};
  payments.forEach(function(p){
    if (p.contractId) paidByContractId[p.contractId] = (paidByContractId[p.contractId] || 0) + p.amount;
    if (p.row) paidByRow[p.row] = (paidByRow[p.row] || 0) + p.amount;
  });
  const stepMap = {'شهري':1,'3 أشهر':3,'6 أشهر':6,'سنوي':12};

  const upcoming  = [];
  contracts.forEach(c => {
    const dueDates = calculateDueDates(c.start, c.end, c.schedule);
    if (!dueDates.length) return;

    const installment = Math.max(0, contractMonthlyRent_(c) * (stepMap[c.schedule] || 1));
    // رصيد الدفعات المتاح لتغطية الأقساط الفائتة (الأقدم أولاً)
    let paidCredit = payments.length ? ((c.id && paidByContractId[c.id]) || paidByRow[c.row] || 0) : parseNum(c.paid);

    dueDates.slice().sort(function(a,b){ return new Date(a) - new Date(b); }).forEach(function(d){
      const dd = new Date(d); dd.setHours(0,0,0,0);
      const daysUntil = Math.round((dd - today) / 86400000);

      let include = false;
      if (daysUntil < 0) {
        // قسط فائت: يبقى ظاهراً حتى السداد ولا يختفي بعد أيام، إلا إذا غطّته الدفعات
        if (installment > 0) {
          const covered = Math.min(installment, Math.max(0, paidCredit));
          paidCredit -= covered;
          include = (installment - covered) > 0.01;
        } else {
          // بلا قيمة قسط محسوبة — حافظ على السلوك القديم (آخر 3 أيام فقط)
          include = daysUntil >= -3;
        }
      } else {
        // قسط قادم: ضمن النافذة المختارة (السلوك كما هو)
        include = daysUntil <= daysAhead;
      }
      if (!include) return;

      upcoming.push({
        tenant:c.tenant, phone:c.phone, building:c.building, unit:c.unit,
        rent:c.rent, paid:c.paid, schedule:c.schedule,
        dueDate:Utilities.formatDate(dd, 'Asia/Riyadh', 'yyyy/MM/dd'),
        daysUntil:daysUntil, row:c.row,
        urgency:daysUntil < 0 ? 'overdue' : daysUntil <= 3 ? 'critical' : daysUntil <= 7 ? 'soon' : 'upcoming'
      });
    });
  });
  upcoming.sort((a,b)=>a.daysUntil-b.daysUntil);
  _scSet_(_ck, upcoming, 300);
  return upcoming;
}

function addPayment(rowNum, amount) {
  const auth = requirePerm_('payments.add'); if (auth) return auth;
  return withLock_(function(){
    rowNum = safeRowNum_(rowNum);
    amount = parseNum(amount);
    if (amount <= 0) return {error:'مبلغ الدفعة يجب أن يكون أكبر من صفر'};
    const sheet = getSheet(CFG.SHEETS.CONTRACTS);
    const cur = parseNum(sheet.getRange(rowNum, C.PAID+1).getValue());
    const rent = parseNum(sheet.getRange(rowNum, C.RENT+1).getValue());
    const remainingBefore = Math.max(0, rent - cur);
    if (rent > 0 && amount > remainingBefore) {
      return {error:'المبلغ يتجاوز المتبقي بمقدار ' + (amount - remainingBefore).toLocaleString() + ' ر.س. راجع قيمة الدفعة أو عدّل قيمة الإيجار أولاً.'};
    }
    const newPaid = cur + amount;
    sheet.getRange(rowNum, C.PAID+1).setValue(newPaid);
    if (newPaid >= rent) sheet.getRange(rowNum, C.REGULARITY+1).setValue('ملتزم');
    const contractId = str(sheet.getRange(rowNum, C.ID+1).getValue());
    const tenant = str(sheet.getRange(rowNum, C.TENANT+1).getValue());
    const building = str(sheet.getRange(rowNum, C.BUILDING+1).getValue());
    const unit = str(sheet.getRange(rowNum, C.UNIT+1).getValue());
    logPayment_({ contractId: contractId, row: rowNum, tenant: tenant, building: building, unit: unit, amount: amount, before: cur, after: newPaid, remaining: rent - newPaid });
    invalidateRuntimeCaches_();
    try { updateTenantRecord(tenant, ''); } catch (e) {}   // ✅ يحدّث "إجمالي المدفوع" في شيت المستأجرين فوراً
    try { logActivity(currentUser() || 'system', 'دفعة', 'عقود', 'تسجيل دفعة بتاريخ ' + fmtDatetime(new Date()) + ' — مبلغ ' + amount + ' ر.س على العقد ' + contractId + ' صف ' + rowNum); } catch(e) {}
    return {success:true, newPaid:newPaid, remaining:rent-newPaid};
  });
}

function updateContract(rowNum, data) {
  const auth = requirePerm_('contracts.edit'); if (auth) return auth;
  const validation = validateContractData_(data, true); if (validation) return {error: validation};
  return withLock_(function(){
    rowNum = safeRowNum_(rowNum);
    const sheet = getSheet(CFG.SHEETS.CONTRACTS);
    if (!sheet) return {error:'الشيت غير موجود'};
    const oldRow = sheet.getRange(rowNum, 1, 1, Math.max(sheet.getLastColumn(), C.DELETED_BY+1)).getValues()[0];
    const beforePaid = parseNum(oldRow[C.PAID]);
    const afterPaid = parseNum(data.paid);
    if (afterPaid < beforePaid) {
      return {error:'لا يمكن تخفيض مبلغ المسدد من نافذة تعديل العقد لأن ذلك يسبب دفعة سالبة في التقارير. استخدم تصحيحاً محاسبياً واضحاً أو راجع سجل الدفعات.'};
    }
    const before = contractRowToAudit_(oldRow);
    if (data.idNo) {
      const existing = getContracts().find(c => c.idNo === data.idNo && c.tenant !== data.tenant && c.row !== rowNum);
      if (existing) return {error:'رقم الهوية ' + data.idNo + ' مستخدم لمستأجر آخر: "' + existing.tenant + '"'};
    }
    if (data.building && data.unit && data.status !== 'منتهي') {
      const conflict = checkUnitOccupied(data.building, data.unit, rowNum);
      if (conflict) return {error:'الوحدة ' + data.unit + ' في ' + data.building + ' مشغولة بـ "' + conflict.tenant + '". لا يمكن تعديل العقد بهذا الوضع.'};
    }
    if (data.building) ensureBuildingExists(data.building, data.type||'سكني');
    const map = [
      [C.BUILDING,sanitizeCell_(data.building)],[C.UNIT,sanitizeCell_(data.unit)],[C.TENANT,sanitizeCell_(data.tenant)],[C.PHONE,sanitizeCell_(data.phone)],
      [C.START,sanitizeCell_(data.start)],[C.END,sanitizeCell_(data.end)],[C.STATUS,sanitizeCell_(data.status)],[C.TYPE,sanitizeCell_(data.type||'سكني')],
      [C.RENT,parseNum(data.rent)],[C.PAID,afterPaid],
      [C.SCHEDULE,sanitizeCell_(data.schedule)],[C.REGULARITY,sanitizeCell_(data.regularity)],[C.NOTES,sanitizeCell_(data.notes)]
    ];
    map.forEach(([col,val]) => sheet.getRange(rowNum, col+1).setValue(val));
    ensureIdNoColumn(sheet);
    sheet.getRange(rowNum, 18).setValue(sanitizeCell_(data.idNo || ''));
    if (afterPaid > beforePaid) {
      reconcilePaymentLogAfterPaidEdit_(rowNum, beforePaid, afterPaid, {
        contractId: str(oldRow[C.ID]), tenant: data.tenant, building: data.building, unit: data.unit, rent: parseNum(data.rent)
      });
    }
    updateTenantRecord(data.tenant, data.phone);
    invalidateRuntimeCaches_();
    const afterRow = sheet.getRange(rowNum, 1, 1, Math.max(sheet.getLastColumn(), C.DELETED_BY+1)).getValues()[0];
    const after = contractRowToAudit_(afterRow);
    const diff = diffObjectsForAudit_(before, after);
    try { logActivity(currentUser() || 'system', 'تعديل', 'عقود', 'تعديل عقد صف ' + rowNum + (diff ? ' — ' + diff : ' — لا توجد تغييرات جوهرية')); } catch(e) {}
    return {success:true, message:'تم تحديث البيانات بنجاح'};
  });
}

function reconcilePaymentLogAfterPaidEdit_(rowNum, beforePaid, afterPaid, meta) {
  beforePaid = parseNum(beforePaid);
  afterPaid  = parseNum(afterPaid);
  const delta = afterPaid - beforePaid;
  if (delta <= 0) return; // منع الدفعات السالبة الصامتة نهائياً
  meta = meta || {};
  logPayment_({
    contractId: meta.contractId || '', row: rowNum, tenant: meta.tenant || '', building: meta.building || '', unit: meta.unit || '',
    amount: delta, before: beforePaid, after: afterPaid, remaining: Math.max(0, parseNum(meta.rent) - afterPaid),
    notes: 'دفعة/تسوية موجبة بسبب رفع مبلغ المسدد يدوياً من عقد الصف ' + rowNum
  });
  try { logActivity(currentUser() || 'system', 'تسوية دفعة', 'دفعات', 'رفع المسدد لعقد صف ' + rowNum + ': ' + beforePaid + ' ← ' + afterPaid + ' ر.س'); } catch(e) {}
}

function getContractPaymentHistory(rowNum) {
  const auth = requirePerm_('contracts.view'); if (auth) return [];
  rowNum = parseInt(rowNum, 10);
  if (!rowNum) return [];
  var contractId = '';
  try {
    const sheet = getSheet(CFG.SHEETS.CONTRACTS);
    if (sheet && sheet.getLastRow() >= rowNum) contractId = str(sheet.getRange(rowNum, C.ID+1).getValue());
  } catch(e) {}
  return getPaymentsRows_()
    .filter(function(p){ return (contractId && p.contractId === contractId) || (!contractId && parseInt(p.row, 10) === rowNum); })
    .sort(function(a,b){ return parseStoredDate_(b.date) - parseStoredDate_(a.date); })
    .map(function(p){
      return { date: fmtDatetime(parseStoredDate_(p.date)), username: p.username || '—', amount: p.amount, before: p.before, after: p.after, remaining: p.remaining, notes: p.notes || '' };
    });
}

function sendBulkSms(targets) {
  const results = [];
  const maxBatch = 50; // حماية من timeout والإرسال المكرر بكميات ضخمة
  targets = (targets || []).slice(0, maxBatch);
  targets.forEach(t => {
    if (!t.phone || t.phone === 'nan' || !String(t.phone).trim()) {
      results.push(Object.assign({}, t, { success: false, reason: 'لا يوجد رقم' }));
      return;
    }
    Utilities.sleep(150);
    const r = sendSingleSms(t.phone, t.message);
    results.push(Object.assign({}, t, r));
  });
  return results;
}

function sendExpiryReminders(daysThreshold, useAI) {
  const auth = requirePerm_('sms.send'); if (auth) return auth;
  if (useAI) return {error:'تم إيقاف الصياغة الجماعية بالذكاء الاصطناعي لحماية الأداء والخصوصية. استخدم القالب العادي أو صِغ رسالة فردية.'};
  const contracts = getContracts().filter(c =>
    c.daysLeft !== null && c.daysLeft <= daysThreshold && c.daysLeft >= -30 &&
    c.phone && c.phone !== 'nan'
  );
  const targets = contracts.map(c => {
    let situation;
    if (c.daysLeft < 0)        situation = 'انتهى عقده منذ ' + Math.abs(c.daysLeft) + ' يوم';
    else if (c.daysLeft === 0) situation = 'ينتهي عقده اليوم';
    else                       situation = 'ينتهي عقده خلال ' + c.daysLeft + ' يوم';
    const msg = 'عزيزي ' + c.tenant + '، ' + situation + '. نرجو التواصل لتجديد العقد. إدارة الأملاك.';
    return { name: c.tenant, phone: c.phone, message: msg, building: c.building, unit: c.unit };
  });
  const results = sendBulkSms(targets);
  return { sent:results.filter(r=>r.success).length, failed:results.filter(r=>!r.success).length, total:contracts.length, processed:results.length };
}

function sendPaymentReminders(useAI) {
  const auth = requirePerm_('sms.send'); if (auth) return auth;
  if (useAI) return {error:'تم إيقاف الصياغة الجماعية بالذكاء الاصطناعي لحماية الأداء والخصوصية. استخدم القالب العادي أو رسالة فردية.'};
  const contracts = getContracts().filter(c => c.status === 'ساري' && c.paid === 0 && c.rent > 0 && c.phone && c.phone !== 'nan');
  const targets = contracts.map(c => ({ name:c.tenant, phone:c.phone, message:'عزيزي ' + c.tenant + '، نذكّركم بسداد إيجار ' + c.rent.toLocaleString() + ' ر.س. شكراً. إدارة الأملاك.', building:c.building, unit:c.unit }));
  const results = sendBulkSms(targets);
  return { sent:results.filter(r=>r.success).length, failed:results.filter(r=>!r.success).length, total:contracts.length, processed:results.length };
}

function getActivityLog(limit) {
  const auth = requirePerm_('activity.view'); if (auth) return [];
  limit = parseInt(limit, 10) || 200;
  var cached = _scGet_('ACTIVITY_LOG'); if (cached) return cached;
  const sheet = getSheet(CFG.SHEETS.ACTIVITY);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const take = Math.min(limit, lastRow - 1);
  const start = Math.max(2, lastRow - take + 1);
  const data = sheet.getRange(start, 1, take, Math.max(5, sheet.getLastColumn())).getValues();
  // التوقيت يُنسَّق دائماً بتوقيت الرياض (yyyy/MM/dd HH:mm) بدل عرض كائن التاريخ الخام
  var result = data.reverse().map(r => ({ time:fmtDatetime(parseStoredDate_(r[AC.TIMESTAMP])), username:str(r[AC.USERNAME]), action:str(r[AC.ACTION]), entity:str(r[AC.ENTITY]), details:str(r[AC.DETAILS]) }));
  _scSet_('ACTIVITY_LOG', result, 120);
  return result;
}

function pruneBackups(folder, keep) {
  keep = keep || 30;
  const files = folder.getFiles();
  const list = [];
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName() || '';
    // لا نحذف إلا النسخ التي أنشأها النظام باسم النسخة الاحتياطية، ولا نمس ملفات المستخدم اليدوية.
    if (name.indexOf('نسخة احتياطية') >= 0 || name.indexOf('نظام الأملاك') >= 0 || name.indexOf('📦') >= 0) {
      list.push({ file: f, date: f.getDateCreated() });
    }
  }
  list.sort((a,b)=>b.date-a.date);
  for (let i = keep; i < list.length; i++) {
    try { list[i].file.setTrashed(true); } catch(e) {}
  }
}

function askAI(prompt, ctx) {
  const auth = requirePerm_('ai.use'); if (auth) return auth;
  const rl = checkRateLimit_('AI', SECURITY.AI_LIMIT_PER_HOUR); if (rl) return rl;
  const key = CFG.AI_KEY();
  if (!key) return {error:'لم يتم إدخال مفتاح الخدمة. من القائمة اضغط حفظ مفاتيح API.'};
  // v9.5: تقليل البيانات الشخصية المرسلة للخدمة الخارجية. نرسل ملخصاً رقمياً فقط.
  const stats = getDashboardStats();
  const fin = hasPermission('finance.view') ? getFinancialStats() : { currentYear:{collected:0, expected:0, progress:0}, topTenants:[] };
  const dueAlerts = getUpcomingDueDates(30);
  const dataPackage = 'ملخص رقمي للنظام بدون أرقام هوية أو جوالات:\n' +
    'إجمالي العقود: ' + (stats.counts ? stats.counts.total : 0) + '\n' +
    'العقود السارية: ' + (stats.counts ? stats.counts.active : 0) + '\n' +
    'تشارف الانتهاء: ' + (stats.counts ? stats.counts.expiring : 0) + '\n' +
    'لم يسددوا: ' + (stats.counts ? stats.counts.noPay : 0) + '\n' +
    'الإيجار السنوي: ' + (stats.financials ? stats.financials.annualRent : 0) + '\n' +
    'المحصل: ' + (stats.financials ? stats.financials.totalPaid : 0) + '\n' +
    'المتبقي: ' + (stats.financials ? stats.financials.remaining : 0) + '\n' +
    'استحقاقات قادمة خلال 30 يوم: ' + (dueAlerts ? dueAlerts.length : 0) + '\n' +
    (ctx ? '\nسياق إضافي من المستخدم:\n' + ctx : '');
  const system = 'أنت مستشار خبير في إدارة الأملاك للجمعيات. أجب بالعربية، وقدّم توصيات عملية. لا تفترض وجود بيانات شخصية غير مذكورة. إذا احتجت أسماء أو تفاصيل عقود، اطلب من المستخدم تحديدها.';
  const isAnthropic = key.indexOf('sk-ant-') === 0;
  const isOpenAI = key.indexOf('sk-') === 0 && !isAnthropic;
  try {
    if (isAnthropic) {
      const customModel = CFG.AI_MODEL();
      const claudeModel = customModel && customModel.indexOf('claude') === 0 ? customModel : 'claude-sonnet-4-20250514';
      const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', { method:'post', headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'}, payload:JSON.stringify({ model:claudeModel, max_tokens:1800, system:system, messages:[{role:'user', content:dataPackage},{role:'user', content:String(prompt||'')}] }), muteHttpExceptions:true });
      const data = JSON.parse(res.getContentText());
      if (data.error) return { error:data.error.message };
      return { text:data.content && data.content[0] ? data.content[0].text : '' };
    } else if (isOpenAI) {
      const customModelO = CFG.AI_MODEL();
      const gptModel = customModelO && customModelO.indexOf('gpt') === 0 ? customModelO : 'gpt-4o-mini';
      const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', { method:'post', headers:{'Content-Type':'application/json','Authorization':'Bearer '+key}, payload:JSON.stringify({ model:gptModel, max_tokens:1800, messages:[{role:'system', content:system},{role:'user', content:dataPackage},{role:'user', content:String(prompt||'')}] }), muteHttpExceptions:true });
      const data = JSON.parse(res.getContentText());
      if (data.error) return { error:data.error.message };
      return { text:data.choices && data.choices[0] ? data.choices[0].message.content : '' };
    }
    return { error:'صيغة المفتاح غير معروفة. يجب أن يبدأ بـ sk- أو sk-ant-' };
  } catch(e) { return { error:'تعذّر الاتصال بالخدمة: ' + e.message }; }
}

// ═══════════════════════════════════════════════════════════════
// v9.7 Stabilization additions — backup restore, tenant sync, auto SMS
// ملاحظة: هذه الدوال في نهاية الملف لتتجاوز أي تعريفات قديمة بنفس الاسم بأمان.
// ═══════════════════════════════════════════════════════════════

function clearTenantRecordIfNoContracts_(tenantName) {
  tenantName = str(tenantName);
  if (!tenantName) return;
  const sheet = getOrCreateSheet(CFG.SHEETS.TENANTS,
    ['اسم المستأجر','رقم الجوال','عدد العقود','آخر مبنى','آخر وحدة',
     'آخر بداية','آخر نهاية','الحالة الحالية','إجمالي المدفوع','نسبة الانتظام','ملاحظات','رقم الهوية']);
  const rows = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (str(rows[i][TC.NAME]) === tenantName) {
      sheet.deleteRow(i + 1);
      try { logActivity(currentUser() || 'system', 'تحديث', 'مستأجرين', 'حذف سجل مستأجر بلا عقود نشطة: ' + tenantName); } catch(e) {}
      return;
    }
  }
}

function updateTenantRecord(tenantName, phone) {
  tenantName = str(tenantName);
  if (!tenantName) return;
  invalidateRuntimeCaches_();
  const contracts = getContracts().filter(function(c){ return c.tenant === tenantName; });
  if (!contracts.length) { clearTenantRecordIfNoContracts_(tenantName); return; }

  const sheet = getOrCreateSheet(CFG.SHEETS.TENANTS,
    ['اسم المستأجر','رقم الجوال','عدد العقود','آخر مبنى','آخر وحدة',
     'آخر بداية','آخر نهاية','الحالة الحالية','إجمالي المدفوع','نسبة الانتظام','ملاحظات','رقم الهوية'], '#92400E');
  if (sheet.getLastColumn() < 12) {
    sheet.getRange(1, 12).setValue('رقم الهوية')
      .setBackground('#1A3A5C').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  }

  const rows = sheet.getDataRange().getValues();
  let targetRow = -1;
  for (let i=1; i<rows.length; i++) {
    if (str(rows[i][TC.NAME]) === tenantName) { targetRow = i + 1; break; }
  }

  const sorted = contracts.slice().sort(function(a,b){ return compareDates(b.start, a.start); });
  const last = sorted[0];
  const totalPaid = contracts.reduce(function(s,c){ return s + parseNum(c.paid); }, 0);
  const good = contracts.filter(function(c){ return c.regularity === 'ملتزم'; }).length;
  const score = contracts.length > 0 ? Math.round(good / contracts.length * 100) + '%' : '—';
  const idContract = sorted.find(function(c){ return c.idNo; }) || contracts.find(function(c){ return c.idNo; });
  const idNo = idContract ? idContract.idNo : '';
  const rowData = [
    sanitizeCell_(tenantName), sanitizeCell_(phone || last.phone || ''), contracts.length,
    sanitizeCell_(last.building), sanitizeCell_(last.unit), sanitizeCell_(last.start || ''), sanitizeCell_(last.end || ''),
    sanitizeCell_(last.status), totalPaid, score, '', sanitizeCell_(idNo)
  ];
  if (targetRow > 0) sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
  else sheet.appendRow(rowData);
}

function addContract(data) {
  const auth = requirePerm_('contracts.add'); if (auth) return auth;
  const validation = validateContractData_(data, false); if (validation) return {error: validation};
  return withLock_(function(){
    const sheet = getSheet(CFG.SHEETS.CONTRACTS);
    if (!sheet) return {error:'الشيت غير موجود — شغّل setupSheets أولاً'};
    ensureIdNoColumn(sheet);
    if (data.idNo) {
      const existing = getContracts().find(function(c){ return c.idNo === data.idNo && c.tenant !== data.tenant; });
      if (existing) return {error:'رقم الهوية ' + data.idNo + ' مستخدم بالفعل للمستأجر "' + existing.tenant + '"'};
    }
    if (data.building && data.unit && data.status !== 'منتهي') {
      const conflict = checkUnitOccupied(data.building, data.unit);
      if (conflict) return {error:'الوحدة ' + data.unit + ' في ' + data.building + ' مشغولة حالياً بـ "' + conflict.tenant + '" (عقد ساري). أنهِ العقد القديم أولاً.'};
    }
    if (data.building) ensureBuildingExists(data.building, data.type || 'سكني');
    const row = buildContractRow(data);
    sheet.appendRow(row);
    // سجّل الرصيد الافتتاحي (المبلغ المُدخل كمدفوع عند الإنشاء) كدفعة مؤرَّخة بتاريخ بداية العقد،
    // حتى يظهر ضمن "ما تم تحصيله". مغلّف بـ try — لا يُعطّل إنشاء العقد إن فشل التسجيل.
    const _paidInit = parseNum(data.paid);
    if (_paidInit > 0) {
      try {
        const _rowNum = sheet.getLastRow();
        const _sd = data.start ? new Date(data.start) : null;
        const _ts = (_sd && !isNaN(_sd.getTime())) ? fmtDatetime(_sd) : fmtDatetime(new Date());
        const _rent = parseNum(data.rent);
        __PAYMENTS_CACHE = null;
        ensurePaymentsSheet().appendRow([
          _ts, currentUser() || 'system', sanitizeCell_(str(row[C.ID])), _rowNum,
          sanitizeCell_(data.tenant), sanitizeCell_(data.building), sanitizeCell_(data.unit),
          _paidInit, 0, _paidInit, Math.max(0, _rent - _paidInit),
          'رصيد افتتاحي (عند إنشاء العقد)'
        ]);
      } catch(e) {}
    }
    invalidateRuntimeCaches_();
    updateTenantRecord(data.tenant, data.phone);
    try { logActivity(currentUser() || 'system', 'إضافة', 'عقود', 'عقد جديد: ' + (data.tenant || '') + ' — ' + (data.building || '') + '/' + (data.unit || '')); } catch(e) {}
    return {success:true, message:'تمت إضافة العقد بنجاح'};
  });
}

function deleteContract(rowNum) {
  const auth = requirePerm_('contracts.delete'); if (auth) return auth;
  return withLock_(function(){
    rowNum = safeRowNum_(rowNum);
    const sheet = getSheet(CFG.SHEETS.CONTRACTS);
    if (!sheet) return {error:'الشيت غير موجود'};
    ensureSoftDeleteColumns_(sheet);
    let info = '', tenantName = '';
    try {
      const r = sheet.getRange(rowNum, 1, 1, Math.max(sheet.getLastColumn(), C.DELETED_BY+1)).getValues()[0];
      tenantName = str(r[C.TENANT]);
      info = (r[C.TENANT]||r[3]||'') + ' — ' + (r[C.BUILDING]||r[1]||'') + '/' + (r[C.UNIT]||r[2]||'');
    } catch (e) {}
    const deletedAt = fmtDatetime(new Date());
    const deletedBy = currentUser() || 'system';
    sheet.getRange(rowNum, C.DELETED+1).setValue('نعم');
    sheet.getRange(rowNum, C.DELETED_AT+1).setValue(deletedAt);
    sheet.getRange(rowNum, C.DELETED_BY+1).setValue(deletedBy);
    invalidateRuntimeCaches_();
    if (tenantName) updateTenantRecord(tenantName, '');
    try { logActivity(deletedBy, 'حذف مبدئي', 'عقود', 'نقل العقد إلى سلة المحذوفات: ' + info + ' — الصف: ' + rowNum + ' — وقت الحذف: ' + deletedAt); } catch(e) {}
    return {success:true, message:'تم نقل العقد إلى سلة المحذوفات. لا يُحذف المستأجر إلا إذا لم يعد لديه أي عقد نشط.'};
  });
}

function restoreContract(rowNum) {
  const authAdmin = requirePerm_('users.manage'); if (authAdmin) return authAdmin;
  const auth = requirePerm_('contracts.delete'); if (auth) return auth;
  return withLock_(function(){
    rowNum = safeRowNum_(rowNum);
    const sheet = getSheet(CFG.SHEETS.CONTRACTS); if (!sheet) return {error:'الشيت غير موجود'};
    ensureSoftDeleteColumns_(sheet);
    const r = sheet.getRange(rowNum,1,1,Math.max(sheet.getLastColumn(), C.DELETED_BY+1)).getValues()[0];
    if (!isContractDeletedRow_(r)) return {error:'هذا العقد غير موجود في سلة المحذوفات'};
    sheet.getRange(rowNum, C.DELETED+1, 1, 3).clearContent();
    invalidateRuntimeCaches_();
    updateTenantRecord(str(r[C.TENANT]), str(r[C.PHONE]));
    try { logActivity(currentUser() || 'system', 'استرجاع', 'عقود', 'استرجاع عقد: ' + str(r[C.TENANT]) + ' — ' + str(r[C.BUILDING]) + '/' + str(r[C.UNIT])); } catch(e) {}
    return {success:true, message:'تم استرجاع العقد وتحديث سجل المستأجر'};
  });
}

// لا نحذف المستأجر تلقائياً مع حذف عقد واحد؛ يتم تحديثه أو حذفه فقط إذا لم يبق له أي عقد نشط.
function syncAllTenantRecords() {
  const auth = requirePerm_('contracts.edit'); if (auth) return auth;
  return rebuildTenantRecords();
}

function listBackupFiles() {
  const auth = requirePerm_('backup.run'); if (auth) return [];
  try {
    const folder = getOrCreateBackupFolder();
    const files = folder.getFiles();
    const out = [];
    while (files.hasNext()) {
      const f = files.next();
      const name = f.getName();
      if (name.indexOf('نسخة') < 0 && name.indexOf('تلقائي') < 0 && name.indexOf('📦') < 0) continue;
      out.push({ id:f.getId(), name:name, date:fmtDatetime(f.getDateCreated()), url:f.getUrl() });
    }
    out.sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
    return out.slice(0, 50);
  } catch(e) { return []; }
}

function restoreBackupFromFile(fileId) {
  const auth = requirePerm_('backup.run'); if (auth) return auth;
  fileId = str(fileId);
  if (!fileId) return {error:'اختر نسخة احتياطية أولاً'};
  return withLock_(function(){
    try {
      const active = SpreadsheetApp.getActiveSpreadsheet();
      const backup = SpreadsheetApp.openById(fileId);
      const pre = backupNow();
      if (pre && pre.error) return {error:'تم إيقاف الاستعادة لأن إنشاء نسخة قبل الاستعادة فشل: ' + pre.error};

      const temp = active.insertSheet('__RESTORE_TEMP__' + Date.now());
      const activeSheets = active.getSheets();
      activeSheets.forEach(function(s){ if (s.getSheetId() !== temp.getSheetId()) active.deleteSheet(s); });

      backup.getSheets().forEach(function(src){
        const copied = src.copyTo(active);
        copied.setName(src.getName());
        try { copied.setRightToLeft(src.isRightToLeft()); } catch(e) {}
      });
      active.deleteSheet(temp);
      invalidateRuntimeCaches_();
      try { logActivity(currentUser() || 'system', 'استعادة نسخة', 'نظام', 'تمت الاستعادة من: ' + backup.getName()); } catch(e) {}
      return {success:true, message:'تمت استعادة النسخة الاحتياطية بنجاح. يفضّل تحديث الصفحة الآن.'};
    } catch(e) {
      return {error:'تعذّرت الاستعادة: ' + e.message};
    }
  });
}

function getAutoSmsSettings() {
  const auth = requirePerm_('sms.send'); if (auth) return {enabled:false};
  const p = PropertiesService.getScriptProperties();
  return {
    enabled: p.getProperty('AUTO_SMS_ENABLED') === 'on',
    renewalEnabled: p.getProperty('AUTO_SMS_RENEWAL') === 'on',
    paymentEnabled: p.getProperty('AUTO_SMS_PAYMENT') === 'on',
    renewalDays: parseInt(p.getProperty('AUTO_SMS_RENEWAL_DAYS') || '30', 10) || 30,
    hour: parseInt(p.getProperty('AUTO_SMS_HOUR') || '9', 10) || 9
  };
}

function saveAutoSmsSettings(settings) {
  const auth = requirePerm_('sms.send'); if (auth) return auth;
  settings = settings || {};
  const p = PropertiesService.getScriptProperties();
  const enabled = !!settings.enabled;
  p.setProperty('AUTO_SMS_ENABLED', enabled ? 'on' : 'off');
  p.setProperty('AUTO_SMS_RENEWAL', settings.renewalEnabled ? 'on' : 'off');
  p.setProperty('AUTO_SMS_PAYMENT', settings.paymentEnabled ? 'on' : 'off');
  p.setProperty('AUTO_SMS_RENEWAL_DAYS', String(Math.max(1, Math.min(120, parseInt(settings.renewalDays || 30, 10) || 30))));
  p.setProperty('AUTO_SMS_HOUR', String(Math.max(6, Math.min(22, parseInt(settings.hour || 9, 10) || 9))));
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction() === 'runAutoSmsJob') ScriptApp.deleteTrigger(t); });
  if (enabled) {
    ScriptApp.newTrigger('runAutoSmsJob').timeBased().everyDays(1).atHour(parseInt(p.getProperty('AUTO_SMS_HOUR'), 10)).create();
  }
  try { logActivity(currentUser() || 'system', 'تعديل', 'رسائل', (enabled ? 'تفعيل' : 'إيقاف') + ' الإرسال التلقائي للرسائل'); } catch(e) {}
  return {success:true, message: enabled ? 'تم تفعيل الإرسال التلقائي' : 'تم إيقاف الإرسال التلقائي'};
}

function renderAutoSmsTemplate_(tpl, data) {
  tpl = str(tpl);
  data = data || {};
  const repl = {
    name: data.name || data.tenant || '', tenant: data.tenant || data.name || '', amount: data.amount || data.rent || '',
    rent: data.rent || data.amount || '', date: data.date || data.dueDate || '', building: data.building || '', unit: data.unit || '', days: data.days || data.daysLeft || ''
  };
  Object.keys(repl).forEach(function(k){ tpl = tpl.replace(new RegExp('\\{' + k + '\\}', 'g'), repl[k]); });
  return tpl;
}

function getAutoSmsSentMap_(dateKey) {
  const p = PropertiesService.getScriptProperties();
  try { return JSON.parse(p.getProperty('AUTO_SMS_SENT_' + dateKey) || '{}'); } catch(e) { return {}; }
}
function setAutoSmsSentMap_(dateKey, map) {
  PropertiesService.getScriptProperties().setProperty('AUTO_SMS_SENT_' + dateKey, JSON.stringify(map || {}));
}

function runAutoSmsJob() {
  const s = getAutoSmsSettings();
  if (!s.enabled) return {success:false, message:'الإرسال التلقائي متوقف'};
  const templates = getSmsTemplates();
  const today = new Date(); today.setHours(0,0,0,0);
  const dateKey = Utilities.formatDate(today, 'Asia/Riyadh', 'yyyyMMdd');
  const sentMap = getAutoSmsSentMap_(dateKey);
  const targets = [];

  if (s.renewalEnabled) {
    getContracts().forEach(function(c){
      if (!c.phone || c.phone === 'nan' || c.daysLeft === null) return;
      if (parseInt(c.daysLeft, 10) === parseInt(s.renewalDays, 10)) {
        const key = 'renewal:' + (c.id || c.row);
        if (!sentMap[key]) targets.push({key:key, phone:c.phone, name:c.tenant, building:c.building, unit:c.unit, message:renderAutoSmsTemplate_(templates.renewal, {tenant:c.tenant, name:c.tenant, building:c.building, unit:c.unit, days:c.daysLeft, rent:c.rent})});
      }
    });
  }

  if (s.paymentEnabled) {
    getUpcomingDueDates(0).forEach(function(d){
      if (!d.phone || d.phone === 'nan' || parseInt(d.daysUntil,10) !== 0) return;
      const key = 'payment:' + (d.contractId || d.row) + ':' + d.dueDate;
      if (!sentMap[key]) targets.push({key:key, phone:d.phone, name:d.tenant, building:d.building, unit:d.unit, message:renderAutoSmsTemplate_(templates.payment, {tenant:d.tenant, name:d.tenant, amount:d.rent, rent:d.rent, date:d.dueDate, building:d.building, unit:d.unit})});
    });
  }

  const results = [];
  targets.slice(0, 50).forEach(function(t){
    const r = sendSingleSms(t.phone, t.message);
    if (r && r.success) sentMap[t.key] = true;
    results.push(Object.assign({}, t, r));
    Utilities.sleep(150);
  });
  setAutoSmsSentMap_(dateKey, sentMap);
  try { logActivity('system', 'رسائل تلقائية', 'SMS', 'تمت معالجة ' + results.length + ' رسالة تلقائية'); } catch(e) {}
  return {success:true, processed:results.length, sent:results.filter(function(r){return r.success;}).length, failed:results.filter(function(r){return !r.success;}).length};
}

// [أمان] حُذفت دالة emergencyCreateAdmin نهائياً — كانت تنشئ حساب أدمن
// بكلمة مرور ثابتة مكتوبة في الكود (rescueadmin / Rescue@2026)، وهو باب خلفي.
// لإنشاء حساب طوارئ عند الحاجة: استخدم ensureUsersSheet أو أنشئ المستخدم يدوياً
// من شيت "المستخدمون" مع كلمة مرور مُجزّأة عبر hashPassword_ من محرر Apps Script.

// ═══════════════════════════════════════════════════════════════
// دوال التحقق والصيانة — أضف في نهاية Code.gs
// ═══════════════════════════════════════════════════════════════

function validateContractDates_(data) {
  data = data || {};
  var start = String(data.start || '').trim();
  var end   = String(data.end   || '').trim();
  if (!start) return { error: 'تاريخ بداية العقد مطلوب' };
  if (!end)   return { error: 'تاريخ انتهاء العقد مطلوب' };
  var startD = new Date(start.replace(/\//g, '-'));
  var endD   = new Date(end.replace(/\//g, '-'));
  if (isNaN(startD.getTime())) return { error: 'تنسيق تاريخ البداية غير صحيح' };
  if (isNaN(endD.getTime()))   return { error: 'تنسيق تاريخ الانتهاء غير صحيح' };
  if (endD < startD)           return { error: 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية' };
  return null;
}

function validatePaymentAmount_(amount) {
  var amt = Number(amount);
  if (isNaN(amt) || amt <= 0) return { error: 'مبلغ الدفعة يجب أن يكون رقماً موجباً' };
  return null;
}

function validatePhone_(phone) {
  if (!phone || !String(phone).trim()) return null;
  var cleaned = String(phone).replace(/[\s\-]/g, '');
  var valid = /^05\d{8}$/.test(cleaned) ||
              /^009665\d{8}$/.test(cleaned) ||
              /^\+9665\d{8}$/.test(cleaned);
  if (!valid) return { error: 'رقم الجوال غير صحيح. يجب أن يبدأ بـ 05 ويكون 10 أرقام' };
  return null;
}

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
    var cached = _scGet_('MAINT_LIST'); if (cached) return cached;
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
    _scSet_('MAINT_LIST', result, 300);
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
      sanitizeCell_(data.date        || Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd')),
      sanitizeCell_(data.building),
      sanitizeCell_(data.unit        || ''),
      sanitizeCell_(data.tenant      || ''),
      sanitizeCell_(data.category    || 'أخرى'),
      sanitizeCell_(data.priority    || 'عادي'),
      sanitizeCell_(data.description),
      sanitizeCell_(data.contractor  || ''),
      sanitizeCell_(data.contractorPhone || ''),
      Number(data.actualCost) || 0,
      sanitizeCell_(data.status      || 'جديد'),
      sanitizeCell_(data.notes       || ''),
      username,
      Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd'),
      false
    ]);
    SpreadsheetApp.flush();
    _scDel_('MAINT_LIST');
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
      sanitizeCell_(data.date        || ''),
      sanitizeCell_(data.building    || ''),
      sanitizeCell_(data.unit        || ''),
      sanitizeCell_(data.tenant      || ''),
      sanitizeCell_(data.category    || 'أخرى'),
      sanitizeCell_(data.priority    || 'عادي'),
      sanitizeCell_(data.description || ''),
      sanitizeCell_(data.contractor  || ''),
      sanitizeCell_(data.contractorPhone || ''),
      Number(data.actualCost) || 0,
      sanitizeCell_(data.status      || 'جديد'),
      sanitizeCell_(data.notes       || '')
    ]]);
    SpreadsheetApp.flush();
    _scDel_('MAINT_LIST');
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
    _scDel_('MAINT_LIST');
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

  // Look up contractId from cached contracts (avoids a raw sheet read)
  var contractId = '';
  var contracts = getContracts();
  var matchedContract = contracts.filter(function(c){ return c.row === rowNum; })[0];
  if (matchedContract) contractId = matchedContract.id || '';

  var results = getPaymentsRows_()
    .filter(function(p) {
      var cRow = parseInt(p.row, 10);
      var cId = String(p.contractId || '');
      return (contractId && cId === contractId) || (!contractId && cRow === rowNum);
    })
    .map(function(p) {
      return {
        logRow:      p.logRow,
        date:        fmtDatetime(p.date),
        username:    p.username || '—',
        amount:      p.amount,
        before:      p.before,
        after:       p.after,
        remaining:   p.remaining,
        notes:       p.notes || '',
        tenant:      p.tenant || '',
        contractRow: parseInt(p.row, 10)
      };
    });

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
    paySheet.getRange(logRowNum, PC.NOTES+1).setValue(sanitizeCell_(finalNotes));

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
