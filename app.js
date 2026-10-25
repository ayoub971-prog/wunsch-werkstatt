/* Wunsch-Werkstatt: Wunsch -> Gratis-KI baut eine HTML-App. Schluessel nur im Browser (localStorage). */
var APP_VERSION = 'v2';
var $ = function (id) { return document.getElementById(id); };
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

/* ---------- Anbieter ---------- */
var PROVIDERS = {
  gemini: { name: 'Google Gemini', link: 'https://aistudio.google.com/apikey', hint: 'Mit Google-Konto anmelden, „Create API key“.' },
  groq: { name: 'Groq', link: 'https://console.groq.com/keys', base: 'https://api.groq.com/openai/v1', hint: 'Gratis-Konto, dann „Create API Key“.' },
  mistral: { name: 'Mistral', link: 'https://console.mistral.ai/api-keys', base: 'https://api.mistral.ai/v1', hint: 'Gratis-Plan „Experiment“ wählen, dann Schlüssel erstellen.' },
  openrouter: { name: 'OpenRouter (optional)', link: 'https://openrouter.ai/keys', base: 'https://openrouter.ai/api/v1', hint: 'Nur Modelle mit „:free“ sind gratis.' }
};
var DEFAULT_CHAIN = [
  { provider: 'gemini', model: 'gemini-flash-latest' }, { provider: 'gemini', model: 'gemini-flash-lite-latest' },
  { provider: 'groq', model: 'llama-3.3-70b-versatile' }, { provider: 'groq', model: 'openai/gpt-oss-120b' },
  { provider: 'mistral', model: 'mistral-small-latest' }, { provider: 'mistral', model: 'codestral-latest' },
  { provider: 'openrouter', model: 'openrouter/free' }
];
var CHAIN = DEFAULT_CHAIN.slice();
var COOL = {};   // "provider/model" -> Zeitpunkt, bis wann pausiert (nach 429)
function keyOf(p) { return (lsGet('ww.key.' + p) || '').trim(); }

function loadModels() {
  return fetch('models.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (j && Array.isArray(j.chain)) {
      var c = j.chain.filter(function (x) { return x && PROVIDERS[x.provider] && typeof x.model === 'string' && x.model; });
      if (c.length) CHAIN = c;
    }
  }).catch(function () {}).then(renderChain);
}

var TIMEOUT = 90000;
function httpErr(status, msg) { var e = new Error(msg || ('HTTP ' + status)); e.status = status; return e; }
function callOne(item, system, user) {
  var p = item.provider, key = keyOf(p), ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, TIMEOUT);
  var req;
  if (p === 'gemini') {
    req = fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(item.model) + ':generateContent', {
      method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.4 } })
    });
  } else {
    req = fetch(PROVIDERS[p].base + '/chat/completions', {
      method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: item.model, temperature: 0.4, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
    });
  }
  return req.then(function (r) {
    clearTimeout(t);
    if (!r.ok) return r.text().then(function (b) { throw httpErr(r.status, 'HTTP ' + r.status + ' ' + b.slice(0, 160)); });
    return r.json();
  }, function (e) { clearTimeout(t); var x = new Error('Netzwerk/Zeitüberschreitung'); x.status = 0; throw x; }).then(function (j) {
    var txt = p === 'gemini'
      ? (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(function (x) { return x.text || ''; }).join('')
      : (((j.choices || [])[0] || {}).message || {}).content || '';
    if (!txt) throw httpErr(502, 'Leere Antwort');
    return txt;
  });
}
var lastLabel = '';
/* Fallback-Kette: bei 429, 5xx, Netzwerk- oder Schluesselfehler -> naechstes Modell */
function callChain(system, user, onSwitch) {
  var list = CHAIN.filter(function (x) { return keyOf(x.provider); });
  if (!list.length) return Promise.reject(new Error('NOKEY'));
  var now = Date.now(), ready = list.filter(function (x) { return !(COOL[x.provider + '/' + x.model] > now); });
  if (!ready.length) ready = list;
  var i = 0, fails = [];
  function next() {
    if (i >= ready.length) { var e = new Error('ALLFAIL'); e.fails = fails; return Promise.reject(e); }
    var item = ready[i++], label = PROVIDERS[item.provider].name.replace(' (optional)', '') + ' · ' + item.model;
    return callOne(item, system, user).then(function (txt) {
      if (onSwitch && (fails.length || (lastLabel && lastLabel !== label))) onSwitch(label, fails);
      lastLabel = label; return { text: txt, label: label };
    }, function (e) {
      var s = e.status || 0;
      if (s === 429) COOL[item.provider + '/' + item.model] = Date.now() + 60000;
      fails.push(label + ': ' + (s === 429 ? 'Limit erreicht' : s >= 500 ? 'Server-Fehler' : s === 0 ? 'keine Verbindung' : (s === 401 || s === 403) ? 'Zugang ungültig' : e.message));
      return next();
    });
  }
  return next();
}

/* ---------- Datenschutz-Filter ---------- */
var SECRET_RES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAIza[0-9A-Za-z_\-]{20,}/g, /\bgsk_[0-9A-Za-z]{20,}/g, /\bsk-(?:or-|proj-|ant-)?[0-9A-Za-z_\-]{16,}/g,
  /\bgh[pousr]_[0-9A-Za-z]{20,}/g, /\bgithub_pat_[0-9A-Za-z_]{20,}/g, /\bxox[abpr]-[0-9A-Za-z\-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, /\beyJ[0-9A-Za-z_\-]{10,}\.[0-9A-Za-z_\-]{10,}\.[0-9A-Za-z_\-]{10,}/g,
  /\bBearer\s+[0-9A-Za-z._\-]{16,}/gi,
  /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g
];
var PW_RE = /((?:passwor[dt]|passwd|pwd|kennwort|pin|api[_\- ]?key|token|secret|schlüssel)\s*[:=]\s*)(\S+)/gi;
function sanitize(text) {
  var n = 0, out = String(text);
  Object.keys(PROVIDERS).forEach(function (p) { var k = keyOf(p); if (k && k.length > 8) out = out.split(k).join(function () { n++; return '[REDACTED_SECRET]'; }()); });
  SECRET_RES.forEach(function (re) { out = out.replace(re, function () { n++; return '[REDACTED_SECRET]'; }); });
  out = out.replace(PW_RE, function (m, a, b) { if (b === '[REDACTED_SECRET]') return m; n++; return a + '[REDACTED_SECRET]'; });
  return { text: out, count: n };
}

/* ---------- Qualitaets-Pruefung ---------- */
function extractHtml(txt) {
  var m = txt.match(/```(?:html|HTML)?\s*\n([\s\S]*?)```/);
  var code = m ? m[1] : txt;
  var s = code.search(/<!doctype html|<html/i);
  if (s > 0) code = code.slice(s);
  var e = code.toLowerCase().lastIndexOf('</html>');
  if (e > -1) code = code.slice(0, e + 7);
  return code.trim();
}
var CATCHER = '<script>(function(){var T="__TOK__";function s(m){try{parent.postMessage({ww:T,err:String(m).slice(0,300)},"*")}catch(e){}}' +
  'window.addEventListener("error",function(e){s((e.message||"Fehler")+(e.lineno?" (Zeile "+e.lineno+")":""))},true);' +
  'window.addEventListener("unhandledrejection",function(e){s("Promise: "+(e.reason&&e.reason.message||e.reason))});' +
  'window.alert=function(){};window.confirm=function(){return true};window.prompt=function(){return ""};})();<\/script>';
function inject(code, snippet) {
  if (/<head[^>]*>/i.test(code)) return code.replace(/<head[^>]*>/i, function (h) { return h + snippet; });
  return snippet + code;
}
function validate(code) {
  return new Promise(function (resolve) {
    var errs = [];
    if (!code || !/<(html|body|div|canvas|script|button|main|h1)/i.test(code)) return resolve(['Kein HTML gefunden. Bitte EINE komplette HTML-Datei liefern.']);
    var doc = new DOMParser().parseFromString(code, 'text/html');
    if (!doc.body || (!doc.body.children.length && !doc.querySelector('script'))) errs.push('Die Seite ist leer (keine Elemente im body).');
    if (!/<\/html>/i.test(code)) errs.push('Die Datei ist abgeschnitten (</html> fehlt). Bitte kürzer und vollständig.');
    Array.prototype.forEach.call(doc.querySelectorAll('script:not([src])'), function (sc, i) {   // Syntax direkt pruefen (Safari verbirgt Details)
      if (sc.type && !/javascript|^module$/i.test(sc.type)) return;
      try { if (sc.type !== 'module') new Function(sc.textContent); } catch (e) { errs.push('Syntaxfehler im Script ' + (i + 1) + ': ' + e.message); }
    });
    var tok = 't' + Math.random().toString(36).slice(2), f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts'); f.style.cssText = 'position:absolute;left:-9999px;width:390px;height:700px;border:0';
    function onMsg(e) { if (e.data && e.data.ww === tok && errs.length < 5) errs.push('JavaScript-Fehler: ' + (/^Script error\.?$/.test(e.data.err) ? 'Laufzeitfehler beim Start (Browser zeigt keine Details). Pruefe alle Variablen/Funktionen, die beim Laden benutzt werden.' : e.data.err)); }
    window.addEventListener('message', onMsg);
    f.srcdoc = inject(code, CATCHER.replace('__TOK__', tok));
    document.body.appendChild(f);
    setTimeout(function () { window.removeEventListener('message', onMsg); f.remove(); resolve(errs); }, VALIDATE_MS);
  });
}
var VALIDATE_MS = 2000;

/* ---------- Aufgaben-Einschaetzung ---------- */
var COMPLEX_RE = /\b(server|backend|datenbank|database|login|anmeld|konto|bezahl|zahlung|api|börse|echtzeit|mehrspieler|multiplayer|kamera|bluetooth|e-?mail senden|whatsapp)\b/i;
var SYSTEM = 'Du baust kleine Web-Apps fuer Ayoub (Schweiz, Deutsch de-CH, schreibe "ss" statt "ß").\n' +
  'Antworte NUR mit EINER vollstaendigen, eigenstaendigen HTML-Datei in einem ```html Codeblock, ohne Erklaerung davor.\n' +
  'Regeln: alles (CSS, JS) in dieser einen Datei, keine externen Dateien/CDNs/Bilder aus dem Internet, keine API-Schluessel, kein Server. ' +
  'Handy zuerst: <meta name="viewport" content="width=device-width,initial-scale=1">, grosse Knoepfe (min. 48px), gut lesbar, schoen und einfach. ' +
  'Daten bei Bedarf in localStorage speichern (in try/catch). Kein Fehler in der Konsole. Halte den Code kurz (unter ca. 400 Zeilen).\n' +
  'Wenn der Wunsch fuer eine einzelne HTML-Datei zu gross ist (Server, Login, echte Datenbank), baue die einfachste funktionierende Version und zeige in der App einen kurzen Hinweis, was fehlt und was man dafuer bräuchte.';
function summary(st, request, error) {
  var s = 'ZUSTAND (kurze Zusammenfassung statt ganzem Chat):\nZiel: ' + st.goal + '\n';
  if (st.code) s += 'Aktuelle App (vollstaendiger Code):\n```html\n' + st.code + '\n```\n';
  if (st.history.length) s += 'Bisherige Wuensche: ' + st.history.slice(-5).join(' | ') + '\n';
  if (error) s += 'FEHLER im letzten Versuch, bitte korrigieren:\n' + error + '\nLiefere die komplette korrigierte HTML-Datei.\n';
  else s += (st.code ? 'Neue Aenderung: ' : 'Wunsch: ') + request + '\nLiefere die komplette HTML-Datei.\n';
  return s;
}

/* ---------- Zustand & Anzeige ---------- */
var S = { goal: '', code: '', history: [], name: '', id: null };
var busy = false;
function addMsg(cls, text, tag) {
  var d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text;
  if (tag) { var t = document.createElement('span'); t.className = 'tag'; t.textContent = tag; d.appendChild(t); }
  $('log').appendChild(d); d.scrollIntoView({ block: 'end' }); return d;
}
function showApp(code) { $('frame').srcdoc = code; $('preview').className = 'on'; }
function guessName(goal) { var w = goal.replace(/[^\wäöüÄÖÜ ]/g, ' ').trim().split(/\s+/).slice(0, 4).join(' '); return w ? w.charAt(0).toUpperCase() + w.slice(1) : 'Meine App'; }

function send() {
  if (busy) return;
  var raw = $('inp').value.trim(); if (!raw) return;
  if (!CHAIN.some(function (x) { return keyOf(x.provider); })) { addMsg('warn', 'Zuerst unter ⚙️ Einstellungen eine KI verbinden (am besten Google Gemini).'); return; }
  var san = sanitize(raw);
  $('inp').value = '';
  addMsg('me', raw);
  if (san.count) addMsg('warn', '🛡️ Achtung: ' + san.count + ' geheime Angabe(n) (Schlüssel, Passwort oder IP) gefunden. Ich habe sie durch [REDACTED_SECRET] ersetzt, bevor etwas an die KI ging. Bitte keine echten Schlüssel in den Wunsch schreiben.');
  var req = san.text;
  if (!S.goal) { S.goal = req; S.name = guessName(req); }
  if (COMPLEX_RE.test(req)) addMsg('warn', 'ℹ️ Das klingt gross (z. B. Server, Login oder Internet-Daten). Gratis-KIs bauen dann nur eine einfache Version. Ich sage dir, was fehlt.');
  run(req);
}
function run(req) {
  busy = true; $('sendBtn').disabled = true;
  var wait = addMsg('ki', '⏳ Ich baue …'), tries = 0, error = null;
  function onSwitch(label, fails) { addMsg('warn', '🔀 ' + (fails.length ? fails.join('; ') + '. ' : '') + 'Weiter mit ' + label + ' (mit kurzer Zusammenfassung).'); }
  function attempt() {
    return callChain(SYSTEM, summary(S, req, error), onSwitch).then(function (res) {
      var code = extractHtml(res.text);
      wait.textContent = '🔍 Ich prüfe die App …';
      return validate(code).then(function (errs) {
        if (errs.length && tries < 2) {
          tries++; error = errs.join('\n');
          addMsg('warn', '🔧 Die Prüfung fand einen Fehler in der App. Die KI korrigiert ihn, Versuch ' + tries + '/2 …', res.label);
          wait.textContent = '⏳ Ich korrigiere …';
          return attempt();
        }
        S.code = code; S.history.push(req); showApp(code); wait.remove();
        addMsg('ki', errs.length ? '⚠️ Fertig, aber die Prüfung meldet noch: ' + errs[0] + '\nSchreib mir, was nicht geht.' : '✅ Fertig! Probier sie unten aus. Was soll ich ändern?', 'Antwort von ' + res.label + (tries ? ' · ' + tries + '× korrigiert' : ''));
        setTimeout(function () { $('preview').scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 300);
      });
    });
  }
  attempt().catch(function (e) {
    wait.remove();
    if (e.message === 'NOKEY') addMsg('warn', 'Zuerst unter ⚙️ Einstellungen eine KI verbinden.');
    else addMsg('err', '😕 Gerade sind alle Gratis-KIs am Limit oder nicht erreichbar:\n' + (e.fails || [e.message]).join('\n') + '\nVersuch es in ein paar Minuten nochmals oder verbinde unter ⚙️ Einstellungen eine weitere KI.');
  }).then(function () { busy = false; $('sendBtn').disabled = false; });
}

/* ---------- Gespeicherte Apps ---------- */
function apps() { try { return JSON.parse(lsGet('ww.apps') || '[]'); } catch (e) { return []; } }
function saveApps(a) { lsSet('ww.apps', JSON.stringify(a)); }
function saveCurrent() {
  if (!S.code) return;
  var a = apps(), now = new Date().toISOString();
  var ex = S.id && a.find(function (x) { return x.id === S.id; });
  if (ex) { ex.code = S.code; ex.goal = S.goal; ex.history = S.history; ex.updated = now; }
  else { S.id = 'a' + Date.now(); a.unshift({ id: S.id, name: S.name, goal: S.goal, history: S.history, code: S.code, updated: now }); }
  try { localStorage.setItem('ww.apps', JSON.stringify(a)); addMsg('ki', '💾 Gespeichert als „' + (ex ? ex.name : S.name) + '“. Du findest sie unter 📱 Apps.'); }
  catch (e) { addMsg('err', 'Speicher voll. Lösche alte Apps unter 📱 Apps.'); }
  renderApps();
}
function fileName(n) { return (n || 'app').replace(/[^\wäöüÄÖÜ\-]+/g, '-').replace(/^-|-$/g, '') + '.html'; }
function download(name, code) {
  var b = new Blob([code], { type: 'text/html' }), u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = fileName(name); document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
}
function share(name, code) {
  try {
    var f = new File([code], fileName(name), { type: 'text/html' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f], title: name }).catch(function () {});
  } catch (e) {}
  download(name, code);
}
function renderApps() {
  var a = apps(), el = $('apps');
  if (!a.length) { el.innerHTML = '<p class="mut">Noch keine gespeicherten Apps. Bau eine unter 💬 und tippe 💾 Speichern.</p>'; return; }
  el.innerHTML = a.map(function (x) {
    return '<div class="card" data-id="' + x.id + '"><b>' + esc(x.name) + '</b><div class="mut">' + esc(new Date(x.updated).toLocaleString('de-CH')) + '</div>' +
      '<div class="row"><button class="main" data-a="open">▶ Öffnen</button><button data-a="ren">✏️ Name</button><button data-a="dl">⬇️</button><button data-a="sh">📤</button><button data-a="del">🗑️</button></div></div>';
  }).join('');
}
$('apps').addEventListener('click', function (e) {
  var b = e.target.closest('button'), c = e.target.closest('.card'); if (!b || !c) return;
  var a = apps(), x = a.find(function (y) { return y.id === c.dataset.id; }); if (!x) return;
  var act = b.dataset.a;
  if (act === 'open') { S = { goal: x.goal, code: x.code, history: x.history || [], name: x.name, id: x.id }; $('log').innerHTML = ''; addMsg('ki', '📂 „' + x.name + '“ geöffnet. Was soll ich ändern?'); showApp(x.code); go('chat'); }
  else if (act === 'ren') { var n = prompt('Neuer Name:', x.name); if (n && n.trim()) { x.name = n.trim(); if (S.id === x.id) S.name = x.name; saveApps(a); renderApps(); } }
  else if (act === 'dl') download(x.name, x.code);
  else if (act === 'sh') share(x.name, x.code);
  else if (act === 'del') { if (confirm('„' + x.name + '“ wirklich löschen?')) { saveApps(a.filter(function (y) { return y !== x; })); if (S.id === x.id) S.id = null; renderApps(); } }
});

/* ---------- Schluessel ---------- */
function mask(k) { return '••••••' + (k.length > 12 ? k.slice(-4) : ''); }
function renderKeys() {
  $('keyList').innerHTML = Object.keys(PROVIDERS).map(function (p) {
    var P = PROVIDERS[p], k = keyOf(p);
    return '<div class="card" data-p="' + p + '"><b>' + P.name + '</b> ' + (k ? '✅' : '') + '<div class="mut">Gratis-Zugang holen: <a href="' + P.link + '" target="_blank" rel="noopener">' + P.link.replace('https://', '') + '</a> · ' + P.hint + '</div>' +
      (k ? '<div class="mut">Gespeichert: ' + mask(k) + '</div>' : '') +
      '<div class="kin"><input type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + (k ? 'Neuen Zugang einfügen (ersetzt)' : 'Zugang hier einfügen') + '"><button data-a="eye" aria-label="Anzeigen">👁</button></div>' +
      '<div class="row"><button class="main" data-a="save">Speichern</button><button data-a="test">Test</button><button data-a="del">Entfernen</button></div><div class="mut res"></div></div>';
  }).join('');
}
$('keyList').addEventListener('click', function (e) {
  var b = e.target.closest('button'), c = e.target.closest('.card'); if (!b || !c) return;
  var p = c.dataset.p, inp = c.querySelector('input'), res = c.querySelector('.res');
  if (b.dataset.a === 'eye') { inp.type = inp.type === 'password' ? 'text' : 'password'; }
  else if (b.dataset.a === 'save') { if (inp.value.trim()) lsSet('ww.key.' + p, inp.value.trim()); renderKeys(); renderChain(); }
  else if (b.dataset.a === 'del') { try { localStorage.removeItem('ww.key.' + p); } catch (x) {} renderKeys(); renderChain(); }
  else if (b.dataset.a === 'test') {
    if (inp.value.trim()) { lsSet('ww.key.' + p, inp.value.trim()); inp.value = ''; inp.type = 'password'; c.querySelector('.mut + .mut, .mut:nth-of-type(2)'); }
    if (!keyOf(p)) { res.textContent = 'Zuerst einen Zugang einfügen.'; return; }
    var item = CHAIN.find(function (x) { return x.provider === p; }) || DEFAULT_CHAIN.find(function (x) { return x.provider === p; });
    res.textContent = '⏳ teste ' + item.model + ' …';
    callOne(item, 'Antworte nur mit OK.', 'Test').then(function () { res.textContent = '✅ Funktioniert (' + item.model + ')'; },
      function (er) { res.textContent = '❌ ' + (er.status === 429 ? 'Limit erreicht, später nochmals' : (er.status === 401 || er.status === 403 || er.status === 400) ? 'Zugang ungültig' : er.status === 0 ? 'Keine Verbindung' : er.message); });
  }
});
function renderChain() {
  $('chainInfo').innerHTML = CHAIN.map(function (x, i) { return (i + 1) + '. ' + esc(PROVIDERS[x.provider].name.replace(' (optional)', '')) + ' · ' + esc(x.model) + (keyOf(x.provider) ? ' ✅' : ' (nicht verbunden)'); }).join('<br>');
}

/* ---------- Navigation ---------- */
function go(v) {
  document.querySelectorAll('.view').forEach(function (s) { s.classList.toggle('on', s.id === 'v-' + v); });
  document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
  $('composer').style.display = v === 'chat' ? 'flex' : 'none';
  if (v === 'apps') renderApps();
}
document.querySelector('nav').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) go(b.dataset.v); });
$('sendBtn').addEventListener('click', send);
$('inp').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); send(); } });
$('saveBtn').addEventListener('click', saveCurrent);
$('dlBtn').addEventListener('click', function () { if (S.code) download(S.name, S.code); });
$('shareBtn').addEventListener('click', function () { if (S.code) share(S.name, S.code); });
$('fullBtn').addEventListener('click', function () { document.body.classList.add('full'); });
$('closeFull').addEventListener('click', function () { document.body.classList.remove('full'); });
function welcome() { $('log').innerHTML = ''; addMsg('ki', 'Hoi Ayoub! 👋 Schreib oder sprich (🎤 auf der Tastatur) deinen Wunsch, z. B. „Ein Timer fürs Velo mit grossen Zahlen“. Danach kannst du sagen, was ich ändern soll.'); }
$('setBtn').addEventListener('click', function () { go('keys'); });
$('newBtn').addEventListener('click', function () { S = { goal: '', code: '', history: [], name: '', id: null }; $('preview').className = ''; $('frame').srcdoc = ''; welcome(); go('chat'); });

/* ---------- Version & Offline ---------- */
$('ver').textContent = 'App ' + APP_VERSION;
function verCheck() {
  fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
    if (!v || !v.version || v.version === APP_VERSION) return;
    var k = 'ww.verfix.' + v.version; if (lsGet(k)) return; lsSet(k, '1');
    var p = [];
    if (window.caches) p.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (x) { return caches.delete(x); })); }));
    if (navigator.serviceWorker) p.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
    Promise.all(p).catch(function () {}).then(function () { location.replace(location.pathname + '?v=' + encodeURIComponent(v.version)); });
  }).catch(function () {});
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
verCheck();
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') verCheck(); });
welcome(); renderKeys(); loadModels();
