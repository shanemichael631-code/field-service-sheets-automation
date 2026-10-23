/* Tests for QuoteCore. Run by opening tests/test.html through the local server. */
(function () {
  var T = window.TestKit;
  var Q = QuoteCore;

  var RULES = [
    { Category: 'Chemicals', Method: 'markup', 'Value %': '45', 'Min Margin %': '25' },
    { Category: 'Parts', Method: 'margin', 'Value %': '40%', 'Min Margin %': 30 },
    { Category: 'Services', Method: 'markup', 'Value %': '0', 'Min Margin %': '' }
  ];
  function cat(o) {
    return Object.assign({ SKU: 'X', Name: 'Thing', Category: 'Chemicals', Manufacturer: 'Acme', 'Part #': '', Unit: 'each',
      Cost: '10.00', 'Price Override': '', Active: '', Taxable: '' }, o);
  }
  var CATALOG = [
    cat({ SKU: 'CHL-1', Name: 'Liquid Chlorine 1 gal', Cost: '3.00' }),                                   // 4.35
    cat({ SKU: 'O-RING', Name: 'Pump Lid O-Ring', Category: 'Parts', 'Part #': 'SPX3200Z1', Cost: '6.00' }), // 10.00
    cat({ SKU: 'SVC-WK', Name: 'Weekly Service', Category: 'Services', Cost: '', 'Price Override': '45.00', Taxable: 'No' }),
    cat({ SKU: 'OLD', Name: 'Discontinued Thing', Active: 'No' })
  ];
  var SETTINGS = { laborRateCents: 9500, taxPct: 7, taxLabor: false, validDays: 30 };
  function priced() { return Q.priceCatalog(CATALOG, RULES); }
  function quote(input) {
    return Q.buildQuote(Object.assign({ customer: { name: 'Pat Doe' }, date: '2026-10-23' }, input), priced().items, SETTINGS);
  }

  T.test('toPct reads percents from text, numbers and %-formatted cells', function () {
    T.eq(Q.toPct('45'), 45);
    T.eq(Q.toPct('45%'), 45);
    T.eq(Q.toPct(0.45), 45);
    T.eq(Q.toPct(45), 45);
    T.eq(Q.toPct(''), null);
    T.ok(isNaN(Q.toPct('lots')));
  });

  T.test('markup vs margin pricing in cents', function () {
    T.eq(Q.priceFromRule(1000, { method: 'markup', value: 45 }), 1450);
    T.eq(Q.priceFromRule(1000, { method: 'margin', value: 25 }), 1333);   // 10 / 0.75 = 13.333
    T.eq(Q.priceFromRule(600, { method: 'margin', value: 40 }), 1000);
    T.eq(Q.marginPct(1000, 600), 40);
    T.eq(Q.marginPct(0, 600), null);
  });

  T.test('catalog pricing: rules, overrides, inactive, taxable, case-insensitive categories', function () {
    var items = Q.priceCatalog(CATALOG.concat([cat({ SKU: 'LOW', Name: 'lower case cat', Category: 'chemicals', Cost: '2.00' })]), RULES).items;
    T.eq(items[0].priceCents, 435);
    T.eq(items[0].priceSource, 'rule');
    T.eq(items[1].priceCents, 1000);
    T.eq(items[2].priceCents, 4500);
    T.eq(items[2].priceSource, 'override');
    T.eq(items[2].taxable, false);
    T.eq(items[3].active, false);
    T.eq(items[4].priceCents, 290);
  });

  T.test('items with no cost and no override get no price (never a guessed one)', function () {
    var p = Q.priceCatalog([cat({ Cost: '' })], RULES);
    T.eq(p.items[0].priceCents, null);
    T.eq(p.items[0].priceSource, 'none');
  });

  T.test('bad rule rows and bad numbers are reported', function () {
    var p = Q.priceCatalog([cat({ Cost: 'call' })], [
      { Category: 'A', Method: 'guess', 'Value %': '10' },
      { Category: 'B', Method: 'margin', 'Value %': '100' },
      { Category: 'C', Method: 'markup', 'Value %': 'ten' }
    ]);
    T.eq(p.warnings.length, 4);
  });

  T.test('catalog health finds duplicates, missing data and low margins', function () {
    var p = Q.priceCatalog([
      cat({ SKU: 'P1', Name: 'Impeller', Category: 'Parts', 'Part #': 'SPX-1', Cost: '20' }),
      cat({ SKU: 'P2', Name: 'Impeller (old name)', Category: 'Parts', Manufacturer: 'ACME', 'Part #': 'spx-1', Cost: '20' }),
      cat({ SKU: 'P1', Name: 'Gauge', Category: 'Parts', 'Part #': 'G-9', Cost: '5' }),
      cat({ SKU: 'P3', Name: 'Mystery part', Category: 'Parts', Cost: '' }),
      cat({ SKU: 'P4', Name: 'Cheap acid', Cost: '10', 'Price Override': '11.00' }),
      cat({ SKU: 'P5', Name: 'Widget', Category: 'Gizmos', Cost: '5' }),
      cat({ SKU: 'P6', Name: 'Inactive dupe', 'Part #': 'SPX-1', Category: 'Parts', Active: 'no' })
    ], RULES);
    var h = Q.catalogHealth(p);
    T.eq(h.counts['Possible duplicate'], 2);      // P1 + P2 by manufacturer/part #, inactive ignored
    T.eq(h.counts['Duplicate SKU'], 2);
    T.eq(h.counts['Missing cost'], 1);
    T.eq(h.counts['Below minimum margin'], 1);    // 11 on 10 = 9.1% < 25%
    T.eq(h.counts['No pricing rule'], 1);
    T.eq(h.counts['Missing part number'], 1);     // P3
  });

  T.test('search matches name, SKU, part # and ignores inactive or unpriced items', function () {
    var items = priced().items;
    T.eq(Q.search(items, 'chlorine')[0].sku, 'CHL-1');
    T.eq(Q.search(items, 'spx3200z1')[0].sku, 'O-RING');
    T.eq(Q.search(items, 'pump ring').length, 1);
    T.eq(Q.search(items, 'discontinued').length, 0);
    T.eq(Q.search(items, '   ').length, 0);
  });

  T.test('quote math: quantities, discounts, labor, tax only on taxable items', function () {
    var q = quote({
      lines: [
        { sku: 'CHL-1', qty: 2.5 },                    // 4.35 * 2.5 = 10.875 -> 1088
        { sku: 'O-RING', qty: 2, discountPct: 10 },    // 20.00 - 2.00 = 18.00
        { sku: 'SVC-WK', qty: 1 }                      // 45.00, not taxable
      ],
      laborHours: 1.5                                  // 1.5 * 95 = 142.50, not taxed
    });
    T.eq(q.errors.length, 0);
    T.eq(q.lines[0].netCents, 1088);
    T.eq(q.lines[1].discountCents, 200);
    T.eq(q.totals.materialsCents, 1088 + 1800 + 4500);
    T.eq(q.totals.laborCents, 14250);
    T.eq(q.totals.taxCents, Math.round((1088 + 1800) * 0.07));   // 202
    T.eq(q.totals.subtotalCents, 7388 + 14250);
    T.eq(q.totals.totalCents, 7388 + 14250 + 202);
    T.eq(q.totals.costCents, 750 + 1200);
    T.eq(ReportCore.formatDate(q.validUntil), 'Nov 22');
  });

  T.test('labor is taxed only when the setting says so', function () {
    var q = Q.buildQuote({ customer: { name: 'A' }, laborHours: 1, date: '2026-10-23' }, priced().items,
      { laborRateCents: 10000, taxPct: 7, taxLabor: true });
    T.eq(q.totals.taxCents, 700);
  });

  T.test('quote refuses bad input instead of guessing', function () {
    var q = quote({ customer: { name: '' }, lines: [{ sku: 'NOPE', qty: 1 }, { sku: 'CHL-1', qty: 0 }, { sku: 'OLD', qty: 1 }, { sku: 'O-RING', qty: 1, discountPct: 150 }] });
    T.eq(q.errors.length, 6);   // unknown SKU, qty 0, inactive, bad discount, nothing left to quote, no customer
    T.eq(q.lines.length, 0);
  });

  T.test('a discount that drops below minimum margin is warned', function () {
    var q = quote({ lines: [{ sku: 'O-RING', qty: 1, discountPct: 20 }] });   // 8.00 on 6.00 cost = 25% < 30%
    T.eq(q.errors.length, 0);
    T.eq(q.warnings.length, 1);
    T.ok(q.warnings[0].indexOf('25%') >= 0);
  });

  T.test('quote numbers count up per year and ignore junk', function () {
    T.eq(Q.nextQuoteNumber(['Q-2026-0007', 'Q-2026-0003', 'Q-2025-0099', 'junk', ''], 'Q', '2026-10-23'), 'Q-2026-0008');
    T.eq(Q.nextQuoteNumber([], 'Q', '2027-01-02'), 'Q-2027-0001');
  });

  T.test('revisions count up from the base quote, whichever revision is reopened', function () {
    var log = ['Q-2026-0004', 'Q-2026-0004-R1', 'Q-2026-0004-R2', 'Q-2026-0040-R9'];
    T.eq(Q.revisionNumber(log, 'Q-2026-0004'), 'Q-2026-0004-R3');
    T.eq(Q.revisionNumber(log, 'Q-2026-0004-R1'), 'Q-2026-0004-R3');
    T.eq(Q.revisionNumber(['Q-2026-0005'], 'Q-2026-0005'), 'Q-2026-0005-R1');
  });

  T.test('customer PDF never shows cost or margin, and escapes text', function () {
    var q = quote({ customer: { name: '<b>Pat</b> & Co' }, lines: [{ sku: 'O-RING', qty: 1, note: '<script>x</script>' }], notes: 'Thanks!' });
    var html = Q.renderQuoteHtml(q, { name: 'Bluewave (demo)', color: 'red;background:url(x)' });
    T.ok(html.indexOf('<script>') < 0);
    T.ok(html.indexOf('&lt;b&gt;Pat&lt;/b&gt; &amp; Co') >= 0);
    var visible = html.replace(/<[^>]+>/g, ' ');   // text the customer sees (CSS like "margin-top" excluded)
    T.ok(visible.indexOf('$6.00') < 0);            // cost
    T.ok(!/margin|cost|profit/i.test(visible));
    T.ok(html.indexOf('url(x)') < 0);              // bad brand color ignored
    T.ok(html.indexOf('$10.00') >= 0);
  });
})();
