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
             'tenants.view','payments.add','finance.view','sms.send','ai.use','alerts.view','log.view','reports.export',
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
  if (out.includes('contracts.add') || out.includes('contracts.edit') || out.includes('contracts.delete') || out.includes('payments.add')) {
    addPermClient_(out, 'contracts.view');
  }
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
let S = { contracts:[], buildings:[], tenants:[], maintenanceList:[], stats:null, loaded:false };

// ── Init ──────────────────────────────────────
document.getElementById('topDate').textContent = new Date().toLocaleDateString('ar-SA',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
document.getElementById('smsText').addEventListener('input',function(){ document.getElementById('smsChars').textContent=smsPartsInfo_(this.value); });
checkSession();

// ── Data loading ──────────────────────────────

function applyAllData_(d) {
  if (!d || d.error) { if (d && d.error) toast(d.error, 'err'); return; }
  S.stats = d.stats || null;
  S.dueAlerts = d.dueAlerts || [];
  S.contracts = d.contracts || [];
  S.buildings = d.buildings || [];
  S.tenants = d.tenants || [];
  S.loaded = true;
  renderDashboard(); renderDashAlerts(); populateAllSelects(); renderContracts(); renderManage(); renderBuildingsTable(); populateMapSelect(); populateAdminArchiveBuildingSelect(); renderTenants(); renderTopbarAlerts_(d.topbarAlerts);
}
function loadData() {
  google.script.run
    .withSuccessHandler(applyAllData_)
    .withFailureHandler(e => toast('خطأ تحميل البيانات: '+e.message,'err'))
    .getAllData();
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
    .withSuccessHandler(applyAllData_)
    .withFailureHandler(()=>{})
    .getAllData();
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
        <div style="font-size:13px;font-weight:500">${d.tenant} — ${d.building} ${d.unit}</div>
        <div style="font-size:11px;color:#718096">${d.schedule} | استحقاق: ${d.dueDate} | ${lbl} | ${nf(d.rent)} ر.س</div>
      </div>
      ${smsButtonHtml('SMS', d.tenant, d.phone, d.rent||0, '', 'padding:3px 8px;font-size:11px')}
    </div>`;
  }).join('') + (data.length > 5 ? '<div style="text-align:center;margin-top:8px;font-size:12px;color:#718096">+' + (data.length-5) + ' استحقاق آخر</div>' : '');
}

function renderDashboard() {
  if (!S.stats) return;
  const c=S.stats.counts, f=S.stats.financials;
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
  const bc = document.getElementById('bldgCards'); bc.innerHTML='';
  Object.entries(S.stats.byBuilding).forEach(([name,d])=>{
    bc.innerHTML+=`<div class="bldg-card" style="margin-bottom:8px">
      <div class="bldg-name">${name}</div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span>مشغول: <strong style="color:var(--green)">${d.occupiedUnits}</strong> / ${d.totalUnits}</span>
        <span>فارغ: <strong style="color:var(--red)">${d.vacantUnits}</strong></span>
        <span class="badge b-${d.occupancyPct>=70?'green':d.occupancyPct>=40?'amber':'red'}">${d.occupancyPct}%</span>
      </div>
      <div class="progress"><div class="progress-fill" style="width:${d.occupancyPct}%"></div></div>
    </div>`;
  });

  // Urgent
  const ul=document.getElementById('urgentList'); ul.innerHTML='';
  if (!S.stats.urgentContracts.length) { ul.innerHTML='<div style="font-size:13px;color:#718096;padding:6px 0">لا توجد عقود عاجلة ✅</div>'; }
  S.stats.urgentContracts.forEach(c=>{
    const d=c.daysLeft, cls=d<0||d<15?'dot-r':'dot-a';
    const lbl=d<0?`انتهى منذ ${Math.abs(d)} يوم`:d===0?'ينتهي اليوم!':d+' يوم';
    ul.innerHTML+=`<div class="alert-item"><div class="dot ${cls}"></div><div>
      <div style="font-size:13px;font-weight:500">${c.tenant}</div>
      <div style="font-size:11px;color:#718096">${c.building} — شقة ${c.unit} | ${lbl}
        ${smsButtonHtml('SMS', c.tenant, c.phone, c.rent||0, 'تنبيه قرب انتهاء عقد', 'margin-right:6px;padding:2px 7px;font-size:11px')}
      </div></div></div>`;
  });

  // NoPay
  const np=document.getElementById('noPayList'); np.innerHTML='';
  if (!S.stats.noPayContracts.length) { np.innerHTML='<div style="font-size:13px;color:var(--green);padding:6px 0">✅ جميع المستأجرين سددوا</div>'; return; }
  np.innerHTML=`<div class="tbl-wrap"><table><thead><tr><th>المستأجر</th><th>المبنى</th><th>شقة</th><th>الإيجار</th><th>إجراء</th></tr></thead><tbody>
    ${S.stats.noPayContracts.map(c=>`<tr>
      <td><strong>${c.tenant}</strong></td><td>${c.building}</td><td>${c.unit}</td>
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
    <div class="metric m-blue"><div class="metric-label">نسبة الإشغال</div><div class="metric-value">${data.units.length?Math.round(occ/data.units.length*100):0}%</div></div>`;

  const grid = document.getElementById('bMapGrid'); grid.innerHTML='';
  data.units.forEach(u => {
    const _isExp=u.status==='شارف على الانتهاء'||u.status==='تشارف انتهاء';
    const cls = u.status==='مشغولة'?'unit-occ':_isExp?'unit-exp':'unit-vac';
    const lbl = u.status==='مشغولة'?'مشغولة':_isExp?'قريب انتهاء':'فارغة';
    grid.innerHTML+=`<div class="unit-cell ${cls}" onclick="showUnitDetail('${esc(u.unit)}','${esc(data.buildingName)}')">
      <div class="unit-num">${u.unit}</div>
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
      <div style="font-weight:600;font-size:14px;margin-bottom:6px">${u.tenant}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;color:#718096">
        <div>الجوال: <strong>${u.phone||'—'}</strong></div>
        <div>الإيجار: <strong>${nf(u.rent)} ر.س</strong></div>
        <div>نهاية العقد: <strong>${u.end||'—'}</strong></div>
        <div>الأيام المتبقية: <strong style="color:${u.daysLeft<0?'var(--red)':u.daysLeft<30?'var(--amber)':'var(--green)'}">${u.daysLeft!==null?u.daysLeft+' يوم':'—'}</strong></div>
        <div>النوع: <strong>${u.type||'—'}</strong></div>
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
          <div style="font-weight:500">${h.tenant}</div>
          <div style="font-size:11px;color:#718096;margin-top:3px">${h.start||'—'} ← ${h.end||'—'} | ${nf(h.rent)} ر.س | ${statusBadge(h.status)}</div>
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
    return `<tr><td><strong>${c.tenant}</strong></td><td>${c.building}</td><td>${c.unit}</td><td>${typeBadge}</td>
      <td style="font-size:12px">${c.end||'—'}</td><td style="text-align:center">${dLabel}</td>
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
    return `<tr><td><strong>${c.tenant}</strong></td>
      <td style="direction:ltr;text-align:left;font-size:12px">${c.phone||'—'}</td>
      <td>${c.building}</td><td>${c.unit}</td><td>${typeBadge}</td>
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
    <td><strong>${t.name}</strong></td>
    <td style="direction:ltr;text-align:left;font-size:12px">${t.idNo||'—'}</td>
    <td style="direction:ltr;text-align:left;font-size:12px">${t.phone||'—'}</td>
    <td style="text-align:center"><strong style="color:var(--blue)">${t.contractsCount}</strong></td>
    <td>${t.lastBuilding||'—'}</td><td>${t.lastUnit||'—'}</td>
    <td>${t.totalPaid?nf(t.totalPaid)+' ر.س':'—'}</td>
    <td>${t.regularityScore||'—'}</td>
    <td>${statusBadge(t.lastStatus)}</td>
    <td><button class="btn btn-sm btn-primary" onclick="showTenantHistory('${esc(t.name)}')">السجل</button></td>
  </tr>`).join('')||'<tr><td colspan="9" style="text-align:center;padding:20px;color:#718096">لا توجد بيانات</td></tr>';
}

function showTenantHistory(name) {
  const card=document.getElementById('tenantHistoryCard');
  document.getElementById('tenantHistoryTitle').textContent='⏳ جارٍ تحميل سجل '+name+'...';
  card.style.display='block';
  card.scrollIntoView({behavior:'smooth'});

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
              <strong>${c.building} — شقة ${c.unit}</strong>${statusBadge(c.status)}
            </div>
            <div style="font-size:11px;color:#718096;margin-top:4px">
              ${c.start||'—'} ← ${c.end||'—'} &nbsp;|&nbsp; إيجار: ${nf(c.rent)} ر.س &nbsp;|&nbsp; مدفوع: ${nf(c.paid)} ر.س &nbsp;|&nbsp; ${c.type||'سكني'}
            </div>
            ${c.regularity?`<div style="font-size:11px;color:#718096;margin-top:2px">الانتظام: ${c.regularity}</div>`:''}
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
    if (!c.building) return;
    if (!stats[c.building]) stats[c.building] = { occupied: new Set(), allUnits: new Set() };
    if (c.unit) stats[c.building].allUnits.add(String(c.unit));
    if (
    c.status === 'ساري' ||
    c.status === 'شارف على الانتهاء' ||
    c.status === 'تشارف انتهاء'
) {
      if (c.unit) stats[c.building].occupied.add(String(c.unit));
    }
  });

  tbody.innerHTML=S.buildings.map(b=>{
    const s = stats[b.name];
    const totalU = b.totalUnits > 0 ? b.totalUnits : (s ? s.allUnits.size : 0);
    const occ = s ? s.occupied.size : 0;
    const vac = Math.max(0, totalU - occ);
    const pct = totalU > 0 ? Math.round(occ / totalU * 100) : 0;
    return `<tr>
      <td><strong>${b.name}</strong></td>
      <td>${b.type==='تجاري'?'<span class="badge b-amber">تجاري</span>':b.type==='مختلط'?'<span class="badge b-navy">مختلط</span>':'<span class="badge b-blue">سكني</span>'}</td>
      <td style="text-align:center">${b.totalUnits}</td><td style="text-align:center">${b.floors}</td>
      <td style="text-align:center;color:var(--green);font-weight:500">${occ}</td>
      <td style="text-align:center;color:var(--red);font-weight:500">${vac}</td>
      <td style="text-align:center"><span class="badge b-${pct>=70?'green':pct>=40?'amber':'red'}">${pct}%</span></td>
      <td style="font-size:12px;color:#718096">${b.notes||'—'}</td>
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
    setTimeout(()=>closeModal('contractModal'),1200);
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
  google.script.run
    .withSuccessHandler(r=>{
      if(r.error){toast('❌ '+r.error,'err');return;}
      document.getElementById('payResult').innerHTML=`<div class="result">✅ سُجّلت ${nf(amt)} ر.س | متبقي: ${nf(r.remaining)} ر.س</div>`;
      document.getElementById('payAmount').value='';
      toast('✅ تم تسجيل الدفعة'); silentRefresh(); loadContractPaymentHistory(row);
    })
    .withFailureHandler(e=>toast('خطأ: '+e.message,'err'))
    .addPayment(row,amt);
}

function loadContractPaymentHistory(row) {
  const box = document.getElementById('payHistory');
  if (!box) return;
  box.innerHTML = '<div style="padding:8px;color:#718096">جارٍ التحميل...</div>';
  // إذا لم يستجب الخادم خلال 15 ثانية، أظهر خيار إعادة المحاولة
  const uiTimer = setTimeout(() => {
    if (box.querySelector && box.innerHTML.includes('جارٍ التحميل')) {
      box.innerHTML = `<div class="result err">استغرق التحميل وقتاً طويلاً. <button class="btn btn-sm" onclick="loadContractPaymentHistory(${parseInt(row)})">إعادة المحاولة</button></div>`;
    }
  }, 15000);
  google.script.run
    .withSuccessHandler(rows=>{
      clearTimeout(uiTimer);
      rows = rows || [];
      if(!rows.length){ box.innerHTML = '<div style="padding:8px;color:#718096">لا توجد دفعات مسجلة لهذا العقد</div>'; return; }
      box.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>التاريخ</th><th>المستخدم</th><th>المبلغ</th><th>قبل</th><th>بعد</th><th>المتبقي</th><th>ملاحظات</th></tr></thead><tbody>${rows.map(p=>`<tr><td style="font-size:11px;white-space:nowrap">${escHtml(p.date)}</td><td>${escHtml(p.username)}</td><td style="font-weight:600;direction:ltr;text-align:left">${nf(p.amount)}</td><td>${nf(p.before)}</td><td>${nf(p.after)}</td><td>${nf(p.remaining)}</td><td style="font-size:12px">${escHtml(p.notes)||'—'}</td></tr>`).join('')}</tbody></table></div>`;
    })
    .withFailureHandler(e=>{ clearTimeout(uiTimer); box.innerHTML = '<div class="result err">خطأ في تحميل سجل الدفعات: '+escHtml(e.message)+'</div>'; })
    .getContractPaymentHistory(row);
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
    setTimeout(()=>closeModal('buildingModal'),1200);
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
  const cb=r=>{btn.disabled=false;btn.textContent='📤 إرسال';document.getElementById('smsResult').innerHTML=`<div class="result">✅ أُرسلت: ${r.sent} | ❌ فشل: ${r.failed||0}</div>`;toast(`✅ أُرسلت ${r.sent} رسالة`);};
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
  const cb=r=>{btn.disabled=false;btn.textContent=btn.textContent.replace('جارٍ الإرسال...','');toast(`✅ أُرسلت ${r.sent} رسالة`);};
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
  google.script.run
    .withSuccessHandler(r=>{document.getElementById('singleResult').innerHTML=`<div class="result ${r.success?'':'err'}">${r.success?'✅ أُرسلت':'❌ فشل'}</div>`;})
    .withFailureHandler(e=>toast('خطأ: '+e.message,'err')).sendSingleSms(p,m);
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
function loadLog(){
  google.script.run
    .withSuccessHandler(rows=>{
      const tbody=document.getElementById('logBody');
      if(!rows.length){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:20px;color:#718096">لا توجد رسائل</td></tr>';return;}
      tbody.innerHTML=rows.map(r=>`<tr><td style="font-size:12px;white-space:nowrap">${r.date}</td><td><strong>${r.name||'—'}</strong></td><td style="direction:ltr;text-align:left;font-size:12px">${r.phone||'—'}</td><td>${r.building||'—'}</td><td style="font-size:12px;max-width:240px">${r.message}</td><td>${r.status}</td></tr>`).join('');
    })
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
    .withSuccessHandler(renderAlerts)
    .withFailureHandler(e => {
      document.getElementById('alertsList').innerHTML = `<div style="text-align:center;padding:20px;color:var(--red)">خطأ: ${e.message}</div>`;
    })
    .getUpcomingDueDates(days);
}

function renderAlerts(data) {
  const list = document.getElementById('alertsList');
  const metrics = document.getElementById('alertsMetrics');
  if (!data || !data.length) {
    metrics.style.display = 'none';
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--green)">✅ لا توجد استحقاقات قريبة</div>';
    return;
  }

  // إحصائيات سريعة
  const overdue  = data.filter(d => d.urgency === 'overdue').length;
  const critical = data.filter(d => d.urgency === 'critical').length;
  const soon     = data.filter(d => d.urgency === 'soon').length;
  const upcoming = data.filter(d => d.urgency === 'upcoming').length;
  metrics.style.display = 'grid';
  document.getElementById('aOverdue').textContent  = overdue;
  document.getElementById('aCritical').textContent = critical;
  document.getElementById('aSoon').textContent     = soon;
  document.getElementById('aUpcoming').textContent = upcoming;

  list.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr>
      <th>الاستعجال</th><th>المستأجر</th><th>المبنى</th><th>وحدة</th>
      <th>الجدولة</th><th>تاريخ الاستحقاق</th><th>الأيام</th><th>الإيجار</th><th>إجراء</th>
    </tr></thead>
    <tbody>${data.map(d => {
      const map = {
        'overdue':  ['<span class="badge b-red">متأخرة</span>',     'var(--red)'],
        'critical': ['<span class="badge b-red">عاجل</span>',        'var(--red)'],
        'soon':     ['<span class="badge b-amber">قريبة</span>',     'var(--amber)'],
        'upcoming': ['<span class="badge b-blue">قادمة</span>',      'var(--blue)']
      };
      const [badge, color] = map[d.urgency] || ['', ''];
      const daysLbl = d.daysUntil < 0 ? `متأخر ${Math.abs(d.daysUntil)} يوم` :
                      d.daysUntil === 0 ? 'اليوم!' :
                      `${d.daysUntil} يوم`;
      return `<tr>
        <td>${badge}</td>
        <td><strong>${d.tenant}</strong></td>
        <td>${d.building}</td><td>${d.unit}</td>
        <td><span style="font-size:12px;color:#718096">${d.schedule||'—'}</span></td>
        <td style="font-size:13px;font-weight:500">${d.dueDate}</td>
        <td style="color:${color};font-weight:600">${daysLbl}</td>
        <td>${nf(d.rent)} ر.س</td>
        <td>${smsButtonHtml('SMS', d.tenant, d.phone, d.rent||0, 'استحقاق دفعة قادمة')}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
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
    document.getElementById('smsCustomCount').textContent = this.value.length + ' حرف';
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
        document.getElementById('smsCustomCount').textContent = r.text.length + ' حرف';
      })
      .withFailureHandler(e => { ta.value = ''; toast('خطأ: '+e.message, 'err'); })
      .askAI(`اكتب رسالة SMS مخصصة قصيرة (أقل من 155 حرف) للمستأجر ${c.name}. ${c.situation||'موضوع عام عن الإيجار'}. اكتب الرسالة فقط.`, '');
  }
  document.getElementById('smsCustomCount').textContent = ta.value.length + ' حرف';
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
  google.script.run
    .withSuccessHandler(renderFinance)
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
      <td><strong>${b.label}</strong></td><td>${b.count}</td><td>${nf(b.amount)} ر.س</td>
      <td style="font-size:11px;color:#718096">${(b.items||[]).slice(0,3).map(i=>`${i.tenant} (${i.age} يوم)`).join('، ') || '—'}</td>
    </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:#718096">لا توجد متأخرات مصنفة</td></tr>';
  }

  document.getElementById('fin-bldg-body').innerHTML = data.byBuilding.map(b => {
    const color = b.collectRate >= 80 ? 'var(--green)' : b.collectRate >= 50 ? 'var(--amber)' : 'var(--red)';
    return `<tr>
      <td><strong>${b.name}</strong></td>
      <td style="text-align:center">${b.contracts}</td>
      <td>${nf(b.rent)}</td>
      <td style="color:var(--green)">${nf(b.paid)}</td>
      <td style="color:var(--red)">${nf(b.remaining)}</td>
      <td style="color:${color};font-weight:500">${b.collectRate}%</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:#718096">لا توجد بيانات</td></tr>';

  // أعلى المستأجرين
  document.getElementById('fin-top-body').innerHTML = data.topTenants.map((t, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1);
    return `<tr>
      <td style="text-align:center">${medal}</td>
      <td><strong>${t.name}</strong></td>
      <td style="text-align:center">${t.contracts}</td>
      <td>${nf(t.rent)} ر.س</td>
      <td style="color:var(--green);font-weight:500">${nf(t.paid)} ر.س</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:#718096">لا توجد بيانات</td></tr>';
}


// ═══════════════════════════════════════════════
// تسجيل الدخول والصلاحيات
// ═══════════════════════════════════════════════
let _currentUser = null;

function checkSession() {
  google.script.run
    .withSuccessHandler(r => {
      if (r && r.loggedIn) {
        _currentUser = r;
        showMainUI();
        if (r.warning) toast(r.warning, 'err');
      } else {
        showLoginScreen();
      }
    })
    .withFailureHandler(() => showLoginScreen())
    .whoami();
}

function showLoginScreen() {
  const overlay = document.getElementById('loginOverlay');
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  setTimeout(() => document.getElementById('loginUsername').focus(), 100);
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
  google.script.run
    .withSuccessHandler(r => {
      btn.disabled = false; btn.textContent = 'تسجيل الدخول';
      if (r.success) {
        _currentUser = r.user;
        document.getElementById('loginPassword').value = '';
        showMainUI();
      } else {
        errEl.textContent = r.error || 'فشل تسجيل الدخول';
        errEl.style.display = 'block';
      }
    })
    .withFailureHandler(e => {
      btn.disabled = false; btn.textContent = 'تسجيل الدخول';
      errEl.textContent = 'خطأ: ' + e.message;
      errEl.style.display = 'block';
    })
    .login(username, password);
}


function resetClientStateAfterLogout() {
  _currentUser = null;
  S = { contracts:[], buildings:[], tenants:[], stats:null, loaded:false, dueAlerts:[] };

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
  google.script.run.withSuccessHandler(()=>{}).withFailureHandler(()=>{}).logout();
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
  google.script.run
    .withSuccessHandler(d => { _allUsers = d || []; renderUsers(); })
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
    <td><strong>${u.username}</strong></td>
    <td>${u.name || '—'}</td>
    <td>${roleLabels[u.role] || u.role}</td>
    <td style="font-size:12px">${u.email || '—'}</td>
    <td>${u.active ? '<span class="badge b-green">نشط</span>' : '<span class="badge b-gray">معطّل</span>'}</td>
    <td style="font-size:11px;color:#718096">${u.lastLogin || '—'}</td>
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
    setTimeout(() => { closeModal('userModal'); loadUsers(); }, 1200);
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
      toast('✅ تم الحذف'); loadUsers();
    })
    .deleteUser(rowNum);
}

// ═══════════════════════════════════════════════
// سجل العمليات
// ═══════════════════════════════════════════════
function loadActivity() {
  document.getElementById('activityBody').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#718096">جارٍ التحميل...</td></tr>';
  google.script.run
    .withSuccessHandler(renderActivity)
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
    '<td style="font-size:11px;color:#718096;white-space:nowrap">' + a.time + '</td>' +
    '<td><strong>' + a.username + '</strong></td>' +
    '<td><span style="color:' + (actionColors[a.action]||'#718096') + ';font-weight:500">' + a.action + '</span></td>' +
    '<td style="font-size:12px">' + a.entity + '</td>' +
    '<td style="font-size:12px">' + a.details + '</td>' +
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
      document.getElementById('bkResult').innerHTML = '<div class="result err">' + r.error + '</div>';
    } else {
      document.getElementById('bkResult').innerHTML = '<div class="result">✅ ' + r.message + '</div>';
      loadBackup();
    }
  };
  if (isOn) {
    google.script.run.withSuccessHandler(handler).disableDailyBackup();
  } else {
    google.script.run.withSuccessHandler(handler).setupDailyBackup();
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
function nf(n){ var x=Number(n||0); return x?Math.round(x).toLocaleString('ar-SA'):'—'; }

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
  const tbody = document.getElementById('maintenanceBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:#718096">جارٍ التحميل...</td></tr>';
  google.script.run
    .withSuccessHandler(renderMaintenance)
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
    <td style="font-size:11px;color:#718096;white-space:nowrap">${r.date || '—'}</td>
    <td>${r.building || '—'}</td>
    <td style="text-align:center">${r.unit || '—'}</td>
    <td style="font-size:12px">${r.tenant || '—'}</td>
    <td><span class="badge b-navy" style="font-size:11px">${r.category || '—'}</span></td>
    <td><span class="badge ${priCls[r.priority] || 'b-gray'}" style="font-size:11px">${r.priority || '—'}</span></td>
    <td style="font-size:12px;max-width:200px;word-break:break-word">${escHtml(r.description || '—')}</td>
    <td style="font-size:12px">${r.contractor || '—'}</td>
    <td style="font-size:12px">${r.actualCost ? nf(r.actualCost) + ' ر.س' : '—'}</td>
    <td><span class="badge ${statusCls[r.status] || 'b-gray'}">${r.status || '—'}</span></td>
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
  document.getElementById('mntModalTitle').textContent = mode === 'add' ? '🔧 إضافة طلب صيانة' : '✏️ تعديل طلب صيانة';
  document.getElementById('mntEditRow').value    = rowNum || '';
  document.getElementById('mntModalResult').innerHTML = '';

  ['mnt-unit','mnt-tenant','mnt-contractor','mnt-contractor-phone','mnt-actual-cost','mnt-description','mnt-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });

  const bsel = document.getElementById('mnt-building');
  bsel.innerHTML = '<option value="">اختر مبنى...</option>';
  S.buildings.forEach(b => { const o = document.createElement('option'); o.value = o.text = b.name; bsel.add(o); });

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
    setTimeout(() => { closeModal('maintenanceModal'); loadMaintenance(); }, 900);
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
      toast('✅ تم الحذف'); loadMaintenance();
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

  const originalApply = window.applyAllData_;
  const originalLoadData = window.loadData;

  if (typeof originalApply === "function") {

    window.applyAllData_ = function (data) {

      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            time: Date.now(),
            data: data
          })
        );
      } catch (e) {}

      return originalApply(data);
    };

  }

  const CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 دقيقة

  window.loadData = function () {

    try {

      const cached = localStorage.getItem(CACHE_KEY);

      if (cached) {

        const obj = JSON.parse(cached);
        const age = Date.now() - (obj.time || 0);

        if (obj && obj.data && age < CACHE_MAX_AGE_MS) {

          console.log("Using cached data (age: " + Math.round(age/1000) + "s)");

          originalApply(obj.data);
        } else if (age >= CACHE_MAX_AGE_MS) {
          localStorage.removeItem(CACHE_KEY);
          console.log("Cache expired, fetching fresh data");
        }
      }

    } catch (e) {
      console.log(e);
    }

    return originalLoadData();
  };

})();
