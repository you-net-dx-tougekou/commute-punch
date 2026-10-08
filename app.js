/** 打刻ページの画面制御 */
(function () {
  var lib = window.PunchLib;
  var TOKEN_KEY = 'punchToken';
  var GEO_OPTIONS = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
  var RETRY_DELAYS_MS = [500, 1000, 2000]; // 送り直しの間隔(最大4回送る)
  var NETWORK_ERROR ='通信できませんでした。電波の良い場所で、もう一度やり直してください。';
  var VIEWS = ['view-register', 'view-guide', 'view-punch', 'view-unregistered', 'view-result'];
  var $ = function (id) { return document.getElementById(id); };

  function show(id) {
    VIEWS.forEach(function (v) { $(v).hidden = v !== id; });
  }
  function setBusy(on) {
    $('busy').hidden = !on;
    Array.prototype.forEach.call(document.querySelectorAll('button'), function (b) { b.disabled = on; });
  }
  // プライベートブラウズなどで localStorage が使えなくても止まらないようにする
  function loadToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function saveToken(token) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* URLの #t= で代用できる */ }
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Googleが結果を返す段階でときどき失敗するので、同じ受付番号で送り直す
  // (Apps Script側は同じ受付番号を二重に処理せず、前回の結果を返す)
  function post(payload) {
    var body = JSON.stringify(Object.assign({}, payload, {
      requestId: lib.requestIdFrom(crypto.getRandomValues(new Uint8Array(16))),
    }));
    return lib.retrying(function () {
      return fetch(window.PUNCH_CONFIG.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // CORSの事前確認を起こさない単純なリクエストにする
        body: body,
      }).then(function (r) { return r.json(); });
    }, RETRY_DELAYS_MS, wait);
  }

  function showResult(view, canGoBack) {
    $('result-box').className = 'result ' + view.tone;
    $('result-title').textContent = view.title;
    $('result-detail').textContent = view.detail;
    $('btn-back').hidden = !canGoBack;
    show('view-result');
  }
  function showError(title, detail, canGoBack) {
    showResult({ tone: 'error', title: title, detail: detail }, canGoBack);
  }

  function getPosition() {
    return new Promise(function (resolve, reject) {
      navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
    });
  }
  // 誤差が大きいときは1回だけ測り直す。それでも大きければそのまま送る(サーバー側で確認待ちになる)
  function measure() {
    return getPosition().then(function (pos) {
      return lib.needsRetry(pos.coords.accuracy) ? getPosition() : pos;
    });
  }

  function punch(type, label, token) {
    if (!navigator.geolocation) { showError('記録できませんでした', lib.geoErrorMessage(2), true); return; }
    setBusy(true);
    measure().then(function (pos) {
      return post({
        action: 'punch', token: token, type: type, lat: pos.coords.latitude, lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy, device: lib.deviceKind(navigator.userAgent),
      }).then(function (res) {
        showResult(lib.resultView(res, label), true);
      }, function () {
        showError('記録できませんでした', NETWORK_ERROR, true);
      });
    }, function (err) {
      showError('記録できませんでした', lib.geoErrorMessage(err.code), true);
    }).then(function () { setBusy(false); });
  }

  function tickClock() {
    var c = lib.formatClock(new Date());
    $('clock-date').textContent = c.date;
    $('clock-time').textContent = c.time;
  }

  function setGps(state) {
    var v = lib.gpsStatusView(state);
    $('gps').textContent = v.text;
    $('gps').className = 'gps ' + v.tone;
  }

  function startPunch(token) {
    $('btn-in').onclick = function () { punch('in', '登校', token); };
    $('btn-out').onclick = function () { punch('out', '下校', token); };
    $('btn-back').onclick = function () { show('view-punch'); };
    show('view-punch');

    // 時計(秒ごとに更新)
    tickClock();
    if (!startPunch.clockTimer) startPunch.clockTimer = setInterval(tickClock, 1000);

    // 位置情報の状態を常時表示(打刻前にGPSを温めておく役割も兼ねる)
    setGps({ kind: 'checking' });
    if (navigator.geolocation) {
      if (startPunch.geoWatch != null) navigator.geolocation.clearWatch(startPunch.geoWatch);
      startPunch.geoWatch = navigator.geolocation.watchPosition(
        function (pos) { setGps({ kind: 'ok', accuracy: pos.coords.accuracy }); },
        function () { setGps({ kind: 'error' }); },
        GEO_OPTIONS,
      );
    } else {
      setGps({ kind: 'error' });
    }

    // 校舎と登録者名はトークンでサーバーに問い合わせる(ホーム画面から開くと名前が分からないため)
    post({ action: 'info', token: token }).then(function (res) {
      if (res && res.ok) {
        $('campus').textContent = res.campus || '';
        $('punch-name').textContent = res.name || '';
      }
    }, function () { /* 取れなくても打刻はできる。名前は空のまま */ });
  }

  function completeRegistration(code) {
    setBusy(true);
    post({ action: 'register', code: code, device: lib.deviceKind(navigator.userAgent) }).then(function (res) {
      setBusy(false);
      if (!res.ok) { showResult(lib.resultView(res, ''), false); return; }
      saveToken(res.token);
      // 登録コードをURLから消し、端末トークンを #t= に入れる(このURLがホーム画面に追加される)
      history.replaceState(null, '', location.pathname + '#t=' + res.token);
      $('btn-guide-done').onclick = function () { startPunch(res.token); };
      show('view-guide');
    }, function () {
      setBusy(false);
      showError('登録できませんでした', NETWORK_ERROR, false);
    });
  }

  function startRegister(code) {
    setBusy(true);
    post({ action: 'preview', code: code }).then(function (res) {
      setBusy(false);
      if (!res.ok) { showResult(lib.resultView(res, ''), false); return; }
      $('register-name').textContent = res.name + ' さんとして登録しますか？';
      $('btn-register').onclick = function () { completeRegistration(code); };
      show('view-register');
    }, function () {
      setBusy(false);
      showError('読み込めませんでした', NETWORK_ERROR, false);
    });
  }

  var code = lib.regCodeFromSearch(location.search);
  if (code) { startRegister(code); return; }
  var token = lib.resolveToken(location.hash, loadToken());
  if (!token) { show('view-unregistered'); return; }
  saveToken(token);
  startPunch(token);
})();
