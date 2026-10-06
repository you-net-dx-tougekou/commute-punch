/** 打刻ページの、画面に依存しない処理(Nodeでテストする) */
(function (root) {
  // gas/Config.js の MAX_ACCURACY_M と同じ値(公開する場所が別なので、ここでも持つ)
  var MAX_ACCURACY_M = 200;
  var SECRET_RE = '([0-9a-f]{64})(?:&|$)';

  function tokenFromHash(hash) {
    var m = new RegExp('(?:^#|&)t=' + SECRET_RE).exec(hash || '');
    return m ? m[1] : null;
  }

  function regCodeFromSearch(search) {
    var m = new RegExp('[?&]reg=' + SECRET_RE).exec(search || '');
    return m ? m[1] : null;
  }

  // iPhoneはSafariとホーム画面アプリで保存領域が別なので、URLに入っている値を優先する
  function resolveToken(hash, stored) {
    return tokenFromHash(hash) || stored || null;
  }

  function deviceKind(ua) {
    if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone';
    if (/Android/.test(ua)) return 'Android';
    return 'その他';
  }

  function needsRetry(accuracy) {
    return !(accuracy <= MAX_ACCURACY_M);
  }

  function geoErrorMessage(code) {
    if (code === 1) return '位置情報の利用が許可されていません。設定で位置情報をオンにし、このページに許可してから、もう一度押してください。';
    if (code === 3) return '位置の取得に時間がかかっています。窓の近くなどで、もう一度押してください。';
    return '位置情報を取得できません。位置情報がオンになっているか確認して、もう一度押してください。';
  }

  function resultView(res, typeLabel) {
    if (!res.ok) return { tone: 'error', title: '記録できませんでした', detail: res.message };
    var title = typeLabel + 'を記録しました ' + res.time;
    if (res.status === '範囲内') return { tone: 'ok', title: title, detail: res.placeName };
    return { tone: 'warn', title: title, detail: '校舎の範囲外のため、先生の確認待ちになりました。' };
  }

  // 送り直しても二重に処理されないよう、ボタン1回ごとに付ける受付番号(16バイト = 32文字の16進)
  function requestIdFrom(bytes) {
    return Array.prototype.map.call(bytes, function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  }

  // attempt() が失敗したら delays の順に待って送り直す(合計 delays.length + 1 回)。wait(ms) は待つ処理
  function retrying(attempt, delays, wait) {
    function run(i) {
      return attempt().catch(function (err) {
        if (i >= delays.length) throw err;
        return wait(delays[i]).then(function () { return run(i + 1); });
      });
    }
    return run(0);
  }

  var api = { tokenFromHash: tokenFromHash, regCodeFromSearch: regCodeFromSearch, resolveToken: resolveToken,
    deviceKind: deviceKind, needsRetry: needsRetry, geoErrorMessage: geoErrorMessage, resultView: resultView,
    requestIdFrom: requestIdFrom, retrying: retrying };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PunchLib = api;
})(this);
