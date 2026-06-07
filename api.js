(function(){
  function callApi(action, args, ok, fail){
    var apiUrl = window.AMLAK_API_URL;
    var token = localStorage.getItem('AMLAAK_TOKEN') || '';

    var cbName = '__amlak_cb_' + Date.now() + '_' + Math.floor(Math.random()*100000);
    var script = document.createElement('script');

    var payload = encodeURIComponent(JSON.stringify({
      action: action,
      args: args || [],
      token: token
    }));

    function cleanup(){
      clearTimeout(timeoutTimer);
      clearTimeout(warnTimer);
      try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    // تحذير مرئي بعد 15 ثانية
    var warnTimer = setTimeout(function(){
      if (typeof window.toast === 'function') window.toast('الاتصال بطيء، يُرجى الانتظار…', '');
    }, 15000);

    // إلغاء الطلب وإظهار خطأ بعد 60 ثانية
    var timeoutTimer = setTimeout(function(){
      cleanup();
      if (fail) fail(new Error('انتهت مهلة الاتصال بالـ API'));
    }, 60000);

    window[cbName] = function(res){
      cleanup();

      if (res && res.__error) {
        if (fail) fail(new Error(res.__error));
        return;
      }

      if (action === 'login' && res && res.token) {
        localStorage.setItem('AMLAAK_TOKEN', res.token);
      }

      if (action === 'logout') {
        localStorage.removeItem('AMLAAK_TOKEN');
      }

      if (ok) ok(res);
    };

    script.onerror = function(){
      cleanup();
      if (fail) fail(new Error('تعذر الاتصال بالـ API'));
    };

    script.src = apiUrl + '?callback=' + encodeURIComponent(cbName) +
      '&payload=' + payload +
      '&_=' + Date.now();

    document.head.appendChild(script);
  }

  function Runner(success, failure){
    this._success = success || null;
    this._failure = failure || null;
  }

  Runner.prototype.withSuccessHandler = function(fn){
    return new Runner(fn, this._failure);
  };

  Runner.prototype.withFailureHandler = function(fn){
    return new Runner(this._success, fn);
  };

  var runnerProxy = new Proxy(new Runner(), {
    get: function(target, prop){
      if (prop in target) return target[prop].bind(target);
      return function(){
        callApi(String(prop), Array.prototype.slice.call(arguments), target._success, target._failure);
      };
    }
  });

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = runnerProxy;
})();
