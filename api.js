/*
  Google Apps Script compatibility layer for GitHub Pages.
  It lets the existing UI keep using google.script.run.withSuccessHandler(...).functionName(...)
  while the real calls go to Apps Script Web App API.
*/
(function(){
  function callApi(action, args, ok, fail){
    var apiUrl = window.AMLAK_API_URL;
    if (!apiUrl || apiUrl.indexOf('PASTE_') === 0) {
      var err = new Error('لم يتم ضبط رابط API في config.js');
      if (fail) return fail(err);
      console.error(err);
      return;
    }

    // JSONP avoids browser CORS issues with Apps Script Web Apps on static hosting.
    var cbName = '__amlak_cb_' + Date.now() + '_' + Math.floor(Math.random()*100000);
    var script = document.createElement('script');
    var payload = encodeURIComponent(JSON.stringify({ action: action, args: args || [] }));
    var timer = setTimeout(function(){
      cleanup();
      if (fail) fail(new Error('انتهت مهلة الاتصال بالـ API'));
    }, 60000);

    function cleanup(){
      clearTimeout(timer);
      try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function(res){
      cleanup();
      if (res && res.__error) {
        if (fail) return fail(new Error(res.__error));
        console.error(res.__error);
        return;
      }
      if (ok) ok(res);
    };

    script.onerror = function(){
      cleanup();
      if (fail) fail(new Error('تعذر الاتصال بالـ API'));
    };
    script.src = apiUrl + '?callback=' + encodeURIComponent(cbName) + '&payload=' + payload + '&_=' + Date.now();
    document.head.appendChild(script);
  }

  function Runner(success, failure){
    this._success = success || null;
    this._failure = failure || null;
  }
  Runner.prototype.withSuccessHandler = function(fn){ return new Runner(fn, this._failure); };
  Runner.prototype.withFailureHandler = function(fn){ return new Runner(this._success, fn); };

  var runnerProxy = new Proxy(new Runner(), {
    get: function(target, prop){
      if (prop in target) return target[prop].bind(target);
      return function(){
        var args = Array.prototype.slice.call(arguments);
        callApi(String(prop), args, target._success, target._failure);
      };
    }
  });

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = runnerProxy;
})();
