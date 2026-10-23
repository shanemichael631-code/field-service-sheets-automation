/**
 * Apps Script entry points for the Command Center: menu, phone capture web app,
 * email-to-task, views sheet, morning digest and triggers. Logic lives in CommandCore.js.
 *
 * Sheets: "Tasks", "Projects" (Project | Business | Aliases | Active), "Settings" (Setting | Value).
 * The script writes the "Command Center" view sheet and an "Automation Log".
 * Nothing here sends email to anyone but the owner, and nothing deletes tasks.
 */
const CC = { tasks: 'Tasks', projects: 'Projects', settings: 'Settings', views: 'Command Center', log: 'Automation Log' };
const TASK_HEADER = ['ID', 'Created', 'Source', 'Original Text', 'Title', 'Project', 'Business', 'Due', 'Priority', 'Status',
  'Waiting On', 'Link', 'Review Reasons'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Command Center')
    .addItem('Add a task…', 'promptTask')
    .addItem('Refresh views', 'refreshViews')
    .addSeparator()
    .addItem('Check flagged emails now', 'processFlaggedEmails')
    .addItem('Email me today\'s digest now', 'sendDigest')
    .addSeparator()
    .addItem('Turn on automations', 'installTriggers')
    .addItem('Turn off automations', 'removeTriggers')
    .addToUi();
}

// ---- data access -------------------------------------------------------------

/** The spreadsheet, even when called from the phone web app (where there's no "active" sheet). */
function ccSS_() {
  const props = PropertiesService.getScriptProperties();
  const active = SpreadsheetApp.getActive();
  if (active) {
    if (props.getProperty('SHEET_ID') !== active.getId()) props.setProperty('SHEET_ID', active.getId());
    return active;
  }
  const id = props.getProperty('SHEET_ID');
  if (!id) throw new Error('Open the Command Center spreadsheet once (and click Command Center › Refresh views) before using the phone page.');
  return SpreadsheetApp.openById(id);
}

function ccSheet_(name) {
  const sheet = ccSS_().getSheetByName(name);
  if (!sheet) throw new Error('Missing a sheet named "' + name + '".');
  return sheet;
}

function ccTable_(name) {
  return ReportCore.rowsFromTable(ccSheet_(name).getDataRange().getValues());
}

function ccSettings_() {
  const s = {};
  ccTable_(CC.settings).forEach(function (r) { s[String(r['Setting']).trim()] = r['Value']; });
  return {
    title: String(s['Title'] || 'Command Center').trim(),
    digestTo: String(s['Digest Email'] || Session.getActiveUser().getEmail()).trim(),
    flagLabel: String(s['Flag Label'] || 'To Task').trim(),
    doneLabel: String(s['Done Label'] || 'Tasked').trim(),
    // Optional: pretend "today" is this date (for demos).
    today: ReportCore.parseDate(s['As Of Date']) || new Date()
  };
}

function ccProjects_() {
  return ccTable_(CC.projects)
    .filter(function (r) { return String(r['Project']).trim() && !/^(n|no|false)$/i.test(String(r['Active']).trim()); })
    .map(function (r) {
      return { name: String(r['Project']).trim(), business: String(r['Business'] || '').trim(),
        aliases: String(r['Aliases'] || '').split(',').map(function (a) { return a.trim(); }).filter(Boolean) };
    });
}

function ccLog_(action, result) {
  try {
    const ss = ccSS_();
    const sheet = ss.getSheetByName(CC.log) || ss.insertSheet(CC.log);
    if (sheet.getLastRow() === 0) sheet.appendRow(['When', 'Action', 'Result']);
    sheet.appendRow([new Date(), action, result]);
  } catch (e) { console.error(e); }
}

/** Add one parsed task as a row. Locked so two captures at once can't get the same ID. */
function addTask_(t, source) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const sheet = ccSheet_(CC.tasks);
    if (sheet.getLastRow() === 0) sheet.appendRow(TASK_HEADER);
    const ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
    const id = CommandCore.nextId(ids);
    sheet.appendRow([id, new Date(), source || t.source || 'Manual', t.original, t.title, t.project, t.business, t.due || '',
      t.priority, t.status, t.waitingOn || '', t.link || '', t.reasons.join(' ')]);
    if (t.due) sheet.getRange(sheet.getLastRow(), 8).setNumberFormat('mmm d, yyyy');
    return id;
  } finally {
    lock.releaseLock();
  }
}

// ---- capture: phone web app + menu prompt ---------------------------------------

/** Web app: deploy as "Execute as: Me", "Who has access: Only myself", add the URL to your phone's home screen. */
function doGet() {
  const html = typeof CAPTURE_HTML !== 'undefined' ? HtmlService.createHtmlOutput(CAPTURE_HTML) : HtmlService.createHtmlOutputFromFile('Capture');
  return html.setTitle('Add a task').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getProjectsForCapture() {
  return ccProjects_().map(function (p) { return { name: p.name, business: p.business }; });
}

function captureTask(text, project) {
  const s = ccSettings_();
  const t = CommandCore.parseCapture(text, { today: s.today, projects: ccProjects_(), project: project });
  const id = addTask_(t, 'Phone');
  ccLog_('Phone capture', id + ' ' + t.status);
  refreshViews();
  return { id: id, title: t.title, project: t.project, priority: t.priority, status: t.status, waitingOn: t.waitingOn,
    dueText: t.due ? ReportCore.formatDate(t.due) : '', reasons: t.reasons };
}

function promptTask() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Add a task', 'Say the project, what to do, and when (e.g. "Hiring. Post the tech job ad by Friday").', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || !r.getResponseText().trim()) return;
  const t = captureTask(r.getResponseText(), '');
  ui.alert(t.id + ' added as ' + t.status + (t.reasons.length ? ':\n\n' + t.reasons.join('\n') : '.'));
}

// ---- flagged email -> task -------------------------------------------------------

/** Threads you label "To Task" become tasks (with a link back), then get relabeled "Tasked". */
function processFlaggedEmails() {
  const s = ccSettings_();
  const flag = GmailApp.getUserLabelByName(s.flagLabel) || GmailApp.createLabel(s.flagLabel);
  const done = GmailApp.getUserLabelByName(s.doneLabel) || GmailApp.createLabel(s.doneLabel);
  const threads = flag.getThreads(0, 25);
  const projects = ccProjects_();
  let added = 0;
  threads.forEach(function (thread) {
    try {
      const msg = thread.getMessages()[0];
      const t = CommandCore.emailToTask(thread.getFirstMessageSubject(), msg.getFrom(), thread.getPermalink(), { today: s.today, projects: projects });
      addTask_(t, 'Gmail');
      thread.removeLabel(flag).addLabel(done);   // only after the row is saved, so a failure can't lose it
      added++;
    } catch (e) {
      ccLog_('Flagged email', 'FAILED on "' + thread.getFirstMessageSubject() + '": ' + e.message + ' (left labeled; will retry)');
    }
  });
  if (threads.length) ccLog_('Flagged email', added + ' of ' + threads.length + ' added');
  if (added) refreshViews();
}

// ---- views + digest --------------------------------------------------------------

function refreshViews() {
  const s = ccSettings_();
  const v = CommandCore.buildViews(CommandCore.readTasks(ccTable_(CC.tasks)), s.today);
  const ss = ccSS_();
  const sheet = ss.getSheetByName(CC.views) || ss.insertSheet(CC.views, 0);
  sheet.clear();
  sheet.getRange(1, 1).setValue(s.title + ' · ' + ReportCore.formatDate(v.today) + ' · ' + v.openCount + ' open · ' +
    v.overdue.length + ' overdue · ' + v.dueToday.length + ' due today · ' + v.needsReview.length + ' to review').setFontWeight('bold').setFontSize(12);
  let row = 3;
  [['OVERDUE', v.overdue, '#fdecea'], ['DUE TODAY', v.dueToday, '#e7f6ec'], ['NEEDS REVIEW', v.needsReview, '#fff4e5'],
   ['NEXT 7 DAYS', v.next7, '#eef2f6'], ['P1 (TOP PRIORITY)', v.p1, '#eef2f6'], ['WAITING ON OTHERS', v.waiting, '#eef2f6'],
   ['NO DUE DATE', v.noDate, '#f5f7f9']].forEach(function (sec) {
    sheet.getRange(row, 1, 1, 6).setValues([[sec[0] + ' (' + sec[1].length + ')', 'Project', 'Due', 'Priority', 'Status / waiting on', 'ID']])
      .setFontWeight('bold').setBackground(sec[2]);
    row++;
    const rows = sec[1].map(function (t) {
      return [t.link ? '=HYPERLINK("' + t.link.replace(/"/g, '') + '","' + t.title.replace(/"/g, "'") + '")' : t.title,
        t.project, t.due ? CommandCore.dueLabel(t, v.today) : '', t.priority, t.waitingOn ? 'Waiting on ' + t.waitingOn : (t.reasons || t.status), t.id];
    });
    if (rows.length) { sheet.getRange(row, 1, rows.length, 6).setValues(rows); row += rows.length; }
    else { sheet.getRange(row, 1).setValue('Nothing here.').setFontColor('#5b6675'); row++; }
    row++;
  });
  sheet.setColumnWidth(1, 360); sheet.setColumnWidths(2, 5, 130);
  return v;
}

function sendDigest() {
  const s = ccSettings_();
  const v = refreshViews();
  MailApp.sendEmail({ to: s.digestTo, subject: s.title + ': ' + v.overdue.length + ' overdue, ' + v.dueToday.length + ' due today',
    htmlBody: CommandCore.renderDigest(v, { title: s.title }) });
  ccLog_('Digest', 'sent to ' + s.digestTo);
}

// ---- triggers ----------------------------------------------------------------------

function installTriggers() {
  removeTriggers_();
  ccSS_();   // remembers this spreadsheet for the phone page and triggers
  ScriptApp.newTrigger('sendDigest').timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger('processFlaggedEmails').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('refreshViews').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('On: digest email at 7am daily, flagged emails checked every 15 minutes, views refreshed hourly.');
}

function removeTriggers() {
  removeTriggers_();
  SpreadsheetApp.getUi().alert('All Command Center automations are off.');
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return ['sendDigest', 'processFlaggedEmails', 'refreshViews'].indexOf(t.getHandlerFunction()) >= 0; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
