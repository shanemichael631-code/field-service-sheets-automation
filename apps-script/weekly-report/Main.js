/**
 * Apps Script entry points: the sheet menu, preview, email, and the Monday trigger.
 * All the math lives in ReportCore.js.
 *
 * Expected sheets: "Jobs", "Quotes", and "Settings" (columns: Setting | Value).
 */
const SHEETS = { jobs: 'Jobs', quotes: 'Quotes', settings: 'Settings' };

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Weekly Report')
    .addItem('Preview last week', 'previewLastWeek')
    .addItem('Email last week now', 'sendLastWeek')
    .addSeparator()
    .addItem('Turn on Monday 7am email', 'installWeeklyTrigger')
    .addItem('Turn off Monday email', 'removeWeeklyTrigger')
    .addToUi();
}

function readTable_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('Missing a sheet named "' + name + '".');
  return ReportCore.rowsFromTable(sheet.getDataRange().getValues());
}

function readSettings_() {
  const s = {};
  readTable_(SHEETS.settings).forEach(function (r) { s[String(r['Setting']).trim()] = r['Value']; });
  return {
    companyName: String(s['Company Name'] || 'Your Company').trim(),
    recipients: String(s['Report Recipients'] || '').split(/[,;\s]+/).filter(Boolean),
    filterChangeType: String(s['Filter Change Job Type'] || 'Filter Change').trim(),
    // Optional: pin the report to the week containing this date (handy for demos).
    reportWeek: ReportCore.parseDate(s['Report Week'])
  };
}

function buildLastWeek_() {
  const settings = readSettings_();
  const lastWeek = settings.reportWeek || ReportCore.addDays(ReportCore.weekStart(new Date()), -7);
  const report = ReportCore.buildReport(readTable_(SHEETS.jobs), readTable_(SHEETS.quotes), {
    weekStart: lastWeek,
    filterChangeType: settings.filterChangeType
  });
  return { settings: settings, report: report, html: ReportCore.renderHtml(report, settings) };
}

function previewLastWeek() {
  const html = buildLastWeek_().html;
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(780).setHeight(680), 'Weekly report preview');
}

function sendLastWeek() {
  const built = buildLastWeek_();
  const to = built.settings.recipients;
  const bad = to.filter(function (e) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); });
  if (!to.length) throw new Error('Add at least one email under "Report Recipients" on the Settings sheet.');
  if (bad.length) throw new Error('These recipient emails look wrong: ' + bad.join(', '));
  MailApp.sendEmail({
    to: to.join(','),
    subject: built.settings.companyName + ' weekly report: ' + ReportCore.formatWeek(built.report.week),
    htmlBody: built.html
  });
}

function installWeeklyTrigger() {
  removeWeeklyTrigger_();
  ScriptApp.newTrigger('sendLastWeek').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  SpreadsheetApp.getUi().alert('The report will now email every Monday around 7am.');
}

function removeWeeklyTrigger() {
  removeWeeklyTrigger_();
  SpreadsheetApp.getUi().alert('The Monday email is turned off.');
}

function removeWeeklyTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sendLastWeek'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
