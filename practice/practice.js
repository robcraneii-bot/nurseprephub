/* NursePrepHub practice engine: Dosage Calculation Challenge + Question Bank.
   Questions come from the server without answer keys; /api/practice/check grades and returns the explanation.
   Uses the hub's globals: $, $$, esc, ico, BY (tool registry), openTool. */
(function () {
  const API = '/api/practice';
  const LS = 'nph_practice';
  const DISCLAIMER = 'Illustrative educational question. Clinical decisions depend on the full patient assessment.';
  const CHOICE = ['mc', 'priority', 'delegation', 'ekg', 'case'];
  const FORMAT_LABEL = { mc: 'Multiple choice', sata: 'Select all that apply', priority: 'Prioritization', delegation: 'Delegation', case: 'Clinical judgment', order: 'Ordering', calc: 'Calculation', ekg: 'EKG rhythm', match: 'Matching', fill: 'Fill in the blank', matrix: 'Matrix', cloze: 'Drop-down' };
  const NCJMM_LABEL = { 'recognize-cues': 'Recognize cues', 'analyze-cues': 'Analyze cues', 'prioritize-hypotheses': 'Prioritize hypotheses', 'generate-solutions': 'Generate solutions', 'take-action': 'Take action', 'evaluate-outcomes': 'Evaluate outcomes' };
  const FLAG_LABEL = { high: 'High', low: 'Low', crit: 'Critical', abn: 'Abnormal' };
  const DIFF_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', nclex: 'NCLEX level' };
  const PRO = '<span class="pro-chip">Pro · Coming soon</span>';

  /* ── saved progress (this device) ── */
  const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } };
  const save = s => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) {} };
  function setState(set) { const s = load(); return s[set] || { items: {}, pos: {} }; }
  function patchItem(set, id, patch) { const s = load(); s[set] = s[set] || { items: {}, pos: {} }; s[set].items[id] = { ...(s[set].items[id] || {}), ...patch }; save(s); }
  function getItem(set, id) { return setState(set).items[id] || {}; }
  function setPos(set, key, i) { const s = load(); s[set] = s[set] || { items: {}, pos: {} }; s[set].pos = s[set].pos || {}; s[set].pos[key] = i; save(s); }

  async function api(path, body) {
    const r = await fetch(API + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Check your connection and try again.');
    return j;
  }

  /* ── text helpers ── */
  const NUM = /(?<![A-Za-z])(\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(\s?(?:mcg\/kg\/min|mg\/kg\/day|mg\/kg\/hr|mg\/kg|mcg\/min|mg\/min|mg\/hr|units\/hr|units\/kg|mL\/hr|mL\/h|mL\/min|gtt\/mL|gtt\/min|mg\/mL|mcg\/mL|units\/mL|mEq\/L|mEq|mcg|mg|kg|lbs?|mL|L|g|units?|tablets?|tabs?|capsules?|caps?|oz|tsp|tbsp|hours?|hrs?|hr|minutes?|min|%)(?![A-Za-z]))?/g;
  const hl = t => esc(t || '').replace(NUM, m => `<b class="num">${m}</b>`).replace(/\n/g, '<br>');
  const txt = t => esc(t || '').replace(/\n/g, '<br>');

  /* ── state ── */
  let SETS = null;            // list from /sets
  const DATA = {};            // set id -> full public set
  let S = null;               // current session: { set, data, key, title, ids, i, mode, cat }
  const host = () => document.getElementById('practice-root');

  async function getSets(force) { if (!SETS || force) SETS = await api('/sets'); return SETS; }
  async function getSet(id) { if (!DATA[id]) DATA[id] = await api('/sets/' + encodeURIComponent(id)); return DATA[id]; }

  function stats(set, ids) {
    const items = setState(set).items; let done = 0, right = 0;
    ids.forEach(id => { const it = items[id]; if (it && it.result) { done++; if (it.result.correct && !it.result.revealed) right++; } });
    return { done, right, total: ids.length, pct: done ? Math.round(right / done * 100) : 0 };
  }
  const missedIds = (set, ids) => ids.filter(id => { const r = (setState(set).items[id] || {}).result; return r && (!r.correct || r.revealed); });

  /* ── routing: #practice, #practice/<set>, #practice/<set>/<category> ── */
  async function route(sub) {
    const el = host(); if (!el) return;
    const [setId, cat] = (sub || '').split('/');
    if (!setId) return renderHome();
    el.innerHTML = '<div class="pp-loading">Loading questions…</div>';
    try {
      const data = await getSet(setId);
      if (data.mode === 'case') return cat ? startCase(setId, data, cat) : renderCaseIndex(data);
      const qs = data.questions.filter(q => !cat || q.category === cat);
      const ordered = data.mode === 'dosage' ? qs.slice().sort((a, b) => (a.number || 0) - (b.number || 0)) : qs;
      const key = cat || 'all';
      const catName = cat ? (data.categories.find(c => c.id === cat) || {}).name : '';
      S = { set: setId, data, key, cat, title: catName ? `${data.title}: ${catName}` : data.title, ids: ordered.map(q => q.id), all: ordered.map(q => q.id), mode: 'all', i: 0 };
      if (!S.ids.length) return renderEmpty();
      S.i = Math.min((setState(setId).pos || {})[key] || 0, S.ids.length - 1);
      renderQuestion();
    } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  /* ── practice home ── */
  async function renderHome() {
    const el = host();
    el.innerHTML = '<div class="pp-loading">Loading…</div>';
    let sets;
    try { sets = await getSets(true); } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const dose = sets.find(s => s.mode === 'dosage'), banks = sets.filter(s => s.mode === 'bank' || !s.mode), caseSets = sets.filter(s => s.mode === 'case');
    const row = (s, cat, name, count, extra) => {
      const href = `#practice/${s.set}${cat ? '/' + cat : ''}`;
      const items = setState(s.set).items; let done = 0, right = 0;
      Object.entries(items).forEach(([, it]) => { if (it.cat === (cat || it.cat) && it.result) { done++; if (it.result.correct && !it.result.revealed) right++; } });
      const prog = count ? (done ? `${done} of ${count} done · ${Math.round(right / done * 100)}% correct` : `${count} question${count === 1 ? '' : 's'}`) : 'Questions coming soon';
      return `<a class="pr-row${count ? '' : ' off'}" ${count ? `href="${href}"` : 'aria-disabled="true"'}><div><b>${esc(name)}</b>${extra ? `<small>${esc(extra)}</small>` : ''}</div><span class="pr-prog">${prog}</span>${count ? `<span class="go">${ico('arrow')}</span>` : ''}</a>`;
    };
    let html = `<div class="vh"><h1>Practice</h1><p>Work through questions one at a time. Every answer comes with a step-by-step explanation. Free for everyone.</p></div>`;
    if (dose) html += `<section class="pr-sec"><div class="sh"><h2>${ico('calc')}${esc(dose.title)}</h2><span class="tier free">Free</span></div><p class="pr-desc">${esc(dose.description)}</p>
      <div class="pr-list">${row(dose, '', dose.total ? 'All dosage questions' : dose.title, dose.total, dose.total ? dose.categories.filter(c => c.count).map(c => c.name).join(' · ') : 'The dosage questions will appear here once they are added.')}</div></section>`;
    banks.forEach(b => {
      html += `<section class="pr-sec"><div class="sh"><h2>${ico('clip')}${esc(b.title)}</h2><span class="tier free">Free</span></div><p class="pr-desc">${esc(b.description)}</p>
        <div class="pr-list">${b.total > 1 ? row(b, '', 'Mixed: all categories', b.total) : ''}${b.categories.map(c => row(b, c.id, c.name, c.count, c.example)).join('')}</div></section>`;
    });
    caseSets.forEach(cs => {
      html += `<section class="pr-sec"><div class="sh"><h2>${ico('doc')}${esc(cs.title)}</h2><span class="tier free">Free</span></div><p class="pr-desc">${esc(cs.description)}</p>
        <div class="pr-list">${cs.cases.length ? cs.cases.map(c => caseRow(cs, c)).join('') : '<a class="pr-row off" aria-disabled="true"><div><b>Case studies</b><small>Cases are being written and reviewed.</small></div><span class="pr-prog">Coming soon</span></a>'}</div></section>`;
    });
    html += proPanel('practice');
    el.innerHTML = html;
  }

  /* ── case studies: unfolding NGN-style cases with a patient chart ── */
  function caseProgress(set, ids) {
    const items = setState(set).items; let done = 0, right = 0;
    ids.forEach(id => { const r = (items[id] || {}).result; if (r) { done++; if (r.correct && !r.revealed) right++; } });
    return { done, right, total: ids.length };
  }
  function caseRow(cs, c) {
    const p = caseProgress(cs.set, c.questions);
    const cat = (cs.categories.find(x => x.id === c.category) || {}).name || '';
    const prog = p.done === p.total ? `Finished · ${p.right} of ${p.total} correct` : p.done ? `${p.done} of ${p.total} answered` : `${c.stages} stages · ${p.total} questions`;
    const sub = [cat, c.setting, DIFF_LABEL[c.difficulty]].filter(Boolean).join(' · ');
    return `<a class="pr-row" href="#practice/${esc(cs.set)}/${esc(c.id)}"><div><b>${esc(c.title)}</b><small>${esc(sub)}${c.summary ? ` · ${esc(c.summary)}` : ''}</small></div><span class="pr-prog">${prog}</span><span class="go">${ico('arrow')}</span></a>`;
  }
  function renderCaseIndex(data) {
    const summary = data.cases.map(c => ({ ...c, questions: c.stages.flatMap(s => s.questions), stages: c.stages.length }));
    host().innerHTML = `<header class="pp-top"><a class="pp-crumb" href="#practice">${ico('back')}Practice</a><h1>${esc(data.title)}</h1><p>${esc(data.description)}</p></header>
      <div class="pr-list">${summary.map(c => caseRow(data, c)).join('') || '<p class="empty">Cases are being written and reviewed.</p>'}</div>`;
  }
  function startCase(setId, data, caseId) {
    const c = data.cases.find(x => x.id === caseId);
    if (!c) { host().innerHTML = `<div class="empty">That case was not found.</div><p class="pp-back"><a href="#practice">${ico('back')} Back to Practice</a></p>`; return; }
    const ids = c.stages.flatMap(s => s.questions), stageOf = {};
    c.stages.forEach((s, i) => s.questions.forEach(id => stageOf[id] = i));
    S = { set: setId, data, key: 'case:' + c.id, cat: '', case: c, stageOf, tab: null, title: c.title, ids, all: ids.slice(), mode: 'all', i: 0 };
    // Resume where the student stopped, but never past the first unanswered question.
    const items = setState(setId).items, firstOpen = ids.findIndex(id => !(items[id] || {}).result);
    S.i = Math.min((setState(setId).pos || {})[S.key] || 0, firstOpen < 0 ? ids.length - 1 : firstOpen);
    renderQuestion();
  }
  function chartHtml() {
    const c = S.case, cur = S.stageOf[S.ids[S.i]];
    const entries = c.stages.slice(0, cur + 1).flatMap((s, si) => (s.chart || []).map(en => ({ ...en, isNew: si === cur && cur > 0 })));
    const newTabs = new Set(entries.filter(e => e.isNew).map(e => e.tab));
    if (!S.tab || !c.tabs.some(t => t.id === S.tab)) S.tab = (c.tabs.find(t => newTabs.has(t.id)) || c.tabs[0]).id;
    const stage = c.stages[cur];
    const body = entries.filter(e => e.tab === S.tab).reverse().map(e => `<div class="ch-entry${e.isNew ? ' new' : ''}">
        <div class="ch-eh">${e.time ? `<b>${esc(e.time)}</b>` : ''}${e.title ? `<span>${esc(e.title)}</span>` : ''}${e.isNew ? '<em class="qtag">New</em>' : ''}</div>
        ${e.text ? `<p>${hl(e.text)}</p>` : ''}
        ${e.rows ? `<table class="ch-t"><tbody>${e.rows.map(r => `<tr class="${r[2] ? 'flag ' + esc(r[2]) : ''}"><th scope="row">${esc(r[0])}</th><td>${esc(r[1])}${r[2] ? ` <span class="fl">${esc(FLAG_LABEL[r[2]] || r[2])}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
      </div>`).join('') || '<p class="ch-none">No entries in this section yet.</p>';
    return `<section class="case-wrap" aria-label="Case information">
      ${stage.title || stage.text ? `<div class="case-upd">${stage.title ? `<h3>${esc(stage.title)}</h3>` : ''}${stage.text ? `<p>${hl(stage.text)}</p>` : ''}</div>` : ''}
      <div class="chart"><div class="ch-tabs" role="tablist" aria-label="Patient chart">${c.tabs.map(t => `<button role="tab" id="cht-${esc(t.id)}" aria-selected="${t.id === S.tab}" aria-controls="ch-panel" data-tab="${esc(t.id)}" tabindex="${t.id === S.tab ? 0 : -1}">${esc(t.name || t.id)}${newTabs.has(t.id) ? '<i class="dot" aria-label="new entries"></i>' : ''}</button>`).join('')}</div>
      <div class="ch-body" id="ch-panel" role="tabpanel" aria-labelledby="cht-${esc(S.tab)}" tabindex="0">${body}</div></div>
    </section>`;
  }
  function wireChart() {
    const tl = host().querySelector('.ch-tabs'); if (!tl) return;
    const pick = id => { S.tab = id; const ch = host().querySelector('.case-wrap'); ch.outerHTML = chartHtml(); wireChart(); host().querySelector(`[data-tab="${CSS.escape(id)}"]`).focus(); };
    tl.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) pick(b.dataset.tab); });
    tl.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); const tabs = S.case.tabs.map(t => t.id), i = tabs.indexOf(S.tab);
      pick(tabs[e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]);
    });
  }
  function caseStepper() {
    const cur = S.stageOf[S.ids[S.i]], n = S.case.stages.length;
    return `<ol class="stepper" aria-label="Case progress">${S.case.stages.map((s, i) => `<li class="${i < cur ? 'done' : i === cur ? 'cur' : ''}" ${i === cur ? 'aria-current="step"' : ''}><span>${i + 1}</span><small>${esc(s.step ? NCJMM_LABEL[s.step] || s.step : 'Stage ' + (i + 1))}</small></li>`).join('')}</ol><p class="sr">Stage ${cur + 1} of ${n}</p>`;
  }

  function proPanel(where) {
    const items = where === 'dosage'
      ? ['AI dosage tutor that explains any step', 'More practice questions generated for your weak spots', 'Personalized practice sessions', 'Practice from your uploaded study materials']
      : ['AI explanations tailored to your level', 'Personalized quizzes from your missed questions', 'Practice questions from your lecture notes and slides', 'Detailed performance analytics'];
    return `<aside class="pro-panel"><div><b>NursePrepHub Pro</b> ${PRO}<p>Personalized AI coaching on top of everything here.</p></div><ul>${items.map(t => `<li>${ico('check')}${t}</li>`).join('')}</ul><a class="btn btn-s" href="#pro">See what's in Pro</a></aside>`;
  }

  function renderEmpty() {
    host().innerHTML = `${header(true)}<div class="empty">No questions here yet. ${S.data.mode === 'dosage' ? 'The dosage calculation questions will appear here once they are added.' : 'Questions for this topic are being written and reviewed.'}</div><p class="pp-back"><a href="#practice">${ico('back')} Back to Practice</a></p>`;
  }

  /* ── question screen ── */
  function header(noProg) {
    const st = stats(S.set, S.ids);
    if (S.case) {
      const instr = S.mode === 'review' ? 'Reviewing the questions you missed. Explanations are shown.' : S.mode === 'retry' ? 'Retrying the questions you missed. Your earlier answers were cleared.'
        : 'Read the chart, then answer. Each answer unlocks the next part of the case, and new chart entries are marked New.';
      const c = S.case, sub = [c.setting, DIFF_LABEL[c.difficulty]].filter(Boolean).join(' · ');
      return `<header class="pp-top"><a class="pp-crumb" href="#practice">${ico('back')}Practice</a><h1>${esc(c.title)}</h1>${sub ? `<p class="case-sub">${esc(sub)}</p>` : ''}<p>${instr}</p>
        ${noProg ? '' : `${caseStepper()}<div class="pp-prog"><div class="pp-prog-t"><b>Question ${S.i + 1} of ${S.ids.length}</b><span>${st.done} answered · ${st.pct}% correct</span></div><div class="bar" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax="${st.total}" aria-valuenow="${st.done}"><i style="width:${st.total ? st.done / st.total * 100 : 0}%"></i></div></div>`}</header>`;
    }
    const instr = S.mode === 'review' ? 'Reviewing the questions you missed. Explanations are shown.'
      : S.mode === 'retry' ? 'Retrying the questions you missed. Your earlier answers were cleared.'
      : S.data.mode === 'dosage' ? 'Use dimensional analysis. Show your work in the workspace if it helps, then enter your answer with the correct rounding.'
      : 'Choose your answer, then check it. Every question explains why each option is right or wrong.';
    const rules = S.data.roundingRules && S.data.roundingRules.length ? `<details class="pp-round"><summary>${ico('doc')}Rounding reference</summary><ul>${S.data.roundingRules.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>` : '';
    return `<header class="pp-top"><a class="pp-crumb" href="#practice">${ico('back')}Practice</a><h1>${esc(S.title)}</h1><p>${instr}</p>
      ${noProg ? '' : `<div class="pp-prog"><div class="pp-prog-t"><b>Question ${S.i + 1} of ${S.ids.length}</b><span>${st.done} answered · ${st.pct}% correct</span></div><div class="bar" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax="${st.total}" aria-valuenow="${st.done}"><i style="width:${st.total ? st.done / st.total * 100 : 0}%"></i></div></div>`}${rules}</header>`;
  }

  const cur = () => S.data.questions.find(q => q.id === S.ids[S.i]);

  function renderQuestion() {
    const q = cur(), it = getItem(S.set, q.id), res = it.result, locked = !!res;
    const catName = (S.data.categories.find(c => c.id === q.category) || {}).name || '';
    const num = q.number || (S.all.indexOf(q.id) + 1);
    const meta = (S.case ? [`Question ${S.all.indexOf(q.id) + 1}`, q.ncjmm && NCJMM_LABEL[q.ncjmm], FORMAT_LABEL[q.format]] : [`Question ${num}`, esc(catName), FORMAT_LABEL[q.format]]).filter(Boolean).join(' · ');
    const tags = (q.difficulty ? `<span class="qtag">${DIFF_LABEL[q.difficulty]}</span>` : '') + (q.verified === true ? '' : '<span class="qtag warn" title="This question has not been reviewed yet">Not yet verified</span>');
    const box = (label, body, cls) => body ? `<section class="pq-box ${cls || ''}"><h4>${label}</h4><p>${hl(body)}</p></section>` : '';
    let rnd = '';
    if (q.format === 'calc' && q.rounding) {
      const r = q.rounding;
      rnd = r.special ? `<p class="pq-round special">${ico('bulb')}<span><b>Special rounding for this question:</b> ${txt(r.note || r.label)}</span></p>`
        : `<p class="pq-round">Round ${esc(r.label || 'to ' + r.to)}.${r.note ? ' ' + txt(r.note) : ''} Answer in <b>${esc(q.unit)}</b>.</p>`;
    }
    const last = S.i === S.ids.length - 1;
    // In a case, the next question stays locked until this one is answered (or its explanation viewed).
    const gate = S.case && S.mode !== 'review' && !locked;
    const hintsUsed = it.hints || 0, hints = q.hints || [];
    host().innerHTML = `${header()}${S.case ? chartHtml() : ''}
      <article class="pq" aria-labelledby="pq-stem">
        <div class="pq-meta"><span>${meta}</span>${tags}</div>
        ${box('Patient', q.patient, 'pt')}${box('Case', q.case)}${box('Medication order', q.order, 'ord')}${box('Available', q.available)}
        ${q.image ? `<figure class="pq-img"><img src="${esc(q.image)}" alt="Rhythm strip or figure for this question"></figure>` : ''}
        <p class="pq-stem" id="pq-stem">${hl(q.stem)}</p>
        ${rnd}
        <div class="pq-input" id="pq-input">${inputHtml(q, it.response || {}, locked)}</div>
        ${q.format === 'calc' && S.data.mode === 'dosage' ? workspaceHtml(it.work, locked) : ''}
        <div class="pq-aids">
          ${hints.length ? `<button class="lnk" id="pq-hint" ${hintsUsed >= hints.length || locked ? 'disabled' : ''}>${ico('bulb')}Hint${hints.length > 1 ? ` (${Math.min(hintsUsed, hints.length)}/${hints.length})` : ''}</button>` : ''}
          ${q.formula ? `<button class="lnk" id="pq-formula" aria-expanded="${!!it.formula}">${ico('calc')}${it.formula ? 'Hide formula' : 'Show formula'}</button>` : ''}
          ${locked ? '' : `<button class="lnk" id="pq-reveal">${ico('help')}Show explanation</button>`}
        </div>
        <div class="pq-aid-out">
          ${hints.slice(0, hintsUsed).map((h, i) => `<p class="aid">${ico('bulb')}<span><b>Hint${hints.length > 1 ? ' ' + (i + 1) : ''}:</b> ${txt(h)}</span></p>`).join('')}
          ${it.formula && q.formula ? `<p class="aid formula">${ico('calc')}<span><b>Formula:</b> ${txt(q.formula)}</span></p>` : ''}
        </div>
        <div id="pq-fb" aria-live="polite">${res && it.fb ? feedbackHtml(q, it.fb, it) : ''}</div>
      </article>
      <nav class="pp-nav" aria-label="Question navigation">
        <button class="btn btn-s" id="pq-prev" aria-label="Previous question" ${S.i === 0 ? 'disabled' : ''}>${ico('back')}Previous</button>
        ${locked ? (last ? `<button class="btn btn-p" id="pq-finish">See results</button>` : '<span></span>') : `<button class="btn btn-p" id="pq-submit">Submit answer</button>`}
        <button class="btn btn-s" id="pq-next" aria-label="${gate ? 'Answer this question to continue the case' : 'Next question'}" ${last || gate ? 'disabled' : ''}>Next${ico('arrow')}</button>
      </nav>`;
    wire(q, it, locked);
    if (S.case) wireChart();
  }

  /* ── answer inputs per format ── */
  function inputHtml(q, r, locked) {
    const dis = locked ? 'disabled' : '';
    if (CHOICE.includes(q.format) || q.format === 'sata') {
      const multi = q.format === 'sata';
      const sel = multi ? new Set(r.choices || []) : new Set(r.choice ? [r.choice] : []);
      return `${multi ? '<p class="pq-sub">Select all that apply.</p>' : ''}<div class="opts" role="${multi ? 'group' : 'radiogroup'}" aria-labelledby="pq-stem">${q.options.map(o =>
        `<label class="opt"><input type="${multi ? 'checkbox' : 'radio'}" name="ans" value="${esc(o.id)}" ${sel.has(o.id) ? 'checked' : ''} ${dis}><span class="ol">${esc(o.id)}</span><span>${hl(o.text)}</span></label>`).join('')}</div>`;
    }
    if (q.format === 'order') {
      const ids = r.order && r.order.length === q.options.length ? r.order : q.options.map(o => o.id);
      return `<p class="pq-sub">Put these in order, first at the top. Drag, or use the arrows.</p><ol class="ord" id="ord">${ids.map((id, i) => {
        const o = q.options.find(x => x.id === id);
        return `<li draggable="${!locked}" data-id="${esc(id)}"><span class="grip" aria-hidden="true">⋮⋮</span><span class="ot">${hl(o.text)}</span>${locked ? '' : `<span class="mv"><button class="ib" data-mv="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>▲</button><button class="ib" data-mv="1" aria-label="Move down" ${i === ids.length - 1 ? 'disabled' : ''}>▼</button></span>`}</li>`;
      }).join('')}</ol>`;
    }
    if (q.format === 'match') {
      const p = r.pairs || {};
      return `<p class="pq-sub">Match each item on the left with one on the right.</p><div class="mt">${q.left.map(l =>
        `<label class="mt-row"><span>${hl(l.text)}</span><select data-l="${esc(l.id)}" ${dis}><option value="">Choose…</option>${q.right.map(x => `<option value="${esc(x.id)}" ${p[l.id] === x.id ? 'selected' : ''}>${esc(x.text)}</option>`).join('')}</select></label>`).join('')}</div>`;
    }
    if (q.format === 'matrix') {
      const cells = r.cells || {};
      return `<p class="pq-sub">Choose one option in each row.</p><div class="cs-mxw"><table class="cs-mx"><thead><tr><th scope="col"><span class="sr">Item</span></th>${q.columns.map(c => `<th scope="col">${esc(c.text)}</th>`).join('')}</tr></thead><tbody>${q.rows.map(row =>
        `<tr><th scope="row" id="mx-${esc(row.id)}">${hl(row.text)}</th>${q.columns.map(c => `<td><label><input type="radio" name="mx-${esc(row.id)}" data-row="${esc(row.id)}" value="${esc(c.id)}" ${cells[row.id] === c.id ? 'checked' : ''} ${dis}><span class="cs-cl" aria-hidden="true">${esc(c.text)}</span><span class="sr">${esc(row.text)}: ${esc(c.text)}</span></label></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    if (q.format === 'cloze') {
      const b = r.blanks || {};
      return `<p class="pq-sub">Choose the option that best completes each blank.</p><p class="cz">${esc(q.template).replace(/\{\{([\w-]+)\}\}/g, (m, id) => {
        const bl = q.blanks.find(x => x.id === id); if (!bl) return m;
        return `<select data-b="${esc(id)}" aria-label="${esc(bl.label || 'Blank ' + id)}" ${dis}><option value="">Select…</option>${bl.options.map(o => `<option value="${esc(o.id)}" ${b[id] === o.id ? 'selected' : ''}>${esc(o.text)}</option>`).join('')}</select>`;
      }).replace(/\n/g, '<br>')}</p>`;
    }
    if (q.format === 'fill') return `<label class="ans"><span class="sr">Your answer</span><input type="text" id="ans-text" autocomplete="off" value="${esc(r.text || '')}" placeholder="Type your answer" ${dis}></label>`;
    if (q.format === 'calc') {
      const unit = q.unitChoices
        ? `<select id="ans-unit" aria-label="Unit" ${dis}><option value="">Unit…</option>${q.unitChoices.map(u => `<option ${r.unit === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>`
        : `<span class="unit">${esc(q.unit)}</span>`;
      return `<label class="ans calc"><span class="ans-l">Your answer</span><span class="ans-f"><input type="text" id="ans-num" inputmode="decimal" autocomplete="off" value="${esc(r.value || '')}" aria-describedby="pq-stem" ${dis}>${unit}</span></label>`;
    }
    return '';
  }
  function readResponse(q) {
    const el = host();
    if (CHOICE.includes(q.format)) { const c = el.querySelector('input[name=ans]:checked'); return { choice: c ? c.value : '' }; }
    if (q.format === 'sata') return { choices: [...el.querySelectorAll('input[name=ans]:checked')].map(c => c.value) };
    if (q.format === 'order') return { order: [...el.querySelectorAll('#ord li')].map(li => li.dataset.id) };
    if (q.format === 'match') { const pairs = {}; el.querySelectorAll('.mt select').forEach(s => { if (s.value) pairs[s.dataset.l] = s.value; }); return { pairs }; }
    if (q.format === 'fill') return { text: (el.querySelector('#ans-text') || {}).value || '' };
    if (q.format === 'matrix') { const cells = {}; el.querySelectorAll('.cs-mx input:checked').forEach(i => cells[i.dataset.row] = i.value); return { cells }; }
    if (q.format === 'cloze') { const blanks = {}; el.querySelectorAll('.cz select').forEach(s => { if (s.value) blanks[s.dataset.b] = s.value; }); return { blanks }; }
    if (q.format === 'calc') { const u = el.querySelector('#ans-unit'); return { value: (el.querySelector('#ans-num') || {}).value || '', unit: u ? u.value : q.unit }; }
    return {};
  }
  function isBlank(q, r) {
    if (CHOICE.includes(q.format)) return !r.choice;
    if (q.format === 'sata') return !r.choices.length;
    if (q.format === 'match') return Object.keys(r.pairs).length < q.left.length;
    if (q.format === 'fill') return !r.text.trim();
    if (q.format === 'matrix') return Object.keys(r.cells).length < q.rows.length;
    if (q.format === 'cloze') return Object.keys(r.blanks).length < q.blanks.length;
    if (q.format === 'calc') return !String(r.value).trim() || (q.unitChoices && !r.unit);
    return false;
  }

  /* ── calculation workspace (optional) ── */
  function workspaceHtml(w, locked) {
    w = w || {};
    const factors = w.factors && w.factors.length ? w.factors : [{}, {}];
    const steps = w.steps && w.steps.length ? w.steps : [''];
    const dis = locked ? 'disabled' : '';
    return `<details class="ws" ${w.open ? 'open' : ''} id="ws"><summary>${ico('calc')}Show my work <small>optional</small></summary>
      <div class="ws-body">
        <h5>Dimensional analysis</h5>
        <p class="ws-help">Start with what you want to find, then multiply by factors so the units cancel. Enter each fraction as numerator over denominator.</p>
        <div class="da" id="da">${factors.map((f, i) => `${i ? '<span class="times" aria-hidden="true">×</span>' : ''}<div class="frac" data-i="${i}">
          <div class="fr-n"><input aria-label="Factor ${i + 1} numerator value" inputmode="decimal" data-k="nv" value="${esc(f.nv || '')}" ${dis}><input aria-label="Factor ${i + 1} numerator unit" data-k="nu" placeholder="unit" value="${esc(f.nu || '')}" ${dis}></div>
          <div class="fr-d"><input aria-label="Factor ${i + 1} denominator value" inputmode="decimal" data-k="dv" value="${esc(f.dv || '')}" ${dis}><input aria-label="Factor ${i + 1} denominator unit" data-k="du" placeholder="unit" value="${esc(f.du || '')}" ${dis}></div>
          ${locked || factors.length <= 1 ? '' : `<button class="ib rm" data-rm="${i}" aria-label="Remove factor ${i + 1}">×</button>`}</div>`).join('')}
          ${locked ? '' : '<button class="btn btn-s add" id="da-add">+ Factor</button>'}</div>
        <p class="da-out" id="da-out" aria-live="polite"></p>
        <h5>Steps</h5>
        <ol class="ws-steps" id="ws-steps">${steps.map((s, i) => `<li><input aria-label="Step ${i + 1}" value="${esc(s)}" placeholder="${i ? 'Next step' : 'e.g. Convert lb to kg first'}" ${dis}></li>`).join('')}</ol>
        ${locked ? '' : '<button class="lnk" id="ws-add">+ Add a step</button>'}
      </div></details>`;
  }
  function parseUnit(u) {
    const parts = String(u || '').trim().split('/').map(p => p.split(/[·*\s]+/).filter(Boolean));
    return { num: parts[0] || [], den: parts.slice(1).flat() };
  }
  function daResult(factors) {
    let v = 1, any = false; const num = [], den = [];
    for (const f of factors) {
      const nv = Number(String(f.nv || '').replace(/,/g, '')), dv = f.dv === undefined || f.dv === '' ? 1 : Number(String(f.dv).replace(/,/g, ''));
      if (f.nv === undefined || f.nv === '') continue;
      if (!Number.isFinite(nv) || !Number.isFinite(dv) || dv === 0) return null;
      any = true; v *= nv / dv;
      const a = parseUnit(f.nu), b = parseUnit(f.du);
      num.push(...a.num, ...b.den); den.push(...a.den, ...b.num);
    }
    if (!any) return null;
    // Cancel matching units, ignoring case ("mL" cancels "ml"); display keeps what the student typed.
    for (let i = num.length - 1; i >= 0; i--) { const j = den.findIndex(d => d.toLowerCase() === num[i].toLowerCase()); if (j >= 0) { num.splice(i, 1); den.splice(j, 1); } }
    const unit = (num.join('·') || (den.length ? '1' : '')) + (den.length ? '/' + den.join('·') : '');
    return { value: Number(v.toPrecision(10)), unit };
  }
  function readWork() {
    const el = host(), ws = el.querySelector('#ws'); if (!ws) return null;
    const factors = [...el.querySelectorAll('#da .frac')].map(fr => { const o = {}; fr.querySelectorAll('input').forEach(i => o[i.dataset.k] = i.value); return o; });
    const steps = [...el.querySelectorAll('#ws-steps input')].map(i => i.value);
    return { open: ws.open, factors, steps };
  }
  function updateDA(locked) {
    const out = host().querySelector('#da-out'); if (!out) return;
    const w = readWork(), r = daResult(w.factors);
    if (!r) { out.innerHTML = ''; return; }
    out.innerHTML = `Your setup gives <b>${r.value}</b>${r.unit ? ` <b>${esc(r.unit)}</b>` : ''}. Units left after canceling: ${r.unit ? esc(r.unit) : 'none'}. ${locked ? '' : '<button class="lnk" id="da-use">Use this number</button>'}`;
    const use = out.querySelector('#da-use');
    if (use) use.onclick = () => { const a = host().querySelector('#ans-num'); if (a) { a.value = String(r.value); a.dispatchEvent(new Event('input', { bubbles: true })); a.focus(); } };
  }

  /* ── feedback ── */
  function feedbackHtml(q, f, it) {
    const status = f.revealed ? ['viewed', 'Explanation (not scored)'] : f.correct ? ['ok', 'Correct'] : ['bad', 'Not quite'];
    const whyLabel = k => q.format === 'matrix' ? ((q.rows.find(r => r.id === k) || {}).text || k) : k;
    const choiceWhy = (CHOICE.includes(q.format) || ['sata', 'matrix', 'cloze'].includes(q.format)) && f.why && Object.keys(f.why).length
      ? `<h5>${['matrix', 'cloze'].includes(q.format) ? 'Item by item' : `Why the other answers are ${q.format === 'priority' ? 'less urgent' : 'incorrect'}`}</h5><ul class="why">${Object.entries(f.why).map(([k, v]) => `<li><b>${esc(whyLabel(k))}:</b> ${txt(v)}</li>`).join('')}</ul>` : '';
    const part = f.partTotal && !f.revealed && !f.correct ? `<p class="pfb-note">You got ${f.partRight} of ${f.partTotal} ${q.format === 'matrix' ? 'rows' : 'blanks'} right.</p>` : '';
    const sata = q.format === 'sata' && !f.revealed && !f.correct ? `<p class="pfb-note">You chose ${f.selectedRight} of the ${f.totalRight} correct answers${f.selectedWrong ? ` and ${f.selectedWrong} incorrect one${f.selectedWrong > 1 ? 's' : ''}` : ''}.</p>` : '';
    const steps = f.steps && f.steps.length ? `<h5>${S.data.mode === 'dosage' ? 'Step-by-step (dimensional analysis)' : 'Step by step'}</h5><ol class="steps">${f.steps.map(s => `<li>${s.work ? `<div class="work">${txt(s.work)}</div>` : ''}${s.explain ? `<p>${txt(s.explain)}</p>` : ''}</li>`).join('')}</ol>` : '';
    const mine = it.work && (it.work.steps || []).some(Boolean) ? `<details class="mine"><summary>Your work</summary><ol>${it.work.steps.filter(Boolean).map(s => `<li>${esc(s)}</li>`).join('')}</ol></details>` : '';
    const tool = f.lesson && typeof BY !== 'undefined' && BY[f.lesson] ? `<a class="lnk" href="#tool-${esc(f.lesson)}" data-open="${esc(f.lesson)}">${ico('book')}Review: ${esc(BY[f.lesson].t)}</a>` : '';
    return `<section class="pfb ${status[0]}">
      <h3>${status[0] === 'ok' ? ico('check') : status[0] === 'bad' ? ico('x') : ico('help')}${status[1]}</h3>
      ${(f.notes || []).map(n => `<p class="pfb-note">${esc(n)}</p>`).join('')}${sata}${part}
      <p class="pfb-ans"><b>Correct answer:</b> <span>${txt(f.answerText)}</span></p>
      <p>${txt(f.explanation)}</p>
      ${steps}
      ${f.roundingExplanation ? `<h5>Rounding</h5><p>${txt(f.roundingExplanation)}</p>` : ''}
      ${choiceWhy}
      ${f.mistakes && f.mistakes.length ? `<h5>Common mistakes to avoid</h5><ul class="mist">${f.mistakes.map(m => `<li>${txt(m)}</li>`).join('')}</ul>` : ''}
      ${f.concept ? `<p class="concept"><b>Key concept:</b> ${txt(f.concept)}</p>` : ''}
      ${mine}
      <div class="pfb-links">${tool}<button class="lnk pro-lock" disabled>${ico('brain')}Ask the AI tutor about a step ${PRO}</button></div>
      <footer class="pfb-foot"><span>${f.source ? 'Source: ' + esc(f.source) + ' · ' : ''}${f.verified ? 'Reviewed' : 'Not yet verified'}</span><span>${DISCLAIMER}</span><button class="lnk" id="pq-report">Report a problem</button></footer>
      <div id="pq-report-f"></div>
    </section>`;
  }

  /* ── events ── */
  function wire(q, it, locked) {
    const el = host();
    const persist = () => patchItem(S.set, q.id, { response: readResponse(q), cat: q.category, work: readWork() || undefined });
    if (!locked) {
      el.querySelector('#pq-input').addEventListener('input', persist);
      el.querySelector('#pq-input').addEventListener('change', persist);
    }
    // ordering: arrows + drag and drop
    const ord = el.querySelector('#ord');
    if (ord && !locked) {
      ord.addEventListener('click', e => {
        const b = e.target.closest('[data-mv]'); if (!b) return;
        const li = b.closest('li'), d = +b.dataset.mv, sib = d < 0 ? li.previousElementSibling : li.nextElementSibling;
        if (!sib) return; d < 0 ? ord.insertBefore(li, sib) : ord.insertBefore(sib, li);
        persist(); const id = li.dataset.id; renderQuestion();
        const again = host().querySelector(`#ord li[data-id="${CSS.escape(id)}"] [data-mv="${d}"]:not([disabled])`) || host().querySelector(`#ord li[data-id="${CSS.escape(id)}"] [data-mv]:not([disabled])`); if (again) again.focus();
      });
      let drag = null;
      ord.addEventListener('dragstart', e => { drag = e.target.closest('li'); drag.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      ord.addEventListener('dragover', e => { e.preventDefault(); const over = e.target.closest('li'); if (!drag || !over || over === drag) return; const r = over.getBoundingClientRect(); ord.insertBefore(drag, e.clientY > r.top + r.height / 2 ? over.nextSibling : over); });
      ord.addEventListener('dragend', () => { if (drag) drag.classList.remove('dragging'); drag = null; persist(); renderQuestion(); });
    }
    // workspace
    const ws = el.querySelector('#ws');
    if (ws) {
      const save = () => { patchItem(S.set, q.id, { work: readWork(), cat: q.category }); updateDA(locked); };
      ws.addEventListener('input', save); ws.addEventListener('toggle', save);
      updateDA(locked);
      if (!locked) {
        ws.addEventListener('click', e => {
          if (e.target.id === 'da-add') { const w = readWork(); w.factors.push({}); patchItem(S.set, q.id, { work: w }); return renderQuestion(); }
          if (e.target.id === 'ws-add') { const w = readWork(); w.steps.push(''); patchItem(S.set, q.id, { work: w }); renderQuestion(); const s = host().querySelectorAll('#ws-steps input'); s[s.length - 1].focus(); return; }
          const rm = e.target.closest('[data-rm]'); if (rm) { const w = readWork(); w.factors.splice(+rm.dataset.rm, 1); patchItem(S.set, q.id, { work: w }); renderQuestion(); }
        });
      }
    }
    // aids
    const hint = el.querySelector('#pq-hint'); if (hint) hint.onclick = () => { patchItem(S.set, q.id, { hints: (getItem(S.set, q.id).hints || 0) + 1, response: locked ? it.response : readResponse(q), work: readWork() || undefined }); renderQuestion(); };
    const fm = el.querySelector('#pq-formula'); if (fm) fm.onclick = () => { patchItem(S.set, q.id, { formula: !getItem(S.set, q.id).formula, ...(locked ? {} : { response: readResponse(q), work: readWork() || undefined }) }); renderQuestion(); };
    const rv = el.querySelector('#pq-reveal');
    if (rv) rv.onclick = async () => {
      if (rv.dataset.confirm !== '1') { rv.dataset.confirm = '1'; rv.innerHTML = `${ico('help')}Show the answer? This question won't be scored.`; return; }
      try { const f = await api('/reveal', { id: q.id }); patchItem(S.set, q.id, { response: readResponse(q), work: readWork() || undefined, result: { correct: false, revealed: true }, fb: f, cat: q.category }); renderQuestion(); }
      catch (e) { showError(e.message); }
    };
    // submit / navigation
    const sub = el.querySelector('#pq-submit');
    if (sub) sub.onclick = async () => {
      const r = readResponse(q);
      if (isBlank(q, r)) return showError(q.format === 'calc' && q.unitChoices && String(r.value).trim() ? 'Choose a unit for your answer.' : q.format === 'match' ? 'Match every item before submitting.' : q.format === 'matrix' ? 'Choose an option in every row before submitting.' : q.format === 'cloze' ? 'Fill every blank before submitting.' : 'Enter or choose an answer first.');
      sub.disabled = true; sub.textContent = 'Checking…';
      try {
        const f = await api('/check', { id: q.id, response: r });
        if (f.invalid) { sub.disabled = false; sub.textContent = 'Submit answer'; return showError(f.notes[0]); }
        patchItem(S.set, q.id, { response: r, work: readWork() || undefined, result: { correct: f.correct }, fb: f, cat: q.category, attempts: (getItem(S.set, q.id).attempts || 0) + 1 });
        renderQuestion();
        const fb = host().querySelector('#pq-fb'); if (fb) fb.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { sub.disabled = false; sub.textContent = 'Submit answer'; showError(e.message); }
    };
    const go = d => { if (!locked) persist(); const st0 = S.case && S.stageOf[S.ids[S.i]]; S.i = Math.max(0, Math.min(S.ids.length - 1, S.i + d)); if (S.case && S.stageOf[S.ids[S.i]] !== st0) S.tab = null; if (S.mode === 'all') setPos(S.set, S.key, S.i); renderQuestion(); window.scrollTo(0, 0); };
    el.querySelector('#pq-prev').onclick = () => go(-1);
    el.querySelector('#pq-next').onclick = () => go(1);
    const fin = el.querySelector('#pq-finish'); if (fin) fin.onclick = renderResults;
    // report
    const rep = el.querySelector('#pq-report');
    if (rep) rep.onclick = () => {
      const box = el.querySelector('#pq-report-f');
      box.innerHTML = `<form class="rep"><label>What's wrong?<select name="reason"><option>Wrong answer</option><option>Confusing explanation</option><option>Typo or formatting</option><option>Other</option></select></label><label>Details (optional)<textarea name="note" rows="3" maxlength="1000"></textarea></label><div><button class="btn btn-p" type="submit">Send report</button></div></form>`;
      box.querySelector('form').onsubmit = async e => {
        e.preventDefault(); const fd = new FormData(e.target);
        try { await api('/report', { id: q.id, reason: fd.get('reason'), note: fd.get('note') }); box.innerHTML = '<p class="pfb-note">Thanks. The report was sent for review.</p>'; }
        catch (err) { box.insertAdjacentHTML('beforeend', `<p class="pfb-note">${esc(err.message)}</p>`); }
      };
    };
  }
  function showError(msg) {
    const fb = host().querySelector('#pq-fb'); if (!fb) return;
    fb.innerHTML = `<p class="pq-err" role="alert">${esc(msg)}</p>`;
  }

  /* ── results ── */
  function renderResults() {
    const ids = S.all, st = stats(S.set, ids), items = setState(S.set).items;
    const byCat = {};
    ids.forEach(id => {
      const q = S.data.questions.find(x => x.id === id), r = (items[id] || {}).result;
      const g = S.case ? (q.ncjmm || 'other') : q.category;
      const c = byCat[g] = byCat[g] || { right: 0, done: 0, total: 0 };
      c.total++; if (r) { c.done++; if (r.correct && !r.revealed) c.right++; }
    });
    const weak = Object.entries(byCat).filter(([, c]) => c.done && c.right < c.done);
    const name = id => S.case ? (NCJMM_LABEL[id] || 'Other') : (S.data.categories.find(c => c.id === id) || {}).name || id;
    const missed = missedIds(S.set, ids);
    host().innerHTML = `${header(true)}
      <section class="res">
        <h2>Your results</h2>
        <div class="kpis"><div class="kpi"><b>${st.right}</b><span>Correct</span></div><div class="kpi"><b>${st.done - st.right}</b><span>Incorrect or viewed</span></div><div class="kpi"><b>${st.pct}%</b><span>Score${st.done < st.total ? ` (${st.total - st.done} unanswered)` : ''}</span></div></div>
        <h3>${S.case ? 'By clinical judgment step' : 'By category'}</h3>
        <ul class="cat-res">${Object.entries(byCat).map(([id, c]) => `<li class="${c.done && c.right < c.done ? 'weak' : ''}"><span>${esc(name(id))}</span><b>${c.done ? `${c.right}/${c.done}` : 'Not answered'}</b></li>`).join('')}</ul>
        ${S.case && S.case.debrief ? `<h3>Case debrief</h3><p class="case-debrief">${txt(S.case.debrief)}</p>` : ''}
        ${weak.length ? `<p class="pfb-note"><b>Needs more practice:</b> ${weak.map(([id]) => esc(name(id))).join(', ')}.</p>` : st.done ? '<p class="pfb-note">No weak categories in this set. Nice work.</p>' : ''}
        <div class="res-act">
          ${missed.length ? `<button class="btn btn-s" id="r-review">Review incorrect (${missed.length})</button><button class="btn btn-p" id="r-retry">Retry missed</button>` : ''}
          <button class="btn btn-s" id="r-restart">Start over</button>${S.case ? `<a class="btn btn-s" href="#practice">More cases</a>` : ''}
          <button class="btn btn-s pro-lock" disabled>Generate practice for weak areas ${PRO}</button>
        </div>
      </section>`;
    const el = host();
    const rv = el.querySelector('#r-review'); if (rv) rv.onclick = () => { S.ids = missed; S.i = 0; S.mode = 'review'; renderQuestion(); };
    const rt = el.querySelector('#r-retry'); if (rt) rt.onclick = () => {
      const s = load(); missed.forEach(id => { const x = s[S.set].items[id]; if (x) { delete x.result; delete x.fb; delete x.hints; x.response = {}; } }); save(s);
      S.ids = missed; S.i = 0; S.mode = 'retry'; renderQuestion();
    };
    el.querySelector('#r-restart').onclick = () => {
      if (el.querySelector('#r-restart').dataset.c !== '1') { el.querySelector('#r-restart').dataset.c = '1'; el.querySelector('#r-restart').textContent = 'Clear all answers in this set?'; return; }
      const s = load(); ids.forEach(id => { if (s[S.set]) delete s[S.set].items[id]; }); if (s[S.set] && s[S.set].pos) s[S.set].pos[S.key] = 0; save(s);
      S.ids = S.all; S.i = 0; S.mode = 'all'; S.tab = null; renderQuestion();
    };
  }

  /* ── Pro page ── */
  function renderPro() {
    const el = document.getElementById('pro-root'); if (!el) return;
    const free = ['All core nursing lessons', 'Anatomy and body systems', 'Pharmacology reference cards', 'Disease and disorder library', 'EKG lessons and practice strips', 'NCLEX-style question bank', 'Clinical judgment case studies', 'Dosage calculation practice', 'Study planner', 'Progress tracking', 'Games and interactive tools'];
    const pro = ['AI nursing tutor available anytime', 'Ask questions about any lesson', 'Upload lecture notes, PowerPoints and study guides', 'Personalized quizzes', 'AI explanations for incorrect answers', 'Adaptive quizzes based on weak areas', 'Personalized NCLEX study plans', 'AI-generated clinical scenarios from your notes', 'Custom flashcard generation', 'Detailed performance analytics'];
    el.innerHTML = `<div class="vh"><h1>Free and Pro</h1><p>The full learning library is free, forever. Pro adds personalized AI coaching.</p></div>
      <div class="tiers">
        <section class="tcard"><span class="tier free">Free forever</span><h2>NursePrepHub Free</h2><p class="price">$0</p><p>Everything you need to learn and practice on your own.</p><ul>${free.map(t => `<li>${ico('check')}${t}</li>`).join('')}</ul><a class="btn btn-s" href="#practice">Start practicing</a></section>
        <section class="tcard pro"><span class="tier pro">Coming soon</span><h2>NursePrepHub Pro</h2><p class="price">AI powered</p><p>Everything in Free, plus:</p><ul>${pro.map(t => `<li>${ico('check')}${t}</li>`).join('')}</ul><button class="btn btn-p" disabled>Coming soon</button></section>
      </div>
      <p class="pp-note">During early access, the AI tools (NCLEX Prep, Coach Quest, Body Systems Quiz, Reference Library, Care Plan Builder) are free with a daily limit per visitor.</p>`;
  }

  window.Practice = { route, renderPro };
})();
