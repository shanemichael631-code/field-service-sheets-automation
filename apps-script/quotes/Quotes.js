/**
 * Apps Script entry points for the Quote Builder: menu, sidebar, PDF creation, quote log,
 * price list and catalog health. All math lives in QuoteCore.js (which uses ReportCore.js).
 *
 * Sheets: "Catalog", "Pricing Rules", "Settings" (Setting | Value), "Quotes Log".
 * The script writes "Price List", "Catalog Health" and rows in "Quotes Log".
 */
const QSHEETS = { catalog: 'Catalog', rules: 'Pricing Rules', settings: 'Settings', log: 'Quotes Log',
  prices: 'Price List', health: 'Catalog Health' };
const LOG_HEADER = ['Quote #', 'Date', 'Customer', 'Total', 'Margin %', 'PDF', 'Status', 'Data'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Quotes')
    .addItem('Open quote builder', 'openQuoteBuilder')
    .addSeparator()
    .addItem('Refresh price list + catalog health', 'refreshPriceList')
    .addToUi();
}

function qSheet_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('Missing a sheet named "' + name + '".');
  return sheet;
}

function qTable_(name) {
  return ReportCore.rowsFromTable(qSheet_(name).getDataRange().getValues());
}

function qSettings_() {
  const s = {};
  qTable_(QSHEETS.settings).forEach(function (r) { s[String(r['Setting']).trim()] = r['Value']; });
  const text = function (k, d) { return String(s[k] === undefined || s[k] === '' ? d : s[k]).trim(); };
  return {
    company: { name: text('Company Name', 'Your Company'), address: text('Company Address', ''), phone: text('Company Phone', ''),
      email: text('Company Email', ''), color: text('Brand Color', '#0b6e99'), terms: text('Terms', '') },
    laborRateCents: ReportCore.toCents(s['Labor Rate']) || 0,
    taxPct: QuoteCore.toPct(s['Tax Rate %']) || 0,
    taxLabor: /^(y|yes|true|1)$/i.test(text('Tax Labor', 'No')),
    validDays: Number(s['Quote Valid Days']) || 30,
    prefix: text('Quote Prefix', 'Q'),
    folder: text('Quotes Folder', 'Quotes')
  };
}

function qPriced_() {
  return QuoteCore.priceCatalog(qTable_(QSHEETS.catalog), qTable_(QSHEETS.rules));
}

function openQuoteBuilder() {
  const html = typeof QUOTE_SIDEBAR_HTML !== 'undefined'
    ? HtmlService.createHtmlOutput(QUOTE_SIDEBAR_HTML)          // single-file (pasted) setup
    : HtmlService.createHtmlOutputFromFile('QuoteSidebar');     // multi-file setup
  SpreadsheetApp.getUi().showSidebar(html.setTitle('Quote Builder'));
}

// ---- called from the sidebar --------------------------------------------------

function getSidebarData() {
  return { laborRate: qSettings_().laborRateCents / 100 };
}

function searchCatalog(query) {
  return QuoteCore.search(qPriced_().items, query, 12).map(function (it) {
    return { sku: it.sku, name: it.name, manufacturer: it.manufacturer, partNumber: it.partNumber, unit: it.unit, priceCents: it.priceCents };
  });
}

function previewQuote(input) {
  const q = QuoteCore.buildQuote(input, qPriced_().items, qSettings_());
  return { totals: q.totals, errors: q.errors, warnings: q.warnings };
}

function createQuote(input) {
  const lock = LockService.getDocumentLock();   // two people creating quotes at once can't get the same number
  lock.waitLock(20000);
  try {
    const settings = qSettings_();
    const log = qSheet_(QSHEETS.log);
    if (log.getLastRow() === 0) log.appendRow(LOG_HEADER);
    const numbers = log.getLastRow() > 1 ? log.getRange(2, 1, log.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
    const q = QuoteCore.buildQuote(input, qPriced_().items, settings);
    if (q.errors.length) return { errors: q.errors };
    q.number = input.reviseOf ? QuoteCore.revisionNumber(numbers, input.reviseOf) : QuoteCore.nextQuoteNumber(numbers, settings.prefix, q.date);

    const html = QuoteCore.renderQuoteHtml(q, settings.company);
    const name = q.number + ' - ' + q.customer.name.replace(/[\\/:*?"<>|]/g, '');
    const pdf = Utilities.newBlob('<html><body style="margin:24px;">' + html + '</body></html>', 'text/html', name + '.html')
      .getAs('application/pdf').setName(name + '.pdf');
    const folder = qFolder_(settings.folder, q.customer.name);
    const file = folder.createFile(pdf);

    // Save what's needed to reopen and revise the quote (with item names for the sidebar).
    const data = {
      number: q.number, customer: q.customer, laborHours: q.labor.hours, laborRateCents: q.labor.rateCents, notes: q.notes,
      lines: q.lines.map(function (l) { return { sku: l.sku, name: l.name, qty: l.qty, discountPct: l.discountPct, unit: l.unit }; })
    };
    log.appendRow([q.number, q.date, q.customer.name, q.totals.totalCents / 100, q.totals.marginPct, file.getUrl(),
      input.reviseOf ? 'Revision of ' + input.reviseOf : 'Created', JSON.stringify(data)]);
    log.getRange(log.getLastRow(), 4).setNumberFormat('$#,##0.00');
    return { number: q.number, totalCents: q.totals.totalCents, url: file.getUrl(), folder: settings.folder + ' › ' + q.customer.name, errors: [] };
  } finally {
    lock.releaseLock();
  }
}

function loadQuote(number) {
  const rows = qTable_(QSHEETS.log);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i]['Quote #']).trim().toLowerCase() === String(number).trim().toLowerCase()) {
      return JSON.parse(rows[i]['Data']);
    }
  }
  return null;
}

function qFolder_(rootName, customer) {
  const root = qChildFolder_(DriveApp.getRootFolder(), rootName);
  return qChildFolder_(root, customer.replace(/[\\/:*?"<>|]/g, '').trim() || 'No name');
}

function qChildFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// ---- menu: price list + health ------------------------------------------------

function refreshPriceList() {
  const priced = qPriced_();
  const ss = SpreadsheetApp.getActive();

  const prices = ss.getSheetByName(QSHEETS.prices) || ss.insertSheet(QSHEETS.prices);
  prices.clear();
  const pHeader = ['SKU', 'Name', 'Category', 'Manufacturer', 'Part #', 'Unit', 'Cost', 'Price', 'Margin %', 'Priced by', 'Active'];
  const pRows = priced.items.map(function (it) {
    return [it.sku, it.name, it.category, it.manufacturer, it.partNumber, it.unit, it.hasCost ? it.costCents / 100 : '',
      it.priceCents === null ? '' : it.priceCents / 100, it.marginPct === null ? '' : it.marginPct,
      it.priceSource === 'none' ? 'NO PRICE' : it.priceSource, it.active ? 'Yes' : 'No'];
  });
  prices.getRange(1, 1, 1, pHeader.length).setValues([pHeader]).setFontWeight('bold').setBackground('#eef2f6');
  if (pRows.length) {
    prices.getRange(2, 1, pRows.length, pHeader.length).setValues(pRows);
    prices.getRange(2, 7, pRows.length, 2).setNumberFormat('$#,##0.00');
  }
  prices.setFrozenRows(1);
  prices.autoResizeColumns(1, pHeader.length);

  const h = QuoteCore.catalogHealth(priced);
  const health = ss.getSheetByName(QSHEETS.health) || ss.insertSheet(QSHEETS.health);
  health.clear();
  const summary = h.issues.length
    ? h.issues.length + ' issue(s): ' + Object.keys(h.counts).map(function (k) { return h.counts[k] + ' ' + k.toLowerCase(); }).join(', ')
    : 'No problems found. The catalog is clean.';
  health.getRange(1, 1).setValue('Checked ' + ReportCore.formatDate(new Date()) + '. ' + summary).setFontWeight('bold');
  const hHeader = ['Problem', 'Catalog row', 'SKU', 'Name', 'Details'];
  health.getRange(3, 1, 1, hHeader.length).setValues([hHeader]).setFontWeight('bold').setBackground('#eef2f6');
  const hRows = h.issues.map(function (x) { return [x.type, x.row, x.sku, x.name, x.detail]; })
    .concat(priced.warnings.map(function (w) { return ['Data error', '', '', '', w]; }));
  if (hRows.length) health.getRange(4, 1, hRows.length, hHeader.length).setValues(hRows);
  health.setFrozenRows(3);
  // Size columns from the table, not the long summary line in A1.
  health.autoResizeColumns(2, hHeader.length - 1);
  health.setColumnWidth(1, 180);
}
