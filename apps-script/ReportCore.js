/**
 * ReportCore: the math and HTML for the weekly field-service KPI report.
 *
 * No Apps Script or browser APIs in this file, so the exact same code runs
 * inside Google Apps Script (Main.js calls it) and in the browser demo/tests.
 * Money is always handled as integer cents to avoid floating-point drift.
 */
var ReportCore = (function () {
  'use strict';

  // ---------------------------------------------------------------- parsing

  /** "$1,234.56", "(50)", 19.99 -> integer cents. Blank -> 0. Unreadable -> NaN. */
  function toCents(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return isFinite(value) ? Math.round(value * 100) : NaN;
    let s = String(value).trim();
    if (s === '') return 0;
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    s = s.replace(/[$,\s]/g, '');
    if (s.charAt(0) === '-') { negative = !negative; s = s.slice(1); }
    if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return NaN;
    const parts = s.split('.');
    const dollars = parts[0] === '' ? 0 : parseInt(parts[0], 10);
    const frac = parts[1] || '';
    const cents = dollars * 100 + (frac === '' ? 0 : parseInt((frac + '0').slice(0, 2), 10));
    return negative ? -cents : cents;
  }

  function makeDate(y, m, d) {
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
  }

  /** Date object, "2026-10-13" or "10/13/2026" -> local midnight Date, or null. */
  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const s = String(value).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return makeDate(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
    if (m) return makeDate(+m[3] < 100 ? +m[3] + 2000 : +m[3], +m[1], +m[2]);
    return null;
  }

  /** RFC-4180-style CSV -> 2D array (handles quotes, escaped quotes, CRLF). */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /** 2D values (header row first) -> array of objects keyed by header. Blank rows skipped. */
  function rowsFromTable(values) {
    if (!values || !values.length) return [];
    const headers = values[0].map(function (h) { return String(h).trim(); });
    return values.slice(1)
      .filter(function (r) { return r.some(function (v) { return v !== '' && v !== null && v !== undefined; }); })
      .map(function (r) {
        const obj = {};
        headers.forEach(function (h, i) { if (h) obj[h] = r[i] === undefined ? '' : r[i]; });
        return obj;
      });
  }

  // ------------------------------------------------------------------ dates

  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }

  /** Monday 00:00 of the week containing `date`. */
  function weekStart(date) {
    const d = parseDate(date);
    return addDays(d, -((d.getDay() + 6) % 7));
  }

  function inRange(date, start, end) {
    return !!date && date >= start && date < end;
  }

  // ---------------------------------------------------------- normalizing

  function clean(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function isYes(v) { return /^(y|yes|true|1|x)$/i.test(clean(v)); }

  function normalizeJobs(rows, warnings) {
    return rows.map(function (r, i) {
      const label = 'Jobs row ' + (i + 2);
      let amount = toCents(r['Amount']);
      if (isNaN(amount)) {
        warnings.push(label + ': amount "' + clean(r['Amount']) + '" is not a number, counted as $0.');
        amount = 0;
      }
      let systems = Number(clean(r['Systems Installed']) || 0);
      if (!isFinite(systems) || systems < 0) {
        warnings.push(label + ': systems installed "' + clean(r['Systems Installed']) + '" is not a valid count, counted as 0.');
        systems = 0;
      }
      const status = clean(r['Status']).toLowerCase();
      const completed = parseDate(r['Completed Date']);
      if (status === 'completed' && !completed) {
        warnings.push(label + ': marked Completed but has no readable Completed Date, left out of the report.');
      }
      return {
        id: clean(r['Job ID']),
        customer: clean(r['Customer']),
        type: clean(r['Job Type']) || 'Other',
        tech: clean(r['Tech']) || 'Unassigned',
        originalTech: clean(r['Original Tech']),
        status: status,
        amountCents: amount,
        completed: completed,
        scheduled: parseDate(r['Scheduled Date']),
        booked: parseDate(r['Booked Date']),
        systems: systems,
        systemType: clean(r['System Type']),
        callback: isYes(r['Callback']),
        callbackCause: clean(r['Callback Cause']) || 'Not recorded'
      };
    });
  }

  function normalizeQuotes(rows, warnings) {
    return rows.map(function (r, i) {
      let amount = toCents(r['Amount']);
      if (isNaN(amount)) {
        warnings.push('Quotes row ' + (i + 2) + ': amount "' + clean(r['Amount']) + '" is not a number, counted as $0.');
        amount = 0;
      }
      return {
        id: clean(r['Quote ID']),
        status: clean(r['Status']).toLowerCase(),
        amountCents: amount,
        sent: parseDate(r['Sent Date']),
        decided: parseDate(r['Decided Date'])
      };
    });
  }

  // --------------------------------------------------------------- report

  /** Group items by key, summing count and cents; sorted by count desc, then name. */
  function tally(items, keyFn, centsFn) {
    const map = {};
    items.forEach(function (it) {
      const k = keyFn(it);
      if (!map[k]) map[k] = { name: k, count: 0, cents: 0 };
      map[k].count += 1;
      if (centsFn) map[k].cents += centsFn(it);
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });
  }

  function sumCents(items) {
    return items.reduce(function (t, j) { return t + j.amountCents; }, 0);
  }

  function pctChange(now, before) {
    if (before === 0) return null;
    // Round half away from zero so -24.75% shows as -24.8%, same as +24.75% -> 24.8%.
    const tenths = Math.round((Math.abs(now - before) * 1000) / Math.abs(before));
    return ((now - before) * before < 0 ? -tenths : tenths) / 10;
  }

  /**
   * Build the report object for the Monday–Sunday week containing opts.weekStart.
   * opts.filterChangeType: the Job Type that counts as a filter change (default "Filter Change").
   * opts.staleQuoteDays: open quotes older than this count as stale (default 14).
   */
  function buildReport(jobRows, quoteRows, opts) {
    opts = opts || {};
    const warnings = [];
    const jobs = normalizeJobs(jobRows || [], warnings);
    const quotes = normalizeQuotes(quoteRows || [], warnings);
    const start = weekStart(opts.weekStart || new Date());
    const end = addDays(start, 7);
    const prevStart = addDays(start, -7);
    const fcType = (opts.filterChangeType || 'Filter Change').toLowerCase();
    const staleDays = opts.staleQuoteDays || 14;
    const isFc = function (j) { return j.type.toLowerCase() === fcType; };

    const done = jobs.filter(function (j) { return j.status === 'completed' && inRange(j.completed, start, end); });
    const prevDone = jobs.filter(function (j) { return j.status === 'completed' && inRange(j.completed, prevStart, start); });
    const revenue = sumCents(done);
    const prevRevenue = sumCents(prevDone);
    const installs = done.filter(function (j) { return j.systems > 0; });
    const callbacks = done.filter(function (j) { return j.callback; });

    const techMap = {};
    done.forEach(function (j) {
      if (!techMap[j.tech]) techMap[j.tech] = { name: j.tech, jobs: 0, cents: 0, callbacks: 0 };
      techMap[j.tech].jobs += 1;
      techMap[j.tech].cents += j.amountCents;
    });
    callbacks.forEach(function (j) {
      const t = j.originalTech || j.tech;
      if (!techMap[t]) techMap[t] = { name: t, jobs: 0, cents: 0, callbacks: 0 };
      techMap[t].callbacks += 1;
    });

    const decided = quotes.filter(function (q) {
      return (q.status === 'approved' || q.status === 'declined') && inRange(q.decided, start, end);
    });
    const approved = decided.filter(function (q) { return q.status === 'approved'; });
    const open = quotes.filter(function (q) { return q.status === 'open' && q.sent && q.sent < end; });
    const staleCutoff = addDays(end, -staleDays);
    const stale = open.filter(function (q) { return q.sent < staleCutoff; });

    return {
      week: { start: start, end: addDays(end, -1) },
      completed: {
        count: done.length,
        revenueCents: revenue,
        avgTicketCents: done.length ? Math.round(revenue / done.length) : 0,
        prevCount: prevDone.length,
        prevRevenueCents: prevRevenue,
        revenueChangePct: pctChange(revenue, prevRevenue)
      },
      byType: tally(done, function (j) { return j.type; }, function (j) { return j.amountCents; }),
      systems: {
        total: installs.reduce(function (t, j) { return t + j.systems; }, 0),
        byType: (function () {
          const map = {};
          installs.forEach(function (j) { const k = j.systemType || 'Unspecified'; map[k] = (map[k] || 0) + j.systems; });
          return Object.keys(map).map(function (k) { return { name: k, count: map[k] }; })
            .sort(function (a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });
        })()
      },
      callbacks: {
        count: callbacks.length,
        byCause: tally(callbacks, function (j) { return j.callbackCause; }),
        rows: callbacks.slice().sort(function (a, b) { return a.completed - b.completed; }).map(function (j) {
          return { date: j.completed, customer: j.customer, tech: j.originalTech || j.tech, cause: j.callbackCause };
        })
      },
      filterChanges: {
        completed: done.filter(isFc).length,
        bookedThisWeek: jobs.filter(function (j) { return isFc(j) && j.status !== 'cancelled' && inRange(j.booked, start, end); }).length,
        scheduledNext30: jobs.filter(function (j) {
          return isFc(j) && j.status === 'scheduled' && inRange(j.scheduled, end, addDays(end, 30));
        }).length
      },
      quotes: {
        sent: quotes.filter(function (q) { return inRange(q.sent, start, end); }).length,
        approved: approved.length,
        declined: decided.length - approved.length,
        closeRatePct: decided.length ? Math.round((approved.length / decided.length) * 100) : null,
        approvedCents: sumCents(approved),
        openCount: open.length,
        openCents: sumCents(open),
        staleCount: stale.length,
        staleCents: sumCents(stale),
        staleDays: staleDays
      },
      techs: Object.keys(techMap).map(function (k) { return techMap[k]; })
        .sort(function (a, b) { return b.cents - a.cents || (a.name < b.name ? -1 : 1); }),
      warnings: warnings
    };
  }

  // ------------------------------------------------------------ rendering

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 123456 -> "$1,235" (whole dollars) or "$1,234.56" with showCents. */
  function formatMoney(cents, showCents) {
    const neg = cents < 0;
    const abs = Math.abs(cents);
    const dollars = showCents ? Math.floor(abs / 100) : Math.round(abs / 100);
    let out = '$' + String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (showCents) out += '.' + String(abs % 100).padStart(2, '0');
    return neg ? '-' + out : out;
  }

  function formatDate(d) { return MONTHS[d.getMonth()] + ' ' + d.getDate(); }

  function formatWeek(week) {
    return formatDate(week.start) + ' – ' + formatDate(week.end) + ', ' + week.end.getFullYear();
  }

  /** Email-safe HTML (inline styles, tables only) for the report. */
  function renderHtml(report, opts) {
    opts = opts || {};
    const company = escapeHtml(opts.companyName || 'Your Company');
    const c = report.completed;
    const q = report.quotes;
    const ink = '#1f2a37', muted = '#5b6675', line = '#e3e7ec', accent = '#0b6e99', bad = '#b42318', good = '#067647';
    const td = 'padding:6px 10px;border-bottom:1px solid ' + line + ';text-align:left;';
    const tdR = td + 'text-align:right;';
    const h2 = 'font-size:15px;margin:22px 0 8px;color:' + ink + ';';

    function tile(label, value, sub) {
      return '<td style="padding:12px;border:1px solid ' + line + ';border-radius:6px;width:25%;vertical-align:top;">' +
        '<div style="font-size:12px;color:' + muted + ';">' + label + '</div>' +
        '<div style="font-size:22px;font-weight:bold;color:' + ink + ';margin-top:2px;">' + value + '</div>' +
        (sub ? '<div style="font-size:12px;margin-top:2px;">' + sub + '</div>' : '') + '</td>';
    }
    function table(headers, rows, rightCols) {
      if (!rows.length) return '<p style="color:' + muted + ';font-size:13px;margin:0;">None this week.</p>';
      let h = '<table style="border-collapse:collapse;width:100%;font-size:13px;color:' + ink + ';"><tr>';
      headers.forEach(function (t, i) {
        h += '<th style="' + (rightCols.indexOf(i) >= 0 ? tdR : td) + 'color:' + muted + ';font-weight:normal;">' + t + '</th>';
      });
      h += '</tr>';
      rows.forEach(function (r) {
        h += '<tr>';
        r.forEach(function (v, i) { h += '<td style="' + (rightCols.indexOf(i) >= 0 ? tdR : td) + '">' + v + '</td>'; });
        h += '</tr>';
      });
      return h + '</table>';
    }

    let change = '<span style="color:' + muted + ';">no prior week</span>';
    if (c.revenueChangePct !== null) {
      const up = c.revenueChangePct >= 0;
      change = '<span style="color:' + (up ? good : bad) + ';">' + (up ? '▲ ' : '▼ ') +
        Math.abs(c.revenueChangePct) + '% vs last week</span>';
    }

    let html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;color:' + ink + ';">' +
      '<div style="border-bottom:3px solid ' + accent + ';padding-bottom:8px;">' +
      '<div style="font-size:12px;color:' + muted + ';text-transform:uppercase;letter-spacing:1px;">Weekly report</div>' +
      '<div style="font-size:22px;font-weight:bold;">' + company + '</div>' +
      '<div style="font-size:13px;color:' + muted + ';">' + formatWeek(report.week) + '</div></div>' +
      '<table style="border-collapse:separate;border-spacing:8px;width:100%;margin:10px -8px 0;"><tr>' +
      tile('Revenue (completed)', formatMoney(c.revenueCents), change) +
      tile('Jobs completed', c.count, '<span style="color:' + muted + ';">avg ticket ' + formatMoney(c.avgTicketCents) + '</span>') +
      tile('Systems installed', report.systems.total, '') +
      tile('Callbacks', report.callbacks.count, report.callbacks.count
        ? '<span style="color:' + bad + ';">see below</span>' : '<span style="color:' + good + ';">clean week</span>') +
      '</tr></table>';

    html += '<div style="' + h2 + '">Jobs by type</div>' + table(['Type', 'Jobs', 'Revenue'],
      report.byType.map(function (t) { return [escapeHtml(t.name), t.count, formatMoney(t.cents)]; }), [1, 2]);

    html += '<div style="' + h2 + '">Systems installed</div>' + table(['System', 'Count'],
      report.systems.byType.map(function (s) { return [escapeHtml(s.name), s.count]; }), [1]);

    html += '<div style="' + h2 + '">Filter changes</div>' + table(['', 'Count'], [
      ['Completed this week', report.filterChanges.completed],
      ['Booked this week', report.filterChanges.bookedThisWeek],
      ['On the schedule, next 30 days', report.filterChanges.scheduledNext30]
    ], [1]);

    html += '<div style="' + h2 + '">Callbacks</div>' + table(['Date', 'Customer', 'Tech', 'Cause'],
      report.callbacks.rows.map(function (r) {
        return [formatDate(r.date), escapeHtml(r.customer), escapeHtml(r.tech), escapeHtml(r.cause)];
      }), []);

    html += '<div style="' + h2 + '">Quotes</div>' + table(['', 'Value'], [
      ['Sent this week', q.sent],
      ['Approved this week', q.approved + ' (' + formatMoney(q.approvedCents) + ')'],
      ['Declined this week', q.declined],
      ['Close rate (decided this week)', q.closeRatePct === null ? '—' : q.closeRatePct + '%'],
      ['Open quotes', q.openCount + ' (' + formatMoney(q.openCents) + ')'],
      ['Open longer than ' + q.staleDays + ' days', '<span style="color:' + (q.staleCount ? bad : ink) + ';">' +
        q.staleCount + ' (' + formatMoney(q.staleCents) + ')</span>']
    ], [1]);

    html += '<div style="' + h2 + '">Tech leaderboard</div>' + table(['Tech', 'Jobs', 'Revenue', 'Callbacks'],
      report.techs.map(function (t) { return [escapeHtml(t.name), t.jobs, formatMoney(t.cents), t.callbacks]; }), [1, 2, 3]);

    if (report.warnings.length) {
      html += '<div style="' + h2 + 'color:' + bad + ';">Data problems to fix</div><ul style="font-size:12px;color:' + muted + ';">' +
        report.warnings.map(function (w) { return '<li>' + escapeHtml(w) + '</li>'; }).join('') + '</ul>';
    }
    return html + '<p style="font-size:11px;color:' + muted + ';margin-top:24px;">Generated automatically from your Jobs and Quotes sheets.</p></div>';
  }

  return {
    toCents: toCents,
    parseDate: parseDate,
    parseCsv: parseCsv,
    rowsFromTable: rowsFromTable,
    addDays: addDays,
    weekStart: weekStart,
    buildReport: buildReport,
    renderHtml: renderHtml,
    formatMoney: formatMoney,
    formatDate: formatDate,
    formatWeek: formatWeek,
    escapeHtml: escapeHtml
  };
})();
