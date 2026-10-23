/**
 * CommandCore: turns a spoken/typed capture into a task, builds the task views, and renders
 * the morning digest. Depends on ReportCore.js (parseDate, addDays, formatDate, escapeHtml).
 *
 * Rule that runs through everything: when something is unclear (no project, a vague date,
 * two dates, a date in the past, too little text), the task goes to "Needs Review" with the
 * reason, instead of guessing.
 */
var CommandCore = (function () {
  'use strict';

  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const DAY_FULL = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday)';
  // Short forms ("fri", "sat") only count after by/on/due/this/next, so "sat down" isn't Saturday.
  const DAY_ABBR = '(sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\\.?';
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  const WORDNUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };
  const LEAD = '(?:(?:due|by|on|before|for)\\s+)?';
  const OPEN = function (t) { return t.status !== 'Done'; };

  function clean(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function dayIndex(word) {
    const w = word.toLowerCase().slice(0, 3);
    return DAYS.findIndex(function (d) { return d.slice(0, 3) === w; });
  }
  function sameDay(a, b) { return a && b && a.getTime() === b.getTime(); }

  // ------------------------------------------------------------------ dates

  /**
   * Find due-date phrases. Returns [{start, end, date|null, vague?, past?, text}] in order.
   * "next Friday" = Friday of next week; a bare weekday = its next occurrence (today counts).
   */
  function findDates(text, today) {
    const found = [];
    function add(m, date, extra) {
      found.push(Object.assign({ start: m.index, end: m.index + m[0].length, date: date, text: m[0].trim() }, extra || {}));
    }
    let m, re;

    re = new RegExp('\\b' + LEAD + '(today|tonight|end of (?:the )?day|eod)\\b', 'gi');
    while ((m = re.exec(text))) add(m, today);

    re = new RegExp('\\b' + LEAD + 'tomorrow\\b', 'gi');
    while ((m = re.exec(text))) add(m, ReportCore.addDays(today, 1));

    function weekday(match, which, dayWord) {
      const idx = dayIndex(dayWord);
      const diff = which && /next/i.test(which) ? nextWeekDiff(today, idx) : (idx - today.getDay() + 7) % 7;
      add(match, ReportCore.addDays(today, diff));
    }
    re = new RegExp('\\b' + LEAD + '(this |next )?' + DAY_FULL + '\\b', 'gi');
    while ((m = re.exec(text))) weekday(m, m[1], m[2]);
    re = new RegExp('\\b(?:(?:due|by|on|before|for)\\s+(this |next )?|(this |next ))' + DAY_ABBR + '(?=[^\\w]|$)', 'gi');
    while ((m = re.exec(text))) weekday(m, m[1] || m[2], m[3]);

    re = new RegExp('\\b(?:in|within)\\s+(\\d+|a|an|one|two|three|four|five|six|seven|ten)\\s+(day|days|week|weeks)\\b', 'gi');
    while ((m = re.exec(text))) {
      const n = /^\d+$/.test(m[1]) ? +m[1] : WORDNUM[m[1].toLowerCase()];
      add(m, ReportCore.addDays(today, /week/i.test(m[2]) ? n * 7 : n));
    }

    re = new RegExp('\\b' + LEAD + '(?:end of (?:the |this )?week|eow)\\b', 'gi');
    while ((m = re.exec(text))) {
      const toFri = (5 - today.getDay() + 7) % 7;
      add(m, ReportCore.addDays(today, today.getDay() === 6 ? 6 : toFri));
    }

    re = new RegExp('\\b' + LEAD + '(?:end of (?:the |this )?month|eom)\\b', 'gi');
    while ((m = re.exec(text))) add(m, new Date(today.getFullYear(), today.getMonth() + 1, 0));

    re = new RegExp('\\b' + LEAD + '(next week|this week|soon|later|sometime)\\b', 'gi');
    while ((m = re.exec(text))) add(m, null, { vague: true });

    // m/d dates, but not fractions like "1/2 inch", "3/4 in" or 1/2" fittings.
    re = new RegExp('\\b' + LEAD + '(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?\\b(?!\\s*(?:in\\b|inch|["”\']|-in))', 'gi');
    while ((m = re.exec(text))) {
      const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : today.getFullYear();
      monthDay(m, y, +m[1], +m[2], !!m[3]);
    }

    re = new RegExp('\\b' + LEAD + MONTH_RE + '\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?', 'gi');
    while ((m = re.exec(text))) {
      monthDay(m, m[3] ? +m[3] : today.getFullYear(), MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)) + 1, +m[2], !!m[3]);
    }

    function monthDay(match, y, mo, d) {
      const date = ReportCore.parseDate(y + '-' + mo + '-' + d);
      if (!date) { add(match, null, { invalid: true }); return; }
      add(match, date, { past: date < today });
    }

    // Drop matches that sit inside a longer match (e.g. "Friday" inside "next Friday").
    found.sort(function (a, b) { return a.start - b.start || (b.end - b.start) - (a.end - a.start); });
    return found.filter(function (f, i) {
      return !found.some(function (g, j) { return j !== i && g.start <= f.start && g.end >= f.end && (g.end - g.start) > (f.end - f.start); });
    });
  }

  /** Days until the given weekday in NEXT week (the week after the current Mon–Sun week). */
  function nextWeekDiff(today, idx) {
    const mondayOffset = (today.getDay() + 6) % 7;              // days since this week's Monday
    const nextMonday = 7 - mondayOffset;
    return nextMonday + ((idx + 6) % 7);                         // Monday=0 ... Sunday=6 within next week
  }

  // ---------------------------------------------------------------- capture

  /**
   * Parse a capture. opts: { today, projects: [{name, business, aliases: []}], project (explicit) }.
   * Returns { original, title, project, business, due, priority, status, waitingOn, reasons }.
   */
  function parseCapture(text, opts) {
    opts = opts || {};
    const original = clean(text);
    const today = ReportCore.parseDate(opts.today || new Date());
    const reasons = [];
    let work = ' ' + original.replace(/\s+/g, ' ') + ' ';
    const cut = [];  // [start,end] ranges (in work) to remove from the title

    // Project / business
    let project = '', business = '';
    const projects = (opts.projects || []).filter(function (p) { return clean(p.name); });
    if (clean(opts.project)) {
      const p = projects.filter(function (x) { return x.name.toLowerCase() === clean(opts.project).toLowerCase(); })[0];
      project = p ? p.name : clean(opts.project);
      business = p ? clean(p.business) : '';
    }
    const names = [];
    projects.forEach(function (p) {
      [p.name].concat(p.aliases || []).forEach(function (n) { if (clean(n)) names.push({ text: clean(n), p: p, kind: 'project' }); });
      if (clean(p.business)) names.push({ text: clean(p.business), p: p, kind: 'business' });
    });
    names.sort(function (a, b) { return b.text.length - a.text.length; });
    const projectHits = [];
    names.forEach(function (n) {
      const re = new RegExp('(^|[^\\w])(' + escRe(n.text) + ')(?=[^\\w]|$)', 'gi');
      let m;
      while ((m = re.exec(work))) {
        const s = m.index + m[1].length, e = s + m[2].length;
        if (cut.some(function (c) { return s < c[1] && e > c[0]; })) continue;
        // Strip it from the title only when it's used as a label ("Hiring - ...", "... , trucks"),
        // not when it's part of the sentence ("order fittings for the van").
        const before = work.slice(0, s).replace(/\s+$/, ''), after = work.slice(e).replace(/^\s+/, '');
        const asLabel = (!before || /[.,:;!?\-–—]$/.test(before)) && (!after || /^[.,:;!?\-–—]/.test(after));
        if (asLabel) cut.push([s, e]);
        else cut.push([s, s]);  // remember the match so shorter names inside it don't match again
        if (n.kind === 'project') projectHits.push(n.p);
        else if (!business) business = clean(n.p.business);
      }
    });
    if (!project) {
      const distinct = projectHits.filter(function (p, i) { return projectHits.indexOf(p) === i; });
      if (distinct.length === 1) { project = distinct[0].name; business = clean(distinct[0].business); }
      else if (distinct.length > 1) reasons.push('Mentions more than one project (' + distinct.map(function (p) { return p.name; }).join(', ') + ').');
      else if (projects.length) reasons.push('No project recognized.');
    }

    // Due date
    let due = null;
    const dates = findDates(work, today);
    dates.forEach(function (d) { cut.push([d.start, d.end]); });
    const real = dates.filter(function (d) { return d.date; });
    const distinctDates = real.filter(function (d, i) { return !real.slice(0, i).some(function (x) { return sameDay(x.date, d.date); }); });
    if (distinctDates.length > 1) reasons.push('More than one date mentioned (' + distinctDates.map(function (d) { return d.text; }).join(', ') + ').');
    else if (distinctDates.length === 1) due = distinctDates[0].date;
    dates.forEach(function (d) {
      if (d.vague) reasons.push('"' + d.text + '" isn\'t a specific day.');
      if (d.invalid) reasons.push('"' + d.text + '" isn\'t a real date.');
      if (d.past && d.date) reasons.push('"' + d.text + '" is in the past.');
    });

    // Priority
    let priority = 'P2';
    let m;
    const pri = [
      [/\b(p1|urgent|asap|critical|top priority)\b|!{2,}/gi, 'P1'],
      [/\bp2\b/gi, 'P2'],
      [/\b(p3|someday|low priority|whenever|no rush)\b/gi, 'P3']
    ];
    pri.forEach(function (pair) {
      while ((m = pair[0].exec(work))) { priority = pair[1]; cut.push([m.index, m.index + m[0].length]); }
    });

    // Waiting on someone
    let waitingOn = '';
    const w = /\bwaiting (?:on|for) ((?:[A-Z][\w'-]*)(?: [A-Z][\w'-]*){0,2})/.exec(work);
    if (w) waitingOn = w[1];

    // Title = what's left
    cut.sort(function (a, b) { return b[0] - a[0]; });
    let title = work;
    cut.forEach(function (c) { title = title.slice(0, c[0]) + ' ' + title.slice(c[1]); });
    title = title
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/(^|[.;:!?])\s*[.,;:!?\s-]+/g, '$1 ')
      .replace(/^[\s.,;:!?-]+|[\s.,;:-]+$/g, '')
      .replace(/^(?:(?:i |we )?need to|remember to|remind me to|todo:?|task:?)\s+/i, '')
      .replace(/\s+/g, ' ')
      .replace(/(\s+(?:and|or|by|on|due|before|for))+$/i, '')   // left behind when a date was cut out
      .trim();
    if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
    if (title.replace(/[^a-z0-9]/gi, '').length < 6 || title.split(' ').length < 3) reasons.push('Not enough detail to know what the task is.');

    return {
      original: original, title: title || original, project: project, business: business, due: due,
      priority: priority, status: reasons.length ? 'Needs Review' : (waitingOn ? 'Waiting' : 'Inbox'),
      waitingOn: waitingOn, reasons: reasons
    };
  }

  /** A flagged email becomes a task: subject is parsed, sender + link are kept. */
  function emailToTask(subject, from, link, opts) {
    const t = parseCapture(clean(subject).replace(/^(re|fwd?):\s*/i, ''), opts);
    t.original = 'Email from ' + clean(from) + ': ' + clean(subject);
    t.source = 'Gmail';
    t.link = clean(link);
    return t;
  }

  /** T-0001, T-0002 ... */
  function nextId(existing) {
    let max = 0;
    (existing || []).forEach(function (id) { const k = /^T-(\d+)$/.exec(clean(id)); if (k && +k[1] > max) max = +k[1]; });
    return 'T-' + String(max + 1).padStart(4, '0');
  }

  // ------------------------------------------------------------------ views

  /** Rows from the Tasks sheet -> normalized tasks. */
  function readTasks(rows) {
    return (rows || []).map(function (r, i) {
      return {
        row: i + 2, id: clean(r['ID']), created: ReportCore.parseDate(r['Created']), source: clean(r['Source']),
        original: clean(r['Original Text']), title: clean(r['Title']), project: clean(r['Project']), business: clean(r['Business']),
        due: ReportCore.parseDate(r['Due']), priority: clean(r['Priority']).toUpperCase() || 'P2',
        status: clean(r['Status']) || 'Inbox', waitingOn: clean(r['Waiting On']), link: clean(r['Link']), reasons: clean(r['Review Reasons'])
      };
    }).filter(function (t) { return t.id || t.title; });
  }

  function bySoonest(a, b) {
    if (a.due && b.due && a.due - b.due) return a.due - b.due;
    if (a.due && !b.due) return -1;
    if (!a.due && b.due) return 1;
    return a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : (a.id < b.id ? -1 : 1);
  }

  /** The Command Center views for a given day. */
  function buildViews(tasks, today) {
    today = ReportCore.parseDate(today || new Date());
    const in7 = ReportCore.addDays(today, 7);
    const open = tasks.filter(OPEN);
    function pick(f) { return open.filter(f).sort(bySoonest); }
    const projects = {};
    open.forEach(function (t) {
      const k = t.project || '(no project)';
      if (!projects[k]) projects[k] = { name: k, business: t.business, open: 0, overdue: 0, p1: 0 };
      projects[k].open++;
      if (t.due && t.due < today && t.status !== 'Needs Review') projects[k].overdue++;   // same rule as the Overdue list
      if (t.priority === 'P1') projects[k].p1++;
    });
    return {
      today: today,
      overdue: pick(function (t) { return t.due && t.due < today && t.status !== 'Needs Review'; }),
      dueToday: pick(function (t) { return sameDay(t.due, today) && t.status !== 'Needs Review'; }),
      next7: pick(function (t) { return t.due && t.due > today && t.due <= in7 && t.status !== 'Needs Review'; }),
      p1: pick(function (t) { return t.priority === 'P1' && t.status !== 'Needs Review'; }),
      waiting: pick(function (t) { return t.status === 'Waiting'; }),
      needsReview: pick(function (t) { return t.status === 'Needs Review'; }),
      noDate: pick(function (t) { return !t.due && t.status !== 'Needs Review' && t.status !== 'Waiting'; }),
      projects: Object.keys(projects).map(function (k) { return projects[k]; })
        .sort(function (a, b) { return b.overdue - a.overdue || b.open - a.open || (a.name < b.name ? -1 : 1); }),
      openCount: open.length
    };
  }

  // ----------------------------------------------------------------- digest

  function dueLabel(t, today) {
    if (!t.due) return '';
    const diff = Math.round((t.due - today) / 86400000);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff < 0) return Math.abs(diff) + (diff === -1 ? ' day' : ' days') + ' late';
    return ReportCore.formatDate(t.due);
  }

  /** Morning digest email (inline styles). Shows only what needs attention. */
  function renderDigest(v, opts) {
    opts = opts || {};
    const e = ReportCore.escapeHtml, muted = '#5b6675', line = '#e3e7ec', red = '#b42318', blue = '#0b6e99';
    function section(title, list, color, empty) {
      if (!list.length && !empty) return '';
      let h = '<div style="font-size:14px;font-weight:bold;margin:18px 0 6px;color:' + (color || '#1f2a37') + ';">' + title +
        ' <span style="color:' + muted + ';font-weight:normal;">(' + list.length + ')</span></div>';
      if (!list.length) return h + '<div style="color:' + muted + ';font-size:13px;">' + empty + '</div>';
      h += '<table style="border-collapse:collapse;width:100%;font-size:13px;">';
      list.slice(0, 12).forEach(function (t) {
        const title = t.link ? '<a href="' + e(t.link) + '" style="color:#1f2a37;">' + e(t.title) + '</a>' : e(t.title);
        h += '<tr><td style="padding:5px 6px;border-bottom:1px solid ' + line + ';">' +
          (t.priority === 'P1' ? '<span style="color:' + red + ';font-weight:bold;">P1</span> ' : '') + title +
          '<div style="color:' + muted + ';font-size:11px;">' + e([t.project, t.waitingOn ? 'waiting on ' + t.waitingOn : '', t.reasons].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td style="padding:5px 6px;border-bottom:1px solid ' + line + ';text-align:right;white-space:nowrap;color:' + (t.due && t.due < v.today ? red : muted) + ';">' + e(dueLabel(t, v.today)) + '</td></tr>';
      });
      if (list.length > 12) h += '<tr><td colspan="2" style="padding:5px 6px;color:' + muted + ';">…and ' + (list.length - 12) + ' more</td></tr>';
      return h + '</table>';
    }
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#1f2a37;">' +
      '<div style="border-bottom:3px solid ' + blue + ';padding-bottom:8px;">' +
      '<div style="font-size:12px;color:' + muted + ';text-transform:uppercase;letter-spacing:1px;">' + e(opts.title || 'Command Center') + '</div>' +
      '<div style="font-size:20px;font-weight:bold;">' + days[v.today.getDay()] + ', ' + ReportCore.formatDate(v.today) + '</div>' +
      '<div style="font-size:13px;color:' + muted + ';">' + v.openCount + ' open · ' + v.overdue.length + ' overdue · ' + v.dueToday.length + ' due today · ' +
      v.needsReview.length + ' to review</div></div>' +
      section('Overdue', v.overdue, red) +
      section('Due today', v.dueToday, '#1f2a37', 'Nothing due today.') +
      section('Needs review', v.needsReview, '#8a4b00') +
      section('Next 7 days', v.next7) +
      section('Waiting on others', v.waiting) +
      '<p style="font-size:11px;color:' + muted + ';margin-top:20px;">From your Command Center sheet. Change a task\'s Status to Done to clear it.</p></div>';
  }

  return {
    findDates: findDates,
    parseCapture: parseCapture,
    emailToTask: emailToTask,
    nextId: nextId,
    readTasks: readTasks,
    buildViews: buildViews,
    renderDigest: renderDigest,
    dueLabel: dueLabel
  };
})();
