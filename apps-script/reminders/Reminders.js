/**
 * Apps Script entry points for the Service Reminder Tracker:
 * menu, refreshing the "Due List" sheet, previewing and sending reminder emails.
 * The logic lives in ReminderCore.js (which uses ReportCore.js).
 *
 * Expected sheets: "Service Items", "Intervals", "Settings" (Setting | Value).
 * The script writes the "Due List" sheet and the "Last Reminded" column.
 */
const SHEETS = { items: 'Service Items', intervals: 'Intervals', settings: 'Settings', due: 'Due List' };

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Service Reminders')
    .addItem('Refresh due list', 'refreshDueList')
    .addItem('Preview reminder emails', 'previewReminders')
    .addItem('Send reminder emails…', 'sendReminders')
    .addSeparator()
    .addItem('Turn on daily 7am refresh', 'installDailyTrigger')
    .addItem('Turn off daily refresh', 'removeDailyTrigger')
    .addToUi();
}

function sheet_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('Missing a sheet named "' + name + '".');
  return sheet;
}

function readTable_(name) {
  return ReportCore.rowsFromTable(sheet_(name).getDataRange().getValues());
}

function readSettings_() {
  const s = {};
  readTable_(SHEETS.settings).forEach(function (r) { s[String(r['Setting']).trim()] = r['Value']; });
  return {
    companyName: String(s['Company Name'] || 'Your Company').trim(),
    companyPhone: String(s['Company Phone'] || '').trim(),
    companyAddress: String(s['Company Address'] || '').trim(),
    bookingLink: String(s['Booking Link'] || '').trim(),
    subject: String(s['Reminder Subject'] || '{first_name}, your {equipment} is due for service'),
    body: String(s['Reminder Body'] || 'Hi {first_name},\n\nYour {equipment} is ready for its next service ({service}); {due_phrase}. Call us at {phone} to book.'),
    remindAgainDays: Number(s['Remind Again After (days)']) || 21,
    windowDays: Number(s['Look Ahead (days)']) || 30,
    // Optional: pretend "today" is this date (handy for demos).
    asOf: ReportCore.parseDate(s['As Of Date'])
  };
}

function computeDueList_() {
  const settings = readSettings_();
  const list = ReminderCore.buildDueList(readTable_(SHEETS.items), readTable_(SHEETS.intervals), {
    today: settings.asOf || new Date(),
    windowDays: settings.windowDays,
    remindAgainDays: settings.remindAgainDays
  });
  return { settings: settings, list: list };
}

function refreshDueList() {
  const list = computeDueList_().list;
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEETS.due) || ss.insertSheet(SHEETS.due);
  sheet.clear();

  const summary = 'Updated ' + ReportCore.formatDate(list.today) + ': ' +
    list.overdue.count + ' overdue (' + ReportCore.formatMoney(list.overdue.valueCents) + '), ' +
    list.dueSoon.count + ' due in the next ' + list.windowDays + ' days (' + ReportCore.formatMoney(list.dueSoon.valueCents) + '). ' +
    list.toEmail.length + ' can be emailed now.';
  sheet.getRange(1, 1).setValue(summary).setFontWeight('bold');

  const header = ['Status', 'Due', 'Days', 'Customer', 'Phone', 'Email', 'City', 'Equipment', 'Service',
    'Last Done', 'Est. Value', 'Email Status'];
  const values = list.rows.map(function (r) {
    return [r.status, r.due, r.daysUntil, r.customer, r.phone, r.email, r.city, r.equipment, r.service,
      r.lastDone, r.priceCents / 100, r.canEmail ? 'Ready' : r.skipReason];
  });
  sheet.getRange(3, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#eef2f6');
  if (values.length) {
    sheet.getRange(4, 1, values.length, header.length).setValues(values);
    sheet.getRange(4, 2, values.length, 1).setNumberFormat('mmm d, yyyy');
    sheet.getRange(4, 10, values.length, 1).setNumberFormat('mmm d, yyyy');
    sheet.getRange(4, 11, values.length, 1).setNumberFormat('$#,##0');
    values.forEach(function (v, i) {
      if (v[0] === 'Overdue') sheet.getRange(4 + i, 1).setFontColor('#b42318').setFontWeight('bold');
    });
  }
  if (list.warnings.length) {
    const start = 5 + values.length;
    sheet.getRange(start, 1).setValue('Data problems to fix:').setFontWeight('bold').setFontColor('#b42318');
    sheet.getRange(start + 1, 1, list.warnings.length, 1).setValues(list.warnings.map(function (w) { return [w]; }));
  }
  sheet.setFrozenRows(3);
  sheet.autoResizeColumns(1, header.length);
}

function previewReminders() {
  const computed = computeDueList_();
  const emails = computed.list.toEmail.slice(0, 5).map(function (r) {
    return ReminderCore.buildEmail(r, computed.settings);
  });
  let html = '<div style="font-family:Arial,sans-serif;font-size:13px;">' +
    '<p><b>' + computed.list.toEmail.length + '</b> reminder email(s) are ready. Showing the first ' + emails.length + ':</p>';
  emails.forEach(function (e) {
    html += '<div style="border:1px solid #ddd;border-radius:6px;padding:10px;margin:10px 0;">' +
      '<div><b>To:</b> ' + ReportCore.escapeHtml(e.to) + '</div>' +
      '<div><b>Subject:</b> ' + ReportCore.escapeHtml(e.subject) + '</div>' +
      '<pre style="white-space:pre-wrap;font-family:inherit;">' + ReportCore.escapeHtml(e.body) + '</pre></div>';
  });
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html + '</div>').setWidth(640).setHeight(560), 'Reminder preview');
}

function sendReminders() {
  const ui = SpreadsheetApp.getUi();
  const computed = computeDueList_();
  const toSend = computed.list.toEmail;
  if (!toSend.length) { ui.alert('Nobody is ready for a reminder right now.'); return; }

  const quota = MailApp.getRemainingDailyQuota();
  if (quota < toSend.length) {
    ui.alert('Google lets this account send ' + quota + ' more emails today, but ' + toSend.length +
      ' are ready. Nothing was sent. Try again tomorrow or shorten the list.');
    return;
  }
  const answer = ui.alert('Send ' + toSend.length + ' reminder emails now?', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  // Record "Last Reminded" for every email that actually went out, even if a later one fails,
  // so nobody gets a duplicate on the next run.
  const items = sheet_(SHEETS.items);
  const headers = items.getRange(1, 1, 1, items.getLastColumn()).getValues()[0].map(String);
  let col = headers.indexOf('Last Reminded') + 1;
  if (!col) {
    col = headers.length + 1;
    items.getRange(1, col).setValue('Last Reminded');
  }
  const stamp = new Date();
  let sent = 0;
  try {
    toSend.forEach(function (r) {
      const e = ReminderCore.buildEmail(r, computed.settings);
      MailApp.sendEmail(e.to, e.subject, e.body, { name: computed.settings.companyName });
      items.getRange(r.rowNumber, col).setValue(stamp);
      sent++;
    });
  } finally {
    SpreadsheetApp.flush();
    refreshDueList();
  }
  ui.alert('Sent ' + sent + ' reminder email(s).');
}

function installDailyTrigger() {
  removeDailyTrigger_();
  ScriptApp.newTrigger('refreshDueList').timeBased().everyDays(1).atHour(7).create();
  SpreadsheetApp.getUi().alert('The due list will now refresh every morning around 7am. Emails still only go out when you click Send.');
}

function removeDailyTrigger() {
  removeDailyTrigger_();
  SpreadsheetApp.getUi().alert('Daily refresh is turned off.');
}

function removeDailyTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'refreshDueList'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
