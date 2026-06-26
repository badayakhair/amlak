// ── ثوابت الحالات (مرجع موحّد لتجنب الأخطاء الإملائية) ──────────
const CONTRACT_STATUS = {
  ACTIVE:    'ساري',
  EXPIRING:  'شارف على الانتهاء',
  EXPIRING2: 'تشارف انتهاء',  // قيمة قديمة قد تظهر في بيانات موجودة
  ENDED:     'منتهي'
};
// دالة مساعدة: هل الحالة تعني "يشارف على الانتهاء"؟
function isExpiring_(status) {
  return status === CONTRACT_STATUS.EXPIRING || status === CONTRACT_STATUS.EXPIRING2;
}
// دالة مساعدة: هل العقد نشط؟
function isActiveContract_(status) {
  return status === CONTRACT_STATUS.ACTIVE || isExpiring_(status);
}

const MAINTENANCE_STATUS   = { NEW:'جديد', IN_PROGRESS:'قيد التنفيذ', DONE:'مكتمل', CANCELLED:'ملغي' };
const MAINTENANCE_PRIORITY = { CRITICAL:'طارئ', HIGH:'عاجل', NORMAL:'عادي' };

// ── قائمة كل الصلاحيات الممكنة مع تسمياتها ────────────────────
const ALL_PERMS = [
  { key:'contracts.view',    label:'عرض العقود' },
  { key:'contracts.add',     label:'إضافة عقد' },
  { key:'contracts.edit',    label:'تعديل عقد' },
  { key:'contracts.delete',  label:'حذف عقد' },
  { key:'buildings.view',    label:'عرض المباني' },
  { key:'buildings.add',     label:'إضافة مبنى' },
  { key:'buildings.edit',    label:'تعديل مبنى' },
  { key:'buildings.delete',  label:'حذف مبنى' },
  { key:'tenants.view',      label:'عرض المستأجرين' },
  { key:'payments.add',      label:'تسجيل دفعات' },
  { key:'payments.edit',     label:'تعديل/تصحيح دفعات' },
  { key:'finance.view',      label:'التقارير المالية' },
  { key:'sms.send',          label:'إرسال SMS' },
  { key:'ai.use',            label:'المساعد الذكي' },
  { key:'alerts.view',      label:'عرض الاستحقاقات' },
  { key:'log.view',         label:'سجل الرسائل' },
  { key:'reports.export',    label:'تصدير البيانات' },
  { key:'users.manage',      label:'إدارة المستخدمين' },
  { key:'backup.run',        label:'النسخ الاحتياطي' },
  { key:'activity.view',     label:'سجل العمليات' },
  { key:'maintenance.view',  label:'عرض الصيانة' },
  { key:'maintenance.add',   label:'إضافة طلب صيانة' },
  { key:'maintenance.edit',  label:'تعديل طلب صيانة' },
  { key:'maintenance.delete',label:'حذف طلب صيانة' }
];

// صلاحيات الدور الافتراضية
const ROLE_DEFAULT_PERMS = {
  admin:    ALL_PERMS.map(p => p.key),
  manager:  ['contracts.view','contracts.add','contracts.edit','contracts.delete',
             'buildings.view','buildings.add','buildings.edit',
             'tenants.view','payments.add','payments.edit','finance.view','sms.send','ai.use','alerts.view','log.view','reports.export',
             'maintenance.view','maintenance.add','maintenance.edit','maintenance.delete'],
  employee: ['contracts.view','contracts.add','contracts.edit',
             'buildings.view','tenants.view','payments.add','sms.send','ai.use','alerts.view',
             'maintenance.view','maintenance.add','maintenance.edit'],
  viewer:   ['contracts.view','buildings.view','tenants.view','finance.view','maintenance.view']
};

function loadRolePerms() {
  const role = document.getElementById('u-role').value;
  const defaults = ROLE_DEFAULT_PERMS[role] || [];
  renderPermsGrid(defaults);
}

function renderPermsGrid(activePerms) {
  activePerms = expandPermsClient_(activePerms || []);
  const grid = document.getElementById('permsGrid');
  if (!grid) return;
  grid.innerHTML = ALL_PERMS.map(p => {
    const checked = activePerms.indexOf(p.key) >= 0;
    return '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:3px 0">' +
      '<input type="checkbox" name="perm_' + p.key + '" value="' + p.key + '"' +
      (checked ? ' checked' : '') + '>' +
      '<span>' + p.label + '</span>' +
      '</label>';
  }).join('');
}

function addPermClient_(list, perm) {
  if (perm && list.indexOf(perm) < 0) list.push(perm);
}

// يطابق منطق الخادم: بعض الصلاحيات تحتاج صلاحيات عرض مساندة حتى تعمل بدون كسر.
function expandPermsClient_(perms) {
  const out = [];
  (perms || []).forEach(p => addPermClient_(out, p));
  if (out.includes('contracts.add') || out.includes('contracts.edit') || out.includes('contracts.delete') || out.includes('payments.add') || out.includes('payments.edit')) {
    addPermClient_(out, 'contracts.view');
  }
  if (out.includes('payments.edit')) addPermClient_(out, 'payments.add');
  if (out.includes('contracts.add') || out.includes('contracts.edit')) {
    addPermClient_(out, 'buildings.view');
    addPermClient_(out, 'tenants.view');
  }
  if (out.includes('buildings.add') || out.includes('buildings.edit') || out.includes('buildings.delete')) {
    addPermClient_(out, 'buildings.view');
  }
  if (out.includes('sms.send')) {
    addPermClient_(out, 'contracts.view');
    addPermClient_(out, 'tenants.view');
  }
  if (out.includes('users.manage')) addPermClient_(out, 'activity.view');
  if (out.includes('maintenance.add') || out.includes('maintenance.edit') || out.includes('maintenance.delete')) {
    addPermClient_(out, 'maintenance.view');
  }
  return out;
}

function getSelectedPerms() {
  const boxes = document.querySelectorAll('#permsGrid input[type=checkbox]');
  const selected = [];
  boxes.forEach(b => { if (b.checked && selected.indexOf(b.value) < 0) selected.push(b.value); });
  return expandPermsClient_(selected);
}

function updateRolePreview() { loadRolePerms(); }


function smsButtonHtml(label, name, phone, rent, situation, extraStyle) {
  if (!hasPerm('sms.send')) return '';
  if (!phone || phone === 'nan') return '';
  return `<button class="btn btn-sm btn-amber" ${extraStyle ? 'style="'+extraStyle+'"' : ''} onclick="openCustomSms('${esc(name)}','${esc(phone)}',${rent||0},'${esc(situation||'')}')">${label || 'SMS'}</button>`;
}

function canSendSms() { return hasPerm('sms.send'); }



// خريطة الصلاحيات: tab name → required permission key
const PAGE_PERMS = {
  'dashboard':  null,               // متاح للجميع
  'map':        'buildings.view',
  'contracts':  'contracts.view',
  'manage':     'contracts.add|contracts.edit|payments.add|contracts.delete',    // إدارة العقود: إضافة/تعديل/دفعات
  'tenants':    'tenants.view',
  'buildings':  'buildings.view',
  'finance':    'finance.view',
  'sms':        'sms.send',
  'ai':         'ai.use',
  'alerts':     'alerts.view',      // يظهر فقط لمن لديه صلاحية عرض الاستحقاقات
  'users':      'users.manage',
  'activity':   'activity.view',
  'backup':     'backup.run',
  'log':        'log.view',         // يظهر فقط لمن لديه صلاحية سجل الرسائل
  'maintenance':'maintenance.view'  // قسم الصيانة
};

// تحقق هل للمستخدم الحالي صلاحية معينة
function hasPerm(perm) {
  if (!_currentUser || !_currentUser.perms) return false;
  if (!perm) return true;
  if (String(perm).indexOf('|') >= 0) { return String(perm).split('|').some(function(p){ return hasPerm(p); }); }
  var perms = _currentUser.perms || [];

  if (perms.indexOf('admin') >= 0) return true;
  if (perms.indexOf(perm) >= 0) return true;

  // توافق محدود فقط للحسابات القديمة التي لا تحتوي أي صلاحية بالصيغة الجديدة module.action.
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
    'alerts.view':      [],
    'log.view':         [],
    'users.manage':     ['users','admin'],
    'backup.run':       ['backup','admin'],
    'activity.view':    ['admin'],
    'maintenance.view': [],
    'maintenance.add':  ['write'],
    'maintenance.edit': ['write'],
    'maintenance.delete': ['delete']
  };
  var legacy = legacyMap[perm] || [];
  for (var j = 0; j < legacy.length; j++) if (perms.indexOf(legacy[j]) >= 0) return true;
  return false;
}

// ── State
// ── State ─────────────────────────────────────
let S = { contracts:[], buildings:[], tenants:[], maintenanceList:[], stats:null, loaded:false, dueAlerts:[] };
var _tabLoadedAt = {};  // طوابع زمنية لآخر تحميل كل تبويب
var _logData = [];      // كاش سجل الرسائل
var _financeData = null; // كاش بيانات المالية

// ── Init ──────────────────────────────────────
document.getElementById('topDate').textContent = new Date().toLocaleDateString('ar-SA',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
document.getElementById('smsText').addEventListener('input',function(){ document.getElementById('smsChars').textContent=smsPartsInfo_(this.value); });
checkSession();

// ── Data loading ──────────────────────────────

function applyAllData_(d) {
  const lb = document.getElementById('loadingBanner');
  if (lb) lb.style.display = 'none';
  if (!d || d.error) {
    if (d && d.error) {
      var msg = String(d.error);
      // إذا كان الخطأ متعلقاً بالجلسة، امسح التوكن وأعِد شاشة الدخول
      if (msg.indexOf('الجلسة') >= 0 || msg.indexOf('سجل الدخول') >= 0) {
        localStorage.removeItem('AMLAAK_TOKEN');
        showLoginScreen();
        return;
      }
      toast(msg, 'err');
    }
    return;
  }
  S.stats = d.stats || null;
  S.dueAlerts = d.dueAlerts || [];
  S.contracts = d.contracts || [];
  S.buildings = d.buildings || [];
  S.tenants = d.tenants || [];
  S.payments = Array.isArray(d.payments) ? d.payments : (S.payments || []);
  S.loaded = true;
  renderDashboard(); renderDashAlerts(); populateAllSelects(); renderContracts(); renderManage(); renderBuildingsTable(); populateMapSelect(); populateAdminArchiveBuildingSelect(); renderTenants(); renderTopbarAlerts_(d.topbarAlerts);
  // إذا كانت نافذة الدفعات مفتوحة، أعد رسم السجل بالبيانات المحدثة (يجلب رقم السجل الحقيقي للتعديل)
  const _pm = document.getElementById('paymentModal');
  if (_pm && _pm.style.display === 'flex') {
    const _pr = parseInt((document.getElementById('payRow') || {}).value, 10);
    if (_pr) loadContractPaymentHistory(_pr);
  }
}
function loadData() {
  // نحفظ التوكن الحالي لنتجاهل الردود القديمة التي تعود بعد تغيير الجلسة
  var myToken = localStorage.getItem('AMLAAK_TOKEN');
  const lb = document.getElementById('loadingBanner');
  if (lb) lb.style.display = 'flex';
  google.script.run
    .withSuccessHandler(function(d) {
      if (localStorage.getItem('AMLAAK_TOKEN') !== myToken) return;
      applyAllData_(d);
    })
    .withFailureHandler(function(e) {
      if (localStorage.getItem('AMLAAK_TOKEN') !== myToken) return;
      if (lb) lb.style.display = 'none';
      toast('خطأ تحميل البيانات: '+e.message,'err');
    })
    .getAllData();
}

// يلتقط التوكن الحالي وقت إرسال الطلب، ويتجاهل أي رد يعود بعد تغيّر الجلسة
// (تسجيل خروج أو دخول مستخدم آخر) حتى لا تُعرض بيانات مستخدم سابق.
function freshGuard_(fn) {
  var myToken = localStorage.getItem('AMLAAK_TOKEN');
  return function (d) {
    if (localStorage.getItem('AMLAAK_TOKEN') !== myToken) return;
    fn(d);
  };
}

// ── Silent refresh — تحديث في الخلفية ──

// ── AI Model Management ──────────────────────
function loadAISettings() {
  google.script.run
    .withSuccessHandler(s => {
      const sel = document.getElementById('aiModelSelect');
      if (sel && s.model) sel.value = s.model;
      const hint = document.getElementById('aiKeyHint');
      if (hint) {
        if (!s.hasKey) {
          hint.textContent = '⚠️ لم يُدخَل مفتاح';
          hint.style.color = 'var(--red)';
        } else {
          hint.textContent = '✓ ' + (s.provider === 'anthropic' ? 'Claude' : s.provider === 'openai' ? 'OpenAI' : 'متصل');
          hint.style.color = 'var(--green)';
        }
      }
    })
    .withFailureHandler(()=>{})
    .getAISettings();
}

function changeAIModel() {
  const model = document.getElementById('aiModelSelect').value;
  google.script.run
    .withSuccessHandler(()=>toast('تم تغيير النموذج'))
    .withFailureHandler(e=>toast('خطأ: '+e.message,'err'))
    .setAIModel(model);
}


function silentRefresh() {
  google.script.run
    .withSuccessHandler(freshGuard_(applyAllData_))
    .withFailureHandler(()=>{})
    .getAllData();
  // إذا كان قسم المالية مفتوحاً أعد تحميله لأنه يعتمد على API منفصل
  const finPage = document.getElementById('page-finance');
  if (finPage && finPage.classList.contains('active')) { _tabLoadedAt.finance = 0; loadFinance(); }
}

function renderTopbarAlerts_(a) {
  const el = document.getElementById('topAlertBadge'); if (!el) return;
  if (!a || !a.urgent) { el.style.display='none'; el.textContent=''; return; }
  el.style.display='inline-flex';
  el.textContent = 'تنبيهات عاجلة: ' + a.urgent;
  el.title = 'عقود تنتهي اليوم: ' + (a.expiredToday||0) + ' | استحقاقات متأخرة: ' + (a.overdue||0);
}

// ── Navigation ────────────────────────────────
function navTo(name) {
  var tabs = document.querySelectorAll('.tab');
  var target = null;
  tabs.forEach(function(t) {
    var oc = t.getAttribute('onclick') || '';
    if (oc.indexOf("nav('" + name + "'") >= 0) target = t;
  });
  nav(name, target);
}

function nav(name, el) {
  // تحقق من الصلاحية قبل الانتقال
  var perm = PAGE_PERMS[name];
  if (!hasPerm(perm)) {
    toast('ليس لديك صلاحية للوصول لهذا القسم', 'err');
    return;
  }
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
  document.getElementById('page-'+name).classList.add('active');
  if(el) el.classList.add('active');
  // تحميل البيانات عند فتح الصفحة
  if (name === 'alerts')   loadAlerts();
  if (name === 'finance')  loadFinance();
  if (name === 'ai')       loadAISettings();
  if (name === 'sms')      { loadSmsTemplates(); loadAutoSmsSettingsUI(); }
  if (name === 'users')    loadUsers();
  if (name === 'activity') { loadActivity(); if (hasPerm('users.manage')) { populateAdminArchiveBuildingSelect(); } }
  if (name === 'backup')      loadBackup();
  if (name === 'log')         loadLog();
  if (name === 'maintenance') loadMaintenance();
}

// ── Dashboard ─────────────────────────────────

function renderDashAlerts() {
  const el = document.getElementById('dashAlertsList');
  if (!el) return;
  const data = S.dueAlerts || [];
  if (!data.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--green);padding:6px 0">✅ لا توجد استحقاقات قريبة خلال 14 يوم</div>';
    return;
  }
  const top = data.slice(0, 5);
  el.innerHTML = top.map(d => {
    const cls = d.urgency==='overdue'||d.urgency==='critical'?'dot-r':d.urgency==='soon'?'dot-a':'dot-g';
    const lbl = d.daysUntil < 0 ? 'متأخر ' + Math.abs(d.daysUntil) + ' يوم' :
                d.daysUntil === 0 ? 'اليوم!' :
                'بعد ' + d.daysUntil + ' يوم';
    return `<div class="alert-item">
      <div class="dot ${cls}"></div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:500">${escHtml(d.tenant)} — ${escHtml(d.building)} ${escHtml(d.unit)}</div>
        <div style="font-size:11px;color:#718096">${escHtml(d.schedule)} | استحقاق: ${escHtml(d.dueDate)} | ${lbl} | ${nf(d.rent)} ر.س</div>
      </div>
      ${smsButtonHtml('SMS', d.tenant, d.phone, d.rent||0, '', 'padding:3px 8px;font-size:11px')}
    </div>`;
  }).join('') + (data.length > 5 ? '<div style="text-align:center;margin-top:8px;font-size:12px;color:#718096">+' + (data.length-5) + ' استحقاق آخر</div>' : '');
}

function renderDashboard() {
  if (!S.stats) return;
  const c=S.stats.counts||{}, f=S.stats.financials||{};
  const canFinance = hasPerm('finance.view') && S.stats.canViewFinance !== false;
  document.getElementById('m-active').textContent = c.active;
  document.getElementById('m-exp').textContent    = c.expiring;
  document.getElementById('m-ended').textContent  = c.expired;
  const annualRent = f.annualRent || f.totalRent || 0;
  const monthlyEst = f.monthlyRent || (annualRent ? Math.round(annualRent / 12) : 0);
  document.getElementById('m-rent').textContent   = canFinance ? nf(annualRent) : 'محجوب';
  document.getElementById('m-rent-sub').textContent = canFinance ? ('تقديري شهري: ' + nf(monthlyEst) + ' ر.س') : 'لا تملك صلاحية المالية';
  document.getElementById('m-paid').textContent   = canFinance ? nf(f.totalPaid) : 'محجوب';
  document.getElementById('m-rem').textContent    = canFinance ? nf(f.remaining) : 'محجوب';
  document.getElementById('m-nopay').textContent  = c.noPay;
  document.getElementById('m-rate').textContent   = canFinance ? (f.collectRate+'%') : 'محجوب';

  // Buildings
  // totalUnits: من جدول المباني المحلي إن توفر (نفس مصدر صفحة المباني → تطابق ضمان)
  // occupiedUnits: من الخادم مباشرة (تجنب إعادة حساب قد تختلف)
  const bc = document.getElementById('bldgCards'); bc.innerHTML='';
  Object.entries(S.stats.byBuilding||{}).forEach(function(entry) {
    var name = entry[0], d = entry[1];
    var nameTrimmed = String(name).trim();
    var bldg = (S.buildings || []).find(function(b){ return String(b.name||'').trim() === nameTrimmed; });
    var totalU = (bldg && bldg.totalUnits > 0) ? bldg.totalUnits : d.totalUnits;
    var occ    = d.occupiedUnits;
    var vac    = Math.max(0, totalU - occ);
    var pct    = totalU > 0 ? Math.round(occ / totalU * 100) : 0;
    bc.innerHTML += `<div class="bldg-card" style="margin-bottom:8px">
      <div class="bldg-name">${escHtml(name)}</div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span>مشغول: <strong style="color:var(--green)">${occ}</strong> / ${totalU}</span>
        <span>فارغ: <strong style="color:var(--red)">${vac}</strong></span>
        <span class="badge b-${pct>=70?'green':pct>=40?'amber':'red'}">${pct}%</span>
      </div>
      <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
  });

  // Urgent
  const ul=document.getElementById('urgentList'); ul.innerHTML='';
  const _urgent = S.stats.urgentContracts || [];
  if (!_urgent.length) { ul.innerHTML='<div style="font-size:13px;color:#718096;padding:6px 0">لا توجد عقود عاجلة ✅</div>'; }
  _urgent.forEach(c=>{
    const d=c.daysLeft, cls=d<0||d<15?'dot-r':'dot-a';
    const lbl=d<0?`انتهى منذ ${Math.abs(d)} يوم`:d===0?'ينتهي اليوم!':d+' يوم';
    ul.innerHTML+=`<div class="alert-item"><div class="dot ${cls}"></div><div>
      <div style="font-size:13px;font-weight:500">${escHtml(c.tenant)}</div>
      <div style="font-size:11px;color:#718096">${escHtml(c.building)} — شقة ${escHtml(c.unit)} | ${lbl}
        ${smsButtonHtml('SMS', c.tenant, c.phone, c.rent||0, 'تنبيه قرب انتهاء عقد', 'margin-right:6px;padding:2px 7px;font-size:11px')}
      </div></div></div>`;
  });

  // NoPay
  const np=document.getElementById('noPayList'); np.innerHTML='';
  const _noPay = S.stats.noPayContracts || [];
  if (!_noPay.length) { np.innerHTML='<div style="font-size:13px;color:var(--green);padding:6px 0">✅ جميع المستأجرين سددوا</div>'; return; }
  np.innerHTML=`<div class="tbl-wrap"><table><thead><tr><th>المستأجر</th><th>المبنى</th><th>شقة</th><th>الإيجار</th><th>إجراء</th></tr></thead><tbody>
    ${_noPay.map(c=>`<tr>
      <td><strong>${escHtml(c.tenant)}</strong></td><td>${escHtml(c.building)}</td><td>${escHtml(c.unit)}</td>
      <td><strong style="color:var(--red)">${nf(c.rent)} ر.س</strong></td>
      <td>${smsButtonHtml('تذكير SMS', c.tenant, c.phone, c.rent||0, 'تذكير بسداد الإيجار')}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

// ── Building Map ──────────────────────────────
function populateMapSelect() {
  const sel = document.getElementById('mapBuildingSelect');
  const cur = sel.value;
  while(sel.options.length>1) sel.remove(1);
  S.buildings.forEach(b => { const o=document.createElement('option'); o.value=o.text=b.name; sel.add(o); });
  if(cur) sel.value=cur;
}

function loadBuildingMap() {
  const name = document.getElementById('mapBuildingSelect').value;
  if (!name) return;
  document.getElementById('mapTitle').textContent = '⏳ جارٍ التحميل...';
  document.getElementById('bMapGrid').innerHTML = '';
  document.getElementById('unitDetail').style.display='none';

  google.script.run
    .withSuccessHandler(renderBuildingMap)
    .withFailureHandler(e=>toast('خطأ: '+e.message,'err'))
    .getBuildingMap(name);
}

function renderBuildingMap(data) {
  document.getElementById('mapTitle').textContent = `🏢 ${data.buildingName} — ${data.units.length} وحدة`;
  // ملاحظة: mapTitle يستخدم textContent (آمن) — لكن خلايا الوحدات أدناه تُبنى بـ innerHTML وتُهرَّب.

  const occ = data.units.filter(
  u => u.status === 'مشغولة'
).length;

const exp = data.units.filter(
  u => u.status === 'تشارف انتهاء' ||
       u.status === 'شارف على الانتهاء'
).length;
  const vac = data.units.filter(u=>u.status==='فارغة').length;

  const statsEl = document.getElementById('mapStats');
  statsEl.style.display='grid';
  statsEl.innerHTML=`
    <div class="metric m-green"><div class="metric-label">مشغولة</div><div class="metric-value">${occ}</div></div>
    <div class="metric m-amber"><div class="metric-label">تشارف انتهاء</div><div class="metric-value">${exp}</div></div>
    <div class="metric m-red"><div class="metric-label">فارغة</div><div class="metric-value">${vac}</div></div>
    <div class="metric m-blue"><div class="metric-label">نسبة الإشغال</div><div class="metric-value">${data.units.length?Math.round((occ+exp)/data.units.length*100):0}%</div></div>`;

  const grid = document.getElementById('bMapGrid'); grid.innerHTML='';
  data.units.forEach(u => {
    const _isExp=u.status==='شارف على الانتهاء'||u.status==='تشارف انتهاء';
    const cls = u.status==='مشغولة'?'unit-occ':_isExp?'unit-exp':'unit-vac';
    const lbl = u.status==='مشغولة'?'مشغولة':_isExp?'قريب انتهاء':'فارغة';
    grid.innerHTML+=`<div class="unit-cell ${cls}" onclick="showUnitDetail('${esc(u.unit)}','${esc(data.buildingName)}')">
      <div class="unit-num">${escHtml(u.unit)}</div>
      <div class="unit-lbl">${lbl}</div>
      ${u.daysLeft!==null&&u.daysLeft<=30?`<div style="font-size:9px;margin-top:1px">${u.daysLeft}ي</div>`:''}
    </div>`;
  });

  window._currentMapData = data;
}

function showUnitDetail(unit, building) {
  const data = window._currentMapData;
  if (!data) return;
  const u = data.units.find(x=>x.unit===unit);
  const history = (data.unitHistory||{})[unit] || [];
  const card = document.getElementById('unitDetail');
  card.style.display='block';
  document.getElementById('unitDetailTitle').textContent = `🚪 وحدة ${unit} — ${building}`;

  let html = '';
  if (u && u.status!=='فارغة') {
    html+=`<div style="background:var(--gray-l);border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px">
      <div style="font-weight:600;font-size:14px;margin-bottom:6px">${escHtml(u.tenant)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;color:#718096">
        <div>الجوال: <strong>${escHtml(u.phone)||'—'}</strong></div>
        <div>الإيجار: <strong>${nf(u.rent)} ر.س</strong></div>
        <div>نهاية العقد: <strong>${escHtml(u.end)||'—'}</strong></div>
        <div>الأيام المتبقية: <strong style="color:${u.daysLeft<0?'var(--red)':u.daysLeft<30?'var(--amber)':'var(--green)'}">${u.daysLeft!==null?u.daysLeft+' يوم':'—'}</strong></div>
        <div>النوع: <strong>${escHtml(u.type)||'—'}</strong></div>
      </div>
      ${smsButtonHtml('إرسال SMS', u.tenant, u.phone, u.rent||0, '', 'margin-top:8px')}
    </div>`;
  } else {
    html+=`<div style="background:var(--gray-l);border-radius:8px;padding:10px;margin-bottom:12px;font-size:13px;color:#718096">
      هذه الوحدة فارغة حالياً
      ${hasPerm('contracts.add') ? `<button class="btn btn-sm btn-success" style="margin-right:10px" onclick="openContractModal('add','${esc(building)}','${esc(unit)}')">+ إضافة عقد</button>` : ''}
    </div>`;
  }

  if (history.length) {
    html+=`<div style="font-size:13px;font-weight:500;margin-bottom:8px;color:var(--navy)">📋 تاريخ الوحدة (${history.length} عقد)</div>
    <div class="timeline">`;
    history.sort((a,b)=>((b.start||'').localeCompare(a.start||''))||0).forEach((h,i)=>{
      const dotCls = h.status==='ساري'?'tl-dot-green':h.status==='منتهي'?'tl-dot-gray':'tl-dot-amber';
      html+=`<div class="tl-item"><div class="tl-dot ${dotCls}"></div>
        <div class="tl-content">
          <div style="font-weight:500">${escHtml(h.tenant)}</div>
          <div style="font-size:11px;color:#718096;margin-top:3px">${escHtml(h.start)||'—'} ← ${escHtml(h.end)||'—'} | ${nf(h.rent)} ر.س | ${statusBadge(h.status)}</div>
        </div></div>`;
    });
    html+='</div>';
  }

  document.getElementById('unitDetailBody').innerHTML = html;
  card.scrollIntoView({behavior:'smooth', block:'nearest'});
}

// ── Contracts table ───────────────────────────
function renderContracts() {
  if (!S.contracts.length) return;
  const q =document.getElementById('searchInput').value.toLowerCase();
  const b =document.getElementById('fBldg').value;
  const st=document.getElementById('fStatus').value;
  const tp=document.getElementById('fType').value;
  const filtered=S.contracts.filter(c=>
    (!q ||c.tenant.toLowerCase().includes(q)||c.unit.includes(q)||c.building.includes(q))&&
    (!b ||c.building===b)&&(!st||c.status===st)&&(!tp||c.type===tp));
  const tbody=document.getElementById('contractsBody');
  tbody.innerHTML=filtered.map(c=>{
    const d=c.daysLeft, typeBadge=c.type==='تجاري'?'<span class="badge b-amber">تجاري</span>':'<span class="badge b-blue">سكني</span>';
    const dLabel=d===null?'—':d<0?`<span style="color:var(--red);font-weight:600">${d}</span>`:d<=30?`<span style="color:var(--amber);font-weight:600">${d}</span>`:d;
    const pctColor=c.payPct===100?'var(--green)':c.payPct===0&&c.rent>0?'var(--red)':c.payPct<50?'var(--amber)':'inherit';
    return `<tr><td><strong>${escHtml(c.tenant)}</strong></td><td>${escHtml(c.building)}</td><td>${escHtml(c.unit)}</td><td>${typeBadge}</td>
      <td style="font-size:12px">${escHtml(c.end)||'—'}</td><td style="text-align:center">${dLabel}</td>
      <td>${c.rent?nf(c.rent)+' ر.س':'—'}</td>
      <td>${c.paid?nf(c.paid):c.rent>0?'<span style="color:var(--red)">0</span>':'—'}</td>
      <td style="color:${pctColor};font-weight:500;text-align:center">${c.rent>0?c.payPct+'%':'—'}</td>
      <td>${statusBadge(c.status)}</td>
      <td>${smsButtonHtml('SMS', c.tenant, c.phone, c.rent||0, '')}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="11" style="text-align:center;padding:20px;color:#718096">لا توجد نتائج</td></tr>';
  document.getElementById('contractsCount').textContent=`عرض ${filtered.length} من ${S.contracts.length}`;
}

// ── Manage table ──────────────────────────────
function loadDeletedContracts(){
  if(!hasPerm('users.manage') || !hasPerm('contracts.delete')){toast('هذه السلة متاحة للمدير فقط','err');return;}
  google.script.run.withSuccessHandler(rows=>{
    const card=document.getElementById('deletedContractsCard'), body=document.getElementById('deletedContractsBody');
    card.style.display='block';
    if(!rows||!rows.length){body.innerHTML='<div style="color:#718096">لا توجد عقود محذوفة</div>';return;}
    body.innerHTML="<div style='display:flex;justify-content:flex-end;margin-bottom:8px'><button class='btn btn-sm' onclick=\"document.getElementById('deletedContractsCard').style.display='none'\">إخفاء السلة</button></div>"+
      '<div class="tbl-wrap"><table><thead><tr><th>المستأجر</th><th>المبنى</th><th>الوحدة</th><th>تاريخ الحذف</th><th>بواسطة</th><th>إجراء</th></tr></thead><tbody>'+rows.map(r=>
        `<tr><td>${escHtml(r.tenant)}</td><td>${escHtml(r.building)}</td><td>${escHtml(r.unit)}</td><td>${escHtml(r.deletedAt)||'—'}</td><td>${escHtml(r.deletedBy)||'—'}</td><td><button class="btn btn-sm btn-success" onclick="restoreDeletedContract(${r.row})">استرجاع</button></td></tr>`
      ).join('')+'</tbody></table></div>';
  }).withFailureHandler(e=>toast('خطأ: '+e.message,'err')).listDeletedContracts();
}
function restoreDeletedContract(row){
  if(!confirm('استرجاع هذا العقد؟')) return;
  google.script.run.withSuccessHandler(r=>{ if(r&&r.error){toast(r.error,'err');return;} toast('تم الاسترجاع'); loadData(); loadDeletedContracts(); }).withFailureHandler(e=>toast('خطأ: '+e.message,'err')).restoreContract(row);
}
function renderManage() {
  if (!S.contracts.length) return;
  const q =document.getElementById('mSearch').value.toLowerCase();
  const b =document.getElementById('mBldg').value;
  const tp=document.getElementById('mType').value;
  const filtered=S.contracts.filter(c=>
    (!q||c.tenant.toLowerCase().includes(q)||c.unit.includes(q))&&(!b||c.building===b)&&(!tp||c.type===tp));
  const tbody=document.getElementById('manageBody');
  tbody.innerHTML=filtered.map(c=>{
    const typeBadge=c.type==='تجاري'?'<span class="badge b-amber">تجاري</span>':'<span class="badge b-blue">سكني</span>';
    return `<tr><td><strong>${escHtml(c.tenant)}</strong></td>
      <td style="direction:ltr;text-align:left;font-size:12px">${escHtml(c.phone)||'—'}</td>
      <td>${escHtml(c.building)}</td><td>${escHtml(c.unit)}</td><td>${typeBadge}</td>
      <td>${c.rent?nf(c.rent):'-'}</td>
      <td style="color:${c.payPct===100?'var(--green)':c.paid===0&&c.rent>0?'var(--red)':'inherit'}">${c.paid?nf(c.paid):c.rent>0?'<span style="color:var(--red)">0</span>':'-'}</td>
      <td>${statusBadge(c.status)}</td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap">
        ${hasPerm('contracts.edit') ? `<button class="btn btn-sm btn-primary" onclick="openContractModal('edit',null,null,${c.row})">تعديل</button>` : ''}
        ${hasPerm('payments.add') ? `<button class="btn btn-sm btn-success" onclick="openPaymentModal(${c.row},'${esc(c.tenant)}',${c.rent||0},${c.paid||0})">دفعة</button>` : ''}
        ${hasPerm('contracts.delete') ? `<button class="btn btn-sm btn-danger" onclick="confirmDelete(${c.row},'${esc(c.tenant)}')">حذف</button>` : ''}
      </div></td>
    </tr>`;
  }).join('')||'<tr><td colspan="9" style="text-align:center;padding:20px;color:#718096">لا توجد نتائج</td></tr>';
}

// ── Tenants ───────────────────────────────────
function renderTenants() {
  const q =document.getElementById('tSearch').value.toLowerCase();
  const st=document.getElementById('tStatus').value;
  // ابني خريطة هوية لكل مستأجر من العقود (fallback)
  const idMap = {};
  (S.contracts||[]).forEach(c => { if (c.tenant && c.idNo) idMap[c.tenant] = c.idNo; });
  // أضف الهوية من contracts إذا غير موجودة في tenants
  S.tenants.forEach(t => { if (!t.idNo && idMap[t.name]) t.idNo = idMap[t.name]; });

  const data=S.tenants.filter(t=>(!q||t.name.toLowerCase().includes(q)||t.phone.includes(q)||(t.idNo&&t.idNo.includes(q)))&&(!st||t.lastStatus===st));
  document.getElementById('tenantsBody').innerHTML=data.map(t=>`<tr>
    <td><strong>${escHtml(t.name)}</strong></td>
    <td style="direction:ltr;text-align:left;font-size:12px">${escHtml(t.idNo)||'—'}</td>
    <td style="direction:ltr;text-align:left;font-size:12px">${escHtml(t.phone)||'—'}</td>
    <td style="text-align:center"><strong style="color:var(--blue)">${t.contractsCount}</strong></td>
    <td>${escHtml(t.lastBuilding)||'—'}</td><td>${escHtml(t.lastUnit)||'—'}</td>
    <td>${t.totalPaid?nf(t.totalPaid)+' ر.س':'—'}</td>
    <td>${escHtml(t.regularityScore)||'—'}</td>
    <td>${statusBadge(t.lastStatus)}</td>
    <td><button class="btn btn-sm btn-primary" onclick="showTenantHistory('${esc(t.name)}')">السجل</button></td>
  </tr>`).join('')||'<tr><td colspan="9" style="text-align:center;padding:20px;color:#718096">لا توجد بيانات</td></tr>';
}

function showTenantHistory(name) {
  document.getElementById('tenantHistoryTitle').textContent='⏳ جارٍ تحميل سجل '+name+'...';
  document.getElementById('tenantHistoryBody').innerHTML='<div style="padding:20px;text-align:center;color:#718096">جارٍ التحميل...</div>';
  openModal('tenantHistoryModal');

  google.script.run
    .withSuccessHandler(data => {
      document.getElementById('tenantHistoryTitle').textContent=`📋 سجل ${data.tenantName} — ${data.contractsCount} عقد | إجمالي المدفوع: ${nf(data.totalPaid)} ر.س`;
      if (!data.history.length) { document.getElementById('tenantHistoryBody').innerHTML='<p style="color:#718096;font-size:13px">لا توجد بيانات</p>'; return; }
      let html='<div class="timeline">';
      data.history.forEach(c=>{
        const dotCls=c.status==='ساري'?'tl-dot-green':c.status==='منتهي'?'tl-dot-gray':'tl-dot-amber';
        html+=`<div class="tl-item"><div class="tl-dot ${dotCls}"></div>
          <div class="tl-content">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong>${escHtml(c.building)} — شقة ${escHtml(c.unit)}</strong>${statusBadge(c.status)}
            </div>
            <div style="font-size:11px;color:#718096;margin-top:4px">
              ${escHtml(c.start)||'—'} ← ${escHtml(c.end)||'—'} &nbsp;|&nbsp; إيجار: ${nf(c.rent)} ر.س &nbsp;|&nbsp; مدفوع: ${nf(c.paid)} ر.س &nbsp;|&nbsp; ${escHtml(c.type)||'سكني'}
            </div>
            ${c.regularity?`<div style="font-size:11px;color:#718096;margin-top:2px">الانتظام: ${escHtml(c.regularity)}</div>`:''}
          </div></div>`;
      });
      html+='</div>';
      document.getElementById('tenantHistoryBody').innerHTML=html;
    })
    .withFailureHandler(e=>toast('خطأ: '+e.message,'err'))
    .getTenantContracts(name);
}

// ── Buildings table ───────────────────────────
function renderBuildingsTable() {
  const tbody=document.getElementById('buildingsBody');
  if (!S.buildings.length) { tbody.innerHTML='<tr><td colspan="9" style="text-align:center;padding:20px;color:#718096">لا توجد مباني — اضغط إضافة مبنى</td></tr>'; return; }

  // احسب الإحصائيات من S.contracts مباشرة (مصدر موثوق)
  const stats = {};
  (S.contracts || []).forEach(c => {
    const bName = String(c.building || '').trim();
    if (!bName) return;
    if (!stats[bName]) stats[bName] = { occupied: new Set(), occupiedNoUnit: 0, allUnits: new Set() };
    if (c.unit) stats[bName].allUnits.add(String(c.unit));
    if (c.status === 'ساري' || c.status === 'شارف على الانتهاء' || c.status === 'تشارف انتهاء') {
      if (c.unit) {
        stats[bName].occupied.add(String(c.unit));
      } else {
        stats[bName].occupiedNoUnit++;
      }
    }
  });

  tbody.innerHTML=S.buildings.map(b=>{
    const s = stats[String(b.name || '').trim()];
    const totalU = b.totalUnits > 0 ? b.totalUnits : (s ? s.allUnits.size : 0);
    const occ = s ? s.occupied.size + s.occupiedNoUnit : 0;
    const vac = Math.max(0, totalU - occ);
    const pct = totalU > 0 ? Math.round(occ / totalU * 100) : 0;
    return `<tr>
      <td><strong>${escHtml(b.name)}</strong></td>
      <td>${b.type==='تجاري'?'<span class="badge b-amber">تجاري</span>':b.type==='مختلط'?'<span class="badge b-navy">مختلط</span>':'<span class="badge b-blue">سكني</span>'}</td>
      <td style="text-align:center">${b.totalUnits}</td><td style="text-align:center">${b.floors}</td>
      <td style="text-align:center;color:var(--green);font-weight:500">${occ}</td>
      <td style="text-align:center;color:var(--red);font-weight:500">${vac}</td>
      <td style="text-align:center"><span class="badge b-${pct>=70?'green':pct>=40?'amber':'red'}">${pct}%</span></td>
      <td style="font-size:12px;color:#718096">${escHtml(b.notes)||'—'}</td>
      <td><div style="display:flex;gap:4px">
        ${hasPerm('buildings.edit') ? `<button class="btn btn-sm btn-primary" onclick="openBuildingModal('edit',${b.row})">تعديل</button>` : ''}
        ${(hasPerm('users.manage') && hasPerm('buildings.delete')) ? `<button class="btn btn-sm btn-danger" onclick="archiveBuildingFromTable(${b.row},'${esc(b.name)}')">أرشفة</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

// ── Contract Modal ────────────────────────────
function openContractModal(mode, building, unit, rowNum) {
  var neededPerm = mode === 'edit' ? 'contracts.edit' : 'contracts.add';
  if (!hasPerm(neededPerm)) { toast('ليس لديك الصلاحية المطلوبة', 'err'); return; }
  clearCForm();
  document.getElementById('cEditRow').value = rowNum||'';
  document.getElementById('cModalTitle').textContent = mode==='add'?'+ إضافة عقد جديد':'✏️ تعديل العقد';
  document.getElementById('cSaveBtn').textContent = mode==='add'?'إضافة':'حفظ التعديلات';
  // ملء قائمة المباني
  const sel=document.getElementById('c-building');
  sel.innerHTML='<option value="">اختر...</option>';
  S.buildings.forEach(b=>{ const o=document.createElement('option'); o.value=o.text=b.name; sel.add(o); });
  if (building) sel.value=building;
  if (unit) document.getElementById('c-unit').value=unit;
  if (mode==='edit'&&rowNum) {
    const c=S.contracts.find(x=>x.row===rowNum);
    if(c){
      document.getElementById('c-tenant').value=c.tenant;
      document.getElementById('c-idNo').value=c.idNo||'';
      document.getElementById('c-phone').value=c.phone;
      document.getElementById('c-building').value=c.building;
      document.getElementById('c-unit').value=c.unit;
      document.getElementById('c-type').value=c.type||'سكني';
      document.getElementById('c-status').value=c.status;
      document.getElementById('c-start').value=c.start?c.start.replace(/\//g,'-'):'';
      document.getElementById('c-end').value=c.end?c.end.replace(/\//g,'-'):'';
      document.getElementById('c-rent').value=c.rent||'';
      document.getElementById('c-paid').value=c.paid||'';
      document.getElementById('c-schedule').value=c.schedule||'';
      document.getElementById('c-regularity').value=c.regularity||'';
      document.getElementById('c-notes').value=c.notes||'';
    }
  }
  openModal('contractModal');
  // حدّث تاريخ الاستحقاق التالي تلقائياً
  setTimeout(updateNextDue, 50);
}

function saveContract() {
  const rowNum=document.getElementById('cEditRow').value;
  if (!hasPerm(rowNum ? 'contracts.edit' : 'contracts.add')) { toast('ليس لديك الصلاحية المطلوبة', 'err'); return; }
  const data={
    tenant:document.getElementById('c-tenant').value.trim(),
    idNo:document.getElementById('c-idNo').value.trim(),
    phone:document.getElementById('c-phone').value.trim(),
    building:document.getElementById('c-building').value,
    unit:document.getElementById('c-unit').value.trim(),
    type:document.getElementById('c-type').value,
    status:document.getElementById('c-status').value,
    start:document.getElementById('c-start').value.replace(/-/g,'/'),
    end:document.getElementById('c-end').value.replace(/-/g,'/'),
    rent:document.getElementById('c-rent').value,
    paid:document.getElementById('c-paid').value,
    schedule:document.getElementById('c-schedule').value,
    regularity:document.getElementById('c-regularity').value,
    notes:document.getElementById('c-notes').value.trim(),
  };
  if(!data.tenant){toast('اسم المستأجر مطلوب','err');return;}
  if(!data.building){toast('اختر المبنى','err');return;}
  if(!data.unit){toast('رقم الوحدة مطلوب','err');return;}
  if(!data.start){toast('تاريخ بداية العقد مطلوب','err');return;}
  if(!data.end){toast('تاريخ انتهاء العقد مطلوب','err');return;}
  if(data.start && data.end && data.end < data.start){toast('تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية','err');return;}
  const phoneErr=validateSaudiPhone_(data.phone);
  if(phoneErr){toast(phoneErr,'err');return;}
  const btn=document.getElementById('cSaveBtn');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span>جارٍ الحفظ...';
  const cb=r=>{
    btn.disabled=false; btn.textContent=rowNum?'حفظ التعديلات':'إضافة';
    if(r && r.error){
      document.getElementById('cModalResult').innerHTML=`<div class="result err">❌ ${r.error}</div>`;
      toast('❌ ' + r.error, 'err');
      return;
    }
    document.getElementById('cModalResult').innerHTML=`<div class="result">✅ ${(r&&r.message)||'تم الحفظ'}</div>`;
    toast((r&&r.message)||'تم الحفظ');
    // عند إضافة عقد جديد: صِفر الفلاتر حتى يظهر العقد الجديد في القائمة
    if(!rowNum){
      ['searchInput','fBldg','fStatus','fType'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    }
    silentRefresh();
    setTimeout(()=>closeModal('contractModal'),600);
  };
  if(rowNum) google.script.run.withSuccessHandler(cb).withFailureHandler(e=>{btn.disabled=false;toast('خطأ: '+e.message,'err');}).updateContract(parseInt(rowNum),data);
  else google.script.run.withSuccessHandler(cb).withFailureHandler(e=>{btn.disabled=false;toast('خطأ: '+e.message,'err');}).addContract(data);
}

function clearCForm() {
  ['c-tenant','c-idNo','c-phone','c-unit','c-rent','c-paid','c-notes','c-start','c-end'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('cModalResult').innerHTML='';
}

function confirmDelete(row, name) {
  if(!confirm(`نقل عقد "${name}" إلى سلة المحذوفات؟
يمكن استرجاعه لاحقاً من إدارة العقود.`)) return;
  google.script.run.withSuccessHandler(r=>{
      if(r && r.error){ toast('❌ '+r.error,'err'); return; }
      toast((r&&r.message)||'✅ تم نقل العقد إلى السلة');
      silentRefresh();
      const card=document.getElementById('deletedContractsCard');
      if(card && card.style.display!=='none') loadDeletedContracts();
    })
    .withFailureHandler(e=>toast('خطأ: '+e.message,'err')).deleteContract(row);
}

// ── Payment Modal ─────────────────────────────
function openPaymentModal(row,name,rent,paid) {
  if (!hasPerm('payments.add')) { toast('ليس لديك الصلاحية المطلوبة', 'err'); return; }
  document.getElementById('payRow').value=row;
  document.getElementById('payAmount').value='';
  document.getElementById('payResult').innerHTML='';
  const remaining=Math.max(0,Number(rent||0)-Number(paid||0));
  document.getElementById('payAmount').dataset.maxAmount=remaining;
  const h = document.getElementById('payHistory'); if (h) h.innerHTML = '<div style="padding:8px;color:#718096">جارٍ التحميل...</div>';
  document.getElementById('payInfo').innerHTML=`<strong>${escHtml(name)}</strong><br>الإيجار: ${nf(rent)} ر.س &nbsp;|&nbsp; مدفوع: <span style="color:var(--green)">${nf(paid)} ر.س</span> &nbsp;|&nbsp; متبقي: <span style="color:var(--red)">${nf(remaining)} ر.س</span>`;
  openModal('paymentModal');
  loadContractPaymentHistory(row);
}

function savePayment() {
  if (!hasPerm('payments.add')) { toast('ليس لديك الصلاحية المطلوبة', 'err'); return; }
  const row=parseInt(document.getElementById('payRow').value);
  const amtInput=document.getElementById('payAmount');
  const amt=parseFloat(amtInput.value);
  const maxAmt=parseFloat(amtInput.dataset.maxAmount||'0');
  if(!amt||amt<=0||isNaN(amt)){toast('أدخل مبلغاً صحيحاً','err');return;}
  if(maxAmt>0&&amt>maxAmt){toast(`المبلغ المدخل (${nf(amt)} ر.س) يتجاوز المتبقي (${nf(maxAmt)} ر.س)`,'err');return;}
  // حماية من الإرسال المزدوج: تعطيل الزر حتى يعود الرد (يمنع تسجيل دفعة مكررة)
  const _payBtn=document.getElementById('paySaveBtn');
  if(_payBtn){ if(_payBtn.disabled) return; _payBtn.disabled=true; _payBtn.dataset.lbl=_payBtn.textContent; _payBtn.innerHTML='<span class="spin"></span>جارٍ التسجيل...'; }
  const _payRestore=()=>{ if(_payBtn){ _payBtn.disabled=false; _payBtn.textContent=_payBtn.dataset.lbl||'تسجيل'; } };
  google.script.run
    .withSuccessHandler(r=>{
      _payRestore();
      if(r.error){toast('❌ '+r.error,'err');return;}
      document.getElementById('payResult').innerHTML=`<div class="result">✅ سُجّلت ${nf(amt)} ر.س | متبقي: ${nf(r.remaining)} ر.س</div>`;
      document.getElementById('payAmount').value='';
      // تحديث فوري لبيانات S.contracts و S.tenants بدون انتظار silentRefresh
      const c = S.contracts.find(x => x.row === row);
      if (c) {
        c.paid = (Number(c.paid) || 0) + amt;
        const t = S.tenants.find(x => x.name === c.tenant);
        if (t) t.totalPaid = (Number(t.totalPaid) || 0) + amt;
        renderTenants();
        renderContracts();
      }
      // إدخال تفاؤلي في S.payments ليظهر السجل فوراً (logRow=0 مؤقت حتى يُستبدل بـ silentRefresh)
      if (!Array.isArray(S.payments)) S.payments = [];
      S.payments.push({
        logRow: 0,
        row: row,
        contractId: c ? (c.id || '') : '',
        date: _nowStamp_(),
        username: (_currentUser && (_currentUser.name || _currentUser.username)) || '—',
        amount: amt,
        remaining: Number(r.remaining) || 0,
        notes: ''
      });
      // تحديث إجمالي المدفوع/المتبقي/نسبة التحصيل في لوحة التحكم فوراً
      if (S.stats && S.stats.financials) {
        const ff = S.stats.financials;
        ff.totalPaid = (Number(ff.totalPaid) || 0) + amt;
        ff.remaining = Math.max(0, (Number(ff.remaining) || 0) - amt);
        const baseRent = Number(ff.annualRent || ff.totalRent || 0);
        if (baseRent > 0) ff.collectRate = Math.round(ff.totalPaid / baseRent * 100);
        renderDashboard();
      }
      toast('✅ تم تسجيل الدفعة'); silentRefresh(); loadContractPaymentHistory(row);
    })
    .withFailureHandler(e=>{_payRestore();toast('خطأ: '+e.message,'err');})
    .addPayment(row,amt);
}

// طابع زمني محلي بصيغة الخادم (yyyy/MM/dd HH:mm) للإدخال التفاؤلي المؤقت
function _nowStamp_() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function loadContractPaymentHistory(row) {
  const box = document.getElementById('payHistory');
  if (!box) return;
  row = parseInt(row, 10);
  const canEdit = hasPerm('payments.edit');

  // المسار السريع: العرض الفوري من S.payments المحمّلة مسبقاً (بلا طلب شبكة)
  if (Array.isArray(S.payments)) {
    const c = (S.contracts || []).find(x => x.row === row);
    const cid = c ? (c.id || '') : '';
    const rows = S.payments
      .filter(p => (cid && p.contractId === cid) || (!cid && parseInt(p.row, 10) === row))
      .sort((a, b) => (Number(b.logRow) || 0) - (Number(a.logRow) || 0));
    renderContractPaymentHistory_(box, rows, row, canEdit);
    return;
  }

  // مسار احتياطي: عميل بنسخة مخزّنة قديمة قبل تحميل الدفعات مع البيانات
  box.innerHTML = '<div style="padding:8px;color:#718096">جارٍ التحميل...</div>';
  const uiTimer = setTimeout(() => {
    if (box.innerHTML.includes('جارٍ التحميل')) {
      box.innerHTML = `<div class="result err">استغرق التحميل وقتاً طويلاً. <button class="btn btn-sm" onclick="loadContractPaymentHistory(${row})">إعادة المحاولة</button></div>`;
    }
  }, 15000);
  const onSuccess = rows => { clearTimeout(uiTimer); renderContractPaymentHistory_(box, rows || [], row, canEdit); };
  const onFail = e => { clearTimeout(uiTimer); box.innerHTML = '<div class="result err">خطأ في تحميل سجل الدفعات: ' + escHtml(e.message) + '</div>'; };
  if (canEdit) {
    google.script.run.withSuccessHandler(onSuccess).withFailureHandler(onFail).getContractPaymentHistoryAdmin(row);
  } else {
    google.script.run.withSuccessHandler(onSuccess).withFailureHandler(onFail).getContractPaymentHistory(row);
  }
}

function renderContractPaymentHistory_(box, rows, row, canEdit) {
  rows = rows || [];
  if (!rows.length) { box.innerHTML = '<div style="padding:8px;color:#718096">لا توجد دفعات مسجلة لهذا العقد</div>'; return; }
  const editTh = canEdit ? '<th></th>' : '';
  const rowsHtml = rows.map(p => {
    const remAfter = Number(p.remaining) || 0;
    const remBefore = remAfter + Number(p.amount || 0);
    // زر التعديل يظهر فقط للدفعات ذات رقم سجل حقيقي (logRow>0) — يستثني الإدخال التفاؤلي المؤقت
    const editTd = canEdit
      ? (Number(p.logRow) > 0
          ? `<td><button class="btn btn-sm" style="font-size:11px;padding:2px 7px" onclick="openPaymentEditForm(${p.logRow},${p.amount})">✏️</button></td>`
          : '<td></td>')
      : '';
    return `<tr>
      <td style="font-size:11px;white-space:nowrap">${escHtml(p.date)}</td>
      <td>${escHtml(p.username)}</td>
      <td style="font-weight:600;color:var(--green);direction:ltr;text-align:left">+${nf(p.amount)}</td>
      <td style="color:var(--amber)">${nf(remBefore)}</td>
      <td style="color:${remAfter>0?'var(--red)':'var(--green)'}">${nf(remAfter)}</td>
      <td style="font-size:12px">${escHtml(p.notes)||'—'}</td>${editTd}
    </tr>`;
  }).join('');
  const editForm = canEdit ? `
    <div id="editPaymentForm" style="display:none;margin-top:10px;padding:12px;background:#f7fafc;border-radius:8px;border:1px solid #e2e8f0">
      <div style="font-weight:600;color:#1A3A5C;margin-bottom:8px">✏️ تعديل الدفعة المحددة</div>
      <input type="hidden" id="editPayLogRow">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div><label style="font-size:12px;color:#718096;display:block;margin-bottom:4px">المبلغ الجديد (ر.س)</label>
          <input type="number" id="editPayAmount" class="form-control" min="0.01" step="0.01"></div>
        <div><label style="font-size:12px;color:#718096;display:block;margin-bottom:4px">سبب التصحيح (اختياري)</label>
          <input type="text" id="editPayNotes" class="form-control" placeholder="اكتب السبب..."></div>
      </div>
      <div style="display:flex;gap:8px">
        <button id="editPaySaveBtn" class="btn btn-primary btn-sm" onclick="savePaymentEdit(${parseInt(row)})">💾 حفظ التعديل</button>
        <button class="btn btn-sm" onclick="cancelPaymentEdit()">إلغاء</button>
      </div>
      <div id="editPayResult" style="margin-top:8px"></div>
    </div>` : '';
  box.innerHTML = `<div class="tbl-wrap"><table><thead><tr>
    <th>التاريخ</th><th>المستخدم</th><th>المبلغ</th><th>متبقي قبل</th><th>متبقي بعد</th><th>ملاحظات</th>${editTh}
  </tr></thead><tbody>${rowsHtml}</tbody></table></div>${editForm}`;
}

function openPaymentEditForm(logRow, amount) {
  const form = document.getElementById('editPaymentForm');
  if (!form) return;
  document.getElementById('editPayLogRow').value = logRow;
  document.getElementById('editPayAmount').value = amount;
  document.getElementById('editPayNotes').value = '';
  document.getElementById('editPayResult').innerHTML = '';
  form.style.display = 'block';
  document.getElementById('editPayAmount').focus();
  document.getElementById('editPayAmount').select();
}

function cancelPaymentEdit() {
  const form = document.getElementById('editPaymentForm');
  if (form) form.style.display = 'none';
}

function savePaymentEdit(contractRow) {
  const logRow = parseInt(document.getElementById('editPayLogRow').value);
  const newAmount = parseFloat(document.getElementById('editPayAmount').value);
  const notes = document.getElementById('editPayNotes').value.trim();
  const out = document.getElementById('editPayResult');
  if (!logRow) { out.innerHTML = '<div class="result err">خطأ: لم يتم تحديد الدفعة</div>'; return; }
  if (!newAmount || newAmount <= 0 || isNaN(newAmount)) { out.innerHTML = '<div class="result err">أدخل مبلغاً صحيحاً</div>'; return; }
  const btn = document.getElementById('editPaySaveBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>جارٍ الحفظ...'; }
  google.script.run
    .withSuccessHandler(r => {
      if (btn) { btn.disabled = false; btn.textContent = '💾 حفظ التعديل'; }
      if (r && r.error) { out.innerHTML = `<div class="result err">❌ ${r.error}</div>`; return; }
      out.innerHTML = `<div class="result">✅ ${r.message || 'تم التعديل'}</div>`;
      toast('✅ ' + (r.message || 'تم تعديل الدفعة'));
      // تحديث S.contracts محلياً بالقيم الجديدة
      if (contractRow && r.newPaid !== undefined) {
        const c = S.contracts.find(x => x.row === contractRow);
        // احسب الفرق قبل تعديل c.paid (وإلا أصبح صفراً) واستخدمه للمستأجر والمالية معاً
        const delta = c ? (Number(r.newPaid) - (Number(c.paid) || 0)) : 0;
        if (c) {
          c.paid = r.newPaid;
          c.remaining = r.remaining !== undefined ? r.remaining : Math.max(0, (c.rent || 0) - c.paid);
          const t = S.tenants.find(x => x.name === c.tenant);
          if (t) t.totalPaid = (Number(t.totalPaid) || 0) + delta;
          renderContracts();
          renderTenants();
        }
        if (S.stats && S.stats.financials) {
          const ff = S.stats.financials;
          ff.totalPaid = (Number(ff.totalPaid) || 0) + delta;
          ff.remaining = Math.max(0, (Number(ff.remaining) || 0) - delta);
          renderDashboard();
        }
      }
      // تحديث تفاؤلي للمبلغ في S.payments وإعادة الرسم فوراً؛ silentRefresh يصحّح بقية السلسلة
      if (Array.isArray(S.payments)) {
        const pe = S.payments.find(p => Number(p.logRow) === logRow);
        if (pe) pe.amount = newAmount;
      }
      loadContractPaymentHistory(contractRow);
      cancelPaymentEdit();
      silentRefresh();
    })
    .withFailureHandler(e => {
      if (btn) { btn.disabled = false; btn.textContent = '💾 حفظ التعديل'; }
      out.innerHTML = `<div class="result err">خطأ: ${escHtml(e.message)}</div>`;
    })
    .updatePayment(logRow, newAmount, notes);
}

// ── Buildings Modal ───────────────────────────
function openBuildingModal(mode, rowNum) {
  var neededPerm = mode === 'edit' ? 'buildings.edit' : 'buildings.add';
  if (!hasPerm(neededPerm)) { toast('ليس لديك الصلاحية المطلوبة', 'err'); return; }
  ['b-name','b-units','b-floors','b-notes'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('bEditRow').value=rowNum||'';
  document.getElementById('bModalTitle').textContent=mode==='add'?'+ إضافة مبنى جديد':'✏️ تعديل المبنى';
  document.getElementById('bSaveBtn').textContent=mode==='add'?'إضافة':'حفظ';
  document.getElementById('bModalResult').innerHTML='';
  if(mode==='edit'&&rowNum){
    const b=S.buildings.find(x=>x.row===rowNum);
    if(b){document.getElementById('b-name').value=b.name;document.getElementById('b-type').value=b.type||'سكني';document.getElementById('b-units').value=b.totalUnits;document.getElementById('b-floors').value=b.floors;document.getElementById('b-notes').value=b.notes||'';}
  }
  openModal('buildingModal');
}

function saveBuilding() {
  const rowNum=document.getElementById('bEditRow').value;
  if (!hasPerm(rowNum ? 'buildings.edit' : 'buildings.add')) { toast('ليس لديك الصلاحية المطلوبة', 'err'); return; }
  const data={name:document.getElementById('b-name').value.trim(),type:document.getElementById('b-type').value,totalUnits:document.getElementById('b-units').value,floors:document.getElementById('b-floors').value,notes:document.getElementById('b-notes').value.trim()};
  if(!data.name){toast('اسم المبنى مطلوب','err');return;}
  const units=parseInt(data.totalUnits), floors=parseInt(data.floors);
  if(isNaN(units)||units<1){toast('عدد الوحدات يجب أن يكون رقماً موجباً (1 على الأقل)','err');return;}
  if(isNaN(floors)||floors<1){toast('عدد الطوابق يجب أن يكون رقماً موجباً (1 على الأقل)','err');return;}
  const btn=document.getElementById('bSaveBtn');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span>...';
  const cb=r=>{
    btn.disabled=false; btn.textContent=rowNum?'حفظ':'إضافة';
    if(r && r.error){
      document.getElementById('bModalResult').innerHTML=`<div class="result err">❌ ${r.error}</div>`;
      toast('❌ ' + r.error, 'err');
      return;
    }
    document.getElementById('bModalResult').innerHTML=`<div class="result">✅ ${(r&&r.message)||'تم الحفظ'}</div>`;
    toast((r&&r.message)||'تم الحفظ');
    silentRefresh();
    setTimeout(()=>closeModal('buildingModal'),600);
  };
  if(rowNum) google.script.run.withSuccessHandler(cb).withFailureHandler(e=>{btn.disabled=false;toast('خطأ: '+e.message,'err');}).updateBuilding(parseInt(rowNum),data);
  else google.script.run.withSuccessHandler(cb).withFailureHandler(e=>{btn.disabled=false;toast('خطأ: '+e.message,'err');}).addBuilding(data);
}

function populateAdminArchiveBuildingSelect() {
  const sel = document.getElementById('adminArchiveBuildingSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">اختر مبنى...</option>';
  if (!hasPerm('users.manage') || !hasPerm('buildings.delete')) return;
  (S.buildings || []).forEach(b => {
    const o = document.createElement('option');
    o.value = b.row;
    o.textContent = b.name;
    sel.appendChild(o);
  });
}

function archiveSelectedBuildingAdmin() {
  if (!hasPerm('users.manage') || !hasPerm('buildings.delete')) { toast('الأرشفة متاحة للمدير فقط', 'err'); return; }
  const sel = document.getElementById('adminArchiveBuildingSelect');
  const row = parseInt(sel && sel.value, 10);
  const name = sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
  if (!row) { toast('اختر مبنى أولاً', 'err'); return; }
  if(!confirm(`أرشفة مبنى "${name}"؟\nلن يتم حذف العقود المرتبطة به، وسيختفي المبنى من قائمة المباني النشطة.`)) return;
  google.script.run.withSuccessHandler(r=>{
      if(r && r.error){ toast('❌ '+r.error,'err'); return; }
      toast((r&&r.message)||'✅ تمت أرشفة المبنى');
      silentRefresh();
    })
    .withFailureHandler(e=>toast('خطأ: '+e.message,'err')).archiveBuilding(row);
}


function archiveBuildingFromTable(row, name) {
  if (!hasPerm('users.manage') || !hasPerm('buildings.delete')) { toast('الأرشفة متاحة للمدير فقط', 'err'); return; }
  if(!confirm(`أرشفة مبنى "${name}"؟\nلن يتم حذف العقود المرتبطة به.`)) return;
  google.script.run.withSuccessHandler(r=>{
      if(r && r.error){ toast('❌ '+r.error,'err'); return; }
      toast((r&&r.message)||'✅ تمت أرشفة المبنى');
      silentRefresh();
    })
    .withFailureHandler(e=>toast('خطأ: '+e.message,'err')).archiveBuilding(row);
}

function loadArchivedBuildingsAdmin() {
  if (!hasPerm('users.manage') || !hasPerm('buildings.delete')) { toast('الأرشفة متاحة للمدير فقط', 'err'); return; }
  const box = document.getElementById('archivedBuildingsBody');
  box.style.display = 'block';
  box.innerHTML = '<div style="font-size:12px;color:#718096;padding:8px">جارٍ التحميل...</div>';
  google.script.run.withSuccessHandler(rows=>{
    rows = rows || [];
    if(!rows.length){ box.innerHTML = '<div style="font-size:12px;color:#718096;padding:8px">لا توجد مبانٍ مؤرشفة</div>'; return; }
    box.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>المبنى</th><th>النوع</th><th>الوحدات</th><th>وقت الأرشفة</th><th>بواسطة</th><th>إجراء</th></tr></thead><tbody>${rows.map(b=>`<tr><td><strong>${escHtml(b.name)}</strong></td><td>${escHtml(b.type)||'—'}</td><td>${b.totalUnits||0}</td><td>${escHtml(b.archivedAt)||'—'}</td><td>${escHtml(b.archivedBy)||'—'}</td><td><button class="btn btn-sm btn-success" onclick="restoreArchivedBuildingAdmin(${b.row})">استرجاع</button></td></tr>`).join('')}</tbody></table></div>`;
  }).withFailureHandler(e=>toast('خطأ: '+e.message,'err')).getArchivedBuildings();
}

function restoreArchivedBuildingAdmin(row) {
  if(!confirm('استرجاع المبنى المؤرشف وإعادته للقوائم النشطة؟')) return;
  google.script.run.withSuccessHandler(r=>{
    if(r && r.error){ toast('❌ '+r.error,'err'); return; }
    toast((r&&r.message)||'✅ تم الاسترجاع');
    loadArchivedBuildingsAdmin(); silentRefresh();
  }).withFailureHandler(e=>toast('خطأ: '+e.message,'err')).restoreBuilding(row);
}

function loadPaymentLogAdmin() {
  if (!hasPerm('finance.view')) { toast('ليس لديك صلاحية التقارير المالية', 'err'); return; }
  const box = document.getElementById('paymentLogAdminBody');
  box.style.display = 'block';
  box.innerHTML = '<div style="font-size:12px;color:#718096;padding:8px">جارٍ التحميل...</div>';
  google.script.run.withSuccessHandler(rows=>{
    rows = rows || [];
    if(!rows.length){ box.innerHTML = '<div style="font-size:12px;color:#718096;padding:8px">لا توجد دفعات مسجلة بعد</div>'; return; }
    box.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>الوقت</th><th>المستخدم</th><th>المستأجر</th><th>المبنى/الوحدة</th><th>المبلغ</th><th>قبل</th><th>بعد</th><th>ملاحظات</th></tr></thead><tbody>${rows.map(p=>`<tr><td style="font-size:11px;white-space:nowrap">${escHtml(p.date)}</td><td>${escHtml(p.username)}</td><td><strong>${escHtml(p.tenant)}</strong></td><td>${escHtml(p.building)} / ${escHtml(p.unit)}</td><td style="font-weight:600;direction:ltr;text-align:left">${nf(p.amount)}</td><td>${nf(p.before)}</td><td>${nf(p.after)}</td><td style="font-size:12px">${escHtml(p.notes)||'—'}</td></tr>`).join('')}</tbody></table></div>`;
  }).withFailureHandler(e=>toast('خطأ: '+e.message,'err')).getPaymentLog(200);
}

// ── SMS ───────────────────────────────────────
let tpls={
  renewal:'عزيزي المستأجر، نود إعلامكم باقتراب نهاية عقد الإيجار. نرجو التواصل لتجديده. إدارة الأملاك.',
  payment:'عزيزي المستأجر، نذكّركم بسداد الإيجار المستحق. شكراً لتعاونكم. إدارة الأملاك.',
  welcome:'أهلاً بكم في مجمعنا. يسعدنا انضمامكم. للاستفسار تواصلوا مع الإدارة.',
  expire:'عزيزي المستأجر، انتهى عقد إيجاركم. نرجو التواصل مع الإدارة لترتيب الإجراءات.',
  maintenance:'عزيزي المستأجر، ستُجرى أعمال صيانة قريباً. نأسف على أي إزعاج. الإدارة.',
};
function smsPartsInfo_(text) {
  const len = (text || '').length;
  if (!len) return '0 حرف';
  // الجزء الأول: 70 حرف. كل جزء إضافي: 67 حرف
  const parts = len <= 70 ? 1 : 1 + Math.ceil((len - 70) / 67);
  return len + ' حرف — يُحتسب غالباً ' + parts + ' جزء SMS عربي';
}
function updateSmsCounter_(id, targetId) {
  const el=document.getElementById(id), out=document.getElementById(targetId); if(el&&out) out.textContent=smsPartsInfo_(el.value);
}
function setTpl(k){
  document.getElementById('smsText').value=tpls[k]||'';
  document.getElementById('smsChars').textContent=smsPartsInfo_(tpls[k]||'');
}
function fillSmsTemplateEditor(){
  ['renewal','payment','welcome','expire','maintenance'].forEach(k=>{
    const el=document.getElementById('tpl-'+k);
    if(el) el.value=tpls[k]||'';
  });
}
function loadSmsTemplates(){
  if (!hasPerm('sms.send')) return;
  google.script.run
    .withSuccessHandler(r=>{ tpls=Object.assign({},tpls,r||{}); fillSmsTemplateEditor(); })
    .withFailureHandler(()=>fillSmsTemplateEditor())
    .getSmsTemplates();
}
function saveSmsTemplatesUI(){
  if (!hasPerm('sms.send')) { toast('ليس لديك صلاحية تعديل القوالب','err'); return; }
  const data={};
  ['renewal','payment','welcome','expire','maintenance'].forEach(k=>{
    const el=document.getElementById('tpl-'+k);
    data[k]=el?el.value.trim():'';
  });
  google.script.run
    .withSuccessHandler(r=>{
      if(r && r.error){ toast('❌ '+r.error,'err'); return; }
      tpls=Object.assign({},tpls,data);
      document.getElementById('smsTplResult').innerHTML='<div class="result">✅ تم حفظ القوالب</div>';
      toast('✅ تم حفظ قوالب الرسائل');
    })
    .withFailureHandler(e=>toast('خطأ: '+e.message,'err'))
    .saveSmsTemplates(data);
}

function loadAutoSmsSettingsUI(){
  if(!hasPerm('sms.send')) return;
  google.script.run
    .withSuccessHandler(s=>{
      s=s||{};
      const set=(id,val)=>{const el=document.getElementById(id); if(el) el.checked=!!val;};
      set('autoSmsEnabled',s.enabled); set('autoSmsRenewal',s.renewalEnabled); set('autoSmsPayment',s.paymentEnabled);
      const d=document.getElementById('autoSmsRenewalDays'); if(d) d.value=s.renewalDays||30;
      const h=document.getElementById('autoSmsHour'); if(h) h.value=s.hour||9;
    })
    .withFailureHandler(()=>{})
    .getAutoSmsSettings();
}
function saveAutoSmsSettingsUI(){
  if(!hasPerm('sms.send')){toast('ليس لديك صلاحية الرسائل','err');return;}
  const data={
    enabled: !!document.getElementById('autoSmsEnabled')?.checked,
    renewalEnabled: !!document.getElementById('autoSmsRenewal')?.checked,
    paymentEnabled: !!document.getElementById('autoSmsPayment')?.checked,
    renewalDays: parseInt(document.getElementById('autoSmsRenewalDays')?.value||'30',10),
    hour: parseInt(document.getElementById('autoSmsHour')?.value||'9',10)
  };
  google.script.run
    .withSuccessHandler(r=>{
      if(r&&r.error){toast('❌ '+r.error,'err');return;}
      document.getElementById('autoSmsResult').innerHTML='<div class="result">✅ '+escHtml(r.message||'تم الحفظ')+'</div>';
      toast('✅ تم حفظ إعدادات الرسائل التلقائية');
    })
    .withFailureHandler(e=>toast('خطأ: '+e.message,'err'))
    .saveAutoSmsSettings(data);
}

function craftSmsAI(){
  if (!hasPerm('sms.send')) { toast('ليس لديك صلاحية إرسال الرسائل', 'err'); return; }
  const target=document.getElementById('smsTarget').value;
  const labels={expiring_60:'تنتهي عقودهم خلال 60 يوم',expiring_30:'تنتهي عقودهم خلال 30 يوم',nopay:'لم يسددوا',building:'مستأجرو المبنى'};
  const btn=event.target; btn.disabled=true; btn.innerHTML='<span class="spin"></span>جارٍ الصياغة...';
  google.script.run
    .withSuccessHandler(r=>{ btn.disabled=false; btn.textContent='🤖 صياغة تلقائية'; if(r.error){toast('خطأ: '+r.error,'err');return;} document.getElementById('smsText').value=r.text; })
    .withFailureHandler(e=>{btn.disabled=false; btn.textContent='🤖 صياغة تلقائية'; toast('خطأ: '+e.message,'err');})
    .askAI(`اكتب رسالة SMS احترافية (أقل من 155 حرف) لـ: ${labels[target]||target}`,'');
}

function sendSmsAction(){
  if (!hasPerm('sms.send')) { toast('ليس لديك صلاحية إرسال الرسائل', 'err'); return; }
  const target=document.getElementById('smsTarget').value;
  const msg=document.getElementById('smsText').value.trim();
  if(!msg){toast('اكتب نص الرسالة','err');return;}
  const info=smsPartsInfo_(msg); if(info.indexOf('2 جزء')>0 || info.indexOf('3 جزء')>0 || info.indexOf('4 جزء')>0){ if(!confirm('تنبيه: '+info+' وقد تزيد تكلفة الإرسال. هل تريد المتابعة؟')) return; }
  const btn=document.querySelector('[onclick="sendSmsAction()"]');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span>جارٍ الإرسال...';
  const cb=r=>{btn.disabled=false;btn.textContent='📤 إرسال';if(r&&r.error){document.getElementById('smsResult').innerHTML=`<div class="result err">❌ ${r.error}</div>`;toast('❌ '+r.error,'err');return;}document.getElementById('smsResult').innerHTML=`<div class="result">✅ أُرسلت: ${r.sent||0} | ❌ فشل: ${r.failed||0}</div>`;toast(`✅ أُرسلت ${r.sent||0} رسالة`);};
  const fail=e=>{btn.disabled=false;btn.textContent='📤 إرسال';toast('خطأ: '+e.message,'err');};
  if(target==='expiring_60') google.script.run.withSuccessHandler(cb).withFailureHandler(fail).sendExpiryReminders(60,false);
  else if(target==='expiring_30') google.script.run.withSuccessHandler(cb).withFailureHandler(fail).sendExpiryReminders(30,false);
  else if(target==='nopay') google.script.run.withSuccessHandler(cb).withFailureHandler(fail).sendPaymentReminders(false);
  else if(target==='building'){
    const bldg=document.getElementById('smsBldg').value;
    if(!bldg){toast('اختر المبنى أولاً','err');btn.disabled=false;btn.textContent='📤 إرسال';return;}
    google.script.run.withSuccessHandler(cb).withFailureHandler(fail).sendToBuildingActiveCustom(bldg,msg);
  }
}

function quickSend(type){
  if (!hasPerm('sms.send')) { toast('ليس لديك صلاحية إرسال الرسائل', 'err'); return; }
  const btn=event.target; btn.disabled=true; btn.innerHTML='<span class="spin"></span>جارٍ الإرسال...';
  const cb=r=>{btn.disabled=false;btn.textContent=btn.textContent.replace('جارٍ الإرسال...','');if(r&&r.error){toast('❌ '+r.error,'err');return;}toast(`✅ أُرسلت ${r.sent||0} رسالة`);};
  const fail=e=>{btn.disabled=false;toast('خطأ: '+e.message,'err');};
  if(type==='exp30') google.script.run.withSuccessHandler(cb).withFailureHandler(fail).sendExpiryReminders(30,true);
  else if(type==='exp60') google.script.run.withSuccessHandler(cb).withFailureHandler(fail).sendExpiryReminders(60,true);
  else if(type==='nopay') google.script.run.withSuccessHandler(cb).withFailureHandler(fail).sendPaymentReminders(true);
}

function quickReminder(name,phone,rent){
  if (!hasPerm('sms.send')) { toast('ليس لديك صلاحية إرسال الرسائل', 'err'); return; }
  if(!phone||phone==='nan'){toast('لا يوجد رقم','err');return;}
  const msg=`عزيزي ${name}، نذكّركم بـ${rent?'سداد الإيجار '+nf(rent)+' ر.س':'متابعة عقد الإيجار'}. إدارة الأملاك.`;
  if(!confirm(`إرسال SMS لـ ${name}:\n${msg}`)) return;
  google.script.run.withSuccessHandler(r=>toast(r.success?`✅ أُرسلت لـ ${name}`:'❌ فشل الإرسال',r.success?'':'err'))
    .withFailureHandler(e=>toast('خطأ: '+e.message,'err')).sendSingleSms(phone,msg);
}

function sendSingle(){
  if (!hasPerm('sms.send')) { toast('ليس لديك صلاحية إرسال الرسائل', 'err'); return; }
  const p=document.getElementById('singlePhone').value.trim();
  const m=document.getElementById('singleMsg').value.trim();
  if(!p||!m){toast('أدخل الرقم والرسالة','err');return;}
  const _sBtn=document.getElementById('singleSendBtn');
  if(_sBtn){ if(_sBtn.disabled) return; _sBtn.disabled=true; _sBtn.dataset.lbl=_sBtn.textContent; _sBtn.innerHTML='<span class="spin"></span>جارٍ الإرسال...'; }
  const _sRestore=()=>{ if(_sBtn){ _sBtn.disabled=false; _sBtn.textContent=_sBtn.dataset.lbl||'إرسال'; } };
  google.script.run
    .withSuccessHandler(r=>{_sRestore();if(r.success)_tabLoadedAt.log=0;document.getElementById('singleResult').innerHTML=`<div class="result ${r.success?'':'err'}">${r.success?'✅ أُرسلت':'❌ فشل'}</div>`;})
    .withFailureHandler(e=>{_sRestore();toast('خطأ: '+e.message,'err');}).sendSingleSms(p,m);
}

// ── AI ────────────────────────────────────────
function askAI(q){
  if (!window.__aiPrivacyNoticeShown) { window.__aiPrivacyNoticeShown = true; toast('تنبيه: المساعد يرسل ملخصاً رقمياً فقط بدون أرقام هوية أو جوالات'); }
  const input=document.getElementById('aiInput');
  const question=q||input.value.trim();
  if(!question){toast('اكتب سؤالاً','err');return;}
  input.value='';
  const msgs=document.getElementById('aiMsgs');
  appendMsg('user', question);
  const thinking = document.createElement('div'); thinking.className='msg msg-think'; thinking.id='thinking'; thinking.textContent='⏳ جارٍ التحليل...'; msgs.appendChild(thinking);
  msgs.scrollTop=msgs.scrollHeight;
  google.script.run
    .withSuccessHandler(r=>{
      var _th=document.getElementById('thinking');if(_th)_th.remove();
      appendMsg('ai', (r.error?'❌ '+r.error:r.text));
      msgs.scrollTop=msgs.scrollHeight;
    })
    .withFailureHandler(e=>{var _th=document.getElementById('thinking');if(_th)_th.remove();appendMsg('ai', '❌ ' + e.message, true);})
    .askAI(question,'');
}

// ── Log ───────────────────────────────────────
function _renderLog_(rows) {
  const tbody = document.getElementById('logBody');
  if (!rows.length) { tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:20px;color:#718096">لا توجد رسائل</td></tr>'; return; }
  tbody.innerHTML = rows.map(r=>`<tr><td style="font-size:12px;white-space:nowrap">${escHtml(r.date)}</td><td><strong>${escHtml(r.name)||'—'}</strong></td><td style="direction:ltr;text-align:left;font-size:12px">${escHtml(r.phone)||'—'}</td><td>${escHtml(r.building)||'—'}</td><td style="font-size:12px;max-width:240px">${escHtml(r.message)}</td><td>${escHtml(r.status)}</td></tr>`).join('');
}
function loadLog(){
  if (_logData.length && _tabLoadedAt.log && Date.now() - _tabLoadedAt.log < 90000) { _renderLog_(_logData); return; }
  google.script.run
    .withSuccessHandler(rows=>{ _logData = rows || []; _tabLoadedAt.log = Date.now(); _renderLog_(_logData); })
    .withFailureHandler(e=>toast('خطأ: '+e.message,'err'))
    .getMessageLog();
}


// ── حساب تاريخ الاستحقاق التالي في النموذج ──
function updateNextDue() {
  const start = document.getElementById('c-start').value;
  const sched = document.getElementById('c-schedule').value;
  const end   = document.getElementById('c-end').value;
  const out   = document.getElementById('c-nextDue');
  if (!start || !sched) { out.textContent = '—'; out.style.background='var(--blue-l)'; return; }

  const months = {'شهري':1,'3 أشهر':3,'6 أشهر':6,'سنوي':12};
  const step = months[sched];
  if (!step) { out.textContent = '—'; return; }

  // إضافة T00:00:00 يمنع تفسير التاريخ كـ UTC مما يسبب انزياح يوم في بعض المناطق الزمنية
  const startD = new Date(start + 'T00:00:00');
  const endD   = end ? new Date(end + 'T00:00:00') : null;
  const today  = new Date(); today.setHours(0,0,0,0);

  // setMonth وحده قد يتجاوز الشهر (مثلاً: 31 يناير + شهر = 3 مارس بدل 28 فبراير)
  // addMonthsSafe_ تُثبّت اليوم في آخر يوم صالح في الشهر المستهدف
  function addMonthsSafe_(date, months) {
    const originalDay = date.getDate();
    const d = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(originalDay, lastDay));
    return d;
  }

  let next = addMonthsSafe_(startD, step);
  // إذا كان الاستحقاق الأول بعد نهاية العقد، استخدم نهاية العقد
  if (endD && next > endD) next = new Date(endD);

  // أوجد أول استحقاق لم يحن بعد
  while (next < today) {
    const candidate = addMonthsSafe_(next, step);
    if (endD && candidate > endD) { out.textContent = 'انتهت كل الاستحقاقات'; out.style.background='var(--peach)'; return; }
    next = candidate;
  }

  const daysUntil = Math.round((next - today) / 86400000);
  const dateStr = next.toISOString().slice(0,10).replace(/-/g,'/');
  let color = 'var(--blue-l)', txt = `${dateStr} (بعد ${daysUntil} يوم)`;
  if (daysUntil <= 3)       { color='var(--pink)'; txt=`⚠️ ${dateStr} (بعد ${daysUntil} أيام فقط!)`; }
  else if (daysUntil <= 7)  { color='var(--peach)'; txt=`${dateStr} (بعد ${daysUntil} أيام)`; }
  out.textContent = txt; out.style.background = color;
}

// ربط بتغيير تاريخ البداية أيضاً
document.addEventListener('DOMContentLoaded', () => {
  const startEl = document.getElementById('c-start');
  if (startEl) startEl.addEventListener('change', updateNextDue);
});

// ── تحميل تنبيهات الاستحقاقات ──
function loadAlerts() {
  const days = parseInt(document.getElementById('alertsRange').value) || 14;
  document.getElementById('alertsList').innerHTML = '<div style="text-align:center;padding:30px;color:#718096">جارٍ التحميل...</div>';
  google.script.run
    .withSuccessHandler(freshGuard_(renderAlerts))
    .withFailureHandler(e => {
      document.getElementById('alertsList').innerHTML = `<div style="text-align:center;padding:20px;color:var(--red)">خطأ: ${escHtml(e.message)}</div>`;
    })
    .getUpcomingDueDates(days);
}

// كاش بيانات التنبيهات + حالة الفلتر النشط
var _alertsData   = [];
var _alertsFilter = null; // null = الكل، أو 'overdue'/'critical'/'soon'/'upcoming'

window.clearAlertsFilter = function() { _alertsFilter = null; _updateAlertCardStyles_(); _renderAlertsTable_(); };
function filterAlerts(urgency) {
  _alertsFilter = (_alertsFilter === urgency) ? null : urgency; // نقرة ثانية تلغي الفلتر
  _updateAlertCardStyles_();
  _renderAlertsTable_();
}

function _updateAlertCardStyles_() {
  var cards = [
    { id: 'aOverdue',  filter: 'overdue'  },
    { id: 'aCritical', filter: 'critical' },
    { id: 'aSoon',     filter: 'soon'     },
    { id: 'aUpcoming', filter: 'upcoming' }
  ];
  cards.forEach(function(m) {
    var el = document.getElementById(m.id); if (!el) return;
    var card = el.closest('.metric'); if (!card) return;
    var isActive = _alertsFilter === m.filter;
    var hasFilter = !!_alertsFilter;
    card.style.opacity = (hasFilter && !isActive) ? '0.45' : '1';
    card.style.boxShadow = isActive ? '0 0 0 3px var(--blue)' : '';
    card.style.transform = isActive ? 'scale(1.03)' : '';
  });
}

function _renderAlertsTable_() {
  var list = document.getElementById('alertsList');
  var view = _alertsFilter ? _alertsData.filter(function(d){ return d.urgency === _alertsFilter; }) : _alertsData;
  var labelMap = { overdue:'متأخرة', critical:'عاجل', soon:'قريبة', upcoming:'قادمة' };
  var filterBar = _alertsFilter
    ? '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;padding:6px 10px;background:var(--bg2);border-radius:8px;font-size:13px">' +
      '<span>الفلتر: <strong>' + (labelMap[_alertsFilter]||_alertsFilter) + '</strong> (' + view.length + ' استحقاق)</span>' +
      '<button onclick="window.clearAlertsFilter()" style="margin-right:auto;padding:2px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer">إلغاء الفلتر ✕</button>' +
      '</div>'
    : '';
  if (!view.length) {
    list.innerHTML = filterBar + '<div style="text-align:center;padding:30px;color:var(--green)">✅ لا توجد استحقاقات في هذه الفئة</div>';
    return;
  }
  var badgeMap = {
    'overdue':  ['<span class="badge b-red">متأخرة</span>',  'var(--red)'],
    'critical': ['<span class="badge b-red">عاجل</span>',     'var(--red)'],
    'soon':     ['<span class="badge b-amber">قريبة</span>',  'var(--amber)'],
    'upcoming': ['<span class="badge b-blue">قادمة</span>',   'var(--blue)']
  };
  list.innerHTML = filterBar + '<div class="tbl-wrap"><table>' +
    '<thead><tr>' +
    '<th>الاستعجال</th><th>المستأجر</th><th>المبنى</th><th>وحدة</th>' +
    '<th>الجدولة</th><th>تاريخ الاستحقاق</th><th>الأيام</th><th>الإيجار</th><th>إجراء</th>' +
    '</tr></thead><tbody>' +
    view.map(function(d) {
      var bp = badgeMap[d.urgency] || ['', ''];
      var badge = bp[0], color = bp[1];
      var daysLbl = d.daysUntil < 0 ? ('متأخر ' + Math.abs(d.daysUntil) + ' يوم') :
                   d.daysUntil === 0 ? 'اليوم!' : (d.daysUntil + ' يوم');
      return '<tr>' +
        '<td>' + badge + '</td>' +
        '<td><strong>' + escHtml(d.tenant) + '</strong></td>' +
        '<td>' + escHtml(d.building) + '</td><td>' + escHtml(d.unit) + '</td>' +
        '<td><span style="font-size:12px;color:#718096">' + (escHtml(d.schedule)||'—') + '</span></td>' +
        '<td style="font-size:13px;font-weight:500">' + d.dueDate + '</td>' +
        '<td style="color:' + color + ';font-weight:600">' + daysLbl + '</td>' +
        '<td>' + nf(d.rent) + ' ر.س</td>' +
        '<td>' + smsButtonHtml('SMS', d.tenant, d.phone, d.rent||0, 'استحقاق دفعة قادمة') + '</td>' +
        '</tr>';
    }).join('') + '</tbody></table></div>';
}

function renderAlerts(data) {
  _alertsData   = data || [];
  _alertsFilter = null; // إعادة تعيين الفلتر عند تحميل بيانات جديدة
  var metrics = document.getElementById('alertsMetrics');
  var list    = document.getElementById('alertsList');
  if (!_alertsData.length) {
    metrics.style.display = 'none';
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--green)">✅ لا توجد استحقاقات قريبة</div>';
    return;
  }
  var overdue  = _alertsData.filter(function(d){ return d.urgency === 'overdue';   }).length;
  var critical = _alertsData.filter(function(d){ return d.urgency === 'critical';  }).length;
  var soon     = _alertsData.filter(function(d){ return d.urgency === 'soon';      }).length;
  var upcoming = _alertsData.filter(function(d){ return d.urgency === 'upcoming';  }).length;
  metrics.style.display = 'grid';
  document.getElementById('aOverdue').textContent  = overdue;
  document.getElementById('aCritical').textContent = critical;
  document.getElementById('aSoon').textContent     = soon;
  document.getElementById('aUpcoming').textContent = upcoming;

  // تفعيل البطاقات كأزرار فلترة (cursor + onclick)
  var cardCfg = [
    { id:'aOverdue',  filter:'overdue'  },
    { id:'aCritical', filter:'critical' },
    { id:'aSoon',     filter:'soon'     },
    { id:'aUpcoming', filter:'upcoming' }
  ];
  cardCfg.forEach(function(m) {
    var el = document.getElementById(m.id); if (!el) return;
    var card = el.closest('.metric'); if (!card) return;
    card.style.cursor = 'pointer';
    card.style.transition = 'opacity 0.15s, box-shadow 0.15s, transform 0.12s';
    card.title = 'انقر للفلترة — انقر مرة ثانية لإلغاء الفلتر';
    card.onclick = (function(f){ return function(){ filterAlerts(f); }; })(m.filter);
  });

  _updateAlertCardStyles_();
  _renderAlertsTable_();
}


// ── Custom SMS Modal ──────────────────────────
let _smsContext = null;
function openCustomSms(name, phone, rent, situation) {
  if (!hasPerm('sms.send')) { toast('ليس لديك صلاحية إرسال الرسائل', 'err'); return; }
  if (!phone || phone === 'nan' || !phone.trim()) { toast('لا يوجد رقم لهذا المستأجر','err'); return; }
  _smsContext = { name, phone, rent: rent||0, situation: situation||'' };
  document.getElementById('smsName').value = name;
  document.getElementById('smsPhone').value = phone;
  document.getElementById('smsRecipient').innerHTML = `<strong>${name}</strong><br>📞 ${phone}${rent?' · إيجار: '+nf(rent)+' ر.س':''}`;
  document.getElementById('smsCustomText').value = '';
  document.getElementById('smsCustomCount').textContent = '0 حرف';
  document.getElementById('smsCustomResult').innerHTML = '';
  openModal('smsModal');
}

document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('smsCustomText');
  if (ta) ta.addEventListener('input', function() {
    document.getElementById('smsCustomCount').textContent = smsPartsInfo_(this.value);
  });
});

function setSmsTpl(type) {
  if (!_smsContext) return;
  const c = _smsContext;
  const ta = document.getElementById('smsCustomText');
  if (type === 'payment') {
    ta.value = `عزيزي ${c.name}، نذكّركم بسداد الإيجار${c.rent?' بمبلغ '+nf(c.rent)+' ر.س':''}. شكراً. إدارة الأملاك.`;
  } else if (type === 'renewal') {
    ta.value = `عزيزي ${c.name}، نود التواصل بشأن تجديد عقد الإيجار. نرجو التواصل معنا. إدارة الأملاك.`;
  } else if (type === 'thanks') {
    ta.value = `عزيزي ${c.name}، شكراً لكم على تعاونكم وانتظامكم في السداد. نقدر ثقتكم بنا.`;
  } else if (type === 'ai') {
    ta.value = '⏳ جارٍ الصياغة...';
    google.script.run
      .withSuccessHandler(r => {
        if (r.error) { ta.value = ''; toast('خطأ: '+r.error, 'err'); return; }
        ta.value = r.text;
        document.getElementById('smsCustomCount').textContent = smsPartsInfo_(r.text);
      })
      .withFailureHandler(e => { ta.value = ''; toast('خطأ: '+e.message, 'err'); })
      .askAI(`اكتب رسالة SMS مخصصة قصيرة (أقل من 155 حرف) للمستأجر ${c.name}. ${c.situation||'موضوع عام عن الإيجار'}. اكتب الرسالة فقط.`, '');
  }
  document.getElementById('smsCustomCount').textContent = smsPartsInfo_(ta.value);
}

function sendCustomSms() {
  if (!hasPerm('sms.send')) { toast('ليس لديك صلاحية إرسال الرسائل', 'err'); return; }
  const phone = document.getElementById('smsPhone').value;
  const msg = document.getElementById('smsCustomText').value.trim();
  if (!msg) { toast('اكتب نص الرسالة', 'err'); return; }
  if (msg.length > 480) { if (!confirm('الرسالة طويلة وقد تُحتسب كأكثر من رسالة. هل تريد المتابعة؟')) return; }
  const btn = document.getElementById('smsSendBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>جارٍ الإرسال...';
  google.script.run
    .withSuccessHandler(r => {
      btn.disabled = false; btn.textContent = 'إرسال';
      const ok = r && r.success;
      document.getElementById('smsCustomResult').innerHTML = `<div class="result ${ok?'':'err'}">${ok?'✅ أُرسلت بنجاح':'❌ فشل الإرسال'}</div>`;
      if (ok) { toast('✅ أُرسلت'); setTimeout(()=>closeModal('smsModal'), 1500); }
    })
    .withFailureHandler(e => { btn.disabled = false; btn.textContent = 'إرسال'; toast('خطأ: '+e.message, 'err'); })
    .sendSingleSms(phone, msg);
}

// ── Finance Section ─────────────────────────
function loadFinance() {
  if (_financeData && _tabLoadedAt.finance && Date.now() - _tabLoadedAt.finance < 45000) { renderFinance(_financeData); return; }
  google.script.run
    .withSuccessHandler(freshGuard_(function(d){ _financeData = d; _tabLoadedAt.finance = Date.now(); renderFinance(d); }))
    .withFailureHandler(e => toast('خطأ: '+e.message, 'err'))
    .getFinancialStats();
}

function renderFinance(data) {
  if (!data) return;
  let warn = document.getElementById('finDataWarning');
  const finPage = document.getElementById('page-finance');
  if (!warn && finPage) {
    warn = document.createElement('div');
    warn.id = 'finDataWarning';
    warn.className = 'result err';
    warn.style.marginBottom = '12px';
    finPage.insertBefore(warn, finPage.firstChild);
  }
  if (warn) {
    const msg = data.meta && data.meta.warning ? data.meta.warning : '';
    warn.style.display = msg ? 'block' : 'none';
    warn.textContent = msg;
  }
  const s = data.summary;
  document.getElementById('fin-monthly').textContent = nf(s.monthlyRent);
  document.getElementById('fin-annual').textContent  = nf(s.annualRent);
  document.getElementById('fin-paid').textContent    = nf(s.totalPaid);
  document.getElementById('fin-rem').textContent     = nf(s.remaining);
  document.getElementById('fin-rate').textContent    = s.collectRate + '%';
  document.getElementById('fin-avg').textContent     = nf(s.avgContractValue);

  // بطاقة العام الحالي
  if (data.currentYear) {
    const cy = data.currentYear;
    document.getElementById('cy-year').textContent     = cy.year;
    document.getElementById('cy-collected').textContent= nf(cy.collected) + ' ر.س';
    document.getElementById('cy-expected').textContent = nf(cy.expected) + ' ر.س';
    document.getElementById('cy-remaining').textContent= nf(cy.remaining) + ' ر.س';
    document.getElementById('cy-progress').textContent = cy.progress + '%';
    document.getElementById('cy-progress-bar').style.width = Math.min(100, Math.max(0, Number(cy.progress) || 0)) + '%';
  }

  // الشهري
  document.getElementById('fin-monthly-body').innerHTML = data.monthly.map(m => {
    const pct = m.expected > 0 ? Math.round(m.collected / m.expected * 100) : 0;
    const color = !m.isPast ? '#A0AEC0' : pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
    const opacity = m.isPast ? '1' : '0.6';
    return `<tr style="opacity:${opacity}">
      <td><strong>${m.name}</strong>${!m.isPast ? ' <span style="font-size:10px;color:#A0AEC0">(قادم)</span>' : ''}</td>
      <td>${nf(m.expected)}</td>
      <td style="color:${color};font-weight:500">${m.isPast ? nf(m.collected) : '—'}</td>
      <td style="text-align:center;color:${color}">${m.isPast ? pct + '%' : '—'}</td>
    </tr>`;
  }).join('');

  // السنوي
  document.getElementById('fin-yearly-body').innerHTML = data.yearly.filter(y => y.contracts > 0 || y.year >= new Date().getFullYear()).map(y => {
    const color = y.collectRate >= 80 ? 'var(--green)' : y.collectRate >= 50 ? 'var(--amber)' : 'var(--red)';
    return `<tr>
      <td><strong>${y.year}</strong></td>
      <td style="text-align:center">${y.contracts}</td>
      <td>${nf(y.rent)}</td>
      <td style="color:${color}">${nf(y.paid)}</td>
      <td style="color:${color}">${y.collectRate}%</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:#718096">لا توجد بيانات</td></tr>';

  // المباني

  const agingBody = document.getElementById('fin-aging-body');
  if (agingBody) {
    const aging = data.aging || [];
    agingBody.innerHTML = aging.length ? aging.map(b => `<tr>
      <td><strong>${escHtml(b.label)}</strong></td><td>${b.count}</td><td>${nf(b.amount)} ر.س</td>
      <td style="font-size:11px;color:#718096">${(b.items||[]).slice(0,3).map(i=>`${escHtml(i.tenant)} (${i.age} يوم)`).join('، ') || '—'}</td>
    </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:#718096">لا توجد متأخرات مصنفة</td></tr>';
  }

  document.getElementById('fin-bldg-body').innerHTML = data.byBuilding.map(b => {
    const color = b.collectRate >= 80 ? 'var(--green)' : b.collectRate >= 50 ? 'var(--amber)' : 'var(--red)';
    return `<tr>
      <td><strong>${escHtml(b.name)}</strong></td>
      <td style="text-align:center">${b.contracts}</td>
      <td>${nf(b.rent)}</td>
      <td style="color:var(--green)">${nf(b.paid)}</td>
      <td style="color:var(--red)">${nf(b.remaining)}</td>
      <td style="color:${color};font-weight:500">${b.collectRate}%</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:#718096">لا توجد بيانات</td></tr>';

  // أعلى المستأجرين — يُستخدم S.tenants لأن totalPaid يمثل الإجمالي الكلي
  // بينما data.topTenants.paid يحسب السنة الحالية فقط من سجل الدفعات
  const _topBody = document.getElementById('fin-top-body');
  let _topRows;
  if (S.tenants && S.tenants.length) {
    const _rentByTenant = {};
    (S.contracts || []).forEach(c => {
      if (!c.tenant) return;
      _rentByTenant[c.tenant] = (_rentByTenant[c.tenant] || 0) + (Number(c.rent) || 0);
    });
    _topRows = S.tenants
      .filter(t => (t.totalPaid || 0) > 0)
      .sort((a, b) => (b.totalPaid || 0) - (a.totalPaid || 0))
      .slice(0, 10)
      .map((t, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1);
        const tRent = _rentByTenant[t.name] || 0;
        return `<tr>
          <td style="text-align:center">${medal}</td>
          <td><strong>${escHtml(t.name)}</strong></td>
          <td style="text-align:center">${t.contractsCount || '—'}</td>
          <td>${tRent > 0 ? nf(tRent) + ' ر.س' : '—'}</td>
          <td style="color:var(--green);font-weight:500">${nf(t.totalPaid)} ر.س</td>
        </tr>`;
      });
  } else {
    _topRows = data.topTenants.map((t, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1);
      return `<tr>
        <td style="text-align:center">${medal}</td>
        <td><strong>${escHtml(t.name)}</strong></td>
        <td style="text-align:center">${t.contracts}</td>
        <td>${nf(t.rent)} ر.س</td>
        <td style="color:var(--green);font-weight:500">${nf(t.paid)} ر.س</td>
      </tr>`;
    });
  }
  _topBody.innerHTML = _topRows.join('') || '<tr><td colspan="5" style="text-align:center;color:#718096">لا توجد بيانات</td></tr>';
}


// ═══════════════════════════════════════════════
// تسجيل الدخول والصلاحيات
// ═══════════════════════════════════════════════
let _currentUser = null;
let _loginInProgress = false;

function checkSession() {
  // بدون توكن نعرف مباشرة أن المستخدم غير مسجَّل — لا حاجة لسؤال الخادم
  if (!localStorage.getItem('AMLAAK_TOKEN')) {
    showLoginScreen();
    return;
  }
  // نحفظ التوكن الحالي لمقارنته لاحقاً — إذا تغيّر يعني المستخدم سجّل دخولاً جديداً
  var tokenAtCheck = localStorage.getItem('AMLAAK_TOKEN');
  google.script.run
    .withSuccessHandler(r => {
      // إذا تغيّر التوكن يعني تسجيل دخول جديد تمّ في الأثناء — تجاهل تام
      const curToken = localStorage.getItem('AMLAAK_TOKEN');
      if (_loginInProgress || (curToken && curToken !== tokenAtCheck)) return;
      if (r && r.loggedIn) {
        _currentUser = r;
        showMainUI();
        if (r.warning) toast(r.warning, 'err');
      } else {
        if (curToken === tokenAtCheck) localStorage.removeItem('AMLAAK_TOKEN');
        showLoginScreen();
      }
    })
    .withFailureHandler(() => {
      const curToken = localStorage.getItem('AMLAAK_TOKEN');
      if (_loginInProgress || (curToken && curToken !== tokenAtCheck)) return;
      if (!curToken || curToken === tokenAtCheck) {
        if (curToken) localStorage.removeItem('AMLAAK_TOKEN');
        showLoginScreen();
      }
    })
    .whoami();
}

function showLoginScreen() {
  const overlay = document.getElementById('loginOverlay');
  if (!overlay) return; // قد تُستدعى قبل اكتمال تحليل HTML — تجاهل آمن
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  setTimeout(() => { const f = document.getElementById('loginUsername'); if (f) f.focus(); }, 100);
}

function showMainUI() {
  document.getElementById('loginOverlay').style.display = 'none';

  // ── المدير العام يملك كل الصلاحيات دائماً بصرف النظر عن الجلسة المخزنة ──
  if (_currentUser && _currentUser.role === 'admin') {
    var _perms = _currentUser.perms || [];
    if (_perms.indexOf('admin') < 0) _perms = _perms.concat(['admin']);
    _currentUser.perms = _perms;
  }

  // ── شريط المستخدم ──────────────────────────────
  const bar = document.getElementById('userBar');
  if (bar) {
    bar.style.display = 'flex';
    document.getElementById('userName').textContent = _currentUser.name || _currentUser.username;
    document.getElementById('userRoleLabel').textContent = _currentUser.roleLabel || _currentUser.role;
  }

  // ── تطبيق الصلاحيات على التبويبات ──────────────
  document.querySelectorAll('.tab[onclick]').forEach(function(tab) {
    var oc = tab.getAttribute('onclick') || '';
    var m  = oc.match(/nav[(][']([^']+)[']/);
    if (!m) return;
    var page = m[1];
    var perm = PAGE_PERMS[page];
    tab.style.display = hasPerm(perm) ? '' : 'none';
    if (!hasPerm(perm)) tab.classList.remove('active');
  });

  // ── أظهر/أخفِ الأزرار والعناصر حسب الصلاحيات ──────────
  // مهم: نعيد إظهار العناصر المسموحة أيضاً، لأن مستخدماً سابقاً قد يكون أخفاها عند تسجيل الخروج.
  document.querySelectorAll('[data-perm]').forEach(function(el) {
    var p = el.getAttribute('data-perm');
    el.style.display = hasPerm(p) ? '' : 'none';
  });
  var trashBtn = document.getElementById('deletedContractsBtn');
  if (trashBtn) trashBtn.style.display = (hasPerm('users.manage') && hasPerm('contracts.delete')) ? '' : 'none';

  // إذا كانت الصفحة الحالية غير مسموحة لهذا المستخدم، أعده للوحة التحكم.
  var activePage = document.querySelector('.page.active');
  if (activePage) {
    var pageName = activePage.id.replace('page-', '');
    if (!hasPerm(PAGE_PERMS[pageName])) {
      var dashTab = Array.prototype.find.call(document.querySelectorAll('.tab'), function(t) {
        return (t.getAttribute('onclick') || '').indexOf("nav('dashboard'") >= 0;
      });
      nav('dashboard', dashTab || document.querySelector('.tab'));
    }
  }

  // حمّل البيانات بعد تطبيق الصلاحيات
  loadData();
}

function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.style.display = 'none';
  if (!username || !password) {
    errEl.textContent = 'الرجاء إدخال اسم المستخدم وكلمة المرور';
    errEl.style.display = 'block';
    return;
  }
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> جارٍ التحقق...';
  _loginInProgress = true;
  google.script.run
    .withSuccessHandler(r => {
      _loginInProgress = false;
      btn.disabled = false; btn.textContent = 'تسجيل الدخول';
      if (r && r.success) {
        // تحقق مزدوج: يجب أن يكون المستخدم موجوداً والتوكن محفوظاً
        if (!r.user || !localStorage.getItem('AMLAAK_TOKEN')) {
          errEl.textContent = 'خطأ داخلي في الخادم، حاول مجدداً';
          errEl.style.display = 'block';
          return;
        }
        _currentUser = r.user;
        document.getElementById('loginPassword').value = '';
        showMainUI();
        if (r.warning) toast(r.warning, 'warn');
      } else {
        errEl.textContent = (r && r.error) || 'فشل تسجيل الدخول';
        errEl.style.display = 'block';
      }
    })
    .withFailureHandler(e => {
      _loginInProgress = false;
      btn.disabled = false; btn.textContent = 'تسجيل الدخول';
      errEl.textContent = 'خطأ: ' + e.message;
      errEl.style.display = 'block';
    })
    .login(username, password);
}


function resetClientStateAfterLogout() {
  _currentUser = null;
  _loginInProgress = false;
  S = { contracts:[], buildings:[], tenants:[], maintenanceList:[], stats:null, loaded:false, dueAlerts:[] };
  _allUsers = [];
  _activityData = [];
  _smsContext = null;
  window._currentMapData = null;
  try { localStorage.removeItem('amlak_cache_v2'); } catch(e) {}

  // إغلاق أي نوافذ منبثقة وإرجاع الصفحة لحالة نظيفة بدون تحديث يدوي.
  document.querySelectorAll('.modal-overlay').forEach(function(el){ el.style.display = 'none'; });
  document.body.style.overflow = '';

  // إخفاء شريط المستخدم وإلغاء تفعيل التبويبات الحالية.
  var bar = document.getElementById('userBar');
  if (bar) bar.style.display = 'none';
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); t.style.display = ''; });
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });

  // إعادة لوحة التحكم كصفحة افتراضية حتى لا يبقى المستخدم على صفحة غير مصرح بها.
  var dash = document.getElementById('page-dashboard');
  if (dash) dash.classList.add('active');
  var dashTab = Array.prototype.find.call(document.querySelectorAll('.tab'), function(t) {
    return (t.getAttribute('onclick') || '').indexOf("nav('dashboard'") >= 0;
  });
  if (dashTab) dashTab.classList.add('active');

  // تنظيف حقول الدخول والرسائل حتى لا تظهر شاشة بيضاء أو بقايا جلسة سابقة.
  var user = document.getElementById('loginUsername');
  var pass = document.getElementById('loginPassword');
  var err  = document.getElementById('loginError');
  if (user) user.value = '';
  if (pass) pass.value = '';
  if (err) { err.textContent = ''; err.style.display = 'none'; }

  showLoginScreen();
}

function doLogout() {
  if (!confirm('هل تريد تسجيل الخروج؟')) return;
  // أخفِ الواجهة فوراً ثم أرسل طلب الخروج في الخلفية
  resetClientStateAfterLogout();
  google.script.run
    .withSuccessHandler(()=>{})
    .withFailureHandler(()=>{ try { localStorage.removeItem('AMLAAK_TOKEN'); } catch(e) {} })
    .logout();
}

// ═══════════════════════════════════════════════
// تغيير كلمة المرور
// ═══════════════════════════════════════════════
function changePassword() {
  const oldP = document.getElementById('pwd-old').value;
  const newP = document.getElementById('pwd-new').value;
  const conf = document.getElementById('pwd-confirm').value;
  const out  = document.getElementById('pwdResult');
  out.innerHTML = '';
  if (!oldP || !newP) { out.innerHTML = '<div class="result err">جميع الحقول مطلوبة</div>'; return; }
  if (newP !== conf)  { out.innerHTML = '<div class="result err">كلمتا المرور الجديدتان غير متطابقتين</div>'; return; }
  if (newP.length < 6) { out.innerHTML = '<div class="result err">كلمة المرور يجب أن تكون 6 أحرف على الأقل</div>'; return; }
  google.script.run
    .withSuccessHandler(r => {
      if (r.error) { out.innerHTML = '<div class="result err">' + r.error + '</div>'; return; }
      out.innerHTML = '<div class="result">✅ تم تغيير كلمة المرور</div>';
      setTimeout(() => {
        closeModal('pwdModal');
        document.getElementById('pwd-old').value = '';
        document.getElementById('pwd-new').value = '';
        document.getElementById('pwd-confirm').value = '';
      }, 1500);
    })
    .withFailureHandler(e => out.innerHTML = '<div class="result err">' + e.message + '</div>')
    .changeMyPassword(oldP, newP);
}

// ═══════════════════════════════════════════════
// إدارة المستخدمين
// ═══════════════════════════════════════════════
let _allUsers = [];

function loadUsers() {
  if (_allUsers.length && _tabLoadedAt.users && Date.now() - _tabLoadedAt.users < 120000) { renderUsers(); return; }
  google.script.run
    .withSuccessHandler(freshGuard_(function(d){ _allUsers = d || []; _tabLoadedAt.users = Date.now(); renderUsers(); }))
    .withFailureHandler(e => toast('خطأ: ' + e.message, 'err'))
    .getUsers();
}

function renderUsers() {
  const body = document.getElementById('usersBody');
  if (!_allUsers.length) {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#718096">لا يوجد مستخدمون</td></tr>';
    return;
  }
  const roleLabels = {
    admin: '<span class="badge b-red">مدير عام</span>',
    manager: '<span class="badge b-amber">مدير فرعي</span>',
    employee: '<span class="badge b-blue">موظف</span>',
    viewer: '<span class="badge b-gray">مشاهد</span>'
  };
  body.innerHTML = _allUsers.map(u => `<tr>
    <td><strong>${escHtml(u.username)}</strong></td>
    <td>${escHtml(u.name) || '—'}</td>
    <td>${roleLabels[u.role] || escHtml(u.role)}</td>
    <td style="font-size:12px">${escHtml(u.email) || '—'}</td>
    <td>${u.active ? '<span class="badge b-green">نشط</span>' : '<span class="badge b-gray">معطّل</span>'}</td>
    <td style="font-size:11px;color:#718096">${escHtml(u.lastLogin) || '—'}</td>
    <td><div style="display:flex;gap:4px">
      <button class="btn btn-sm btn-primary" onclick="openUserModal('edit',${u.row})">تعديل</button>
      ${u.username !== 'admin' ? `<button class="btn btn-sm btn-danger" onclick="confirmDeleteUser(${u.row},'${esc(u.username)}')">حذف</button>` : ''}
    </div></td>
  </tr>`).join('');
}

function openUserModal(mode, rowNum) {
  document.getElementById('userResult').innerHTML = '';
  document.getElementById('u-row').value = rowNum || '';
  if (mode === 'add') {
    document.getElementById('userModalTitle').textContent = '👤 إضافة مستخدم';
    document.getElementById('u-pwd-hint').textContent = '(مطلوبة)';
    ['u-username','u-name','u-password','u-email'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('u-role').value = 'employee';
    document.getElementById('u-active').checked = true;
    document.getElementById('u-username').disabled = false;
    renderPermsGrid(ROLE_DEFAULT_PERMS.employee || []);
  } else {
    document.getElementById('userModalTitle').textContent = '✏️ تعديل مستخدم';
    document.getElementById('u-pwd-hint').textContent = '(اتركها فارغة للإبقاء على القديمة)';
    const u = _allUsers.find(x => x.row === rowNum);
    if (!u) return;
    document.getElementById('u-username').value = u.username;
    document.getElementById('u-username').disabled = true;
    document.getElementById('u-name').value = u.name || '';
    document.getElementById('u-password').value = '';
    document.getElementById('u-role').value = u.role;
    document.getElementById('u-email').value = u.email || '';
    // حمّل الصلاحيات المخصصة إذا وجدت، وإلا حمّل الافتراضية
    var permsToLoad = (u.customPerms && u.customPerms.length) ? u.customPerms : (ROLE_DEFAULT_PERMS[u.role] || []);
    renderPermsGrid(permsToLoad);
    document.getElementById('u-active').checked = u.active;
  }
  openModal('userModal');
}


function saveUser() {
  const row = parseInt(document.getElementById('u-row').value) || 0;
  const data = {
    username:    document.getElementById('u-username').value.trim(),
    name:        document.getElementById('u-name').value.trim(),
    password:    document.getElementById('u-password').value,
    role:        document.getElementById('u-role').value,
    email:       document.getElementById('u-email').value.trim(),
    active:      document.getElementById('u-active').checked,
    customPerms: getSelectedPerms()  // الصلاحيات المخصصة
  };
  const out = document.getElementById('userResult');
  out.innerHTML = '';
  if (!data.username) { out.innerHTML = '<div class="result err">اسم المستخدم مطلوب</div>'; return; }
  if (!row && !data.password) { out.innerHTML = '<div class="result err">كلمة المرور مطلوبة للمستخدم الجديد</div>'; return; }

  const handler = r => {
    // إذا انتهت الجلسة أثناء الحفظ، أعِد التحقق منها بدل التوقف
    if (r && r.error && String(r.error).indexOf('الجلسة') >= 0) {
      out.innerHTML = '<div class="result err">⚠️ انتهت الجلسة — جارٍ التحقق مجدداً...</div>';
      setTimeout(() => { closeModal('userModal'); checkSession(); }, 1500);
      return;
    }
    if (r && r.error) { out.innerHTML = '<div class="result err">' + r.error + '</div>'; return; }
    out.innerHTML = '<div class="result">✅ ' + (r && r.message || 'تم الحفظ') + '</div>';
    // إذا عدّل المستخدم حسابه هو، أعد تحميل الجلسة لتطبيق الصلاحيات الجديدة فوراً
    const isSelfEdit = row > 0 && _currentUser && _currentUser.username === data.username;
    setTimeout(() => { closeModal('userModal'); if (isSelfEdit) { checkSession(); } else { _tabLoadedAt.users = 0; loadUsers(); } }, 1200);
  };
  if (row > 0) {
    google.script.run.withSuccessHandler(handler).withFailureHandler(e => { out.innerHTML = '<div class="result err">' + e.message + '</div>'; }).updateUser(row, data);
  } else {
    google.script.run.withSuccessHandler(handler).withFailureHandler(e => { out.innerHTML = '<div class="result err">' + e.message + '</div>'; }).addUser(data);
  }
}

function confirmDeleteUser(rowNum, username) {
  if (!confirm('حذف المستخدم "' + username + '"؟ لا يمكن التراجع.')) return;
  google.script.run
    .withSuccessHandler(r => {
      if (r.error) { toast('خطأ: ' + r.error, 'err'); return; }
      toast('✅ تم الحذف'); _tabLoadedAt.users = 0; loadUsers();
    })
    .withFailureHandler(e => toast('خطأ: ' + e.message, 'err'))
    .deleteUser(rowNum);
}

// ═══════════════════════════════════════════════
// سجل العمليات
// ═══════════════════════════════════════════════
function loadActivity() {
  if (_activityData.length && _tabLoadedAt.activity && Date.now() - _tabLoadedAt.activity < 60000) { filterActivity(); return; }
  document.getElementById('activityBody').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#718096">جارٍ التحميل...</td></tr>';
  google.script.run
    .withSuccessHandler(freshGuard_(function(d){ _tabLoadedAt.activity = Date.now(); renderActivity(d); }))
    .withFailureHandler(e => toast('خطأ: ' + e.message, 'err'))
    .getActivityLog(200);
}

var _activityData = [];

function renderActivity(data) {
  _activityData = data || [];
  filterActivity();
}

function filterActivity() {
  const body = document.getElementById('activityBody');
  if (!_activityData.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#718096">لا توجد عمليات بعد — قم بإضافة أو تعديل أو حذف عقد وستظهر هنا</td></tr>';
    return;
  }
  // اجمع الفلاتر المحددة
  const checked = [];
  document.querySelectorAll('#activityFilters input:checked').forEach(cb => checked.push(cb.value));

  // اعرض كل شيء إذا لا يوجد فلتر محدد
  const filtered = checked.length === 0 ? _activityData : _activityData.filter(a => checked.indexOf(a.action) >= 0);

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#718096">لا توجد نتائج للفلتر المحدد</td></tr>';
    return;
  }
  const actionColors = {
    'إضافة': 'var(--green)', 'تعديل': 'var(--blue)', 'حذف': 'var(--red)',
    'دفعة': 'var(--green)', 'رسالة': 'var(--amber)', 'نسخ احتياطي': 'var(--blue)'
  };
  body.innerHTML = filtered.map(a => '<tr>' +
    '<td style="font-size:11px;color:#718096;white-space:nowrap">' + escHtml(a.time) + '</td>' +
    '<td><strong>' + escHtml(a.username) + '</strong></td>' +
    '<td><span style="color:' + (actionColors[a.action]||'#718096') + ';font-weight:500">' + escHtml(a.action) + '</span></td>' +
    '<td style="font-size:12px">' + escHtml(a.entity) + '</td>' +
    '<td style="font-size:12px">' + escHtml(a.details) + '</td>' +
    '</tr>').join('');
}

// ═══════════════════════════════════════════════
// النسخ الاحتياطي
// ═══════════════════════════════════════════════
function loadBackup() {
  google.script.run
    .withSuccessHandler(renderBackup)
    .withFailureHandler(e => toast('خطأ: ' + e.message, 'err'))
    .getBackupStatus();
}

function renderBackup(s) {
  if (!s) return;
  document.getElementById('bk-status').textContent = s.autoEnabled ? '🟢 مفعّل' : '⚪ متوقف';
  document.getElementById('bk-status').style.color = s.autoEnabled ? 'var(--green)' : '#718096';
  document.getElementById('bk-count').textContent  = s.count || 0;
  document.getElementById('bk-last').textContent   = s.lastBackup || '—';

  const link = document.getElementById('bk-folder-link');
  if (s.fileUrl) {
    link.href = s.fileUrl;
    link.style.display = 'inline-flex';
  } else {
    link.style.display = 'none';
  }
  const btn = document.getElementById('bk-toggle-btn');
  btn.textContent = s.autoEnabled ? '⏸️ إيقاف النسخ التلقائي' : '⏰ تفعيل النسخ التلقائي اليومي';
  btn.className = s.autoEnabled ? 'btn btn-amber' : 'btn btn-primary';
}

function doBackupNow() {
  const btn = document.getElementById('bk-now-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> جارٍ النسخ...';
  document.getElementById('bkResult').innerHTML = '';
  google.script.run
    .withSuccessHandler(r => {
      btn.disabled = false; btn.textContent = '📥 نسخة احتياطية الآن';
      if (r.error) {
        document.getElementById('bkResult').innerHTML = '<div class="result err">' + r.error + '</div>';
      } else {
        document.getElementById('bkResult').innerHTML =
          '<div class="result">✅ ' + r.message +
          (r.fileUrl ? ' — <a href="' + r.fileUrl + '" target="_blank" style="color:var(--green)">📂 فتح النسخة</a>' : '') +
          '</div>';
        loadBackup();
      }
    })
    .withFailureHandler(e => {
      btn.disabled = false; btn.textContent = '📥 نسخة احتياطية الآن';
      document.getElementById('bkResult').innerHTML = '<div class="result err">' + e.message + '</div>';
    })
    .backupNow();
}

function toggleAutoBackup() {
  const btn = document.getElementById('bk-toggle-btn');
  const isOn = btn.textContent.indexOf('إيقاف') >= 0;
  btn.disabled = true;
  const handler = r => {
    btn.disabled = false;
    if (r.error) {
      document.getElementById('bkResult').innerHTML = '<div class="result err">' + escHtml(r.error) + '</div>';
    } else {
      document.getElementById('bkResult').innerHTML = '<div class="result">✅ ' + escHtml(r.message) + '</div>';
      loadBackup();
    }
  };
  // معالج فشل: يُعيد تفعيل الزر حتى لا يبقى معطّلاً للأبد عند انقطاع الاتصال
  const failHandler = e => {
    btn.disabled = false;
    document.getElementById('bkResult').innerHTML = '<div class="result err">خطأ: ' + escHtml(e.message) + '</div>';
  };
  if (isOn) {
    google.script.run.withSuccessHandler(handler).withFailureHandler(failHandler).disableDailyBackup();
  } else {
    google.script.run.withSuccessHandler(handler).withFailureHandler(failHandler).setupDailyBackup();
  }
}

function loadBackupFilesUI(){
  const box=document.getElementById('restoreBackupBox');
  const sel=document.getElementById('backupRestoreSelect');
  box.style.display='block';
  sel.innerHTML='<option value="">جارٍ تحميل النسخ...</option>';
  google.script.run
    .withSuccessHandler(list=>{
      list=list||[];
      if(!list.length){ sel.innerHTML='<option value="">لا توجد نسخ في مجلد النسخ الاحتياطي</option>'; return; }
      sel.innerHTML='<option value="">اختر نسخة...</option>'+list.map(f=>'<option value="'+f.id+'">'+escHtml(f.date+' — '+f.name)+'</option>').join('');
    })
    .withFailureHandler(e=>{sel.innerHTML='<option value="">خطأ: '+escHtml(e.message)+'</option>';})
    .listBackupFiles();
}
function restoreSelectedBackupUI(){
  const sel=document.getElementById('backupRestoreSelect');
  const id=sel.value;
  if(!id){toast('اختر نسخة احتياطية أولاً','err');return;}
  const name=sel.options[sel.selectedIndex].text;
  if(!confirm('سيتم استبدال بيانات النظام الحالية بالكامل بالنسخة:\n'+name+'\n\nسيتم إنشاء نسخة احتياطية قبل الاستعادة. اكتب موافق للمتابعة.')) return;
  const typed=prompt('للتأكيد اكتب: استعادة');
  if(typed!=='استعادة') { toast('تم إلغاء الاستعادة'); return; }
  document.getElementById('bkResult').innerHTML='<div class="result">⏳ جارٍ الاستعادة... لا تغلق الصفحة</div>';
  google.script.run
    .withSuccessHandler(r=>{
      if(r && r.error){document.getElementById('bkResult').innerHTML='<div class="result err">'+escHtml(r.error)+'</div>';return;}
      document.getElementById('bkResult').innerHTML='<div class="result">✅ '+escHtml(r.message||'تمت الاستعادة')+'</div>';
      toast('✅ تمت الاستعادة، حدّث الصفحة');
    })
    .withFailureHandler(e=>{document.getElementById('bkResult').innerHTML='<div class="result err">'+escHtml(e.message)+'</div>';})
    .restoreBackupFromFile(id);
}


// ── Modal helpers ─────────────────────────────
function openModal(id){
  const el=document.getElementById(id);
  el.style.display='flex';
  document.body.style.overflow='hidden';
}
function closeModal(id){
  document.getElementById(id).style.display='none';
  document.body.style.overflow='';
}
// Close on overlay click
document.querySelectorAll('.modal-overlay').forEach(el=>{
  el.addEventListener('click',function(e){ if(e.target===this) closeModal(this.id); });
});

// ── Populate selects ──────────────────────────
function populateAllSelects(){
  if(!S.stats) return;
  const statsBuildings=Object.keys(S.stats.byBuilding);
  // smsBldg يستخدم قائمة المباني الكاملة حتى يشمل المباني بدون عقود
  const allBuildings=(S.buildings||[]).map(b=>b.name);
  const buildingsBySelect={smsBldg:allBuildings.length?allBuildings:statsBuildings};
  ['fBldg','mBldg','smsBldg','mntBldgFilter'].forEach(id=>{
    const sel=document.getElementById(id); if(!sel) return;
    const buildings=buildingsBySelect[id]||statsBuildings;
    const cur=sel.value; while(sel.options.length>1) sel.remove(1);
    buildings.forEach(b=>{ const o=document.createElement('option'); o.value=o.text=b; sel.add(o); });
    if(cur) sel.value=cur;
  });
}

// ── Utils ─────────────────────────────────────
function nf(n){ if(n===null||n===undefined||n==='') return '—'; var x=Number(n); return isNaN(x)?'—':Math.round(x).toLocaleString('ar-SA'); }

// ── التحقق من رقم الجوال السعودي ──────────────────────────────
// يقبل: 05XXXXXXXX أو 009665XXXXXXXX أو +9665XXXXXXXX
// يُعيد null إذا كان الرقم صحيحاً، أو رسالة خطأ نصية
function validateSaudiPhone_(phone) {
  if (!phone || !String(phone).trim()) return null; // الحقل اختياري
  const cleaned = String(phone).replace(/[\s\-]/g, '');
  if (/^05\d{8}$/.test(cleaned)) return null;
  if (/^009665\d{8}$/.test(cleaned)) return null;
  if (/^\+9665\d{8}$/.test(cleaned)) return null;
  return 'رقم الجوال غير صحيح (يجب أن يبدأ بـ 05 ويكون 10 أرقام)';
}
function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function esc(s){ return escHtml(s).replace(/&#39;/g,"\\'"); }
function appendMsg(kind, text, isErr){
  const msgs=document.getElementById('aiMsgs');
  const div=document.createElement('div');
  div.className='msg ' + (kind==='user'?'msg-user':'msg-ai');
  if(isErr) div.style.color='var(--red)';
  String(text||'').split('\n').forEach(function(part, i){ if(i) div.appendChild(document.createElement('br')); div.appendChild(document.createTextNode(part)); });
  msgs.appendChild(div);
}

function statusBadge(s){
  const m={'ساري':'b-green','شارف على الانتهاء':'b-amber','تشارف انتهاء':'b-amber','منتهي':'b-gray'};
  return `<span class="badge ${m[s]||'b-gray'}">${s||'—'}</span>`;
}
function toast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg; el.style.background=type==='err'?'#9B1C1C':'#1A3A5C';
  el.classList.add('show'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),3000);
}

// ═══════════════════════════════════════════════
// قسم الصيانة
// ═══════════════════════════════════════════════

function loadMaintenance() {
  if (S.maintenanceList.length && _tabLoadedAt.maintenance && Date.now() - _tabLoadedAt.maintenance < 90000) { _applyMaintenanceFilters(); return; }
  const tbody = document.getElementById('maintenanceBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:#718096">جارٍ التحميل...</td></tr>';
  google.script.run
    .withSuccessHandler(freshGuard_(function(d){ _tabLoadedAt.maintenance = Date.now(); renderMaintenance(d && d.error ? [] : d); if (d && d.error) toast('خطأ الصيانة: ' + d.error, 'err'); }))
    .withFailureHandler(e => toast('خطأ تحميل الصيانة: ' + e.message, 'err'))
    .getMaintenanceList();
}

function renderMaintenance(data) {
  S.maintenanceList = data || [];
  _applyMaintenanceFilters();
}

function _applyMaintenanceFilters() {
  const list = S.maintenanceList || [];
  const fBldg   = (document.getElementById('mntBldgFilter')    || {}).value || '';
  const fStatus  = (document.getElementById('mntStatusFilter') || {}).value || '';
  const fCat     = (document.getElementById('mntCatFilter')    || {}).value || '';
  const fPri     = (document.getElementById('mntPriFilter')    || {}).value || '';

  let filtered = list;
  if (fBldg)   filtered = filtered.filter(r => r.building  === fBldg);
  if (fStatus) filtered = filtered.filter(r => r.status    === fStatus);
  if (fCat)    filtered = filtered.filter(r => r.category  === fCat);
  if (fPri)    filtered = filtered.filter(r => r.priority  === fPri);

  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  set('mnt-total',  list.length);
  set('mnt-open',   list.filter(r => r.status === 'جديد').length);
  set('mnt-inprog', list.filter(r => r.status === 'قيد التنفيذ').length);
  set('mnt-done',   list.filter(r => r.status === 'مكتمل').length);

  const tbody = document.getElementById('maintenanceBody');
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:#718096">لا توجد طلبات صيانة</td></tr>';
    return;
  }

  const priCls    = { 'طارئ':'b-red', 'عاجل':'b-amber', 'عادي':'b-blue' };
  const statusCls = { 'جديد':'b-blue', 'قيد التنفيذ':'b-amber', 'مكتمل':'b-green', 'ملغي':'b-gray' };

  tbody.innerHTML = filtered.map(r => `<tr>
    <td style="font-size:11px;color:#718096;white-space:nowrap">${escHtml(r.date) || '—'}</td>
    <td>${escHtml(r.building) || '—'}</td>
    <td style="text-align:center">${escHtml(r.unit) || '—'}</td>
    <td style="font-size:12px">${escHtml(r.tenant) || '—'}</td>
    <td><span class="badge b-navy" style="font-size:11px">${escHtml(r.category) || '—'}</span></td>
    <td><span class="badge ${priCls[r.priority] || 'b-gray'}" style="font-size:11px">${escHtml(r.priority) || '—'}</span></td>
    <td style="font-size:12px;max-width:200px;word-break:break-word">${escHtml(r.description || '—')}</td>
    <td style="font-size:12px">${escHtml(r.contractor) || '—'}</td>
    <td style="font-size:12px">${r.actualCost ? nf(r.actualCost) + ' ر.س' : '—'}</td>
    <td><span class="badge ${statusCls[r.status] || 'b-gray'}">${escHtml(r.status) || '—'}</span></td>
    <td><div style="display:flex;gap:4px">
      ${hasPerm('maintenance.edit')   ? `<button class="btn btn-sm btn-primary" onclick="openMaintenanceModal('edit',${r.row})">تعديل</button>` : ''}
      ${hasPerm('maintenance.delete') ? `<button class="btn btn-sm btn-danger"  onclick="confirmDeleteMaintenance(${r.row})">حذف</button>` : ''}
    </div></td>
  </tr>`).join('');
}

function openMaintenanceModal(mode, rowNum) {
  if (!hasPerm(mode === 'edit' ? 'maintenance.edit' : 'maintenance.add')) {
    toast('ليس لديك الصلاحية المطلوبة', 'err'); return;
  }
  // إذا كانت قائمة المباني فارغة (مستخدم صلاحيات صيانة فقط)، اجلبها أولاً
  const buildingNames = (S.buildings || []).map(b => b.name);
  if (buildingNames.length) {
    _doOpenMaintenanceModal_(mode, rowNum, buildingNames);
  } else {
    const btn = document.getElementById('mntSaveBtn');
    if (btn) btn.disabled = true;
    google.script.run
      .withSuccessHandler(names => {
        if (btn) btn.disabled = false;
        _doOpenMaintenanceModal_(mode, rowNum, names || []);
      })
      .withFailureHandler(e => {
        if (btn) btn.disabled = false;
        toast('تعذر جلب قائمة المباني: ' + (e && e.message ? e.message : 'خطأ غير معروف'), 'err');
      })
      .getMaintenanceBuildingNames();
  }
}

function _doOpenMaintenanceModal_(mode, rowNum, buildingNames) {
  document.getElementById('mntModalTitle').textContent = mode === 'add' ? '🔧 إضافة طلب صيانة' : '✏️ تعديل طلب صيانة';
  document.getElementById('mntEditRow').value    = rowNum || '';
  document.getElementById('mntModalResult').innerHTML = '';

  ['mnt-unit','mnt-tenant','mnt-contractor','mnt-contractor-phone','mnt-actual-cost','mnt-description','mnt-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });

  const bsel = document.getElementById('mnt-building');
  bsel.innerHTML = '<option value="">اختر مبنى...</option>';
  buildingNames.forEach(name => { const o = document.createElement('option'); o.value = o.text = name; bsel.add(o); });

  document.getElementById('mnt-category').value = 'أخرى';
  document.getElementById('mnt-priority').value  = 'عادي';
  document.getElementById('mnt-status').value    = 'جديد';
  document.getElementById('mnt-date').value      = new Date().toISOString().split('T')[0];

  if (mode === 'edit' && rowNum) {
    const r = (S.maintenanceList || []).find(x => x.row === rowNum);
    if (r) {
      document.getElementById('mnt-building').value          = r.building        || '';
      document.getElementById('mnt-unit').value              = r.unit            || '';
      document.getElementById('mnt-tenant').value            = r.tenant          || '';
      document.getElementById('mnt-category').value          = r.category        || 'أخرى';
      document.getElementById('mnt-priority').value          = r.priority        || 'عادي';
      document.getElementById('mnt-description').value       = r.description     || '';
      document.getElementById('mnt-contractor').value        = r.contractor      || '';
      document.getElementById('mnt-contractor-phone').value  = r.contractorPhone || '';
      document.getElementById('mnt-actual-cost').value       = r.actualCost      || '';
      document.getElementById('mnt-status').value            = r.status          || 'جديد';
      document.getElementById('mnt-notes').value             = r.notes           || '';
      if (r.date) document.getElementById('mnt-date').value  = r.date.replace(/\//g, '-');
    }
  }
  openModal('maintenanceModal');
}

function autoFillMaintenanceTenant() {
  const building = document.getElementById('mnt-building').value;
  const unit     = document.getElementById('mnt-unit').value.trim();
  if (!building || !unit) return;
  const contract = (S.contracts || []).find(c =>
    c.building === building && String(c.unit) === String(unit) &&
    (c.status === 'ساري' || c.status === 'شارف على الانتهاء' || c.status === 'تشارف انتهاء')
  );
  if (contract) document.getElementById('mnt-tenant').value = contract.tenant || '';
}

function saveMaintenance() {
  const rowNum = document.getElementById('mntEditRow').value;
  if (!hasPerm(rowNum ? 'maintenance.edit' : 'maintenance.add')) {
    toast('ليس لديك الصلاحية المطلوبة', 'err'); return;
  }
  const data = {
    date:            document.getElementById('mnt-date').value.replace(/-/g, '/'),
    building:        document.getElementById('mnt-building').value,
    unit:            document.getElementById('mnt-unit').value.trim(),
    tenant:          document.getElementById('mnt-tenant').value.trim(),
    category:        document.getElementById('mnt-category').value,
    priority:        document.getElementById('mnt-priority').value,
    description:     document.getElementById('mnt-description').value.trim(),
    contractor:      document.getElementById('mnt-contractor').value.trim(),
    contractorPhone: document.getElementById('mnt-contractor-phone').value.trim(),
    actualCost:      document.getElementById('mnt-actual-cost').value,
    status:          document.getElementById('mnt-status').value,
    notes:           document.getElementById('mnt-notes').value.trim()
  };
  const out = document.getElementById('mntModalResult');
  if (!data.building)    { out.innerHTML = '<div class="result err">المبنى مطلوب</div>'; return; }
  if (!data.description) { out.innerHTML = '<div class="result err">وصف المشكلة مطلوب</div>'; return; }

  const btn = document.getElementById('mntSaveBtn');
  btn.disabled = true;
  const cb = r => {
    btn.disabled = false;
    if (r && r.error) { out.innerHTML = '<div class="result err">' + escHtml(r.error) + '</div>'; return; }
    out.innerHTML = '<div class="result">✅ تم الحفظ بنجاح</div>';
    setTimeout(() => { closeModal('maintenanceModal'); _tabLoadedAt.maintenance = 0; loadMaintenance(); }, 500);
  };
  const fail = e => { btn.disabled = false; toast('خطأ: ' + e.message, 'err'); };
  if (rowNum) {
    google.script.run.withSuccessHandler(cb).withFailureHandler(fail).updateMaintenance(parseInt(rowNum), data);
  } else {
    google.script.run.withSuccessHandler(cb).withFailureHandler(fail).addMaintenance(data);
  }
}

function confirmDeleteMaintenance(row) {
  if (!confirm('هل تريد حذف طلب الصيانة هذا؟')) return;
  google.script.run
    .withSuccessHandler(r => {
      if (r && r.error) { toast('خطأ: ' + r.error, 'err'); return; }
      toast('✅ تم الحذف'); _tabLoadedAt.maintenance = 0; loadMaintenance();
    })
    .withFailureHandler(e => toast('خطأ: ' + e.message, 'err'))
    .deleteMaintenance(row);
}
// =====================================================
// PATCH FIXED
// تحسين سرعة الدخول مع كاش متوافق مع نظام S
// =====================================================

(function () {

  const CACHE_KEY = "amlak_cache_v2";
  const CACHE_MAX_AGE_MS   = 30 * 60 * 1000; // 30 min — max display age
  const CACHE_SKIP_SVRS_MS =  3 * 60 * 1000; // 3 min — skip server if cache is this fresh

  const originalApply    = window.applyAllData_;
  const originalLoadData = window.loadData;

  if (typeof originalApply === "function") {
    window.applyAllData_ = function (data) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          time: Date.now(),
          username: (_currentUser && _currentUser.username) ? _currentUser.username : '',
          data: data
        }));
      } catch (e) {}
      return originalApply(data);
    };
  }

  window.loadData = function () {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const obj  = JSON.parse(cached);
        const age  = Date.now() - (obj.time || 0);
        const user = (_currentUser && _currentUser.username) ? _currentUser.username : '';
        const sameUser = obj.username && user && obj.username === user;
        if (obj && obj.data && sameUser && age < CACHE_MAX_AGE_MS) {
          originalApply(obj.data);
          if (age < CACHE_SKIP_SVRS_MS) return; // cache is fresh — skip server round-trip
        } else {
          localStorage.removeItem(CACHE_KEY);
        }
      }
    } catch (e) {
      localStorage.removeItem(CACHE_KEY);
    }
    return originalLoadData();
  };

  // debounce silentRefresh so rapid mutations don't stack server calls
  var _srTimer = null;
  var _srOrig  = window.silentRefresh;
  if (typeof _srOrig === 'function') {
    window.silentRefresh = function () {
      if (_srTimer) clearTimeout(_srTimer);
      _srTimer = setTimeout(function () { _srTimer = null; _srOrig(); }, 600);
    };
  }

})();

// ═══════════════════════════════════════════════
// استيراد عقد إيجار من PDF (Ejar Import)
// ═══════════════════════════════════════════════

var _ejarExtracted = null;

function importEjarPdf() {
  if (!hasPerm('contracts.add')) { toast('ليس لديك صلاحية إضافة عقود', 'err'); return; }
  _loadPdfJs_(function() { document.getElementById('ejarPdfFile').click(); });
}

function _loadPdfJs_(cb) {
  if (window.pdfjsLib) { cb(); return; }
  var s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  s.onload = function() {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    cb();
  };
  s.onerror = function() { toast('تعذر تحميل مكتبة قراءة PDF — تحقق من الاتصال', 'err'); };
  document.head.appendChild(s);
}

function _onEjarFileSelected_(input) {
  var file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('حجم الملف كبير جداً (الحد 10MB)', 'err'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    _loadPdfJs_(function() {
      toast('⏳ جاري قراءة ملف الإيجار...');
      pdfjsLib.getDocument({ data: new Uint8Array(e.target.result) }).promise
        .then(function(pdf) {
          var pp = [];
          for (var i = 1; i <= Math.min(pdf.numPages, 20); i++) {
            pp.push(pdf.getPage(i).then(_ejarPageToLines_));
          }
          return Promise.all(pp);
        })
        .then(function(pagesLines) {
          // دمج أسطر جميع الصفحات
          var allLines = [];
          pagesLines.forEach(function(lines) { allLines = allLines.concat(lines); });
          var data = _parseEjarLines_(allLines);
          if (!data.tenantName && !data.startDate && !data.rent && !data.idNo) {
            toast('لم يُتعرف على بيانات عقد إيجار في هذا الملف', 'err');
            return;
          }
          _ejarExtracted = data;
          _showEjarPreview_(data);
        })
        .catch(function(err) {
          toast('خطأ في قراءة PDF' + (err && err.message ? ': ' + err.message : ''), 'err');
        });
    });
  };
  reader.onerror = function() { toast('خطأ في قراءة الملف', 'err'); };
  reader.readAsArrayBuffer(file);
}

// ── إعادة بناء النص ثنائي اللغة من صيغ الإظهار العربية المعكوسة في PDF ──
function _ejarHasArabic_(s) {
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if ((c >= 0x0600 && c <= 0x06FF) || (c >= 0x0750 && c <= 0x077F) ||
        (c >= 0xFB50 && c <= 0xFDFF) || (c >= 0xFE70 && c <= 0xFEFF)) return true;
  }
  return false;
}
function _ejarReconLine_(items) {
  items.sort(function(a, b) { return a.x - b.x; });
  var segs = [], cur = null;
  items.forEach(function(it) {
    var s = it.str;
    if (s == null) return;
    if (!s.trim()) { if (cur) cur.items.push(s); return; }
    var ar = _ejarHasArabic_(s);
    if (!cur || cur.ar !== ar) { cur = { ar: ar, items: [] }; segs.push(cur); }
    cur.items.push(s);
  });
  return segs.map(function(seg) {
    var str = seg.ar ? seg.items.slice().reverse().join('') : seg.items.join('');
    if (seg.ar) { try { str = str.normalize('NFKC'); } catch (e) {} }
    return str.replace(/\s+/g, ' ').trim();
  }).filter(function(t) { return t.length; }).join(' ');
}

// تجميع عناصر الصفحة في أسطر حسب الموضع الرأسي ثم إعادة بناء كل سطر
function _ejarPageToLines_(page) {
  return page.getTextContent().then(function(tc) {
    var bands = {};
    tc.items.forEach(function(item) {
      if (item.str === undefined || item.str === null) return;
      var band = Math.round(item.transform[5] / 8);
      if (!bands[band]) bands[band] = [];
      bands[band].push({ str: item.str, x: item.transform[4] });
    });
    return Object.keys(bands)
      .sort(function(a, b) { return Number(b) - Number(a); })
      .map(function(b) { return _ejarReconLine_(bands[b]); });
  });
}

function _parseEjarLines_(lines) {
  var fullText = '\n' + lines.join('\n') + '\n';
  function fromFull(re) { var m = fullText.match(re); return m ? m[1].trim() : ''; }

  function section(startRe, endRe) {
    var s = fullText.search(startRe);
    if (s < 0) return '';
    var after = fullText.slice(s);
    var em = after.slice(1).search(endRe);
    return em < 0 ? after : after.slice(0, em + 1);
  }
  var tenantText = section(/Tenant\s+Data/i, /Tenant\s+Representative\s+Data|Brokerage\s+Entity/i);
  var repText    = section(/Tenant\s+Representative\s+Data/i, /Brokerage\s+Entity|Title\s+Deeds?\s+Data/i);

  function nameFrom(sec) {
    if (!sec) return '';
    var ls = sec.split('\n');
    for (var i = 0; i < ls.length; i++) {
      var m = ls[i].match(/\bName\s+([؀-ۿ][؀-ۿ\s]{3,60}?)\s*(?::|الاسم|$)/);
      if (m) return m[1].replace(/\s+/g, ' ').trim();
    }
    return '';
  }
  var tenantName = nameFrom(tenantText) || nameFrom(repText);

  var idScope = (repText || '') + '\n' + (tenantText || '');
  var idNo = (idScope.match(/(?:ID\s*No\.?|رقم\s*(?:الهوية|الإقامة))[^\n\d]{0,15}(\d{10})/i) || [])[1] || '';
  var phone = '';
  var phM = idScope.match(/(\+?9665\d{8}|05\d{8})/);
  if (phM) { var dd = phM[1].replace(/^\+?966/, ''); phone = dd.length === 9 ? '0' + dd : dd; }

  var startDate = fromFull(/(?:Tenancy\s*Start\s*Date)[^\n\d]{0,15}(\d{4}-\d{2}-\d{2})/i)
              || fromFull(/تاريخ\s*بداية[^\n]{0,25}?(\d{4}-\d{2}-\d{2})/i);
  var endDate   = fromFull(/(?:Tenancy\s*End\s*Date)[^\n\d]{0,15}(\d{4}-\d{2}-\d{2})/i)
              || fromFull(/تاريخ\s*نهاية[^\n]{0,25}?(\d{4}-\d{2}-\d{2})/i);

  var rentRaw = fromFull(/(?:Annual\s*Rent)[^\n\d]{0,20}(\d[\d,]*(?:\.\d+)?)/i)
             || fromFull(/(?:القيمة\s*السنوية\s*للإيجار|قيمة\s*الإيجار)[^\n\d]{0,20}(\d[\d,]*(?:\.\d+)?)/i);
  var rent = rentRaw ? rentRaw.replace(/,/g, '').replace(/\.0+$/, '') : '';

  var totalRaw = fromFull(/(?:Total\s*Contract\s*value|اجمالي\s*قيمة\s*العقد|إجمالي\s*قيمة\s*العقد)[^\n\d]{0,20}(\d[\d,]*(?:\.\d+)?)/i);
  var total = totalRaw ? totalRaw.replace(/,/g, '').replace(/\.0+$/, '') : '';

  var ejarNo = fromFull(/(?:Contract\s*No\.?|رقم\s*(?:سجل\s*)?العقد)[^\n]*?(\d{8,})/i);

  var schedule = '';
  var sm = fullText.match(/(?:Rent\s*payment\s*cycle|Payment\s*Cycle|دورة\s*سداد\s*الايجار|دورية\s*السداد)([^\n]{0,40})/i);
  if (sm) {
    var r = sm[1];
    if (/ربع|quarter/i.test(r)) schedule = '3 أشهر';
    else if (/نصف|semi/i.test(r)) schedule = '6 أشهر';
    else if (/سنو|annual|year/i.test(r)) schedule = 'سنوي';
    else if (/شهر|month/i.test(r)) schedule = 'شهري';
  }

  // نوع العقد: نعتمد على نوع الوحدة بعد إزالة التشكيل والمسافات (الحقل "الغرض" يخلط سكني/تجاري)
  var compact = fullText.replace(/[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ\s]/g, '');
  var comHit = /نوعالوحدة:?(?:محل|مكتب|معرض|مستودع|أرض|ارض|عيادة|ورشة|صالة|مغسلة|مصنع|كشك|تجاري)/.test(compact);
  var resHit = /نوعالوحدة:?(?:شقة|دور|فيلا|فلة|استوديو|غرفة|جناح|سكن|بيت)/.test(compact);
  var contractType = (comHit && !resHit) ? 'تجاري' : 'سكني';

  var propText = section(/Property\s+Data/i, /Rental\s+Units?\s+Data|Title\s+Deeds?\s+Data/i);
  var address = '';
  var am = (propText || fullText).match(/(?:National\s*Address|العنوان\s*الوطني)\s*:?\s*([؀-ۿ\d][^\n:]{4,80})/i);
  if (am) address = am[1].replace(/\s+/g, ' ').trim();

  var unit = fromFull(/(?:Unit\s*No\.?|رقم\s*الوحدة)[^\n\d]{0,10}(\d+)/i);

  return { tenantName: tenantName, idNo: idNo, phone: phone, startDate: startDate,
           endDate: endDate, rent: rent, total: total, schedule: schedule, unit: unit,
           contractType: contractType, ejarNo: ejarNo, address: address };
}

// فحص تعارضات في العقود الحالية
function _checkEjarConflicts_(d) {
  var warnings = [];
  var contracts = (S && S.contracts) || [];
  var active = ['ساري', 'شارف على الانتهاء', 'تشارف انتهاء'];

  // هل المستأجر لديه عقد ساري؟
  if (d.idNo || d.tenantName) {
    var existing = contracts.filter(function(c) {
      if (active.indexOf(c.status) < 0) return false;
      return (d.idNo && c.idNo && c.idNo === d.idNo) ||
             (d.tenantName && c.tenant && c.tenant === d.tenantName);
    });
    if (existing.length) {
      warnings.push({ type: 'warn', msg: '⚠️ هذا المستأجر لديه عقد ساري في: ' +
        existing.map(function(c) { return escHtml(c.building + ' / ' + c.unit); }).join('، ') });
    }
  }

  // هل الوحدة مشغولة؟ (تحذير فقط — قد تكون نفس رقم في مباني مختلفة)
  if (d.unit) {
    var occ = contracts.filter(function(c) {
      return active.indexOf(c.status) >= 0 && String(c.unit) === String(d.unit);
    });
    if (occ.length) {
      warnings.push({ type: 'warn', msg: '⚠️ وحدة رقم ' + escHtml(d.unit) +
        ' مشغولة في: ' + occ.map(function(c) { return escHtml(c.building + ' (' + c.tenant + ')'); }).join('، ') +
        ' — تحقق من المبنى' });
    }
  }

  return warnings;
}

function _showEjarPreview_(d) {
  var warnings = _checkEjarConflicts_(d);

  var bldgNames = (S.buildings || []).map(function(b) { return b.name; });

  var fields = [
    { id:'ej-building', label:'المبنى',               val: '',             type:'select',
      opts: [''].concat(bldgNames) },
    { id:'ej-tenant',   label:'اسم المستأجر',         val: d.tenantName,   type:'text'   },
    { id:'ej-idno',     label:'رقم الهوية',            val: d.idNo,         type:'text'   },
    { id:'ej-phone',    label:'رقم الجوال',            val: d.phone,        type:'text'   },
    { id:'ej-start',    label:'بداية العقد',           val: d.startDate,    type:'date'   },
    { id:'ej-end',      label:'نهاية العقد',           val: d.endDate,      type:'date'   },
    { id:'ej-rent',     label:'قيمة الإيجار (ر.س)',    val: d.rent,         type:'number' },
    { id:'ej-schedule', label:'دورية السداد',          val: d.schedule,     type:'select',
      opts: ['', 'شهري', '3 أشهر', '6 أشهر', 'سنوي'] },
    { id:'ej-unit',     label:'رقم الوحدة',            val: d.unit,         type:'text'   },
    { id:'ej-type',     label:'نوع العقد',             val: d.contractType, type:'select',
      opts: ['سكني', 'تجاري'] },
    { id:'ej-ejarno',   label:'رقم إيجار (للملاحظات)',  val: d.ejarNo,      type:'text'   }
  ];

  var rows = fields.map(function(f) {
    var ok = f.val ? '<span style="color:var(--green);font-size:11px">✅</span>'
                   : '<span style="color:#cbd5e0;font-size:11px">—</span>';
    var ctrl;
    if (f.type === 'select') {
      var opts = f.opts.map(function(o) {
        return '<option value="' + escHtml(o) + '"' + (o === f.val ? ' selected' : '') + '>' + escHtml(o || '—') + '</option>';
      }).join('');
      ctrl = '<select id="' + f.id + '" class="form-control" style="font-size:13px;padding:3px 6px">' + opts + '</select>';
    } else {
      ctrl = '<input type="' + f.type + '" id="' + f.id + '" class="form-control" style="font-size:13px;padding:3px 6px" value="' + escHtml(f.val || '') + '">';
    }
    return '<tr>' +
      '<td style="padding:4px 8px;color:#718096;font-size:12px;white-space:nowrap;width:120px">' + f.label + '</td>' +
      '<td style="padding:4px 4px">' + ctrl + '</td>' +
      '<td style="padding:4px 6px;width:24px">' + ok + '</td>' +
      '</tr>';
  }).join('');

  var warnHtml = warnings.length
    ? warnings.map(function(w) {
        return '<div class="result ' + w.type + '" style="padding:6px 10px;font-size:12px;margin-bottom:4px">' + w.msg + '</div>';
      }).join('')
    : '';

  var addrHtml = d.address
    ? '<div style="margin-top:8px;padding:6px 10px;background:var(--blue-l);border-radius:6px;font-size:12px;color:var(--navy)">📍 عنوان العقار: <strong>' + escHtml(d.address) + '</strong></div>'
    : '';

  document.getElementById('ejarPreviewBody').innerHTML =
    (warnHtml ? warnHtml : '') +
    '<div style="font-size:12px;color:#718096;margin-bottom:6px">عدّل أي حقل قبل التطبيق:</div>' +
    '<table style="width:100%;border-collapse:collapse">' + rows + '</table>' +
    addrHtml +
    '<div style="margin-top:8px;padding:6px 10px;background:#fffbeb;border-radius:6px;font-size:12px;color:#92400e">' +
    '⚠️ راجع البيانات وأكّد قبل الحفظ.</div>';

  openModal('ejarPreviewModal');
}

function applyEjarData_() {
  function gv(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  var d = {
    building:     gv('ej-building'),
    tenantName:   gv('ej-tenant'),
    idNo:         gv('ej-idno'),
    phone:        gv('ej-phone'),
    startDate:    gv('ej-start'),
    endDate:      gv('ej-end'),
    rent:         gv('ej-rent'),
    schedule:     gv('ej-schedule'),
    unit:         gv('ej-unit'),
    contractType: gv('ej-type'),
    ejarNo:       gv('ej-ejarno')
  };

  closeModal('ejarPreviewModal');

  var modal = document.getElementById('contractModal');
  var isOpen = modal && modal.classList.contains('open');
  if (!isOpen) openContractModal('add');

  setTimeout(function() {
    function setVal(id, val) {
      var el = document.getElementById(id);
      if (!el || !val) return;
      if (el.tagName === 'SELECT') {
        for (var i = 0; i < el.options.length; i++) {
          if (el.options[i].value === val || el.options[i].text === val) { el.value = val; break; }
        }
      } else {
        el.value = val;
      }
    }
    setVal('c-building', d.building);
    setVal('c-tenant',   d.tenantName);
    setVal('c-idNo',     d.idNo);
    setVal('c-phone',    d.phone);
    setVal('c-start',    d.startDate);
    setVal('c-end',      d.endDate);
    setVal('c-rent',     d.rent);
    setVal('c-schedule', d.schedule);
    setVal('c-unit',     d.unit);
    setVal('c-type',     d.contractType);
    if (d.ejarNo) {
      var notes = document.getElementById('c-notes');
      if (notes && !notes.value) notes.value = 'رقم عقد إيجار: ' + d.ejarNo;
    }
    if (typeof updateNextDue === 'function') updateNextDue();
    toast('✅ تم ملء النموذج — راجع البيانات قبل الحفظ');
    _ejarExtracted = null;
  }, isOpen ? 50 : 400);
}


