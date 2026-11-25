// Paper formats for the Care Plan Builder. Runs entirely in the browser: the student's name, title page and plan are
// never sent to the server. Also loadable in Node (module.exports) for checks.
//
// To add a style (AMA, Vancouver, Harvard): add an entry to FORMATS with the same members as apa7 below. The dropdown
// is filled from this list. build() returns a list of blocks; renderDocx and renderPdf are shared by every style and
// read page settings from `layout`.
//   block: { t, runs:[{x, b, i}], n, list }   t = center | h1 | h2 | p | flush | num | bul | ref | break | blank
(function (root) {
  const clean = s => String(s == null ? '' : s).normalize('NFC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(^|[^\ud800-\udbff])[\udc00-\udfff]/g, '$1')
    .replace(/\s+/g, ' ').trim();
  const sentence = s => {
    s = clean(s);
    if (!s || /[.!?]["'”’)\]]?$/.test(s)) return s;
    return /["”]$/.test(s) ? s.slice(0, -1) + '.' + s.slice(-1) : s + '.';
  };
  const MINOR = new Set('a an and as at but by for from if in nor of on or per so the to up via yet off'.split(' '));
  // Title case that never lowers a letter, so acronyms such as COPD and SpO2 survive.
  function titleCase(s) {
    let first = true;
    return clean(s).split(' ').map(w => {
      const keep = !first && MINOR.has(w);
      first = /[:.?!]$/.test(w);
      if (keep || /[A-Z]/.test(w)) return w;
      return w.split('-').map(p => p.replace(/^([^\p{L}\d]*)(\p{L})/u, (m, a, b) => a + b.toUpperCase())).join('-');
    }).join(' ');
  }
  const MONTHS = 'January February March April May June July August September October November December'.split(' ');
  function longDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${MONTHS[m[2] - 1]} ${+m[3]}, ${m[1]}` : clean(iso);
  }

  /* ---------- authors ---------- */
  const PERSON = /([^,&;]+),\s*((?:\p{Lu}\.[\s-]*)+)(?:,\s*(Jr\.|Sr\.|III|II|IV))?/gu;
  // One author per line. "Last, F. M." is a person (several may share a line); anything else is an organization.
  function parseAuthors(text) {
    const out = [];
    String(text || '').split('\n').map(clean).filter(Boolean).forEach(line => {
      const ms = [...line.matchAll(PERSON)];
      const rest = line.replace(PERSON, '').replace(/\band\b/g, '').replace(/[,&;\s]/g, '');
      if (ms.length && !rest) ms.forEach(m => out.push({
        last: m[1].replace(/^\s*(and\s+)?/, '').trim(),
        init: m[2].trim().replace(/\.(?=\p{Lu})/gu, '. '), suffix: m[3] || ''
      }));
      else out.push({ org: line.replace(/\.$/, '') });
    });
    return out;
  }
  const refName = a => a.org || `${a.last}, ${a.init}${a.suffix ? ', ' + a.suffix : ''}`;

  /* ---------- APA 7 references and in-text citations ---------- */
  function apaAuthors(list) {
    const n = list.map(refName);
    if (n.length <= 1) return n.join('');
    if (n.length > 20) return n.slice(0, 19).join(', ') + ', . . . ' + n[n.length - 1];
    return n.slice(0, -1).join(', ') + ', & ' + n[n.length - 1];
  }
  // Books and web pages are italic in the reference list, so they are italic in text when there is no author.
  const shortTitle = r => { const t = titleCase(r.title).split(/[:?]/)[0].split(' ').slice(0, 5).join(' '); return t || 'Untitled'; };
  function prepare(refs) {
    const L = refs.map(r => ({ r, a: parseAuthors(r.authors), year: clean(r.year) || 'n.d.', sfx: '' }));
    const surname = a => a.org || a.last;
    // Same surname, different initials, among first authors: initials are added in text.
    const firsts = {};
    L.forEach(e => { const f = e.a[0]; if (f && f.last) (firsts[f.last] = firsts[f.last] || new Set()).add(f.init); });
    const name = (e, i) => { const f = e.a[i]; return i === 0 && f.last && firsts[f.last].size > 1 ? `${f.init} ${f.last}` : surname(f); };
    const cite = (e, k) => {
      const n = e.a.length;
      if (!n) return e.r.type === 'article' ? `“${shortTitle(e.r)}”` : shortTitle(e.r);
      if (n === 1) return name(e, 0);
      if (n === 2) return `${name(e, 0)} & ${name(e, 1)}`;
      // "et al." must stand for at least two people; otherwise every name is written out.
      if (k >= n - 1) return e.a.slice(0, -1).map((x, i) => name(e, i)).join(', ') + ', & ' + name(e, n - 1);
      return e.a.slice(0, k).map((x, i) => name(e, i)).join(', ') + (k > 1 ? ',' : '') + ' et al.';
    };
    // "et al." may not be ambiguous: spell out names until works by different author lists differ.
    const key = e => e.a.map(refName).join('|').toLowerCase() || 'title:' + clean(e.r.title).toLowerCase();
    L.forEach(e => {
      let k = 1;
      while (k < e.a.length && L.some(o => key(o) !== key(e) && o.year === e.year && o.a.length > 2 && cite(o, k) === cite(e, k))) k++;
      e.text = cite(e, k);
    });
    const titleKey = e => clean(e.r.title).toLowerCase().replace(/^(a|an|the)\s+/, '');
    const sortKey = e => e.a.length ? e.a.map(refName).join(' ').toLowerCase() : titleKey(e);
    const yk = y => y === 'n.d.' ? 0 : parseInt(y, 10) || 9999;
    L.sort((x, y) => sortKey(x).localeCompare(sortKey(y), 'en') || yk(x.year) - yk(y.year) || titleKey(x).localeCompare(titleKey(y), 'en'));
    // Same authors and year: 2023a, 2023b, or n.d.-a, n.d.-b.
    const same = {};
    L.forEach(e => { if (e.a.length) (same[key(e) + e.year] = same[key(e) + e.year] || []).push(e); });
    Object.values(same).filter(g => g.length > 1).forEach(g => g.forEach((e, i) => { e.sfx = (e.year === 'n.d.' ? '-' : '') + String.fromCharCode(97 + i); }));
    return L;
  }
  function link(u) {
    u = clean(u);
    if (/^10\.\d{4,}\//.test(u)) return 'https://doi.org/' + u;
    if (/^(https?:\/\/)?(dx\.)?doi\.org\//i.test(u)) return u.replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, 'https://doi.org/');
    return u.replace(/^doi:\s*/i, 'https://doi.org/');
  }
  function apaReference(e) {
    const r = e.r, runs = [], add = (x, i) => x && runs.push({ x, i: !!i });
    const t = clean(r.title).replace(/\.$/, '') || '[Title missing]', au = apaAuthors(e.a), dt = `(${e.year}${e.sfx}).`;
    const end = t.match(/[?!]$/) ? '' : '.';
    const italic = r.type !== 'article';
    const ed = r.type === 'book' && clean(r.edition) ? ` (${clean(r.edition).replace(/\.?\s*(ed|edition)?\.?$/i, '')} ed.)` : '';
    const title = () => { add(t, italic); add(ed + (ed ? '.' : end)); };
    if (au) { add(au + (/\.$/.test(au) ? ' ' : '. ') + dt + ' '); title(); } else { title(); add(' ' + dt); }
    const src = clean(r.source).replace(/\.$/, '');
    if (r.type === 'article') {
      if (src) {
        add(' '); add(src, true);
        if (clean(r.volume)) { add(', '); add(clean(r.volume), true); }
        if (clean(r.issue)) add(`${clean(r.volume) ? '' : ', '}(${clean(r.issue)})`);
        if (clean(r.pages)) add(', ' + clean(r.pages).replace(/\s*-\s*/g, '–'));
        add('.');
      }
    } else if (src && !(e.a.length === 1 && src.toLowerCase() === refName(e.a[0]).toLowerCase())) add(' ' + src + '.');
    if (clean(r.url)) add(' ' + link(r.url));
    return runs;
  }
  function apaCite(entries) {
    const runs = [{ x: '(' }];
    entries.forEach((e, i) => {
      if (i) runs.push({ x: '; ' });
      runs.push({ x: e.text, i: !e.a.length && e.r.type !== 'article' });
      runs.push({ x: `, ${e.year}${e.sfx}` });
    });
    runs.push({ x: ')' });
    return runs;
  }
  function checkRef(r) {
    const w = [];
    if (!clean(r.authors)) w.push('no author, so the title is used instead');
    parseAuthors(r.authors).forEach(a => { if (a.org && a.org.includes(',')) w.push(`"${a.org}" is read as an organization; for a person write Last, F. M.`); });
    if (!clean(r.year)) w.push('no year, so n.d. is used');
    if (!clean(r.title)) w.push('title missing');
    if (!clean(r.source)) w.push(r.type === 'article' ? 'journal missing' : r.type === 'book' ? 'publisher missing' : 'website name missing (fine if it is the same as the author)');
    if (r.type === 'web' && !clean(r.url)) w.push('web address missing');
    return w;
  }

  const DISCLOSURE = 'Parts of this care plan were drafted with an artificial intelligence study tool (NursePrepHub Care Plan Builder) using a fictional case, then edited by the student. AI-drafted content must be verified against current references before use.';
  const UNVERIFIED = '[Not yet verified]';

  // data: { plan, paper, title, refs, citesFor(intervention) -> [ref id] }
  function buildApa(data) {
    const p = data.plan, pp = data.paper || {}, B = [];
    let list = 0;
    const push = (t, x, extra) => B.push(Object.assign({ t, runs: typeof x === 'string' ? [{ x }] : x || [] }, extra));
    const bold = x => [{ x, b: true }];
    const none = '[None recorded.]';
    const para = (x, label) => push('p', label ? [{ x: label + ' ', i: true }, { x: sentence(x) || none }] : sentence(x) || none);
    const bullets = a => { a = a.map(clean).filter(Boolean); if (!a.length) return push('p', none); list++; a.forEach(x => push('bul', x, { list })); };
    const numbered = rows => { list++; rows.forEach((r, i) => push('num', r, { n: i + 1, list })); };
    const dxName = (x, n) => titleCase(x.label) || 'Nursing Diagnosis ' + (n + 1);
    const each = (heading, fn) => { if (!p.diagnoses.length) return; push('h1', heading); p.diagnoses.forEach((x, n) => { push('h2', dxName(x, n)); fn(x, n); }); };

    const used = new Set();
    p.diagnoses.forEach(x => x.interventions.forEach(v => data.citesFor(v).forEach(id => used.add(id))));
    const entries = prepare(data.refs.filter(r => used.has(r.id)));
    const title = titleCase(pp.title || data.title || 'Nursing Care Plan');
    const field = (v, name) => clean(v) || `[${name}]`;

    for (let i = 0; i < 3; i++) push('blank');
    push('center', bold(title));
    push('blank');
    push('center', field(pp.student, 'Student Name'));
    push('center', [pp.department, pp.school].map(clean).filter(Boolean).join(', ') || '[Department, School]');
    push('center', field(pp.course, 'Course'));
    push('center', field(pp.instructor, 'Instructor'));
    push('center', longDate(pp.due) || '[Due Date]');
    push('break');

    push('center', bold(title));
    // The opening section has no heading in APA 7; the title above stands in for it.
    push('p', (clean(p.medical_diagnosis) ? 'This care plan addresses a fictional client with the following diagnosis: ' + sentence(p.medical_diagnosis) : 'This care plan addresses a fictional client.') + (clean(p.snapshot) ? ' ' + sentence(p.snapshot) : ''));

    if (p.urgent_flags.some(clean)) { push('h1', 'Findings Requiring Immediate Action'); bullets(p.urgent_flags); }
    each('Assessment', x => {
      [['subjective', 'Subjective.'], ['objective', 'Objective.'], ['assessment', 'Assessment.'], ['plan', 'Plan.']].forEach(([k, l]) => {
        const a = x.soap[k].map(sentence).filter(Boolean);
        para(a.join(' '), l);
      });
    });
    each('Nursing Diagnoses', x => {
      const priority = clean(x.priority), kind = clean(x.kind);
      para(`${priority.charAt(0).toUpperCase() + priority.slice(1)} priority, ${kind} diagnosis`, 'Priority.');
      para(x.related_to, 'Related to:');
      para(x.evidence.map(clean).filter(Boolean).join('; '), x.kind === 'risk' ? 'As evidenced by risk factors:' : 'As evidenced by:');
      if (clean(x.priority_reason)) para(x.priority_reason, 'Reason for priority.');
    });
    each('Planning', x => {
      const g = x.goals.filter(g => clean(g.text));
      if (!g.length) return push('p', none);
      numbered(g.map(g => [{ x: clean(g.text).replace(/\.$/, '') + (clean(g.timeframe) ? ` (${clean(g.timeframe)})` : '') + '.' }]));
    });
    each('Implementation', x => {
      const iv = x.interventions.filter(v => clean(v.text));
      if (!iv.length) return push('p', none);
      numbered(iv.map(v => {
        const runs = [{ x: (TYPES[v.type] || 'Act') + ': ', i: true }, { x: sentence(v.text) + ' ' }, { x: 'Rationale: ', i: true }];
        const rat = sentence(v.rationale) || none, ids = data.citesFor(v), es = entries.filter(e => ids.includes(e.r.id));
        if (!es.length) return runs.concat({ x: rat + ' ' + UNVERIFIED });
        const m = /^([\s\S]*?)([.!?]?)$/.exec(rat);
        return runs.concat({ x: m[2] === '.' ? m[1] + ' ' : rat + ' ' }, apaCite(es), { x: '.' });
      }));
    });
    each('Evaluation', x => para(x.evaluation));
    if (p.teaching.some(clean)) { push('h1', 'Client and Family Teaching'); bullets(p.teaching); }
    const sb = p.sbar;
    if ([sb.situation, sb.background, sb.assessment, sb.recommendation].some(clean)) {
      push('h1', 'SBAR Handoff');
      ['situation', 'background', 'assessment', 'recommendation'].forEach(k => { push('h2', titleCase(k)); para(sb[k]); });
    }
    if (p.ngn_cues.some(c => clean(c.cue))) {
      push('h1', 'Recognition of Cues');
      [['immediate concern', 'Cues of Immediate Concern'], ['relevant', 'Relevant Cues'], ['not relevant', 'Cues Not Relevant Now']].forEach(([k, h]) => {
        const c = p.ngn_cues.filter(c => c.category === k && clean(c.cue));
        if (c.length) { push('h2', h); bullets(c.map(c => clean(c.cue).replace(/\.$/, '') + (clean(c.why) ? ': ' + sentence(c.why) : '.'))); }
      });
    }
    if (p.ai || p.diagnoses.some(x => x.ai || x.interventions.some(v => v.ai))) { push('h1', 'AI Use Disclosure'); para(clean(pp.disclosure) || DISCLOSURE); }

    push('break');
    push('center', bold('References'), { heading: true });
    if (entries.length) entries.forEach(e => push('ref', apaReference(e)));
    else push('flush', '[No sources cited.]');
    return { blocks: B, title, author: clean(pp.student) };
  }
  const TYPES = { assess: 'Assess', act: 'Act', teach: 'Teach', collaborate: 'Collaborate' };

  const FORMATS = [
    { id: 'standard', label: 'Standard' },
    {
      id: 'apa7', label: 'APA 7', paper: true,
      layout: { pageNumber: 'right', h1: 'center', h2: 'left' },
      build: buildApa, checkRef,
      preview(refs) { return prepare(refs).map(e => ({ id: e.r.id, cite: apaCite([e]), ref: apaReference(e) })); }
    }
  ];

  /* ---------- Word ---------- */
  async function renderDocx(doc, layout) {
    const D = root.docx, AL = D.AlignmentType, FONT = 'Times New Roman', HALF = 720;
    const al = v => ({ center: AL.CENTER, left: AL.LEFT, right: AL.RIGHT })[v];
    const para = o => new D.Paragraph(o);
    let brk = false;
    const kids = [];
    for (const b of doc.blocks) {
      if (b.t === 'break') { brk = true; continue; }
      const o = { children: b.runs.map(r => new D.TextRun({ text: r.x, bold: r.b, italics: r.i })) };
      if (brk) { o.pageBreakBefore = true; brk = false; }
      if (b.heading) { o.heading = D.HeadingLevel.HEADING_1; }
      else if (b.t === 'center') o.alignment = AL.CENTER;
      else if (b.t === 'h1') o.heading = D.HeadingLevel.HEADING_1;
      else if (b.t === 'h2') o.heading = D.HeadingLevel.HEADING_2;
      else if (b.t === 'p') o.indent = { firstLine: HALF };
      else if (b.t === 'ref') o.indent = { left: HALF, hanging: HALF };
      else if (b.t === 'num' || b.t === 'bul') o.numbering = { reference: b.t, level: 0, instance: b.list };
      kids.push(para(o));
    }
    const base = { font: FONT, size: 24, color: '000000' }, sp = { before: 0, after: 0, line: 480, lineRule: D.LineRuleType.AUTO };
    const level = (format, text) => [{ level: 0, format, text, alignment: AL.LEFT, style: { paragraph: { indent: { left: HALF, hanging: HALF / 2 } } } }];
    const file = new D.Document({
      title: doc.title, creator: doc.author || 'Student', lastModifiedBy: doc.author || 'Student', description: '',
      styles: {
        default: {
          document: { run: base, paragraph: { spacing: sp } },
          heading1: { run: { ...base, bold: true }, paragraph: { spacing: sp, alignment: al(layout.h1), keepNext: true } },
          heading2: { run: { ...base, bold: true }, paragraph: { spacing: sp, alignment: al(layout.h2), keepNext: true } },
          listParagraph: { run: base, paragraph: { spacing: sp } }
        }
      },
      numbering: { config: [
        { reference: 'num', levels: level(D.LevelFormat.DECIMAL, '%1.') },
        { reference: 'bul', levels: level(D.LevelFormat.BULLET, '•') }
      ] },
      sections: [{
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 } } },
        headers: { default: new D.Header({ children: [para({ alignment: al(layout.pageNumber), spacing: { line: 240 }, children: [new D.TextRun({ children: [D.PageNumber.CURRENT] })] })] }) },
        children: kids
      }]
    });
    return D.Packer.toBlob(file);
  }

  /* ---------- PDF: letter, 1 inch margins, Tinos (same metrics as Times New Roman), double spaced ---------- */
  function renderPdf(doc, layout, fonts) {
    const pdf = new root.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
    [['Regular', 'normal'], ['Bold', 'bold'], ['Italic', 'italic']].forEach(([f, s]) => {
      pdf.addFileToVFS(`Tinos-${f}.ttf`, fonts[f]); pdf.addFont(`Tinos-${f}.ttf`, 'Tinos', s);
    });
    pdf.setProperties({ title: doc.title, author: doc.author });
    const W = 612, H = 792, M = 72, LH = 27.6, SIZE = 12, MAX = Math.floor((H - 2 * M) / LH);
    const setFont = r => pdf.setFont('Tinos', r.b ? 'bold' : r.i ? 'italic' : 'normal');
    pdf.setFontSize(SIZE);
    const width = r => { setFont(r); return pdf.getTextWidth(r.x); };

    // Splits runs into words (each word keeps its run style), then fills lines; over-long words such as URLs are cut.
    function wrap(runs, first, rest) {
      const words = [];
      let glue = false;
      runs.forEach(r => r.x.split(/(\s+)/).forEach(x => {
        if (!x) return;
        if (/^\s+$/.test(x)) { glue = false; return; }
        const part = { x, b: r.b, i: r.i };
        if (glue) words[words.length - 1].push(part); else words.push([part]);
        glue = true;
      }));
      const space = width({ x: ' ' }), lines = [];
      let line = [], w = 0, avail = first;
      const flush = () => { lines.push({ parts: line, w }); line = []; w = 0; avail = rest; };
      words.forEach(word => {
        let ww = word.reduce((a, q) => a + width(q), 0);
        if (line.length && w + space + ww > avail) {
          if (ww <= rest) flush();
        }
        if (w + (line.length ? space : 0) + ww > avail) {
          word.forEach(q => {
            let buf = '', sp = line.length ? space : 0;
            for (const ch of q.x) {
              if (w + sp + width({ ...q, x: buf + ch }) > avail && (buf || line.length)) {
                if (buf) { line.push({ ...q, x: buf, dx: w + sp }); w += sp + width({ ...q, x: buf }); }
                flush(); buf = ''; sp = 0;
              }
              buf += ch;
            }
            if (buf) { line.push({ ...q, x: buf, dx: w + sp }); w += sp + width({ ...q, x: buf }); }
          });
          return;
        }
        if (line.length) w += space;
        word.forEach(q => { line.push({ ...q, dx: w }); w += width(q); });
      });
      if (line.length || !lines.length) flush();
      return lines;
    }

    const TW = W - 2 * M;
    let page = 1, row = 0;
    const newPage = () => { pdf.addPage('letter'); page++; row = 0; };
    const laid = doc.blocks.map(b => {
      if (b.t === 'break' || b.t === 'blank') return { b, lines: [] };
      const runs = b.t === 'h1' || b.t === 'h2' ? b.runs.map(r => ({ ...r, b: true })) : b.runs;
      const list = b.t === 'num' || b.t === 'bul';
      const x0 = b.t === 'p' ? 36 : list ? 36 : 0, x1 = list || b.t === 'ref' ? 36 : 0;
      const align = b.t === 'center' ? 'center' : b.t === 'h1' ? layout.h1 : b.t === 'h2' ? layout.h2 : 'left';
      return { b, x0, x1, align, lines: wrap(runs, TW - x0, TW - x1) };
    });
    laid.forEach((l, k) => {
      const b = l.b;
      if (b.t === 'break') return newPage();
      if (b.t === 'blank') { row++; return; }
      // Keep a heading with the next two lines, and avoid a single line alone at the foot or top of a page.
      if (b.t === 'h1' || b.t === 'h2') {
        let need = l.lines.length, j = k + 1;
        while (laid[j] && /^h[12]$/.test(laid[j].b.t)) need += laid[j++].lines.length;
        need += laid[j] ? Math.min(laid[j].lines.length, laid[j].lines.length === 3 ? 3 : 2) : 0;
        if (row && row + need > MAX) newPage();
      } else if (row && l.lines.length > 1) {
        const left = MAX - row;
        if (left < 2 || (l.lines.length === 3 && left === 2)) newPage();
      }
      l.lines.forEach((ln, i) => {
        if (row >= MAX || (row === MAX - 1 && i === l.lines.length - 2 && l.lines.length > 3)) newPage();
        const y = M + row * LH + 11, ind = i ? l.x1 : l.x0;
        const x = l.align === 'center' ? (W - ln.w) / 2 : l.align === 'right' ? W - M - ln.w : M + ind;
        if (i === 0 && b.t === 'num') { setFont({}); pdf.text(b.n + '.', M + 18, y); }
        if (i === 0 && b.t === 'bul') { setFont({}); pdf.text('•', M + 18, y); }
        // Draw each run of same-styled words as one string so copied text keeps its spaces.
        let cur = null;
        const draw = () => { if (cur) { setFont(cur); pdf.text(cur.x, x + cur.dx, y); } };
        let endAt = 0;
        ln.parts.forEach(q => {
          const gap = q.dx - endAt > 0.5;
          if (cur && !cur.b === !q.b && !cur.i === !q.i) cur.x += (gap ? ' ' : '') + q.x;
          else { if (cur && gap) cur.x += ' '; draw(); cur = { ...q }; }
          endAt = q.dx + width(q);
        });
        draw();
        row++;
      });
    });
    for (let n = 1; n <= page; n++) {
      pdf.setPage(n); setFont({});
      const s = String(n), w = pdf.getTextWidth(s);
      pdf.text(s, layout.pageNumber === 'right' ? W - M - w : M, 36 + 11);
    }
    return pdf.output('blob');
  }

  /* ---------- browser loading, only when a download is asked for ---------- */
  const scripts = {};
  function loadScript(src) {
    return scripts[src] || (scripts[src] = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok;
      s.onerror = () => { delete scripts[src]; s.remove(); no(new Error('load failed: ' + src)); };
      document.head.appendChild(s);
    }));
  }
  async function loadFont(name) {
    const r = await fetch(`/vendor/fonts/Tinos-${name}.ttf`);
    if (!r.ok) throw new Error('font failed: ' + name);
    const bytes = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(s);
  }
  let fontCache = null;
  async function make(formatId, kind, data) {
    const f = FORMATS.find(x => x.id === formatId), doc = f.build(data);
    if (kind === 'docx') { await loadScript('/vendor/docx.js'); return renderDocx(doc, f.layout); }
    await loadScript('/vendor/jspdf.js');
    if (!fontCache) { const n = ['Regular', 'Bold', 'Italic'], v = await Promise.all(n.map(loadFont)); fontCache = {}; n.forEach((k, i) => { fontCache[k] = v[i]; }); }
    return renderPdf(doc, f.layout, fontCache);
  }

  const api = { FORMATS, make, DISCLOSURE, longDate, titleCase, parseAuthors };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CarePlanFormats = api;
})(typeof window !== 'undefined' ? window : globalThis);
