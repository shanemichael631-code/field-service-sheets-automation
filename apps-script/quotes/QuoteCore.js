/**
 * QuoteCore: catalog pricing, catalog health checks, quote math and the quote's HTML/PDF layout.
 *
 * Depends on ReportCore.js (toCents, parseDate, formatMoney, escapeHtml, addDays).
 * No Apps Script or browser APIs here, so the same file runs in Google Apps Script
 * and in the browser demo/tests. Money is integer cents; percentages are plain numbers (45 = 45%).
 */
var QuoteCore = (function () {
  'use strict';

  function clean(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function norm(v) { return clean(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function isYes(v) { return /^(y|yes|true|1|x)$/i.test(clean(v)); }
  function isNo(v) { return /^(n|no|false|0)$/i.test(clean(v)); }

  /** "45", "45%", 45, 0.45 (a decimal from a % formatted cell) -> 45. Blank -> null. Junk -> NaN. */
  function toPct(value) {
    if (value === null || value === undefined || clean(value) === '') return null;
    if (typeof value === 'number') return value > 0 && value < 1 ? value * 100 : value;
    const n = Number(clean(value).replace('%', ''));
    return isFinite(n) ? n : NaN;
  }

  // ------------------------------------------------------------ pricing

  /** Selling price in cents from cost and a rule. markup: cost*(1+v%). margin: cost/(1-v%). */
  function priceFromRule(costCents, rule) {
    if (!rule) return null;
    if (rule.method === 'margin') {
      if (rule.value >= 100) return null;
      return Math.round(costCents / (1 - rule.value / 100));
    }
    return Math.round(costCents * (1 + rule.value / 100));
  }

  /** Gross margin % on a price, one decimal. Null when price is 0. */
  function marginPct(priceCents, costCents) {
    if (!priceCents) return null;
    return Math.round(((priceCents - costCents) / priceCents) * 1000) / 10;
  }

  function readRules(ruleRows, warnings) {
    const rules = {};
    (ruleRows || []).forEach(function (r, i) {
      const label = 'Pricing Rules row ' + (i + 2);
      const cat = norm(r['Category']);
      const method = clean(r['Method']).toLowerCase() || 'markup';
      const value = toPct(r['Value %']);
      const min = toPct(r['Min Margin %']);
      if (!cat) return;
      if (method !== 'markup' && method !== 'margin') {
        warnings.push(label + ': Method must be "markup" or "margin".'); return;
      }
      if (value === null || isNaN(value) || value < 0 || (method === 'margin' && value >= 100)) {
        warnings.push(label + ': "Value %" must be a number' + (method === 'margin' ? ' from 0 to 99.' : ' of 0 or more.')); return;
      }
      if (min !== null && (isNaN(min) || min < 0 || min >= 100)) {
        warnings.push(label + ': "Min Margin %" must be a number from 0 to 99.'); return;
      }
      rules[cat] = { category: clean(r['Category']), method: method, value: value, minMargin: min };
    });
    return rules;
  }

  /**
   * Price every catalog row. Returns { items, rules, warnings }.
   * Each item: { row, sku, name, category, manufacturer, partNumber, unit, costCents, priceCents,
   *              priceSource ('override'|'rule'|'none'), marginPct, minMargin, active, taxable }.
   */
  function priceCatalog(catalogRows, ruleRows) {
    const warnings = [];
    const rules = readRules(ruleRows, warnings);
    const items = (catalogRows || []).map(function (r, i) {
      const row = i + 2;
      let cost = ReportCore.toCents(r['Cost']);
      let override = ReportCore.toCents(r['Price Override']);
      if (isNaN(cost)) { warnings.push('Catalog row ' + row + ': cost "' + clean(r['Cost']) + '" is not a number.'); cost = NaN; }
      if (isNaN(override)) { warnings.push('Catalog row ' + row + ': price override "' + clean(r['Price Override']) + '" is not a number.'); override = 0; }
      const rule = rules[norm(r['Category'])];
      let price = null;
      let source = 'none';
      if (override > 0) { price = override; source = 'override'; }
      else if (rule && !isNaN(cost) && clean(r['Cost']) !== '') { price = priceFromRule(cost, rule); source = 'rule'; }
      const costCents = isNaN(cost) ? 0 : cost;
      return {
        row: row,
        sku: clean(r['SKU']),
        name: clean(r['Name']),
        category: clean(r['Category']),
        manufacturer: clean(r['Manufacturer']),
        partNumber: clean(r['Part #']),
        unit: clean(r['Unit']) || 'each',
        costCents: costCents,
        hasCost: clean(r['Cost']) !== '' && !isNaN(cost),
        priceCents: price,
        priceSource: source,
        marginPct: price === null ? null : marginPct(price, costCents),
        minMargin: rule ? rule.minMargin : null,
        active: !isNo(r['Active']),
        taxable: !isNo(r['Taxable'])
      };
    });
    return { items: items, rules: rules, warnings: warnings };
  }

  // ------------------------------------------------------- catalog health

  /** Problems an office manager should fix, grouped by type. */
  function catalogHealth(priced) {
    const issues = [];
    function add(type, item, detail) {
      issues.push({ type: type, row: item.row, sku: item.sku, name: item.name, detail: detail });
    }
    const bySku = {}, byPart = {}, byName = {};
    priced.items.forEach(function (it) {
      if (!it.active) return;
      if (!it.sku) add('Missing SKU', it, 'Every item needs a unique SKU.');
      if (it.sku) (bySku[it.sku.toLowerCase()] = bySku[it.sku.toLowerCase()] || []).push(it);
      if (it.partNumber) {
        const k = norm(it.manufacturer) + '|' + norm(it.partNumber);
        (byPart[k] = byPart[k] || []).push(it);
      }
      (byName[norm(it.name)] = byName[norm(it.name)] || []).push(it);
      if (!it.category) add('Missing category', it, 'No category, so no pricing rule applies.');
      else if (!priced.rules[norm(it.category)] && it.priceSource !== 'override') {
        add('No pricing rule', it, 'Category "' + it.category + '" has no row on the Pricing Rules sheet.');
      }
      if (!it.hasCost && it.priceSource !== 'override') add('Missing cost', it, 'No cost, so no price can be calculated.');
      if (it.priceSource === 'none' && it.hasCost && it.category && priced.rules[norm(it.category)]) {
        add('No price', it, 'Could not calculate a price.');
      }
      if (it.priceCents !== null && it.minMargin !== null && it.hasCost && it.marginPct < it.minMargin) {
        add('Below minimum margin', it, 'Margin ' + it.marginPct + '% is under the ' + it.minMargin + '% minimum for ' +
          it.category + ' (price ' + ReportCore.formatMoney(it.priceCents, true) + ', cost ' + ReportCore.formatMoney(it.costCents, true) + ').');
      }
      if (!it.partNumber && /^(parts|equipment)$/i.test(it.category)) add('Missing part number', it, 'Parts and equipment should have the manufacturer part #.');
    });
    function dupes(map, type, describe) {
      Object.keys(map).forEach(function (k) {
        const list = map[k];
        if (list.length < 2 || !k.replace(/\|/g, '')) return;
        list.forEach(function (it) {
          const others = list.filter(function (o) { return o !== it; }).map(function (o) { return 'row ' + o.row; }).join(', ');
          add(type, it, describe(it) + ' Same as ' + others + '.');
        });
      });
    }
    dupes(bySku, 'Duplicate SKU', function (it) { return 'SKU ' + it.sku + ' is used more than once.'; });
    dupes(byPart, 'Possible duplicate', function (it) { return 'Same manufacturer + part # (' + it.partNumber + ').'; });
    dupes(byName, 'Possible duplicate', function () { return 'Same name.'; });
    // One row per (type,row) pair even if it matched twice.
    const seen = {};
    const unique = issues.filter(function (x) { const k = x.type + '|' + x.row; if (seen[k]) return false; seen[k] = true; return true; });
    const counts = {};
    unique.forEach(function (x) { counts[x.type] = (counts[x.type] || 0) + 1; });
    return { issues: unique.sort(function (a, b) { return a.type < b.type ? -1 : a.type > b.type ? 1 : a.row - b.row; }), counts: counts };
  }

  // -------------------------------------------------------------- search

  /** Rank active, priced items by how many query words hit name/SKU/manufacturer/part #/category. */
  function search(items, query, limit) {
    const words = norm(query).split(' ').filter(Boolean);
    if (!words.length) return [];
    return items
      .filter(function (it) { return it.active && it.priceCents !== null; })
      .map(function (it) {
        const hay = [it.name, it.sku, it.manufacturer, it.partNumber, it.category].map(norm).join(' ');
        const compact = hay.replace(/ /g, '');
        let score = 0;
        words.forEach(function (w) {
          if (hay.indexOf(w) >= 0 || compact.indexOf(w) >= 0) score += norm(it.partNumber) === w || norm(it.sku) === w ? 10 : 1;
        });
        return { it: it, score: score, all: words.every(function (w) { return hay.indexOf(w) >= 0 || compact.indexOf(w) >= 0; }) };
      })
      .filter(function (x) { return x.all; })
      .sort(function (a, b) { return b.score - a.score || (a.it.name < b.it.name ? -1 : 1); })
      .slice(0, limit || 15)
      .map(function (x) { return x.it; });
  }

  // --------------------------------------------------------------- quote

  /**
   * Build a quote. input: { customer:{name,address,email,phone}, lines:[{sku, qty, discountPct, note}],
   *   laborHours, laborRateCents (optional, defaults to settings), notes, date }
   * settings: { laborRateCents, taxPct, taxLabor, validDays, prefix }
   * Returns { lines, totals, errors, warnings, ... }. errors means the quote must not be issued.
   */
  function buildQuote(input, items, settings) {
    const errors = [], warnings = [];
    const bySku = {};
    items.forEach(function (it) { if (it.sku && !bySku[it.sku.toLowerCase()]) bySku[it.sku.toLowerCase()] = it; });
    const taxPct = settings.taxPct || 0;

    const lines = (input.lines || []).map(function (l, i) {
      const it = bySku[clean(l.sku).toLowerCase()];
      const qty = Number(l.qty);
      const disc = l.discountPct === undefined || l.discountPct === '' || l.discountPct === null ? 0 : Number(l.discountPct);
      const label = 'Line ' + (i + 1);
      if (!it) { errors.push(label + ': SKU "' + clean(l.sku) + '" is not in the catalog.'); return null; }
      if (!it.active) { errors.push(label + ': ' + it.name + ' is marked inactive.'); return null; }
      if (it.priceCents === null) { errors.push(label + ': ' + it.name + ' has no price yet (check catalog health).'); return null; }
      if (!(qty > 0) || !isFinite(qty)) { errors.push(label + ': quantity must be more than 0.'); return null; }
      if (!(disc >= 0 && disc <= 100)) { errors.push(label + ': discount must be 0–100%.'); return null; }
      const gross = Math.round(it.priceCents * qty);
      const discount = Math.round(gross * disc / 100);
      const net = gross - discount;
      const cost = Math.round(it.costCents * qty);
      if (it.hasCost && it.minMargin !== null && net > 0 && marginPct(net, cost) < it.minMargin) {
        warnings.push(label + ': ' + it.name + ' is at ' + marginPct(net, cost) + '% margin after discount (minimum ' + it.minMargin + '%).');
      }
      if (!it.hasCost) warnings.push(label + ': ' + it.name + ' has no cost on file, so margin is overstated.');
      return {
        sku: it.sku, name: it.name, partNumber: it.partNumber, manufacturer: it.manufacturer, unit: it.unit,
        qty: qty, unitPriceCents: it.priceCents, discountPct: disc, grossCents: gross, discountCents: discount,
        netCents: net, costCents: cost, taxable: it.taxable, note: clean(l.note)
      };
    }).filter(Boolean);

    const hours = input.laborHours === undefined || input.laborHours === '' ? 0 : Number(input.laborHours);
    const rate = input.laborRateCents === undefined || input.laborRateCents === null ? (settings.laborRateCents || 0) : input.laborRateCents;
    if (!(hours >= 0) || !isFinite(hours)) errors.push('Labor hours must be 0 or more.');
    if (!(rate >= 0)) errors.push('Labor rate must be 0 or more.');
    const laborCents = hours > 0 && rate >= 0 ? Math.round(hours * rate) : 0;
    if (!lines.length && !laborCents) errors.push('Add at least one item or some labor.');
    if (!clean(input.customer && input.customer.name)) errors.push('Customer name is required.');

    const materials = lines.reduce(function (t, l) { return t + l.netCents; }, 0);
    const discounts = lines.reduce(function (t, l) { return t + l.discountCents; }, 0);
    const taxableBase = lines.reduce(function (t, l) { return t + (l.taxable ? l.netCents : 0); }, 0) + (settings.taxLabor ? laborCents : 0);
    const tax = Math.round(taxableBase * taxPct / 100);
    const cost = lines.reduce(function (t, l) { return t + l.costCents; }, 0);
    const revenue = materials + laborCents;
    const date = ReportCore.parseDate(input.date || new Date());

    return {
      number: clean(input.number),
      date: date,
      validUntil: ReportCore.addDays(date, settings.validDays || 30),
      customer: {
        name: clean(input.customer && input.customer.name), address: clean(input.customer && input.customer.address),
        email: clean(input.customer && input.customer.email), phone: clean(input.customer && input.customer.phone)
      },
      lines: lines,
      labor: { hours: hours, rateCents: rate, cents: laborCents },
      notes: clean(input.notes),
      totals: {
        materialsCents: materials, discountCents: discounts, laborCents: laborCents,
        subtotalCents: revenue, taxPct: taxPct, taxCents: tax, totalCents: revenue + tax,
        costCents: cost, grossProfitCents: revenue - cost, marginPct: marginPct(revenue, cost)
      },
      errors: errors,
      warnings: warnings
    };
  }

  /** Next quote number after the ones already used: Q-2026-0007 -> Q-2026-0008. Restarts each year. */
  function nextQuoteNumber(existing, prefix, date) {
    const year = (ReportCore.parseDate(date || new Date())).getFullYear();
    const p = (prefix || 'Q') + '-' + year + '-';
    let max = 0;
    (existing || []).forEach(function (n) {
      const s = clean(n);
      if (s.indexOf(p) === 0) { const k = parseInt(s.slice(p.length), 10); if (k > max) max = k; }
    });
    return p + String(max + 1).padStart(4, '0');
  }

  /** Revision number for an existing quote: Q-2026-0004 -> Q-2026-0004-R1, then -R2 ... */
  function revisionNumber(existing, reviseOf) {
    const base = clean(reviseOf).replace(/-R\d+$/i, '');
    let max = 0;
    (existing || []).forEach(function (n) {
      const m = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-R(\\d+)$', 'i').exec(clean(n));
      if (m && +m[1] > max) max = +m[1];
    });
    return base + '-R' + (max + 1);
  }

  // ------------------------------------------------------------ render

  function qtyText(q) { return Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100); }

  /** Customer-facing quote. Email/PDF-safe HTML (inline styles). Never shows cost or margin. */
  function renderQuoteHtml(q, company) {
    company = company || {};
    const e = ReportCore.escapeHtml, m = function (c) { return ReportCore.formatMoney(c, true); };
    const color = /^#[0-9a-f]{6}$/i.test(clean(company.color)) ? clean(company.color) : '#0b6e99';
    const muted = '#5b6675', line = '#e3e7ec', ink = '#1f2a37';
    const td = 'padding:7px 8px;border-bottom:1px solid ' + line + ';vertical-align:top;';
    const r = td + 'text-align:right;white-space:nowrap;';
    function d(x) { return ReportCore.formatDate(x) + ', ' + x.getFullYear(); }
    let rows = '';
    q.lines.forEach(function (l) {
      rows += '<tr><td style="' + td + '"><div style="font-weight:bold;">' + e(l.name) + '</div>' +
        '<div style="font-size:11px;color:' + muted + ';">' + e([l.manufacturer, l.partNumber ? 'Part ' + l.partNumber : '', l.sku].filter(Boolean).join(' · ')) +
        (l.note ? '<br>' + e(l.note) : '') + '</div></td>' +
        '<td style="' + r + '">' + qtyText(l.qty) + (/^\d/.test(l.unit) ? ' × ' : ' ') + e(l.unit) + '</td>' +
        '<td style="' + r + '">' + m(l.unitPriceCents) + '</td>' +
        '<td style="' + r + '">' + (l.discountPct ? l.discountPct + '%' : '') + '</td>' +
        '<td style="' + r + '">' + m(l.netCents) + '</td></tr>';
    });
    if (q.labor.cents) {
      rows += '<tr><td style="' + td + '"><div style="font-weight:bold;">Labor</div></td><td style="' + r + '">' + qtyText(q.labor.hours) +
        ' hr</td><td style="' + r + '">' + m(q.labor.rateCents) + '</td><td style="' + r + '"></td><td style="' + r + '">' + m(q.labor.cents) + '</td></tr>';
    }
    const t = q.totals;
    function trow(label, val, bold) {
      return '<tr><td style="padding:4px 8px;text-align:right;color:' + (bold ? ink : muted) + ';' + (bold ? 'font-weight:bold;font-size:15px;' : '') + '">' + label +
        '</td><td style="padding:4px 8px;text-align:right;white-space:nowrap;' + (bold ? 'font-weight:bold;font-size:15px;' : '') + '">' + val + '</td></tr>';
    }
    return '<div style="font-family:Arial,Helvetica,sans-serif;color:' + ink + ';font-size:13px;max-width:760px;margin:0 auto;">' +
      '<table style="width:100%;border-collapse:collapse;"><tr><td style="vertical-align:top;">' +
      '<div style="font-size:22px;font-weight:bold;color:' + color + ';">' + e(company.name || 'Your Company') + '</div>' +
      '<div style="color:' + muted + ';font-size:12px;line-height:1.5;">' + [company.address, company.phone, company.email].filter(Boolean).map(e).join('<br>') + '</div></td>' +
      '<td style="vertical-align:top;text-align:right;"><div style="font-size:26px;font-weight:bold;letter-spacing:1px;">QUOTE</div>' +
      '<div style="font-size:12px;color:' + muted + ';line-height:1.6;">' + (q.number ? 'No. <b style="color:' + ink + ';">' + e(q.number) + '</b><br>' : '') +
      'Date: ' + d(q.date) + '<br>Valid until: ' + d(q.validUntil) + '</div></td></tr></table>' +
      '<div style="border-top:3px solid ' + color + ';margin:14px 0 12px;"></div>' +
      '<div style="font-size:11px;color:' + muted + ';text-transform:uppercase;letter-spacing:1px;">Prepared for</div>' +
      '<div style="font-weight:bold;font-size:14px;">' + e(q.customer.name) + '</div>' +
      '<div style="color:' + muted + ';font-size:12px;line-height:1.5;">' + [q.customer.address, q.customer.phone, q.customer.email].filter(Boolean).map(e).join('<br>') + '</div>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:16px;"><tr style="background:' + color + ';color:#fff;">' +
      '<th style="padding:7px 8px;text-align:left;">Item</th><th style="padding:7px 8px;text-align:right;">Qty</th><th style="padding:7px 8px;text-align:right;">Unit price</th>' +
      '<th style="padding:7px 8px;text-align:right;">Disc.</th><th style="padding:7px 8px;text-align:right;">Amount</th></tr>' + rows + '</table>' +
      '<table style="margin-left:auto;margin-top:8px;border-collapse:collapse;">' +
      trow('Materials', m(t.materialsCents)) + (t.discountCents ? trow('Includes discounts of', '−' + m(t.discountCents)) : '') +
      (t.laborCents ? trow('Labor', m(t.laborCents)) : '') + trow('Tax (' + t.taxPct + '%)', m(t.taxCents)) +
      '<tr><td colspan="2" style="border-top:2px solid ' + ink + ';"></td></tr>' + trow('Total', m(t.totalCents), true) + '</table>' +
      (q.notes ? '<div style="margin-top:16px;"><div style="font-weight:bold;margin-bottom:4px;">Notes</div><div style="white-space:pre-wrap;">' + e(q.notes) + '</div></div>' : '') +
      (company.terms ? '<div style="margin-top:16px;font-size:11px;color:' + muted + ';white-space:pre-wrap;">' + e(company.terms) + '</div>' : '') +
      '</div>';
  }

  return {
    toPct: toPct,
    priceFromRule: priceFromRule,
    marginPct: marginPct,
    priceCatalog: priceCatalog,
    catalogHealth: catalogHealth,
    search: search,
    buildQuote: buildQuote,
    nextQuoteNumber: nextQuoteNumber,
    revisionNumber: revisionNumber,
    renderQuoteHtml: renderQuoteHtml
  };
})();
