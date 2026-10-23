/* Tests for ReminderCore. Run by opening tests/test.html through the local server. */
(function () {
  var T = window.TestKit;
  var M = ReminderCore;
  var TODAY = new Date(2026, 9, 19);
  var INTERVALS = [
    { Equipment: 'Softener', Service: 'Annual service', 'Every (months)': '12', Price: '149.00' },
    { Equipment: 'Reverse Osmosis', Service: 'Filter change', 'Every (months)': 12, Price: '$129' }
  ];
  function item(o) {
    return Object.assign({ Customer: 'Maria Lopez', Email: 'maria@example.com', Phone: '(555) 555-0101',
      Equipment: 'Softener', Service: 'Annual service', Installed: '2024-01-01', 'Last Done': '2025-10-20' }, o);
  }
  function build(items, opts) {
    return M.buildDueList(items, INTERVALS, Object.assign({ today: TODAY }, opts));
  }

  T.test('addMonths clamps to the end of short months', function () {
    T.eq(M.addMonths(new Date(2026, 0, 31), 1).getTime(), new Date(2026, 1, 28).getTime());
    T.eq(M.addMonths(new Date(2026, 7, 31), 6).getTime(), new Date(2027, 1, 28).getTime());
    T.eq(M.addMonths(new Date(2027, 11, 15), 12).getTime(), new Date(2028, 11, 15).getTime());
  });

  T.test('daysBetween counts calendar days across daylight saving', function () {
    T.eq(M.daysBetween(new Date(2026, 10, 1), new Date(2026, 10, 2)), 1);   // DST ends Nov 1, 2026
    T.eq(M.daysBetween(new Date(2026, 9, 19), new Date(2026, 9, 12)), -7);
  });

  T.test('firstName falls back to "there" for initials or blanks', function () {
    T.eq(M.firstName('Maria Lopez'), 'Maria');
    T.eq(M.firstName('J. Smith'), 'there');
    T.eq(M.firstName(''), 'there');
  });

  T.test('due date = last done + interval; status buckets; outside window excluded', function () {
    var r = build([
      item({ 'Last Done': '2025-10-20' }),                         // due Oct 20, 2026 -> due soon (+1)
      item({ 'Last Done': '2025-09-01', Customer: 'Old Due' }),     // due Sep 1 -> overdue
      item({ 'Last Done': '2026-01-15', Customer: 'Later' })        // due Jan 2027 -> outside 30 days
    ]);
    T.eq(r.rows.length, 2);
    T.eq(r.rows[0].customer, 'Old Due');                            // sorted by due date
    T.eq(r.rows[0].status, 'Overdue');
    T.eq(r.rows[0].daysUntil, -48);
    T.eq(r.rows[1].status, 'Due soon');
    T.eq(r.rows[1].daysUntil, 1);
  });

  T.test('uses Installed when Last Done is blank, and override interval when set', function () {
    var r = build([
      item({ 'Last Done': '', Installed: '2025-10-01' }),
      item({ Customer: 'Six Month', 'Last Done': '2026-04-25', 'Every (months)': '6' })
    ]);
    T.eq(r.rows.length, 2);
    T.eq(ReportCore.formatDate(r.rows[0].due), 'Oct 1');
    T.eq(ReportCore.formatDate(r.rows[1].due), 'Oct 25');
  });

  T.test('rows without an interval or a date are warned about, not guessed', function () {
    var r = build([
      item({ Equipment: 'Mystery Box' }),
      item({ 'Last Done': '', Installed: '' })
    ]);
    T.eq(r.rows.length, 0);
    T.eq(r.warnings.length, 2);
  });

  T.test('who can be emailed: DNC, no email, bad email, recently reminded', function () {
    var r = build([
      item({ Customer: 'A Ready' }),
      item({ Customer: 'B Dnc', 'Do Not Contact': 'Yes' }),
      item({ Customer: 'C NoEmail', Email: '' }),
      item({ Customer: 'D BadEmail', Email: 'd.example.com' }),
      item({ Customer: 'E Recent', 'Last Reminded': '2026-10-09' }),   // 10 days ago, rule is 21
      item({ Customer: 'F Old', 'Last Reminded': '2026-09-01' })       // 48 days ago -> OK again
    ]);
    var by = {};
    r.rows.forEach(function (x) { by[x.customer] = x; });
    T.ok(by['A Ready'].canEmail);
    T.eq(by['B Dnc'].skipReason, 'Do not contact');
    T.eq(by['C NoEmail'].skipReason, 'No email');
    T.eq(by['D BadEmail'].skipReason, 'Email looks wrong');
    T.eq(by['E Recent'].skipReason, 'Reminded Oct 9');
    T.ok(by['F Old'].canEmail);
    T.eq(r.toEmail.length, 2);
  });

  T.test('estimated value sums prices in cents per bucket', function () {
    var r = build([
      item({}),
      item({ Equipment: 'Reverse Osmosis', Service: 'Filter change' }),
      item({ 'Last Done': '2025-08-01' })
    ]);
    T.eq(r.dueSoon.count, 2);
    T.eq(r.dueSoon.valueCents, 14900 + 12900);
    T.eq(r.overdue.valueCents, 14900);
  });

  T.test('bad interval rows and prices are flagged', function () {
    var r = M.buildDueList([item({})], [
      { Equipment: 'Softener', Service: 'Annual service', 'Every (months)': 'twelve', Price: '149' },
      { Equipment: 'UV', Service: 'Bulb', 'Every (months)': '12', Price: 'call us' }
    ], { today: TODAY });
    T.eq(r.warnings.length, 3);   // bad months, bad price, and the item now has no interval
    T.eq(r.rows.length, 0);
  });

  T.test('email template fills placeholders and always adds opt-out + address', function () {
    var row = build([item({})]).rows[0];
    var settings = { companyName: 'Clearwell (demo)', companyPhone: '(555) 555-0100',
      companyAddress: '100 Example Way', bookingLink: 'https://example.com/book',
      subject: '{first_name}, your {service} is due', body: 'Due {due_date}. Call {phone}. {unknown}' };
    var e = M.buildEmail(row, settings);
    T.eq(e.to, 'maria@example.com');
    T.eq(e.subject, 'Maria, your Annual service is due');
    T.ok(e.body.indexOf('Due October 20. Call (555) 555-0100. {unknown}') === 0);
    T.ok(e.body.indexOf('100 Example Way') > 0);
    T.ok(e.body.indexOf('no reminders') > 0);
  });

  T.test('due_phrase says "was due" for overdue and "is due" for upcoming', function () {
    var rows = build([item({}), item({ Customer: 'Late Larry', 'Last Done': '2025-09-01' })]).rows;
    var s = { companyName: 'X', subject: '', body: '{due_phrase}' };
    T.eq(M.fillTemplate(s.body, rows[0], s), 'it was due around September 1');
    T.eq(M.fillTemplate(s.body, rows[1], s), "it's due around October 20");
  });
})();
