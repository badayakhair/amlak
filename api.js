(function () {
  function callApi(action, args, ok, fail) {
    var apiUrl = window.AMLAK_API_URL;
    var token = localStorage.getItem('AMLAAK_TOKEN') || '';

    if (!apiUrl) {
      if (fail) fail(new Error('API URL غير موجود في config.js'));
      return;
    }

    var cbName = '__amlak_cb_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    var script = document.createElement('script');

    var payload = encodeURIComponent(JSON.stringify({
      action: action,
      args: args || [],
      token: token
    }));

    // تحذير مرئي بعد 15 ثانية
    var warnTimer = setTimeout(function () {
      if (typeof window.toast === 'function') window.toast('الاتصال بطيء، يُرجى الانتظار…', '');
    }, 15000);

    // إلغاء الطلب وإظهار خطأ بعد 60 ثانية
    var timeoutTimer = setTimeout(function () {
      cleanup();
      if (fail) fail(new Error('انتهت مهلة الاتصال بالـ API'));
    }, 60000);

    function cleanup() {
      clearTimeout(timeoutTimer);
      clearTimeout(warnTimer);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (res) {
      cleanup();

      if (res && res.__error) {
        if (fail) fail(new Error(res.__error));
        return;
      }

      if (action === 'login' && res && res.token) {
        localStorage.setItem('AMLAAK_TOKEN', res.token);
      }

      if (action === 'logout') {
        // احذف التوكن فقط إذا لم يتغيّر منذ إرسال الطلب
        // (يمنع حذف توكن مستخدم جديد سجّل دخوله قبل وصول رد الخروج)
        if (token && localStorage.getItem('AMLAAK_TOKEN') === token) {
          localStorage.removeItem('AMLAAK_TOKEN');
        } else if (!token) {
          localStorage.removeItem('AMLAAK_TOKEN');
        }
      }

      if (ok) ok(res);
    };

    script.onerror = function () {
      cleanup();
      if (fail) fail(new Error('تعذر الاتصال بالـ API'));
    };

    script.src =
      apiUrl +
      '?callback=' + encodeURIComponent(cbName) +
      '&payload=' + payload +
      '&_=' + Date.now();

    document.head.appendChild(script);
  }

  function makeRunner(successHandler, failureHandler) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') {
          return function (fn) {
            return makeRunner(fn, failureHandler);
          };
        }

        if (prop === 'withFailureHandler') {
          return function (fn) {
            return makeRunner(successHandler, fn);
          };
        }

        return function () {
          var args = Array.prototype.slice.call(arguments);
          callApi(String(prop), args, successHandler, failureHandler);
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = makeRunner(null, null);
})();
