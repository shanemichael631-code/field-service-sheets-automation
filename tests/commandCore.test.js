/* Tests for CommandCore. Run by opening tests/test.html through the local server. */
(function () {
  var T = window.TestKit;
  var C = CommandCore;
  var FRI = new Date(2026, 9, 23);   // Friday, Oct 23 2026
  var PROJECTS = [
    { name: 'Hiring', business: 'Clearwell Water', aliases: ['recruiting'] },
    { name: 'Truck Fleet', business: 'Clearwell Water', aliases: ['trucks', 'van'] },
    { name: 'Automotive Curation', business: 'Time to Drive', aliases: [] }
  ];
  function parse(text, extra) { return C.parseCapture(text, Object.assign({ today: FRI, projects: PROJECTS }, extra)); }
  function day(d) { return d ? ReportCore.formatDate(d) : null; }
  function due(text) { return day(parse('Hiring. Post the tech job ad ' + text).due); }

  T.test('weekday phrases (today is Friday Oct 23)', function () {
    T.eq(due('by Friday'), 'Oct 23');          // same day counts
    T.eq(due('on Monday'), 'Oct 26');
    T.eq(due('next Monday'), 'Oct 26');        // Monday of next week
    T.eq(due('next Friday'), 'Oct 30');        // Friday of next week, not today
    T.eq(due('by fri'), 'Oct 23');
    T.eq(due('by sat'), 'Oct 24');
  });

  T.test('relative and calendar dates', function () {
    T.eq(due('tomorrow'), 'Oct 24');
    T.eq(due('today'), 'Oct 23');
    T.eq(due('in 2 weeks'), 'Nov 6');
    T.eq(due('in three days'), 'Oct 26');
    T.eq(due('by end of week'), 'Oct 23');
    T.eq(due('by end of month'), 'Oct 31');
    T.eq(due('due 11/5'), 'Nov 5');
    T.eq(due('by Nov 5th'), 'Nov 5');
    T.eq(due('on December 1'), 'Dec 1');
  });

  T.test('fractions and everyday words are not dates', function () {
    T.eq(parse('Truck Fleet - order 1/2 inch and 3/4" fittings').due, null);
    T.eq(parse('Hiring. Sat down with the new tech about the schedule').due, null);
    T.eq(parse('Hiring. Check sun damage on the sign').due, null);
    T.eq(parse('Hiring - order 1/2 inch fittings').title, 'Order 1/2 inch fittings');
  });

  T.test('the example from a real job post', function () {
    var t = parse('Time to Drive. Automotive Curation. Build the complete vehicle master list by Friday.');
    T.eq(t.project, 'Automotive Curation');
    T.eq(t.business, 'Time to Drive');
    T.eq(t.title, 'Build the complete vehicle master list');
    T.eq(day(t.due), 'Oct 23');
    T.eq(t.status, 'Inbox');
    T.eq(t.reasons.length, 0);
    T.eq(t.original, 'Time to Drive. Automotive Curation. Build the complete vehicle master list by Friday.');
  });

  T.test('priority words set P1/P3 and are removed from the title', function () {
    var t = parse('Hiring - post the tech job ad by Monday, urgent');
    T.eq(t.priority, 'P1');
    T.eq(t.title, 'Post the tech job ad');
    T.eq(parse('Truck Fleet: wash the trucks someday').priority, 'P3');
    T.eq(parse('Truck Fleet: replace the van wipers').priority, 'P2');
  });

  T.test('project names inside the sentence stay in the title', function () {
    var t = parse('Need to order new tires for the van by Monday');
    T.eq(t.project, 'Truck Fleet');
    T.eq(t.title, 'Order new tires for the van');
  });

  T.test('waiting on someone', function () {
    var t = parse('Trucks - waiting on Mike Torres for the van title');
    T.eq(t.status, 'Waiting');
    T.eq(t.waitingOn, 'Mike Torres');
    T.eq(t.project, 'Truck Fleet');
  });

  T.test('unclear captures go to Needs Review with reasons, never a guess', function () {
    var short = parse('call him');
    T.eq(short.status, 'Needs Review');
    T.ok(short.reasons.some(function (r) { return /No project/.test(r); }));
    T.ok(short.reasons.some(function (r) { return /detail/.test(r); }));

    var vague = parse('Hiring. Interview the two plumber applicants next week');
    T.eq(vague.status, 'Needs Review');
    T.eq(vague.due, null);
    T.ok(/specific day/.test(vague.reasons.join(' ')));

    var two = parse('Hiring. Interview applicants Monday or Tuesday');
    T.eq(two.status, 'Needs Review');
    T.eq(two.due, null);
    T.eq(two.title, 'Interview applicants');

    var past = parse('Hiring. Renew the job posting by 10/1');
    T.eq(past.status, 'Needs Review');
    T.ok(/past/.test(past.reasons.join(' ')));

    var both = parse('Hiring budget and trucks budget review');
    T.ok(/more than one project/.test(both.reasons.join(' ')));
  });

  T.test('a project picked in the capture form wins', function () {
    var t = parse('Get three quotes on new tires', { project: 'Truck Fleet' });
    T.eq(t.project, 'Truck Fleet');
    T.eq(t.business, 'Clearwell Water');
    T.eq(t.status, 'Inbox');
  });

  T.test('flagged email becomes a task with sender and link', function () {
    var t = C.emailToTask('Re: Truck Fleet - invoice for van repair due Friday', 'Pat <pat@example.com>',
      'https://mail.google.com/mail/#inbox/abc', { today: FRI, projects: PROJECTS });
    T.eq(t.source, 'Gmail');
    T.eq(t.link, 'https://mail.google.com/mail/#inbox/abc');
    T.eq(day(t.due), 'Oct 23');
    T.eq(t.project, 'Truck Fleet');
    T.ok(t.original.indexOf('Pat <pat@example.com>') >= 0);
  });

  T.test('task IDs count up', function () {
    T.eq(C.nextId(['T-0001', 'T-0009', 'junk', '']), 'T-0010');
    T.eq(C.nextId([]), 'T-0001');
  });

  function row(o) {
    return Object.assign({ ID: 'T-1', Title: 'Task', Project: 'Hiring', Business: 'Clearwell Water', Due: '', Priority: 'P2', Status: 'Inbox' }, o);
  }
  T.test('views: overdue, today, next 7 days, waiting, review, P1; done is hidden', function () {
    var tasks = C.readTasks([
      row({ ID: 'T-1', Due: '2026-10-20' }),                               // overdue
      row({ ID: 'T-2', Due: '2026-10-23', Priority: 'P1' }),                // today, P1
      row({ ID: 'T-3', Due: '2026-10-30' }),                               // next 7 (day 7)
      row({ ID: 'T-4', Due: '2026-10-31' }),                               // outside 7
      row({ ID: 'T-5', Status: 'Waiting', 'Waiting On': 'Mike' }),
      row({ ID: 'T-6', Status: 'Needs Review', Due: '2026-10-01' }),       // review, not counted overdue
      row({ ID: 'T-7', Due: '2026-10-19', Status: 'Done' }),               // done: hidden
      row({ ID: 'T-8', Due: '2026-10-18', Project: 'Truck Fleet' }),       // overdue, sorts first
      row({ ID: 'T-9' })                                                   // no date
    ]);
    var v = C.buildViews(tasks, FRI);
    T.eq(v.overdue.map(function (t) { return t.id; }).join(), 'T-8,T-1');
    T.eq(v.dueToday.map(function (t) { return t.id; }).join(), 'T-2');
    T.eq(v.next7.map(function (t) { return t.id; }).join(), 'T-3');
    T.eq(v.p1.length, 1);
    T.eq(v.waiting.map(function (t) { return t.id; }).join(), 'T-5');
    T.eq(v.needsReview.map(function (t) { return t.id; }).join(), 'T-6');
    T.eq(v.noDate.map(function (t) { return t.id; }).join(), 'T-9');
    T.eq(v.openCount, 8);
    T.eq(v.projects[0].name, 'Hiring');   // 1 overdue, 7 open beats Truck Fleet's 1 overdue, 1 open
    T.eq(v.projects[0].overdue, 1);
  });

  T.test('digest shows what needs attention and escapes text', function () {
    var tasks = C.readTasks([
      row({ ID: 'T-1', Title: '<b>Pay</b> the van insurance', Due: '2026-10-20', Link: 'https://example.com/x' }),
      row({ ID: 'T-2', Title: 'Call Pat', Due: '2026-10-23' })
    ]);
    var html = C.renderDigest(C.buildViews(tasks, FRI), { title: 'Command Center (demo)' });
    T.ok(html.indexOf('&lt;b&gt;Pay&lt;/b&gt;') >= 0);
    T.ok(html.indexOf('<b>Pay') < 0);
    T.ok(html.indexOf('3 days late') >= 0);
    T.ok(html.indexOf('Friday, Oct 23') >= 0);
    T.ok(html.indexOf('2 open · 1 overdue · 1 due today') >= 0);
  });
})();
