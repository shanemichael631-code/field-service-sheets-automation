/**
 * ReminderCore: works out who is due for service and fills in reminder emails.
 *
 * Depends on ReportCore.js (parseDate, toCents, formatDate).
 * Like ReportCore, it uses no Apps Script or browser APIs, so the same file runs
 * in Google Apps Script and in the browser demo/tests.
 */
var ReminderCore = (function () {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];

  function clean(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function isYes(v) { return /^(y|yes|true|1|x)$/i.test(clean(v)); }
  function key(equipment, service) { return clean(equipment).toLowerCase() + '|' + clean(service).toLowerCase(); }

  /** Add whole months, clamping to month end (Jan 31 + 1 month = Feb 28). */
  function addMonths(date, months) {
    const y = date.getFullYear();
    const m = date.getMonth() + months;
    const lastDay = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(date.getDate(), lastDay));
  }

  /** Whole days from a to b (b - a), immune to daylight-saving shifts. */
  function daysBetween(a, b) {
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
  }

  /** "Jane Smith" -> "Jane"; initials like "J. Smith" or blanks -> "there". */
  function firstName(customer) {
    const first = clean(customer).split(/\s+/)[0] || '';
    return first.length > 1 && !/\.$/.test(first) ? first : 'there';
  }

  /**
   * Build the due list.
   * items: rows from the "Service Items" sheet.
   * intervals: rows from the "Intervals" sheet (Equipment, Service, Every (months), Price).
   * opts.today, opts.windowDays (default 30), opts.remindAgainDays (default 21).
   */
  function buildDueList(items, intervals, opts) {
    opts = opts || {};
    const warnings = [];
    const today = ReportCore.parseDate(opts.today || new Date());
    const windowDays = opts.windowDays || 30;
    const remindAgainDays = opts.remindAgainDays || 21;

    const intervalMap = {};
    (intervals || []).forEach(function (r, i) {
      const months = Number(clean(r['Every (months)']));
      let price = ReportCore.toCents(r['Price']);
      if (isNaN(price)) {
        warnings.push('Intervals row ' + (i + 2) + ': price "' + clean(r['Price']) + '" is not a number, counted as $0.');
        price = 0;
      }
      if (!(months > 0)) {
        warnings.push('Intervals row ' + (i + 2) + ': "Every (months)" must be a number above 0.');
        return;
      }
      intervalMap[key(r['Equipment'], r['Service'])] = { months: months, priceCents: price };
    });

    const rows = [];
    (items || []).forEach(function (r, i) {
      const rowNumber = i + 2;
      const label = 'Service Items row ' + rowNumber;
      const preset = intervalMap[key(r['Equipment'], r['Service'])];
      const override = Number(clean(r['Every (months)']));
      const months = override > 0 ? override : preset && preset.months;
      if (!months) {
        warnings.push(label + ': no interval for "' + clean(r['Equipment']) + ' / ' + clean(r['Service']) +
          '". Add it to the Intervals sheet or fill "Every (months)".');
        return;
      }
      const lastDone = ReportCore.parseDate(r['Last Done']) || ReportCore.parseDate(r['Installed']);
      if (!lastDone) {
        warnings.push(label + ': needs a "Last Done" or "Installed" date.');
        return;
      }
      const due = addMonths(lastDone, months);
      const daysUntil = daysBetween(today, due);
      if (daysUntil > windowDays) return;

      const email = clean(r['Email']);
      const lastReminded = ReportCore.parseDate(r['Last Reminded']);
      let skip = '';
      if (isYes(r['Do Not Contact'])) skip = 'Do not contact';
      else if (!email) skip = 'No email';
      else if (!EMAIL_RE.test(email)) skip = 'Email looks wrong';
      else if (lastReminded && daysBetween(lastReminded, today) < remindAgainDays) skip = 'Reminded ' + ReportCore.formatDate(lastReminded);

      rows.push({
        rowNumber: rowNumber,
        status: daysUntil < 0 ? 'Overdue' : 'Due soon',
        due: due,
        daysUntil: daysUntil,
        customer: clean(r['Customer']),
        email: email,
        phone: clean(r['Phone']),
        city: clean(r['City']),
        equipment: clean(r['Equipment']),
        service: clean(r['Service']),
        lastDone: lastDone,
        lastReminded: lastReminded,
        priceCents: preset ? preset.priceCents : 0,
        canEmail: !skip,
        skipReason: skip
      });
    });

    rows.sort(function (a, b) { return a.due - b.due || (a.customer < b.customer ? -1 : 1); });

    function summarize(list) {
      return { count: list.length, valueCents: list.reduce(function (t, r) { return t + r.priceCents; }, 0) };
    }
    const overdue = rows.filter(function (r) { return r.status === 'Overdue'; });
    const soon = rows.filter(function (r) { return r.status === 'Due soon'; });
    return {
      today: today,
      windowDays: windowDays,
      rows: rows,
      overdue: summarize(overdue),
      dueSoon: summarize(soon),
      toEmail: rows.filter(function (r) { return r.canEmail; }),
      warnings: warnings
    };
  }

  /** Fill {placeholders} in the subject/body templates. Unknown placeholders are left as-is. */
  function fillTemplate(template, row, settings) {
    const dueDate = LONG_MONTHS[row.due.getMonth()] + ' ' + row.due.getDate();
    const values = {
      first_name: firstName(row.customer),
      customer: row.customer,
      service: row.service,
      equipment: row.equipment,
      due_date: dueDate,
      due_phrase: (row.daysUntil < 0 ? 'it was due around ' : "it's due around ") + dueDate,
      company: clean(settings.companyName),
      phone: clean(settings.companyPhone),
      booking_link: clean(settings.bookingLink),
      address: clean(settings.companyAddress)
    };
    return String(template).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : m;
    });
  }

  /** The email for one due row: { to, subject, body }. Always ends with the opt-out line and address. */
  function buildEmail(row, settings) {
    const footer = '\n\n--\n' + clean(settings.companyName) +
      (settings.companyAddress ? '\n' + clean(settings.companyAddress) : '') +
      '\nDon\'t want these reminders? Just reply "no reminders" and we\'ll take you off the list.';
    return {
      to: row.email,
      subject: fillTemplate(settings.subject, row, settings),
      body: fillTemplate(settings.body, row, settings) + footer
    };
  }

  return {
    addMonths: addMonths,
    daysBetween: daysBetween,
    firstName: firstName,
    buildDueList: buildDueList,
    fillTemplate: fillTemplate,
    buildEmail: buildEmail
  };
})();
