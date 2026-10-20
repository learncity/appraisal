/* Learn City Staff Appraisal — staff portal
   Same structure and error-handling pattern as Spark Points app.js. */
'use strict';

/* ---------- fail loudly, not silently ---------- */

function fatal(message) {
  var bar = document.getElementById('lcFatal');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'lcFatal';
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#9b1c1c;color:#fff;' +
      'padding:12px 16px;font:14px/1.5 Arial,Helvetica,sans-serif;white-space:pre-wrap';
    (document.body || document.documentElement).appendChild(bar);
  }
  bar.textContent = 'Appraisal portal problem — report this line to Head of IT:\n' + message;
}

window.addEventListener('error', function (e) {
  fatal((e.message || 'Unknown error') + '  [' + (e.filename || '?').split('/').pop() + ' line ' + (e.lineno || '?') + ']');
});

/* SETUP: the SAME /exec URL as Spark Points — Results and Appraisal are
   add-on files in the Spark Points Apps Script project. */
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbxahzgarriiZeHw-RCWr8PivATnm1ajQa3cUcadNyyj0eNYdUFT4zbt8_yqxQSxSBqW/exec';
const ACTION_PREFIX = 'appraisal.';

/* Separate keys from Spark Points: both sites share learncity.github.io,
   and appraisal records are more sensitive, so remembering one must not
   silently sign someone into the other. */
const STORE_EMAIL = 'LC_APPRAISAL_EMAIL';
const STORE_CODE = 'LC_APPRAISAL_CODE';

const $ = function (id) { return document.getElementById(id); };

const CRITERIA_LABELS = {
  'Planning': ['Planning and learning objectives', 'Clear objectives, well-sequenced lesson'],
  'Subject Knowledge': ['Subject knowledge', 'Accurate, confident, tackles misconceptions'],
  'Strategies': ['Teaching strategies and differentiation', 'Varied methods, work matched to different learners'],
  'Questioning': ['Questioning and checking understanding', 'Probing questions; checks who has understood'],
  'Behaviour Management': ['Behaviour management', 'Calm, consistent, fair use of Spark Points'],
  'Engagement': ['Engagement and progress in the lesson', 'Students on task; progress visible'],
  'Marking Feedback': ['Marking and feedback in books', 'Regular marking with feedback students act on']
};
const LEVELS_NOTE = '4 Strong (a model for others) · 3 Secure · 2 Developing (needs specific support) · 1 Weak (significant concerns)';
const RATING_WORDS = { 4: '4 — Fully met / Strong', 3: '3 — Mostly met / Secure', 2: '2 — Partially met / Developing', 1: '1 — Not met / Weak' };

let state = {
  email: '', code: '', me: null,
  record: null, recordEmail: '', recordTarget: '', flash: '',
  team: [], setup: null, punctuality: null
};

/* ---------- server calls ---------- */

function call(action, extra) {
  const payload = Object.assign({ action: ACTION_PREFIX + action, email: state.email, code: state.code }, extra || {});
  return fetch(ENDPOINT, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ data: JSON.stringify(payload) })
  }).then(function (r) { return r.json(); });
}

/* ---------- sign in ---------- */

function trySignIn(email, code) {
  state.email = email.trim().toLowerCase();
  state.code = code.trim();
  $('signInBtn').disabled = true;
  $('signInError').textContent = 'Checking...';

  call('verifyStaff').then(function (r) {
    if (!r || !r.success) {
      $('signInBtn').disabled = false;
      $('signInError').textContent = (r && r.error) || 'Sign in failed.';
      return;
    }
    state.me = r;
    try {
      if ($('rememberMeToggle').checked) {
        localStorage.setItem(STORE_EMAIL, state.email); localStorage.setItem(STORE_CODE, state.code);
        sessionStorage.removeItem(STORE_EMAIL); sessionStorage.removeItem(STORE_CODE);
      } else {
        sessionStorage.setItem(STORE_EMAIL, state.email); sessionStorage.setItem(STORE_CODE, state.code);
        localStorage.removeItem(STORE_EMAIL); localStorage.removeItem(STORE_CODE);
      }
    } catch (e) { /* private browsing — still works for this visit */ }
    enterPortal();
  }).catch(function () {
    $('signInBtn').disabled = false;
    $('signInError').textContent = 'Could not reach the server. Check your connection and try again.';
  });
}

function signOut() {
  try {
    sessionStorage.removeItem(STORE_EMAIL); sessionStorage.removeItem(STORE_CODE);
    localStorage.removeItem(STORE_EMAIL); localStorage.removeItem(STORE_CODE);
  } catch (e) {}
  location.reload();
}

function enterPortal() {
  const me = state.me;
  $('signInScreen').classList.add('hidden');
  $('mainScreen').classList.remove('hidden');
  $('staffNameDisplay').textContent = me.fullName;
  $('staffRoleDisplay').textContent = ' ' + me.role;
  $('sessionDisplay').textContent = me.session + ' · ' + me.term;
  $('developmentalBanner').classList.toggle('hidden', !me.developmentalOnly);

  const tabs = [['myTab', me.isAppraisee], ['teamTab', me.hasTeam], ['punctualityTab', me.canPunctuality], ['setupTab', me.canSetup]];
  let first = '';
  tabs.forEach(function (t) {
    $(t[0] + 'Btn').classList.toggle('hidden', !t[1]);
    if (t[1] && !first) first = t[0];
  });
  if (!first) { $('noAccessNote').classList.remove('hidden'); return; }
  switchTab(first);
}

const loaded = {};
function switchTab(tabId) {
  document.querySelectorAll('.tabPanel').forEach(function (p) { p.classList.add('hidden'); });
  document.querySelectorAll('.tabBtn').forEach(function (b) { b.classList.remove('activeTab'); });
  $(tabId).classList.remove('hidden');
  document.querySelector('.tabBtn[data-tab="' + tabId + '"]').classList.add('activeTab');
  if (tabId === 'myTab') loadRecord(state.email, 'myRecord');
  if (tabId === 'teamTab' && $('teamRecordWrap').classList.contains('hidden')) loadTeam();
  if (tabId === 'punctualityTab' && !loaded.punctuality) { loaded.punctuality = true; loadPunctuality(); }
  if (tabId === 'setupTab' && !loaded.setup) { loaded.setup = true; loadSetup(); }
}

/* ---------- helpers ---------- */

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmt(n) { return n === null || n === undefined || n === '' ? '–' : Number(n).toFixed(2); }
function yes(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function options(list, selected, blankLabel) {
  return (blankLabel !== undefined ? '<option value="">' + esc(blankLabel) + '</option>' : '') +
    list.map(function (o) {
      const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
}
function ratingSelect(name, current) {
  return '<select name="' + name + '">' + options([4, 3, 2, 1].map(function (n) { return [n, RATING_WORDS[n]]; }), current, 'Not yet rated') + '</select>';
}
function chip(status) { return '<span class="chip ' + esc(status) + '">' + esc(status) + '</span>'; }
function msgLine() { return '<p class="error formMsg"></p>'; }
function voidForm(kind, id) {
  return '<form data-form="void" class="subForm hidden" id="void-' + esc(id) + '" data-confirm="Void this item? It stays in the record, marked void, with your reason.">' +
    '<input type="hidden" name="kind" value="' + esc(kind) + '"><input type="hidden" name="id" value="' + esc(id) + '">' +
    '<label>Reason for voiding</label><input name="reason" placeholder="e.g. entered against the wrong teacher">' +
    '<button type="submit">Void</button>' + msgLine() + '</form>';
}

/* ---------- appraisal record ---------- */

function loadRecord(email, targetId) {
  state.recordEmail = email;
  state.recordTarget = targetId;
  const box = $(targetId);
  if (!state.record || state.record.staff.email !== email) box.innerHTML = '<p class="subtitle">Loading...</p>';
  call('getRecord', { staffEmail: email }).then(function (r) {
    if (!r || !r.success) { box.innerHTML = '<p class="error">' + esc((r && r.error) || 'Could not load this appraisal.') + '</p>'; return; }
    state.record = r;
    renderRecord();
  }).catch(function () { box.innerHTML = '<p class="error">Could not reach the server.</p>'; });
}

function renderRecord() {
  const r = state.record;
  const isLeader = String(r.staff.framework).indexOf('Leader') === 0;
  $(state.recordTarget).innerHTML =
    (state.flash ? '<p class="success">' + esc(state.flash) + '</p>' : '') +
    secHeader(r) + secSummary(r) + secWorkflow(r) + secObjectives(r) + secObservations(r) +
    secAcademic(r) + secConduct(r) + secCpd(r) + (isLeader ? secLeadership(r) : '') +
    (r.permissions.isHeadOfSchool ? secFindings(r) : '');
  state.flash = '';
}

function secHeader(r) {
  const s = r.staff;
  return '<div class="card"><div class="cardHead"><h2>' + esc(s.name) + '</h2>' + chip(r.appraisal.Status || 'Planning') + '</div>' +
    '<p class="subtitle">' + esc(s.framework) + ' · ' + esc(s.className) + ' · ' + esc(r.session) + '</p>' +
    '<p class="muted">Appraised by: ' + (s.firstAppraiser ? 'Section Head (' + esc(s.firstAppraiser) + '), then Head of School' : 'Head of School') + '</p></div>';
}

function secSummary(r) {
  const s = r.summary;
  const st = r.appraisal.Status || 'Planning';
  const final = st === 'Finalised' || st === 'Locked' || st === 'Appeal';
  let html = '<div class="card"><div class="cardHead"><h2>Summary</h2><span class="muted">' +
    (final ? 'Final, as finalised' : 'Provisional — updates as evidence is added') + '</span></div>';
  html += '<div class="tableWrap"><table class="dataTable"><thead><tr><th>Component</th><th>Weight</th><th>Score</th><th>Based on</th></tr></thead><tbody>';
  s.components.forEach(function (c) {
    html += '<tr><td>' + esc(c.label) + '</td><td>' + Math.round(c.weight * 100) + '%</td><td class="score">' + fmt(c.score) + '</td><td class="muted">' + esc(c.detail) + '</td></tr>';
  });
  html += '<tr><td><strong>Teaching score</strong></td><td></td><td class="score">' + fmt(s.teachingScore) + '</td><td></td></tr></tbody></table></div>';
  if (s.leadership) {
    html += '<h3>Leadership</h3><div class="tableWrap"><table class="dataTable"><thead><tr><th>Component</th><th>Weight</th><th>Score</th></tr></thead><tbody>';
    s.leadership.components.forEach(function (c) {
      html += '<tr><td>' + esc(c.label) + '</td><td>' + Math.round(c.weight * 100) + '%</td><td class="score">' + fmt(c.score) + '</td></tr>';
    });
    html += '<tr><td><strong>Leadership score</strong></td><td></td><td class="score">' + fmt(s.leadership.score) + '</td></tr></tbody></table></div>' +
      '<p class="muted">Overall = 60% teaching + 40% leadership.</p>';
  }
  html += '<p>Overall: <span class="overall">' + fmt(s.overall) + '</span> ' + (s.rating ? '<span class="chip">' + esc(s.rating) + '</span>' : '') + '</p>';
  if (s.cappedBy) html += '<p class="warn">' + esc(s.cappedBy) + '</p>';
  if (s.warnings && s.warnings.length && !final) html += '<p class="warn">Still missing: ' + esc(s.warnings.join(' ')) + '</p>';
  html += secEvidence(s.evidence) + '</div>';
  return html;
}

function secEvidence(ev) {
  if (!ev) return '';
  let html = '<h3>Observation evidence this session</h3><div class="trackGrid">';
  Object.keys(ev.byTerm).forEach(function (t) {
    const x = ev.byTerm[t];
    const needsFormal = ev.formalTerms.indexOf(t) !== -1;
    html += '<div class="statCard"><span class="statLabel">' + esc(t) + '</span>' +
      (needsFormal ? '<div class="' + (x.formal ? 'ok' : 'muted') + '">Formal: ' + x.formal + ' / 1</div>' : '') +
      '<div class="' + (x.dropIns >= ev.dropInsPerTerm ? 'ok' : 'muted') + '">Drop-ins: ' + x.dropIns + ' / ' + ev.dropInsPerTerm + '</div></div>';
  });
  html += '</div><p class="muted">Months with a book check: ' + (ev.bookCheckMonths.length ? esc(ev.bookCheckMonths.join(', ')) : 'none yet') + '</p>';
  return html;
}

/* ---------- objectives ---------- */

function secObjectives(r) {
  const p = r.permissions;
  const ap = r.appraisal;
  const areas = state.me.lists.areas;
  let html = '<div class="card"><h2>Objectives</h2>';
  html += '<p class="muted">' + (ap['Objectives Agreed At'] ? 'Agreed by the staff member on ' + esc(ap['Objectives Agreed At']) + '.' : 'Not yet agreed by the staff member.') +
    (ap['Mid-Year Done At'] ? ' Mid-year review completed ' + esc(ap['Mid-Year Done At']) + '.' : '') + '</p>';
  if (!r.objectives.length) html += '<p class="subtitle">No objectives set yet. Agree 3–4 in the first term: one each for a student outcome, teaching practice, professional growth and a whole-school contribution.</p>';
  r.objectives.forEach(function (o) {
    html += '<div class="item"><strong>' + esc(o.Area) + ':</strong> ' + esc(o.Objective) +
      (o['Success Measure'] ? '<br><span class="muted">Success looks like: ' + esc(o['Success Measure']) + '</span>' : '') +
      (o['Mid-Year Note'] ? '<br><span class="muted">Mid-year: ' + esc(o['Mid-Year Note']) + '</span>' : '') +
      (o.Evidence ? '<br><span class="muted">Evidence: ' + esc(o.Evidence) + '</span>' : '') +
      (o.Rating !== '' && o.Rating !== null ? '<br><strong>Rating: ' + esc(RATING_WORDS[o.Rating] || o.Rating) + '</strong>' + (o['Rating Note'] ? ' <span class="muted">— ' + esc(o['Rating Note']) + '</span>' : '') : '');
    const acts = [];
    if (p.canAppraise) {
      acts.push('<button type="button" class="smallBtn" data-act="objEdit" data-id="' + esc(o.ID) + '">Edit</button>');
      acts.push('<button type="button" class="smallBtn" data-act="toggle" data-target="mid-' + esc(o.ID) + '">Mid-year note</button>');
      acts.push('<button type="button" class="smallBtn" data-act="toggle" data-target="rate-' + esc(o.ID) + '">Rate</button>');
      acts.push('<button type="button" class="smallBtn danger" data-act="toggle" data-target="wd-' + esc(o.ID) + '">Withdraw</button>');
    }
    if (p.canAppraiseeEdit && p.isSelf) acts.push('<button type="button" class="smallBtn" data-act="toggle" data-target="ev-' + esc(o.ID) + '">Add evidence</button>');
    if (acts.length) html += '<div class="itemActions">' + acts.join('') + '</div>';
    if (p.canAppraise) {
      html += '<form data-form="midYear" class="subForm hidden" id="mid-' + esc(o.ID) + '"><input type="hidden" name="id" value="' + esc(o.ID) + '">' +
        '<label>Mid-year progress note</label><textarea name="note" rows="2">' + esc(o['Mid-Year Note']) + '</textarea><button type="submit">Save note</button>' + msgLine() + '</form>';
      html += '<form data-form="rateObjective" class="subForm hidden" id="rate-' + esc(o.ID) + '"><input type="hidden" name="id" value="' + esc(o.ID) + '">' +
        '<label>Rating</label>' + ratingSelect('rating', o.Rating) + '<label>Evidence for this rating</label><textarea name="note" rows="2">' + esc(o['Rating Note']) + '</textarea>' +
        '<button type="submit">Save rating</button>' + msgLine() + '</form>';
      html += '<form data-form="withdrawObjective" class="subForm hidden" id="wd-' + esc(o.ID) + '" data-confirm="Withdraw this objective? It will no longer count.">' +
        '<input type="hidden" name="id" value="' + esc(o.ID) + '"><label>Reason</label><input name="reason" placeholder="e.g. replaced at mid-year review">' +
        '<button type="submit">Withdraw</button>' + msgLine() + '</form>';
    }
    if (p.canAppraiseeEdit && p.isSelf) {
      html += '<form data-form="evidence" class="subForm hidden" id="ev-' + esc(o.ID) + '"><input type="hidden" name="id" value="' + esc(o.ID) + '">' +
        '<label>Your evidence (what you did, links to documents)</label><textarea name="evidence" rows="3">' + esc(o.Evidence) + '</textarea>' +
        '<button type="submit">Save evidence</button>' + msgLine() + '</form>';
    }
    html += '</div>';
  });
  if (p.canAppraise) {
    html += '<form data-form="objective" id="objForm" class="subForm"><h3 id="objFormTitle">Add an objective</h3><input type="hidden" name="id">' +
      '<label>Area</label><select name="area">' + options(areas, '', 'Choose...') + '</select>' +
      '<label>Objective</label><textarea name="objective" rows="2" placeholder="e.g. Raise the share of JSS 2 students secure in algebra"></textarea>' +
      '<label>Success measure</label><input name="measure" placeholder="e.g. 70% score 60%+ on the Term 2 algebra test">' +
      '<button type="submit">Save objective</button> <button type="button" class="linkBtn" data-act="objClear">Clear</button>' + msgLine() + '</form>';
    if (r.objectives.length && !r.appraisal['Mid-Year Done At']) {
      html += '<form data-form="midYearDone" data-confirm="Mark the mid-year review as completed?"><button type="submit" class="smallBtn">Mark mid-year review completed</button>' + msgLine() + '</form>';
    }
  }
  if (p.canAppraiseeEdit && p.isSelf && !r.appraisal['Objectives Agreed At'] && r.objectives.length >= 3) {
    html += '<form data-form="agreeObjectives" data-confirm="Confirm you have discussed and agree these objectives?"><button type="submit">I agree these objectives</button>' + msgLine() + '</form>';
  }
  return html + '</div>';
}

/* ---------- observations ---------- */

function secObservations(r) {
  const p = r.permissions;
  let html = '<div class="card"><h2>Lesson observations</h2><p class="muted">Formal observations and drop-ins count equally. ' + esc(LEVELS_NOTE) + '</p>';
  if (!r.observations.length) html += '<p class="subtitle">None recorded yet.</p>';
  r.observations.slice().sort(function (a, b) { return String(b.Date).localeCompare(String(a.Date)); }).forEach(function (o) {
    const crit = state.me.lists.formalCriteria.filter(function (c) { return o[c] !== '' && o[c] !== null && o[c] !== undefined; })
      .map(function (c) { return esc(CRITERIA_LABELS[c][0]) + ': <strong>' + esc(o[c]) + '</strong>'; }).join(' · ');
    html += '<div class="item"><strong>' + esc(o.Type) + '</strong> — ' + esc(o.Date) + ' · ' + esc(o.Class) + (o.Subject ? ' · ' + esc(o.Subject) : '') +
      ' · Score <strong>' + fmt(o.Score) + '</strong>' + (yes(o['Books Checked']) ? ' · books checked' : '') +
      '<br><span class="muted">' + crit + '</span>' +
      (o.Strengths ? '<br><span class="muted">Strengths: ' + esc(o.Strengths) + '</span>' : '') +
      (o.Development ? '<br><span class="muted">Next steps: ' + esc(o.Development) + '</span>' : '') +
      '<br><span class="muted">Observer: ' + esc(o.Observer) + '</span>';
    if (p.canAppraise) html += '<div class="itemActions"><button type="button" class="smallBtn danger" data-act="toggle" data-target="void-' + esc(o.ID) + '">Void</button></div>' + voidForm('observation', o.ID);
    html += '</div>';
  });
  if (p.canAppraise) {
    html += '<button type="button" data-act="toggle" data-target="obsForm">Record an observation or drop-in</button>' +
      '<form data-form="observation" id="obsForm" class="subForm hidden">' +
      '<div class="row2"><div><label>Type</label><select name="type" data-act-change="obsType">' + options([['Formal', 'Formal observation (30–40 min)'], ['Drop-in', 'Unannounced drop-in (10–15 min)']], 'Drop-in') + '</select></div>' +
      '<div><label>Date</label><input type="date" name="date" value="' + today() + '" max="' + today() + '"></div></div>' +
      '<div class="row2"><div><label>Class</label><input name="className" value="' + esc(r.staff.className) + '"></div>' +
      '<div><label>Subject</label><input name="subject" placeholder="e.g. Mathematics"></div></div>' +
      '<div id="obsRubric">' + rubricHtml('Drop-in') + '</div>' +
      '<label class="check"><input type="checkbox" name="booksChecked"> Students\' books were checked on this visit</label>' +
      '<label>Strengths</label><textarea name="strengths" rows="2"></textarea>' +
      '<label>Next steps for development</label><textarea name="development" rows="2"></textarea>' +
      '<button type="submit">Save</button>' + msgLine() + '</form>';
  }
  return html + '</div>';
}

function rubricHtml(type) {
  const list = type === 'Formal' ? state.me.lists.formalCriteria : state.me.lists.dropInCriteria;
  return '<div class="rubric">' + list.map(function (c) {
    return '<div class="crit">' + esc(CRITERIA_LABELS[c][0]) + '<small>' + esc(CRITERIA_LABELS[c][1]) + '</small></div><div class="scorePick">' +
      [1, 2, 3, 4].map(function (n) { return '<label><input type="radio" name="crit:' + esc(c) + '" value="' + n + '"><span>' + n + '</span></label>'; }).join('') + '</div>';
  }).join('') + '</div>';
}

/* ---------- academic progress ---------- */

function secAcademic(r) {
  const p = r.permissions;
  const isForm = String(r.staff.framework).indexOf('Form Tutor') !== -1;
  const comp = r.summary.components.find(function (c) { return c.key === 'academic'; }) || {};
  const terms = state.me.lists.terms;
  let html = '<div class="card"><h2>Academic progress</h2>';
  html += '<p class="muted">Entered by the appraiser each term until the academic report system takes over: the % of students making expected progress against their baseline.' +
    (isForm ? ' For Form Tutors this is half the score; the other half is pastoral (form attendance, behaviour, reports on time).' : '') + '</p>';
  if (isForm) {
    html += '<p class="muted">Subjects taught: ' + (r.subjects.length ? esc(r.subjects.map(function (s) { return s.subject + ' (' + s.className + ')'; }).join(', '))
      : 'none recorded — scored on pastoral measures only. Head of IT can add subjects in Setup.') + '</p>';
  }
  const rows = r.academic;
  if (rows.length) {
    html += '<div class="tableWrap"><table class="dataTable"><thead><tr><th>Term</th><th>Class</th><th>Subject</th><th>% expected progress</th><th>Students</th><th>Context</th><th></th></tr></thead><tbody>';
    rows.forEach(function (a) {
      const v = a.Status === 'Void';
      html += '<tr' + (v ? ' style="opacity:.5"' : '') + '><td>' + esc(a.Term) + '</td><td>' + esc(a.Class) + '</td><td>' + esc(a.Subject) + '</td><td>' + esc(a['Pct Expected Progress']) + '%</td><td>' +
        esc(a.Students) + '</td><td class="muted">' + esc(a['Context Note']) + (v ? ' <span class="deletedBadge">VOID</span>' : '') + '</td><td>' +
        (p.canAppraise && !v ? '<button type="button" class="smallBtn danger" data-act="toggle" data-target="void-' + esc(a.ID) + '">Void</button>' : '') + '</td></tr>';
      if (p.canAppraise && !v) html += '<tr><td colspan="7" style="border:none;padding:0">' + voidForm('academic', a.ID) + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }
  if (comp.terms && comp.terms.length) {
    html += '<h3>Termly scores</h3>';
    comp.terms.forEach(function (t) {
      html += '<div class="item"><strong>' + esc(t.term) + ': ' + fmt(t.score) + '</strong>';
      if (t.pastoral) {
        const pp = t.pastoral;
        html += '<br><span class="muted">Form attendance ' + (pp.attendancePct === null ? '–' : pp.attendancePct + '%') + ' (' + fmt(pp.attendanceScore) + ') · ' +
          'no Level 2+ behaviour ' + (pp.behaviourCleanPct === null ? '–' : pp.behaviourCleanPct + '%') + ' (' + fmt(pp.behaviourScore) + ') · ' +
          'reports ' + esc(pp.reportsStatus || 'not entered') + (pp.reportsScore ? ' (' + pp.reportsScore + ')' : '') + '</span>';
      }
      html += '</div>';
    });
  }
  if (p.canAppraise) {
    const subjOpts = isForm
      ? '<label>Subject and class</label><select name="subjectClass">' + options(r.subjects.map(function (s) { return [s.subject + '||' + s.className, s.subject + ' — ' + s.className]; }), '', 'Choose...') + '</select>'
      : '<input type="hidden" name="subjectClass" value="All subjects||' + esc(r.staff.className) + '">';
    if (!isForm || r.subjects.length) {
      html += '<form data-form="academic" class="subForm"><h3>Enter academic progress</h3>' +
        '<div class="row2"><div><label>Term</label><select name="term">' + options(terms, r.term) + '</select></div><div>' + (isForm ? subjOpts : '<label>Class</label><input value="' + esc(r.staff.className) + '" disabled>' + subjOpts) + '</div></div>' +
        '<div class="row2"><div><label>% making expected progress</label><input type="number" name="pct" min="0" max="100" step="1"></div>' +
        '<div><label>Number of students</label><input type="number" name="students" min="1" step="1"></div></div>' +
        '<label>Context note (optional)</label><input name="note" placeholder="e.g. teacher changed mid-term">' +
        '<button type="submit">Save</button>' + msgLine() + '</form>';
    }
    if (isForm) {
      html += '<form data-form="pastoral" class="subForm"><h3>Form reports completed</h3><div class="row2"><div><label>Term</label><select name="term">' + options(terms, r.term) + '</select></div>' +
        '<div><label>Reports</label><select name="status">' + options(['On time', 'Late', 'Not done'], '', 'Choose...') + '</select></div></div>' +
        '<button type="submit">Save</button>' + msgLine() + '</form>';
    }
  }
  return html + '</div>';
}

/* ---------- conduct ---------- */

function secConduct(r) {
  const p = r.permissions;
  const c = (r.summary.components.find(function (x) { return x.key === 'conduct'; }) || {}).parts || {};
  const ap = r.appraisal;
  let html = '<div class="card"><h2>Professional conduct</h2><div class="tableWrap"><table class="dataTable"><thead><tr><th>Measure</th><th>Value</th><th>Score</th></tr></thead><tbody>' +
    '<tr><td>Punctuality (average on-time %)</td><td>' + (c.punctualityPct === null || c.punctualityPct === undefined ? '–' : c.punctualityPct + '%') + '</td><td>' + fmt(c.punctualityScore) + '</td></tr>' +
    '<tr><td>Unauthorised absence (days this session)</td><td>' + (c.absenceDays === null || c.absenceDays === undefined ? '–' : c.absenceDays) + '</td><td>' + fmt(c.absenceScore) + '</td></tr>' +
    '<tr><td>Spark Points logging (termly Teacher Performance score)</td><td>' + (c.sparkUsage === null || c.sparkUsage === undefined ? 'n/a' : c.sparkUsage) +
    (c.sparkUsageTerms && c.sparkUsageTerms.length ? ' <span class="muted">(' + esc(c.sparkUsageTerms.map(function (t) { return t.term + ' ' + t.score; }).join(', ')) + ')</span>' : '') + '</td><td>' + fmt(c.sparkUsageScore) + '</td></tr>' +
    '<tr><td>Safeguarding training up to date</td><td>' + (c.safeguardingTrainingScore === null || c.safeguardingTrainingScore === undefined ? 'not yet confirmed' : (c.safeguardingTrainingScore === 4 ? 'Yes' : 'No')) + '</td><td>' + fmt(c.safeguardingTrainingScore) + '</td></tr>' +
    '<tr><td>Appraiser\'s judgement (conduct, deadlines, code of conduct)</td><td class="muted">' + esc(ap['Conduct Note'] || '') + '</td><td>' + fmt(c.judgement) + '</td></tr>' +
    '</tbody></table></div>';
  if (r.punctuality.length) {
    html += '<p class="muted">Monthly punctuality: ' + esc(r.punctuality.map(function (m) { return String(m.Month).replace(/^'/, '') + ' ' + m['On-Time Pct'] + '% / ' + m['Unauthorised Absence Days'] + 'd'; }).join(' · ')) + '</p>';
  }
  if (p.canAppraise) {
    const tr = ap['Safeguarding Training Current'];
    html += '<form data-form="conduct" class="subForm"><h3>Appraiser\'s conduct judgement</h3>' +
      '<label>Judgement</label>' + ratingSelect('conductJudgement', ap['Conduct Judgement']) +
      '<label>Note (conduct with colleagues, students and parents; deadlines; code of conduct)</label><textarea name="conductNote" rows="2">' + esc(ap['Conduct Note']) + '</textarea>' +
      '<label>Safeguarding training up to date?</label><select name="safeguardingTraining">' +
      options([['yes', 'Yes'], ['no', 'No']], tr === '' || tr === undefined ? '' : (yes(tr) ? 'yes' : 'no'), 'Not yet confirmed') + '</select>' +
      '<button type="submit">Save</button>' + msgLine() + '</form>';
  }
  return html + '</div>';
}

/* ---------- CPD ---------- */

function secCpd(r) {
  const p = r.permissions;
  const ap = r.appraisal;
  let html = '<div class="card"><h2>CPD and contribution</h2>';
  html += '<p class="muted">Rating: <strong>' + (ap['CPD Rating'] !== '' && ap['CPD Rating'] !== undefined ? esc(RATING_WORDS[ap['CPD Rating']] || ap['CPD Rating']) : 'not yet rated') + '</strong>' +
    (ap['CPD Note'] ? ' — ' + esc(ap['CPD Note']) : '') + '</p>';
  if (!r.cpd.length) html += '<p class="subtitle">No activities logged yet.</p>';
  r.cpd.forEach(function (c) {
    const v = c.Status === 'Void';
    html += '<div class="item"' + (v ? ' style="opacity:.5"' : '') + '><strong>' + esc(c.Title) + '</strong> — ' + esc(c.Category) + ' · ' + esc(c.Date) +
      (yes(c.Verified) ? ' <span class="chip Locked">Verified</span>' : '') + (v ? ' <span class="deletedBadge">VOID</span>' : '') +
      '<br><span class="muted">' + esc(c.Reflection) + '</span>' +
      (c['Evidence Link'] ? '<br><a href="' + esc(c['Evidence Link']) + '" target="_blank" rel="noopener">Evidence</a>' : '');
    if (!v && (p.canAppraise || (p.canAppraiseeEdit && p.isSelf))) {
      html += '<div class="itemActions">' +
        (p.canAppraise ? '<button type="button" class="smallBtn" data-act="cpdVerify" data-id="' + esc(c.ID) + '" data-v="' + (yes(c.Verified) ? '0' : '1') + '">' + (yes(c.Verified) ? 'Unverify' : 'Verify') + '</button>' : '') +
        '<button type="button" class="smallBtn danger" data-act="toggle" data-target="void-' + esc(c.ID) + '">Void</button></div>' + voidForm('cpd', c.ID);
    }
    html += '</div>';
  });
  if (p.canAppraiseeEdit && p.isSelf) {
    html += '<button type="button" data-act="toggle" data-target="cpdForm">Log an activity</button><form data-form="cpd" id="cpdForm" class="subForm hidden">' +
      '<div class="row2"><div><label>Category</label><select name="category">' + options(state.me.lists.cpdCategories, '', 'Choose...') + '</select></div>' +
      '<div><label>Date</label><input type="date" name="date" value="' + today() + '"></div></div>' +
      '<label>Title</label><input name="title" placeholder="e.g. In-service day: assessment for learning">' +
      '<label>Reflection — what you learned or contributed, and how you have used it</label><textarea name="reflection" rows="3"></textarea>' +
      '<label>Evidence link (optional)</label><input name="link" placeholder="https://...">' +
      '<button type="submit">Save</button>' + msgLine() + '</form>';
  }
  if (p.canAppraise) {
    html += '<form data-form="cpdRating" class="subForm"><h3>CPD and contribution rating</h3>' + ratingSelect('cpdRating', ap['CPD Rating']) +
      '<label>Note</label><textarea name="cpdNote" rows="2">' + esc(ap['CPD Note']) + '</textarea><button type="submit">Save</button>' + msgLine() + '</form>';
  }
  return html + '</div>';
}

/* ---------- leadership (Section Heads) ---------- */

function secLeadership(r) {
  const p = r.permissions;
  const ap = r.appraisal;
  const h = r.summary.leadership ? r.summary.leadership.helper : null;
  let html = '<div class="card"><h2>Leadership</h2><p class="muted">Rated by the Head of School.' +
    (h && h.teamSize ? ' Observation work completed for their team so far this session: <strong>' + (h.observationWorkPct === null ? '–' : h.observationWorkPct + '%') + '</strong> (' + h.teamSize + ' staff).' : '') + '</p>';
  if (ap['Leadership Note']) html += '<p class="muted">' + esc(ap['Leadership Note']) + '</p>';
  if (p.canRateLeadership) {
    html += '<form data-form="leadership" class="subForm">' +
      '<label>Section performance (progress, attendance and behaviour across the section) — 15%</label>' + ratingSelect('sectionPerformance', ap['Section Performance']) +
      '<label>Staff development (observations, drop-ins and appraisals done on time and well) — 10%</label>' + ratingSelect('staffDevelopment', ap['Staff Development']) +
      '<label>Operational management (rotas, reports, escalations handled promptly) — 10%</label>' + ratingSelect('operational', ap['Operational Management']) +
      '<label>Communication with parents and the Head of School — 5%</label>' + ratingSelect('communication', ap['Communication']) +
      '<label>Note</label><textarea name="leadershipNote" rows="2">' + esc(ap['Leadership Note']) + '</textarea>' +
      '<button type="submit">Save</button>' + msgLine() + '</form>';
  }
  return html + '</div>';
}

/* ---------- safeguarding findings (Head of School only) ---------- */

function secFindings(r) {
  let html = '<div class="card"><h2>Safeguarding override</h2><p class="muted">Only formally upheld concerns, after investigation, belong here. Keep case details in the safeguarding file; record only a reference. Visible to the Head of School only; the staff member sees that the cap applies.</p>';
  r.findings.forEach(function (f) {
    const v = f.Status === 'Void';
    html += '<div class="item"' + (v ? ' style="opacity:.5"' : '') + '>Upheld ' + esc(f['Date Upheld']) + ' — ' + esc(f.Summary) + (v ? ' <span class="deletedBadge">VOID</span>' : '');
    if (!v && r.permissions.canAppraise) html += '<div class="itemActions"><button type="button" class="smallBtn danger" data-act="toggle" data-target="void-' + esc(f.ID) + '">Void</button></div>' + voidForm('finding', f.ID);
    html += '</div>';
  });
  if (r.permissions.canAppraise) {
    html += '<form data-form="finding" class="subForm" data-confirm="Record an upheld safeguarding concern? This caps the overall rating at Requires Improvement.">' +
      '<label>Date upheld</label><input type="date" name="dateUpheld" max="' + today() + '"><label>Reference</label><input name="summary" placeholder="e.g. Case SG-2026-014, upheld by DSL">' +
      '<button type="submit">Record finding</button>' + msgLine() + '</form>';
  }
  return html + '</div>';
}

/* ---------- workflow ---------- */

function secWorkflow(r) {
  const p = r.permissions;
  const ap = r.appraisal;
  const steps = [['Objectives agreed', ap['Objectives Agreed At']], ['Mid-year review', ap['Mid-Year Done At']], ['Submitted to Head of School', ap['Submitted At']],
    ['Finalised', ap['Finalised At']], ['Appeal deadline', ap['Appeal Deadline']], ['Signed off', ap['Signed At']], ['Locked', ap['Locked At']]]
    .filter(function (s) { return s[1]; });
  let html = '<div class="card"><h2>Progress and sign-off</h2>';
  html += steps.length ? '<p class="muted">' + steps.map(function (s) { return esc(s[0]) + ': ' + esc(s[1]); }).join(' · ') + '</p>' : '<p class="muted">Planning stage.</p>';
  if (ap['Moderation Note']) html += '<p><strong>Head of School\'s note:</strong> ' + esc(ap['Moderation Note']) + '</p>';
  if (ap['Appraisee Comment']) html += '<p><strong>Staff member\'s comment:</strong> ' + esc(ap['Appraisee Comment']) + '</p>';
  r.appeals.forEach(function (a) {
    html += '<div class="item"><strong>Appeal lodged ' + esc(a['Lodged At']) + ':</strong> ' + esc(a.Grounds) +
      (a.Outcome ? '<br><strong>' + esc(a.Outcome) + '</strong> — ' + esc(a['Outcome Note']) : '<br><span class="warn">Awaiting the Head of School.</span>') + '</div>';
  });
  const missing = r.summary.warnings || [];
  if (p.canSubmit) {
    html += '<form data-form="submit" data-confirm="Submit this appraisal to the Head of School? You will not be able to edit it afterwards.">' +
      (missing.length ? '<p class="warn">Check before submitting: ' + esc(missing.join(' ')) + '</p>' : '') +
      '<button type="submit">Submit to Head of School</button>' + msgLine() + '</form>';
  }
  if (p.canFinalise) {
    html += '<form data-form="finalise" class="subForm" data-confirm="Finalise this appraisal? The staff member is notified and has 5 working days to sign off or appeal.">' +
      '<h3>Finalise</h3>' + (missing.length ? '<p class="warn">Still missing: ' + esc(missing.join(' ')) + '</p>' : '') +
      '<label>Moderation note (optional, shown to the staff member)</label><textarea name="moderationNote" rows="2"></textarea>' +
      '<button type="submit">Finalise appraisal</button>' + msgLine() + '</form>';
  }
  if (p.canRespond) {
    html += '<form data-form="respond" class="subForm" data-confirm="Send your response? This cannot be changed afterwards.">' +
      '<h3>Your response</h3><p class="muted">Respond by ' + esc(ap['Appeal Deadline']) + '. If you do not respond, the appraisal locks automatically after that date.</p>' +
      '<label>Your comments (optional)</label><textarea name="comment" rows="3"></textarea>' +
      '<label class="check"><input type="radio" name="choice" value="sign"> I have read this appraisal and sign it off</label>' +
      '<label class="check"><input type="radio" name="choice" value="appeal"> I want to appeal</label>' +
      '<label>Grounds for appeal (only if appealing)</label><textarea name="grounds" rows="3"></textarea>' +
      '<button type="submit">Send response</button>' + msgLine() + '</form>';
  }
  if (p.canResolveAppeal) {
    html += '<form data-form="resolveAppeal" class="subForm" data-confirm="Record this appeal outcome? The staff member is emailed.">' +
      '<h3>Resolve appeal</h3><label class="check"><input type="radio" name="outcome" value="stands"> The rating stands (record locks)</label>' +
      '<label class="check"><input type="radio" name="outcome" value="reopen"> Reopen for review</label>' +
      '<label>Outcome and reasons</label><textarea name="note" rows="3"></textarea><button type="submit">Record outcome</button>' + msgLine() + '</form>';
  }
  if (p.canReopen) {
    html += '<button type="button" class="smallBtn" data-act="toggle" data-target="reopenForm">Reopen this appraisal</button>' +
      '<form data-form="reopen" id="reopenForm" class="subForm hidden" data-confirm="Reopen this appraisal? The final rating is cleared and the reason is logged.">' +
      '<label>Reason</label><input name="reason"><button type="submit">Reopen</button>' + msgLine() + '</form>';
  }
  return html + '</div>';
}

/* ---------- record actions ---------- */

function recordCall(action, extra, form, flash) {
  const btn = form ? form.querySelector('button[type="submit"]') : null;
  const msg = form ? form.querySelector('.formMsg') : null;
  if (btn) btn.disabled = true;
  if (msg) msg.textContent = '';
  return call(action, Object.assign({ staffEmail: state.recordEmail }, extra)).then(function (r) {
    if (btn) btn.disabled = false;
    if (!r || !r.success) {
      if (msg) msg.textContent = (r && r.error) || 'Could not save.';
      return;
    }
    state.flash = flash || 'Saved.';
    loadRecord(state.recordEmail, state.recordTarget);
  }).catch(function () {
    if (btn) btn.disabled = false;
    if (msg) msg.textContent = 'Could not reach the server. Nothing was saved — try again.';
  });
}

function val(form, name) { const el = form.elements[name]; return el ? String(el.value || '').trim() : ''; }
function radio(form, name) { const el = form.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ''; }

const FORMS = {
  objective: function (f) { recordCall('saveObjective', { id: val(f, 'id'), area: val(f, 'area'), objective: val(f, 'objective'), measure: val(f, 'measure') }, f, 'Objective saved.'); },
  midYear: function (f) { recordCall('saveMidYearNote', { id: val(f, 'id'), note: val(f, 'note') }, f, 'Mid-year note saved.'); },
  midYearDone: function (f) { recordCall('markMidYearDone', {}, f, 'Mid-year review marked complete.'); },
  rateObjective: function (f) { recordCall('rateObjective', { id: val(f, 'id'), rating: val(f, 'rating'), note: val(f, 'note') }, f, 'Rating saved.'); },
  withdrawObjective: function (f) { recordCall('withdrawObjective', { id: val(f, 'id'), reason: val(f, 'reason') }, f, 'Objective withdrawn.'); },
  evidence: function (f) { recordCall('saveObjectiveEvidence', { id: val(f, 'id'), evidence: val(f, 'evidence') }, f, 'Evidence saved.'); },
  agreeObjectives: function (f) { recordCall('agreeObjectives', {}, f, 'Objectives agreed.'); },
  observation: function (f) {
    const type = val(f, 'type');
    const list = type === 'Formal' ? state.me.lists.formalCriteria : state.me.lists.dropInCriteria;
    const scores = {};
    list.forEach(function (c) { scores[c] = radio(f, 'crit:' + c); });
    recordCall('saveObservation', { type: type, date: val(f, 'date'), className: val(f, 'className'), subject: val(f, 'subject'), scores: scores,
      booksChecked: f.elements.booksChecked.checked, strengths: val(f, 'strengths'), development: val(f, 'development') }, f, type + ' saved.');
  },
  academic: function (f) {
    const sc = val(f, 'subjectClass').split('||');
    recordCall('saveAcademic', { term: val(f, 'term'), subject: sc[0] || '', className: sc[1] || '', pct: val(f, 'pct'), students: val(f, 'students'), note: val(f, 'note') }, f, 'Academic progress saved.');
  },
  pastoral: function (f) { recordCall('savePastoral', { term: val(f, 'term'), status: val(f, 'status') }, f, 'Form reports status saved.'); },
  conduct: function (f) {
    const t = val(f, 'safeguardingTraining');
    recordCall('saveRatings', { conductJudgement: val(f, 'conductJudgement'), conductNote: val(f, 'conductNote'), safeguardingTraining: t === '' ? '' : t === 'yes' }, f, 'Conduct saved.');
  },
  cpd: function (f) { recordCall('addCpd', { category: val(f, 'category'), date: val(f, 'date'), title: val(f, 'title'), reflection: val(f, 'reflection'), link: val(f, 'link') }, f, 'Activity logged.'); },
  cpdRating: function (f) { recordCall('saveRatings', { cpdRating: val(f, 'cpdRating'), cpdNote: val(f, 'cpdNote') }, f, 'CPD rating saved.'); },
  leadership: function (f) {
    recordCall('saveRatings', { sectionPerformance: val(f, 'sectionPerformance'), staffDevelopment: val(f, 'staffDevelopment'), operational: val(f, 'operational'),
      communication: val(f, 'communication'), leadershipNote: val(f, 'leadershipNote') }, f, 'Leadership ratings saved.');
  },
  finding: function (f) { recordCall('addFinding', { dateUpheld: val(f, 'dateUpheld'), summary: val(f, 'summary') }, f, 'Finding recorded.'); },
  void: function (f) { recordCall('voidItem', { kind: val(f, 'kind'), id: val(f, 'id'), reason: val(f, 'reason') }, f, 'Item voided.'); },
  submit: function (f) { recordCall('submitToHeadOfSchool', {}, f, 'Submitted to the Head of School.'); },
  finalise: function (f) { recordCall('finalise', { moderationNote: val(f, 'moderationNote') }, f, 'Appraisal finalised. The staff member has been emailed.'); },
  respond: function (f) {
    const choice = radio(f, 'choice');
    if (!choice) { f.querySelector('.formMsg').textContent = 'Choose to sign off or appeal.'; return; }
    recordCall('respond', { choice: choice, comment: val(f, 'comment'), grounds: val(f, 'grounds') }, f, choice === 'sign' ? 'Signed off. Thank you.' : 'Appeal lodged with the Head of School.');
  },
  resolveAppeal: function (f) { recordCall('resolveAppeal', { outcome: radio(f, 'outcome'), note: val(f, 'note') }, f, 'Appeal outcome recorded.'); },
  reopen: function (f) { recordCall('reopen', { reason: val(f, 'reason') }, f, 'Appraisal reopened.'); },
  punctuality: null
};

/* Risky actions go through an on-page confirmation (not a native confirm()
   popup, which gets reflexively dismissed) — same approach as Spark Points. */
function showConfirm(form) {
  if (form.querySelector('.confirmBox')) return;
  const box = document.createElement('div');
  box.className = 'confirmBox';
  box.innerHTML = '<p style="margin:0">' + esc(form.getAttribute('data-confirm')) + '</p>' +
    '<button type="button" data-act="confirmYes">Confirm</button> <button type="button" class="linkBtn" data-act="confirmNo">Cancel</button>';
  form.appendChild(box);
  const sub = form.querySelector('button[type="submit"]');
  if (sub) sub.classList.add('hidden');
}

function closeConfirm(form) {
  const box = form.querySelector('.confirmBox');
  if (box) box.remove();
  const sub = form.querySelector('button[type="submit"]');
  if (sub) sub.classList.remove('hidden');
}

/* ---------- team ---------- */

function loadTeam() {
  $('teamList').innerHTML = '<p class="subtitle">Loading...</p>';
  call('getTeam').then(function (r) {
    if (!r || !r.success) { $('teamList').innerHTML = '<p class="error">' + esc((r && r.error) || 'Could not load your team.') + '</p>'; return; }
    state.team = r.rows;
    const priority = { Submitted: 0, Appeal: 1, Planning: 2, Finalised: 3, Locked: 4 };
    const rows = r.rows.slice().sort(function (a, b) {
      return state.me.isHeadOfSchool ? ((priority[a.status] - priority[b.status]) || a.name.localeCompare(b.name)) : a.name.localeCompare(b.name);
    });
    if (!rows.length) { $('teamList').innerHTML = '<p class="subtitle">Nobody is assigned to you for appraisal.</p>'; return; }
    $('teamList').innerHTML = '<p class="subtitle">' + esc(r.term) + ': at least 1 formal observation (First and Second Term), ' + r.dropInsPerTerm + ' drop-ins per term, and a book check every month.</p>' +
      '<div class="tableWrap"><table class="dataTable"><thead><tr><th>Name</th><th>Class</th><th>Status</th><th>Objectives</th><th>Formal (term)</th><th>Drop-ins (term)</th><th>Books (month)</th><th>Rating</th></tr></thead><tbody>' +
      rows.map(function (t) {
        return '<tr class="clickable" data-act="openStaff" data-email="' + esc(t.email) + '"><td><strong>' + esc(t.name) + '</strong><br><span class="muted">' + esc(t.framework) +
          (state.me.isHeadOfSchool ? (t.firstAppraiser ? ' · via Section Head' : ' · direct') : '') + '</span></td><td>' + esc(t.className) + '</td><td>' + chip(t.status) + '</td>' +
          '<td>' + (t.objectivesAgreed ? '<span class="ok">Agreed</span>' : '–') + '</td><td>' + t.formalThisTerm + '</td>' +
          '<td class="' + (t.dropInsThisTerm >= r.dropInsPerTerm ? 'ok' : '') + '">' + t.dropInsThisTerm + ' / ' + r.dropInsPerTerm + '</td>' +
          '<td>' + (t.bookCheckThisMonth ? '<span class="ok">Done</span>' : '–') + '</td><td>' + esc(t.rating || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }).catch(function () { $('teamList').innerHTML = '<p class="error">Could not reach the server.</p>'; });
}

function openStaff(email) {
  $('teamList').classList.add('hidden');
  $('teamRecordWrap').classList.remove('hidden');
  state.record = null;
  loadRecord(email, 'teamRecord');
  window.scrollTo(0, 0);
}

function backToTeam() {
  $('teamRecordWrap').classList.add('hidden');
  $('teamList').classList.remove('hidden');
  loadTeam();
}

/* ---------- punctuality ---------- */

function loadPunctuality() {
  if (!$('punctualityMonth').value) $('punctualityMonth').value = today().slice(0, 7);
  $('punctualityMonth').max = today().slice(0, 7);
  $('punctualityError').textContent = '';
  $('punctualitySuccess').textContent = '';
  $('punctualityTable').innerHTML = '<p class="subtitle">Loading...</p>';
  call('getPunctuality', { month: $('punctualityMonth').value }).then(function (r) {
    if (!r || !r.success) { $('punctualityError').textContent = (r && r.error) || 'Could not load punctuality.'; $('punctualityTable').innerHTML = ''; return; }
    state.punctuality = r;
    $('punctualityTable').innerHTML = '<div class="tableWrap"><table class="dataTable"><thead><tr><th>Staff</th><th>On-time %</th><th>Unauthorised absence (days)</th></tr></thead><tbody>' +
      r.rows.map(function (s) {
        return '<tr data-email="' + esc(s.email) + '"><td>' + esc(s.name) + (s.enteredBy ? '<br><span class="muted">by ' + esc(s.enteredBy) + '</span>' : '') + '</td>' +
          '<td><input type="number" class="punctPct" min="0" max="100" step="1" value="' + esc(s.onTimePct) + '"></td>' +
          '<td><input type="number" class="punctDays" min="0" step="1" value="' + esc(s.absenceDays) + '"></td></tr>';
      }).join('') + '</tbody></table></div>';
  }).catch(function () { $('punctualityError').textContent = 'Could not reach the server.'; });
}

function savePunctuality() {
  const rows = [];
  document.querySelectorAll('#punctualityTable tr[data-email]').forEach(function (tr) {
    rows.push({ email: tr.getAttribute('data-email'), onTimePct: tr.querySelector('.punctPct').value, absenceDays: tr.querySelector('.punctDays').value });
  });
  const incomplete = rows.filter(function (x) { return (x.onTimePct === '') !== (x.absenceDays === ''); });
  if (incomplete.length) { $('punctualityError').textContent = 'Fill in both columns for each person you enter (use 0 for no absence).'; return; }
  $('punctualitySaveBtn').disabled = true;
  $('punctualityError').textContent = '';
  call('savePunctuality', { month: $('punctualityMonth').value, rows: rows }).then(function (r) {
    $('punctualitySaveBtn').disabled = false;
    if (!r || !r.success) { $('punctualityError').textContent = (r && r.error) || 'Could not save.'; return; }
    loadPunctuality();
    setTimeout(function () { $('punctualitySuccess').textContent = 'Saved — ' + r.saved + ' change' + (r.saved === 1 ? '' : 's') + '.'; }, 300);
  }).catch(function () {
    $('punctualitySaveBtn').disabled = false;
    $('punctualityError').textContent = 'Could not reach the server. Nothing was saved — try again.';
  });
}

/* ---------- setup ---------- */

function loadSetup() {
  $('setupContent').innerHTML = '<p class="subtitle">Loading...</p>';
  call('getSetup').then(function (r) {
    if (!r || !r.success) { $('setupContent').innerHTML = '<p class="error">' + esc((r && r.error) || 'Could not load setup.') + '</p>'; return; }
    state.setup = r;
    renderSetup();
  }).catch(function () { $('setupContent').innerHTML = '<p class="error">Could not reach the server.</p>'; });
}

function appraiserOptions(selected) {
  return options(state.setup.appraisers.map(function (a) { return [a.email, a.name]; }), selected, 'Head of School (direct)');
}

function renderSetup() {
  const s = state.setup;
  const listed = s.appraisees.map(function (a) { return a.email; });
  let html = '<div class="tableWrap"><table class="dataTable"><thead><tr><th>Staff</th><th>Framework</th><th>Class</th><th>First appraiser</th><th>Active</th><th></th></tr></thead><tbody>';
  s.appraisees.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }).forEach(function (a) {
    const key = esc(a.email);
    const isForm = String(a.framework).indexOf('Form Tutor') !== -1;
    const subj = s.subjects.filter(function (x) { return x.email === a.email; });
    html += '<tr data-email="' + key + '"><td><strong>' + esc(a.name) + '</strong><br><span class="muted">' + key + '</span>' +
      (isForm ? '<br><span class="muted">Subjects: ' + (subj.length ? esc(subj.map(function (x) { return x.subject + ' (' + x.className + ')'; }).join(', ')) : 'none') + '</span>' : '') + '</td>' +
      '<td><select class="suFramework">' + options(s.frameworks, a.framework) + '</select></td>' +
      '<td><select class="suClass">' + options(s.classes, a.className, 'Choose...') + '</select></td>' +
      '<td><select class="suAppraiser">' + appraiserOptions(a.firstAppraiser) + '</select></td>' +
      '<td><input type="checkbox" class="suActive"' + (a.active ? ' checked' : '') + '></td>' +
      '<td><button type="button" class="smallBtn" data-act="saveAppraisee" data-email="' + key + '">Save</button>' +
      (isForm ? ' <button type="button" class="smallBtn" data-act="toggle" data-target="subj-' + key + '">Subjects</button>' : '') +
      '<p class="error suMsg"></p></td></tr>';
    if (isForm) html += '<tr><td colspan="6" style="border:none;padding:0">' + subjectsEditor(a.email, subj) + '</td></tr>';
  });
  html += '</tbody></table></div>';

  const notListed = s.users.filter(function (u) { return listed.indexOf(u.email) === -1 && ['Head of School', 'Head of IT', 'School Governor', 'Bursar'].indexOf(u.role) === -1; });
  html += '<div class="subForm"><h3>Add someone to appraisal</h3>' +
    (notListed.length ? '<div id="addAppraiseeRow"><label>Staff member</label><select class="suEmail">' + options(notListed.map(function (u) { return [u.email, u.name + ' — ' + u.role]; }), '', 'Choose...') + '</select>' +
      '<div class="row2"><div><label>Framework</label><select class="suFramework">' + options(s.frameworks, '') + '</select></div>' +
      '<div><label>Class</label><select class="suClass">' + options(s.classes, '', 'Choose...') + '</select></div></div>' +
      '<label>First appraiser</label><select class="suAppraiser">' + appraiserOptions('') + '</select>' +
      '<button type="button" data-act="addAppraisee">Add</button><p class="error suMsg"></p></div>'
      : '<p class="subtitle">Every teaching member of staff is already listed.</p>') + '</div>';
  $('setupContent').innerHTML = html;
}

function subjectsEditor(email, subj) {
  const rows = subj.length ? subj : [{ subject: '', className: '' }];
  return '<div class="subForm hidden" id="subj-' + esc(email) + '"><p class="muted">Subjects this Form Tutor teaches, with the class for each. Their academic half is calculated from these.</p>' +
    '<div class="subjRows">' + rows.map(function (x) { return subjectRow(x.subject, x.className); }).join('') + '</div>' +
    '<button type="button" class="smallBtn" data-act="addSubjectRow">Add row</button> ' +
    '<button type="button" class="smallBtn" data-act="saveSubjects" data-email="' + esc(email) + '">Save subjects</button><p class="error suMsg"></p></div>';
}

function subjectRow(subject, cls) {
  return '<div class="row2 subjRow"><div><input class="sjSubject" placeholder="Subject, e.g. Mathematics" value="' + esc(subject) + '"></div>' +
    '<div><select class="sjClass">' + options(state.setup.classes, cls, 'Class...') + '</select></div></div>';
}

function saveAppraiseeFrom(container, email, btn) {
  const msg = container.querySelector('.suMsg');
  msg.textContent = '';
  btn.disabled = true;
  const active = container.querySelector('.suActive');
  call('saveAppraisee', { targetEmail: email, framework: container.querySelector('.suFramework').value, className: container.querySelector('.suClass').value,
    firstAppraiser: container.querySelector('.suAppraiser').value, active: active ? active.checked : true }).then(function (r) {
    btn.disabled = false;
    if (!r || !r.success) { msg.textContent = (r && r.error) || 'Could not save.'; return; }
    loadSetup();
  }).catch(function () { btn.disabled = false; msg.textContent = 'Could not reach the server.'; });
}

/* ---------- wiring ---------- */

function handleAct(act, el) {
  if (act === 'toggle') { const t = $(el.getAttribute('data-target')); if (t) t.classList.toggle('hidden'); return; }
  if (act === 'confirmYes') { const f = el.closest('form'); closeConfirm(f); FORMS[f.getAttribute('data-form')](f); return; }
  if (act === 'confirmNo') { closeConfirm(el.closest('form')); return; }
  if (act === 'openStaff') { openStaff(el.getAttribute('data-email')); return; }
  if (act === 'backToTeam') { backToTeam(); return; }
  if (act === 'objEdit') {
    const o = state.record.objectives.find(function (x) { return x.ID === el.getAttribute('data-id'); });
    const f = $('objForm');
    if (!o || !f) return;
    f.elements.id.value = o.ID; f.elements.area.value = o.Area; f.elements.objective.value = o.Objective; f.elements.measure.value = o['Success Measure'] || '';
    $('objFormTitle').textContent = 'Edit objective';
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (act === 'objClear') { const f = $('objForm'); f.reset(); f.elements.id.value = ''; $('objFormTitle').textContent = 'Add an objective'; return; }
  if (act === 'cpdVerify') { recordCall('verifyCpd', { id: el.getAttribute('data-id'), verified: el.getAttribute('data-v') === '1' }, null, 'CPD entry updated.'); return; }
  if (act === 'saveAppraisee') { saveAppraiseeFrom(el.closest('tr'), el.getAttribute('data-email'), el); return; }
  if (act === 'addAppraisee') {
    const box = $('addAppraiseeRow');
    const email = box.querySelector('.suEmail').value;
    if (!email) { box.querySelector('.suMsg').textContent = 'Choose a staff member.'; return; }
    saveAppraiseeFrom(box, email, el);
    return;
  }
  if (act === 'addSubjectRow') { el.parentNode.querySelector('.subjRows').insertAdjacentHTML('beforeend', subjectRow('', '')); return; }
  if (act === 'saveSubjects') {
    const box = el.parentNode;
    const rows = [];
    box.querySelectorAll('.subjRow').forEach(function (r) { rows.push({ subject: r.querySelector('.sjSubject').value, className: r.querySelector('.sjClass').value }); });
    const msg = box.querySelector('.suMsg');
    el.disabled = true; msg.textContent = '';
    call('saveSubjects', { targetEmail: el.getAttribute('data-email'), rows: rows }).then(function (r) {
      el.disabled = false;
      if (!r || !r.success) { msg.textContent = (r && r.error) || 'Could not save.'; return; }
      loadSetup();
    }).catch(function () { el.disabled = false; msg.textContent = 'Could not reach the server.'; });
  }
}

function wire() {
  if (window.__appraisalWired) return;
  window.__appraisalWired = true;

  const needed = ['signInScreen', 'mainScreen', 'signInForm', 'staffEmail', 'staffCode', 'rememberMeToggle', 'signInBtn', 'signInError',
    'staffNameDisplay', 'staffRoleDisplay', 'sessionDisplay', 'signOutBtn', 'developmentalBanner', 'noAccessNote',
    'myTab', 'myTabBtn', 'myRecord', 'teamTab', 'teamTabBtn', 'teamList', 'teamRecordWrap', 'teamRecord',
    'punctualityTab', 'punctualityTabBtn', 'punctualityMonth', 'punctualityTable', 'punctualitySaveBtn', 'punctualityError', 'punctualitySuccess',
    'setupTab', 'setupTabBtn', 'setupContent'];
  const missing = needed.filter(function (id) { return !document.getElementById(id); });
  if (missing.length) { fatal('index.html is missing these elements: ' + missing.join(', ')); return; }

  $('signInForm').addEventListener('submit', function (e) { e.preventDefault(); trySignIn($('staffEmail').value, $('staffCode').value); });
  $('signOutBtn').addEventListener('click', signOut);
  document.querySelectorAll('.tabBtn').forEach(function (b) { b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); }); });
  $('punctualityMonth').addEventListener('change', loadPunctuality);
  $('punctualitySaveBtn').addEventListener('click', savePunctuality);

  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-act]');
    if (el) handleAct(el.getAttribute('data-act'), el);
  });
  document.addEventListener('submit', function (e) {
    const f = e.target.closest('form[data-form]');
    if (!f || !FORMS[f.getAttribute('data-form')]) return;
    e.preventDefault();
    if (f.getAttribute('data-confirm')) { showConfirm(f); return; }
    FORMS[f.getAttribute('data-form')](f);
  });
  document.addEventListener('change', function (e) {
    if (e.target.getAttribute && e.target.getAttribute('data-act-change') === 'obsType') {
      $('obsRubric').innerHTML = rubricHtml(e.target.value);
    }
  });

  let savedEmail, savedCode;
  try {
    savedEmail = localStorage.getItem(STORE_EMAIL) || sessionStorage.getItem(STORE_EMAIL);
    savedCode = localStorage.getItem(STORE_CODE) || sessionStorage.getItem(STORE_CODE);
  } catch (e) {}
  if (savedEmail && savedCode) {
    $('staffEmail').value = savedEmail;
    $('staffCode').value = savedCode;
    try { if (localStorage.getItem(STORE_EMAIL)) $('rememberMeToggle').checked = true; } catch (e) {}
    trySignIn(savedEmail, savedCode);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
else wire();
