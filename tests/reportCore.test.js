/* Tests for ReportCore. Run by opening tests/test.html through the local server. */
var T = window.TestKit;
var R = ReportCore;

T.test('toCents parses common money formats', function () {
  T.eq(R.toCents('$1,234.56'), 123456);
  T.eq(R.toCents('19.9'), 1990);
  T.eq(R.toCents(19.99), 1999);
  T.eq(R.toCents('(50.00)'), -5000);
  T.eq(R.toCents('-$5'), -500);
  T.eq(R.toCents('.5'), 50);
  T.eq(R.toCents(''), 0);
  T.eq(R.toCents(null), 0);
});

T.test('toCents rejects unreadable amounts instead of guessing', function () {
  T.ok(isNaN(R.toCents('abc')));
  T.ok(isNaN(R.toCents('1.234')));
  T.ok(isNaN(R.toCents('12-34')));
  T.ok(isNaN(R.toCents(Infinity)));
});

T.test('parseDate handles ISO, US format, Date objects, and rejects bad dates', function () {
  T.eq(R.parseDate('2026-10-13').getTime(), new Date(2026, 9, 13).getTime());
  T.eq(R.parseDate('10/13/2026').getTime(), new Date(2026, 9, 13).getTime());
  T.eq(R.parseDate('10/13/26').getTime(), new Date(2026, 9, 13).getTime());
  T.eq(R.parseDate(new Date(2026, 9, 13, 15, 45)).getTime(), new Date(2026, 9, 13).getTime());
  T.eq(R.parseDate('2026-02-30'), null);
  T.eq(R.parseDate('next tuesday'), null);
  T.eq(R.parseDate(''), null);
});

T.test('weekStart returns the Monday of the week', function () {
  T.eq(R.weekStart(new Date(2026, 9, 18)).getTime(), new Date(2026, 9, 12).getTime()); // Sunday
  T.eq(R.weekStart(new Date(2026, 9, 12)).getTime(), new Date(2026, 9, 12).getTime()); // Monday
  T.eq(R.weekStart('2026-10-14').getTime(), new Date(2026, 9, 12).getTime());
});

T.test('parseCsv handles quotes, commas inside quotes, and CRLF', function () {
  var rows = R.parseCsv('a,b\r\n"Smith, J.","say ""hi"""\r\n3,\n');
  T.eq(rows.length, 3);
  T.eq(rows[1][0], 'Smith, J.');
  T.eq(rows[1][1], 'say "hi"');
  T.eq(rows[2][1], '');
});

T.test('rowsFromTable maps headers and skips blank rows', function () {
  var rows = R.rowsFromTable([[' Name ', 'Amount'], ['A', 5], ['', ''], ['B', '']]);
  T.eq(rows.length, 2);
  T.eq(rows[0].Name, 'A');
  T.eq(rows[1].Amount, '');
});

function job(o) {
  return Object.assign({ 'Job ID': '1', 'Customer': 'Test C.', 'Job Type': 'Service Call', 'Tech': 'Ann',
    'Status': 'Completed', 'Completed Date': '2026-10-13', 'Amount': '100.00' }, o);
}
var WEEK = { weekStart: new Date(2026, 9, 12) };

T.test('revenue only counts completed jobs inside the week', function () {
  var r = R.buildReport([
    job({ Amount: '100.00' }),
    job({ Amount: '50.50', 'Completed Date': '2026-10-18' }),          // Sunday: in week
    job({ Amount: '999.00', 'Completed Date': '2026-10-19' }),         // next Monday: out
    job({ Amount: '999.00', Status: 'Cancelled' }),                    // cancelled: out
    job({ Amount: '200.00', 'Completed Date': '2026-10-06' })          // prior week
  ], [], WEEK);
  T.eq(r.completed.count, 2);
  T.eq(r.completed.revenueCents, 15050);
  T.eq(r.completed.avgTicketCents, 7525);
  T.eq(r.completed.prevRevenueCents, 20000);
  T.eq(r.completed.revenueChangePct, -24.8);
});

T.test('money sums have no floating-point drift', function () {
  var r = R.buildReport([job({ Amount: '0.10' }), job({ Amount: '0.20' }), job({ Amount: '0.70' })], [], WEEK);
  T.eq(r.completed.revenueCents, 100);
  T.eq(R.formatMoney(r.completed.revenueCents, true), '$1.00');
});

T.test('bad amounts are flagged as warnings and counted as $0', function () {
  var r = R.buildReport([job({ Amount: 'TBD' }), job({ Amount: '40' })], [], WEEK);
  T.eq(r.completed.revenueCents, 4000);
  T.eq(r.warnings.length, 1);
  T.ok(r.warnings[0].indexOf('TBD') >= 0);
});

T.test('completed jobs with no date are flagged, not silently dropped', function () {
  var r = R.buildReport([job({ 'Completed Date': '' })], [], WEEK);
  T.eq(r.completed.count, 0);
  T.eq(r.warnings.length, 1);
});

T.test('no prior-week revenue gives null change, not Infinity', function () {
  var r = R.buildReport([job({})], [], WEEK);
  T.eq(r.completed.revenueChangePct, null);
});

T.test('systems, callbacks, filter changes and techs', function () {
  var r = R.buildReport([
    job({ 'Job Type': 'Install', 'Systems Installed': '2', 'System Type': 'Softener', Amount: '5000', Tech: 'Bo' }),
    job({ 'Job Type': 'Install', 'Systems Installed': '1', 'System Type': 'UV System', Amount: '1200', Tech: 'Ann' }),
    job({ 'Job Type': 'Callback', Callback: 'Yes', 'Callback Cause': 'Loose fitting', Amount: '0', Tech: 'Ann', 'Original Tech': 'Bo' }),
    job({ 'Job Type': 'Filter Change', Amount: '120', 'Booked Date': '2026-10-14' }),
    job({ 'Job Type': 'Filter Change', Status: 'Scheduled', 'Completed Date': '', 'Scheduled Date': '2026-10-25', 'Booked Date': '2026-10-15' }),
    job({ 'Job Type': 'Filter Change', Status: 'Scheduled', 'Completed Date': '', 'Scheduled Date': '2026-12-25' })
  ], [], WEEK);
  T.eq(r.systems.total, 3);
  T.eq(r.systems.byType[0].name, 'Softener');
  T.eq(r.callbacks.count, 1);
  T.eq(r.callbacks.rows[0].tech, 'Bo');               // blamed on the original tech
  T.eq(r.callbacks.byCause[0].name, 'Loose fitting');
  T.eq(r.filterChanges.completed, 1);
  T.eq(r.filterChanges.bookedThisWeek, 2);
  T.eq(r.filterChanges.scheduledNext30, 1);           // Dec 25 is outside 30 days
  var bo = r.techs.filter(function (t) { return t.name === 'Bo'; })[0];
  T.eq(bo.cents, 500000);
  T.eq(bo.callbacks, 1);
  T.eq(r.techs[0].name, 'Bo');                        // sorted by revenue
});

T.test('quotes: close rate, open pipeline and stale quotes', function () {
  var r = R.buildReport([], [
    { 'Quote ID': 'Q1', Status: 'Approved', Amount: '3000', 'Sent Date': '2026-10-01', 'Decided Date': '2026-10-13' },
    { 'Quote ID': 'Q2', Status: 'Declined', Amount: '2000', 'Sent Date': '2026-10-02', 'Decided Date': '2026-10-14' },
    { 'Quote ID': 'Q3', Status: 'Declined', Amount: '2000', 'Sent Date': '2026-10-02', 'Decided Date': '2026-10-15' },
    { 'Quote ID': 'Q4', Status: 'Open', Amount: '4000', 'Sent Date': '2026-09-20' },
    { 'Quote ID': 'Q5', Status: 'Open', Amount: '1000', 'Sent Date': '2026-10-16' },
    { 'Quote ID': 'Q6', Status: 'Open', Amount: '9999', 'Sent Date': '2026-10-20' }  // sent after the week
  ], WEEK);
  T.eq(r.quotes.sent, 1);
  T.eq(r.quotes.approved, 1);
  T.eq(r.quotes.declined, 2);
  T.eq(r.quotes.closeRatePct, 33);
  T.eq(r.quotes.approvedCents, 300000);
  T.eq(r.quotes.openCount, 2);
  T.eq(r.quotes.openCents, 500000);
  T.eq(r.quotes.staleCount, 1);
});

T.test('formatMoney rounds and groups', function () {
  T.eq(R.formatMoney(123456), '$1,235');
  T.eq(R.formatMoney(123456, true), '$1,234.56');
  T.eq(R.formatMoney(-5000), '-$50');
  T.eq(R.formatMoney(5, true), '$0.05');
});

T.test('renderHtml escapes data so names cannot inject HTML', function () {
  var r = R.buildReport([job({ 'Job Type': 'Callback', Callback: 'Y', Customer: '<script>alert(1)</script>' })], [], WEEK);
  var html = R.renderHtml(r, { companyName: 'A & B <Co>' });
  T.ok(html.indexOf('<script>') < 0);
  T.ok(html.indexOf('&lt;script&gt;') >= 0);
  T.ok(html.indexOf('A &amp; B &lt;Co&gt;') >= 0);
});
