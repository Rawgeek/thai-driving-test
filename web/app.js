// Thai Driving Trainer — fully client-side. Data + images served as static assets;
// progress + settings live in localStorage.

const DEFAULTS = {
  masteryStreak: 3, weakStreak: 1, questionsPerRun: 50, limitQuestions: true,
  timerEnabled: false, timePerQuestion: 72, theme: 'dark', ds: 'primary', showTh: false,
};

const DATASETS = {}; // ds_name -> {questions, rules, image_prefix, byId, total}
const ATT_KEY = (ds) => 'attempts_' + ds;

let CFG = loadCfg();
let cur = null, locked = false, lastQId = null;
let RUN = { active: false, answered: 0, correct: 0, target: 0, startMs: 0, totalSec: 0, timerId: null };

function loadCfg() {
  let s = {}; try { s = JSON.parse(localStorage.getItem('cfg') || '{}'); } catch (e) {}
  return Object.assign({}, DEFAULTS, s);
}
function saveCfg() { localStorage.setItem('cfg', JSON.stringify(CFG)); }

function loadAttempts(ds) {
  try { return JSON.parse(localStorage.getItem(ATT_KEY(ds)) || '{}'); }
  catch (e) { return {}; }
}
function saveAttempts(ds, a) { localStorage.setItem(ATT_KEY(ds), JSON.stringify(a)); }

async function loadDataset(ds) {
  if (DATASETS[ds]) return DATASETS[ds];
  const r = await fetch(`data/${ds}.json`, { cache: 'force-cache' });
  if (!r.ok) throw new Error('failed to load ' + ds);
  const d = await r.json();
  d.byId = {};
  for (const q of d.questions) d.byId[q.q_id] = q;
  d.total = d.questions.length;
  DATASETS[ds] = d;
  return d;
}

// ---------- selection algorithm (mirrors src/trainer.py) ----------
function questionWeight(stats, mastery, weak) {
  if (stats.seen === 0) return 4.0;
  if (stats.streak >= mastery) return 0.0;
  if (stats.streak < weak) return 5.0;
  const errRate = 1 - (stats.correct / stats.seen);
  if (errRate >= 0.5) return 2.5;
  return 1.0;
}
function statsFor(qid, attempts) {
  return attempts[qid] || { seen: 0, correct: 0, streak: 0 };
}
function pickNext(ds, exclude, mastery, weak) {
  const data = DATASETS[ds];
  const attempts = loadAttempts(ds);
  const pool = [];
  for (const q of data.questions) {
    if (exclude && exclude.has(q.q_id)) continue;
    const w = questionWeight(statsFor(q.q_id, attempts), mastery, weak);
    if (w > 0) pool.push([q, w]);
  }
  if (!pool.length) {
    if (exclude && exclude.size) return pickNext(ds, null, mastery, weak);
    return null;
  }
  let total = 0; for (const [, w] of pool) total += w;
  let r = Math.random() * total;
  for (const [q, w] of pool) { r -= w; if (r <= 0) return q; }
  return pool[pool.length - 1][0];
}
function progressSummary(ds, mastery, weak) {
  const data = DATASETS[ds];
  const attempts = loadAttempts(ds);
  let mastered = 0, seenC = 0, weakC = 0;
  for (const q of data.questions) {
    const s = statsFor(q.q_id, attempts);
    if (s.streak >= mastery) mastered++;
    if (s.seen > 0) seenC++;
    if (s.seen > 0 && s.streak < weak) weakC++;
  }
  const total = data.total;
  return { total, seen: seenC, mastered, weak: weakC, remaining: total - mastered };
}
function recordAttempt(ds, qid, correct) {
  const a = loadAttempts(ds);
  const s = a[qid] || { seen: 0, correct: 0, streak: 0 };
  s.seen += 1; if (correct) { s.correct += 1; s.streak += 1; } else { s.streak = 0; }
  a[qid] = s; saveAttempts(ds, a);
}

// ---------- DOM ----------
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(); applyShowTh();
  document.getElementById('dsSel').value = CFG.ds;
  document.getElementById('dsSel').addEventListener('change', switchDS);
  const chk = document.getElementById('thChk'), tog = document.getElementById('thToggle');
  chk.checked = CFG.showTh; tog.classList.toggle('on', CFG.showTh);
  chk.addEventListener('change', () => {
    CFG.showTh = chk.checked; saveCfg();
    tog.classList.toggle('on', CFG.showTh); applyShowTh();
  });
  document.getElementById('themeBtn').onclick = () => {
    CFG.theme = CFG.theme === 'dark' ? 'light' : 'dark'; saveCfg(); applyTheme();
  };
  document.getElementById('settingsBtn').onclick = openSettings;
  document.getElementById('endRunBtn').onclick = () => endRun(false);
  document.addEventListener('keydown', onKey);
  bindSettings();

  try {
    await loadDataset(CFG.ds);
    startRun();
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="qcard done" role=alert>Failed to load <b>${escape(CFG.ds)}</b> dataset.<br><br>` +
      `<small style="color:var(--muted)">${escape(String(e))}</small></div>`;
  }
});

function applyTheme() {
  document.documentElement.classList.toggle('theme-light', CFG.theme === 'light');
  const btn = document.getElementById('themeBtn');
  btn.textContent = CFG.theme === 'dark' ? '☾' : '☼';
  btn.setAttribute('aria-pressed', CFG.theme === 'light');
  btn.setAttribute('aria-label', CFG.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}
function applyShowTh() {
  document.body.classList.toggle('hide-th', !CFG.showTh);
  document.getElementById('thChk').setAttribute('aria-checked', CFG.showTh);
}
async function switchDS() {
  CFG.ds = document.getElementById('dsSel').value;
  saveCfg();
  try {
    await loadDataset(CFG.ds);
    const max = DATASETS[CFG.ds].total;
    CFG.questionsPerRun = Math.min(CFG.questionsPerRun, max); saveCfg();
    startRun();
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="qcard done" role=alert>Failed to load dataset.</div>`;
  }
}

function loadStats() {
  const s = progressSummary(CFG.ds, CFG.masteryStreak, CFG.weakStreak);
  document.getElementById('stats').innerHTML =
    `<b>${s.mastered}</b>/${s.total} mastered · ${s.weak} weak · ${s.seen} seen`;
  const pct = s.total ? (s.mastered / s.total * 100) : 0;
  document.getElementById('barfill').style.width = pct + '%';
  document.getElementById('barOuter').setAttribute('aria-valuenow', Math.round(pct));
}

function loadNext() {
  locked = false;
  const app = document.getElementById('app');
  app.setAttribute('aria-busy', 'true');
  const exclude = lastQId ? new Set([lastQId]) : null;
  const q = pickNext(CFG.ds, exclude, CFG.masteryStreak, CFG.weakStreak);
  if (!q) {
    app.innerHTML =
      '<div class="qcard done" role=status><div class=done-emoji aria-hidden=true>🎉</div>' +
      '<div>All questions mastered.</div><br>' +
      '<button class=next type=button onclick="resetProgress()">Reset progress and start over</button></div>';
    app.setAttribute('aria-busy', 'false');
    hideRunBar(); return;
  }
  cur = q; render(q);
  app.setAttribute('aria-busy', 'false');
  const first = app.querySelector('.opt'); if (first) first.focus({ preventScroll: false });
}

function imgURL(filename) {
  const d = DATASETS[CFG.ds];
  return (d ? d.image_prefix : 'images/') + encodeURIComponent(filename);
}

function render(q) {
  const optsHtml = q.options.map((o) => {
    const key = o.idx + 1;
    const en = o.txt ? escape(o.txt) : '';
    const th = (o.txt_th && o.txt_th !== o.txt) ? `<span class=opt-th lang=th>${escape(o.txt_th)}</span>` : '';
    const img = o.pic ? `<img src="${imgURL(o.pic)}" alt="Option ${key} illustration" loading=lazy decoding=async>` : '';
    return `<button class=opt data-idx="${o.idx}" onclick="answer(${o.idx})" type=button aria-label="Option ${key}: ${escape(o.txt || o.txt_th || '')}" aria-keyshortcuts="${key}">` +
      `<span class=opt-key aria-hidden=true>${key}</span>` +
      `<span class=opt-en>${en}</span>${th}${img}</button>`;
  }).join('');
  const tagsHtml = (q.tags || []).map(t => `<span class=tag>${escape(t)}</span>`).join('');
  const cat = (q.tags && q.tags[0]) ? `<div class=qcat>${escape(q.tags[0])}</div>` : '';
  const stem_th = (q.q_txt_th && q.q_txt_th !== q.q_txt)
    ? `<div class=qstem-th lang=th>${escape(q.q_txt_th)}</div>` : '';
  const img = q.q_pic ? `<div class=qimg-wrap><img class=qimg src="${imgURL(q.q_pic)}" alt="Question illustration" loading=eager decoding=async></div>` : '';
  document.getElementById('app').innerHTML = `
    <article class=qcard aria-labelledby=qstemEl>
      ${cat}
      <h2 class=qstem id=qstemEl>${escape(q.q_txt)}</h2>
      ${stem_th}
      ${img}
      <div class=opts role=group aria-label="Answer options">${optsHtml}</div>
      ${q.tags && q.tags.length > 1 ? `<div class=tags aria-label="Tags">${tagsHtml}</div>` : ''}
    </article>
    <div id=feedback></div>`;
}

function answer(choice) {
  if (locked || !RUN.active) return;
  locked = true;
  document.querySelectorAll('.opt').forEach(b => b.disabled = true);
  const correctIdx = cur.ans_num;
  const isCorrect = choice === correctIdx;
  recordAttempt(CFG.ds, cur.q_id, isCorrect);

  document.querySelectorAll('.opt').forEach(b => {
    const idx = parseInt(b.dataset.idx, 10);
    if (idx === correctIdx) b.classList.add('correct');
    else if (idx === choice) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  RUN.answered++; if (isCorrect) RUN.correct++;
  document.getElementById('runIdx').textContent = RUN.answered;
  document.getElementById('runCorrect').textContent = RUN.correct;

  // build feedback
  const data = DATASETS[CFG.ds];
  const rules = (cur.rule_ids || []).map(rid => data.rules[rid]).filter(Boolean);
  let rulesHtml = '';
  if (rules.length) {
    rulesHtml = '<div class=rules>' + rules.map(r =>
      `<a href=# onclick="showRule(${r.id});return false">📖 Manual p.${r.page}${r.section ? ' — ' + escape(r.section) : ''}</a>`
    ).join('') + '</div>';
  }
  const klass = isCorrect ? 'correct' : 'wrong';
  const head = isCorrect ? '✓ Correct' : '✗ Wrong';
  const isLast = RUN.answered >= RUN.target;
  const explanation = cur.explanation || '';
  document.getElementById('feedback').innerHTML = `
    <div class="expl ${klass}" role=status aria-live=polite>
      <h3>${head}</h3>
      ${explanation ? escape(explanation) : '<i style="color:var(--muted)">No explanation available for this question.</i>'}
      ${rulesHtml}
    </div>
    <button class=next id=nextBtn type=button onclick="next()" aria-keyshortcuts="Enter">${isLast ? 'Finish run' : 'Next question'} <span class=kbd aria-hidden=true>↵ Enter</span></button>`;
  loadStats();
  lastQId = cur.q_id;
  const nb = document.getElementById('nextBtn'); if (nb) nb.focus();
}

function next() {
  if (RUN.answered >= RUN.target) { endRun(false); return; }
  loadNext();
}

function startRun() {
  RUN.active = true; RUN.answered = 0; RUN.correct = 0;
  const max = DATASETS[CFG.ds] ? DATASETS[CFG.ds].total : CFG.questionsPerRun;
  RUN.target = CFG.limitQuestions ? Math.min(CFG.questionsPerRun, max) : max;
  RUN.startMs = Date.now();
  RUN.totalSec = CFG.timerEnabled ? (RUN.target * CFG.timePerQuestion) : 0;
  document.getElementById('runbar').style.display = 'flex';
  document.getElementById('runTarget').textContent = RUN.target;
  document.getElementById('runIdx').textContent = '0';
  document.getElementById('runCorrect').textContent = '0';
  startTimer(); lastQId = null;
  loadStats(); loadNext();
}

function startTimer() {
  if (RUN.timerId) { clearInterval(RUN.timerId); RUN.timerId = null; }
  const t = document.getElementById('timer');
  if (!CFG.timerEnabled) { t.style.display = 'none'; t.removeAttribute('aria-live'); return; }
  t.style.display = 'inline-flex';
  function fmt(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  function spoken(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const parts = [];
    if (h) parts.push(h + (h === 1 ? ' hour' : ' hours'));
    if (m) parts.push(m + (m === 1 ? ' minute' : ' minutes'));
    if (s || !parts.length) parts.push(s + (s === 1 ? ' second' : ' seconds'));
    return parts.join(' ') + ' remaining';
  }
  function tick() {
    const elapsed = Math.floor((Date.now() - RUN.startMs) / 1000);
    const left = Math.max(0, RUN.totalSec - elapsed);
    t.textContent = fmt(left);
    t.setAttribute('aria-label', spoken(left));
    const wasCrit = t.classList.contains('crit');
    t.classList.toggle('warn', left <= 60 && left > 15);
    t.classList.toggle('crit', left <= 15);
    if (left <= 15 && !wasCrit) t.setAttribute('aria-live', 'assertive');
    if (left === 0) { clearInterval(RUN.timerId); RUN.timerId = null; endRun(true); }
  }
  tick(); RUN.timerId = setInterval(tick, 500);
}

function hideRunBar() {
  document.getElementById('runbar').style.display = 'none';
  document.getElementById('timer').style.display = 'none';
  if (RUN.timerId) { clearInterval(RUN.timerId); RUN.timerId = null; }
  RUN.active = false;
}

function endRun(timedOut) {
  hideRunBar();
  const elapsed = Math.floor((Date.now() - RUN.startMs) / 1000);
  const m = Math.floor(elapsed / 60), s = elapsed % 60;
  const tElapsed = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  const pct = RUN.answered ? Math.round(RUN.correct / RUN.answered * 100) : 0;
  let grade = '—';
  if (RUN.answered) {
    if (pct >= 95) grade = 'A+'; else if (pct >= 90) grade = 'A'; else if (pct >= 80) grade = 'B';
    else if (pct >= 70) grade = 'C'; else if (pct >= 60) grade = 'D'; else grade = 'F';
  }
  const app = document.getElementById('app');
  app.innerHTML = `
    <section class="qcard summary" role=status aria-label="Run summary">
      <div class=grade aria-label="Grade ${grade}">${grade}</div>
      <div class=pct>${timedOut ? '⏱ Time’s up · ' : ''}${pct}% accuracy</div>
      <div class=grid>
        <div class=cell><div class=num>${RUN.correct}</div><div class=lbl>Correct</div></div>
        <div class=cell><div class=num>${RUN.answered - RUN.correct}</div><div class=lbl>Wrong</div></div>
        <div class=cell><div class=num>${tElapsed}</div><div class=lbl>Time</div></div>
      </div>
      <button class=next type=button id=newRunBtn onclick=startRun()>Start new run <span class=kbd aria-hidden=true>↵ Enter</span></button>
    </section>`;
  const btn = document.getElementById('newRunBtn'); if (btn) btn.focus();
}

function onKey(e) {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (document.getElementById('ruledlg').open || document.getElementById('setdlg').open) return;
  if (!RUN.active && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startRun(); return; }
  if (!locked && cur && /^[1-4]$/.test(e.key)) {
    const idx = parseInt(e.key, 10) - 1;
    if (cur.options.some(o => o.idx === idx)) { e.preventDefault(); answer(idx); }
  } else if (locked && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault(); next();
  } else if (e.key === 't' || e.key === 'T') {
    const c = document.getElementById('thChk'); c.checked = !c.checked; c.dispatchEvent(new Event('change'));
  } else if (e.key === 's' || e.key === 'S') { e.preventDefault(); openSettings(); }
}

function showRule(id) {
  const data = DATASETS[CFG.ds];
  const r = data && data.rules ? data.rules[id] : null;
  if (!r) return;
  document.getElementById('ruledlg_title').textContent = `Manual p.${r.page}${r.section ? ' — ' + r.section : ''}`;
  document.getElementById('ruledlg_body').textContent = r.body;
  document.getElementById('ruledlg').showModal();
}

function resetProgress() {
  if (!confirm('Reset progress for the ' + CFG.ds + ' dataset?')) return;
  localStorage.removeItem(ATT_KEY(CFG.ds));
  startRun();
}

function escape(s) { return (s || '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function openSettings() {
  const max = (DATASETS[CFG.ds] && DATASETS[CFG.ds].total) || 400;
  const $ = id => document.getElementById(id);
  $('rngMastery').value = CFG.masteryStreak; $('valMastery').textContent = CFG.masteryStreak;
  $('rngMastery').setAttribute('aria-valuetext', CFG.masteryStreak + ' correct in a row');
  $('rngWeak').value = CFG.weakStreak; $('valWeak').textContent = CFG.weakStreak;
  $('rngWeak').setAttribute('aria-valuetext', CFG.weakStreak + ' correct in a row');
  $('rngQpr').max = max; $('rngQpr').value = Math.min(CFG.questionsPerRun, max);
  $('valQpr').textContent = $('rngQpr').value;
  $('rngQpr').setAttribute('aria-valuetext', $('rngQpr').value + ' questions');
  $('swLimit').setAttribute('aria-checked', CFG.limitQuestions);
  $('fldQpr').hidden = !CFG.limitQuestions;
  $('rngTpq').value = CFG.timePerQuestion; $('valTpq').textContent = CFG.timePerQuestion + 's';
  $('rngTpq').setAttribute('aria-valuetext', CFG.timePerQuestion + ' seconds');
  $('swTimer').setAttribute('aria-checked', CFG.timerEnabled);
  $('fldTpq').hidden = !CFG.timerEnabled;
  document.querySelectorAll('#segTheme button').forEach(b => {
    const on = b.dataset.v === CFG.theme;
    b.setAttribute('aria-checked', on); b.setAttribute('aria-pressed', on);
  });
  $('setdlg').showModal();
  $('setdlg').querySelector('input,button,select').focus();
}

function bindSettings() {
  const $ = id => document.getElementById(id);
  const onRange = (rng, val, key, suffix = '', cb) => {
    rng.addEventListener('input', () => {
      const v = parseInt(rng.value, 10); CFG[key] = v; saveCfg();
      val.textContent = v + suffix;
      rng.setAttribute('aria-valuetext', v + (suffix ? (suffix === 's' ? ' seconds' : suffix) : ''));
      if (cb) cb(v);
    });
  };
  onRange($('rngMastery'), $('valMastery'), 'masteryStreak', '', () => loadStats());
  onRange($('rngWeak'), $('valWeak'), 'weakStreak', '', () => loadStats());
  onRange($('rngQpr'), $('valQpr'), 'questionsPerRun');
  onRange($('rngTpq'), $('valTpq'), 'timePerQuestion', 's');
  $('swTimer').addEventListener('click', () => {
    CFG.timerEnabled = !CFG.timerEnabled; saveCfg();
    $('swTimer').setAttribute('aria-checked', CFG.timerEnabled);
    $('fldTpq').hidden = !CFG.timerEnabled;
    if (RUN.active) {
      RUN.totalSec = CFG.timerEnabled ? (RUN.target * CFG.timePerQuestion) : 0;
      RUN.startMs = Date.now(); startTimer();
    }
  });
  $('swTimer').addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); $('swTimer').click(); }
  });
  $('swLimit').addEventListener('click', () => {
    CFG.limitQuestions = !CFG.limitQuestions; saveCfg();
    $('swLimit').setAttribute('aria-checked', CFG.limitQuestions);
    $('fldQpr').hidden = !CFG.limitQuestions;
  });
  $('swLimit').addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); $('swLimit').click(); }
  });
  document.querySelectorAll('#segTheme button').forEach(b => {
    b.addEventListener('click', () => {
      CFG.theme = b.dataset.v; saveCfg(); applyTheme();
      document.querySelectorAll('#segTheme button').forEach(x => {
        const on = x.dataset.v === CFG.theme;
        x.setAttribute('aria-checked', on); x.setAttribute('aria-pressed', on);
      });
    });
  });
  $('resetProgBtn').addEventListener('click', () => {
    $('setdlg').close(); resetProgress();
  });
}

// expose for inline onclick handlers
window.answer = answer; window.next = next; window.startRun = startRun;
window.showRule = showRule; window.resetProgress = resetProgress;
