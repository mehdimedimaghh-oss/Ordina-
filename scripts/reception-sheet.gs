/**
 * Comande → Reception sheet
 * Paste ALL of this in your Google Sheet: Extensions → Apps Script → replace everything → Save.
 * Then Deploy → New deployment → Web app (Execute as: Me · Who has access: Anyone) → copy the /exec link
 * and paste it in the Comande app: Owner → Reception sheet.
 *
 * Every order sent to reception becomes one row. One tab per day (newest day first).
 * Reopened or deleted orders are greyed out and crossed out, so reception does not charge them twice.
 */

var HEADERS = ['Ora / Time', 'Tavolo', 'Cliente', 'Edificio', 'Camera', 'Ordine / Items', 'Serv. camera', 'Note', 'Totale €', 'Cameriere', 'Stato / Status', 'ID'];
var STATUS = { sent: 'Da pagare / To pay', reopened: 'Riaperto / Reopened', deleted: 'Eliminato / Deleted', test: 'TEST' };

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var o = JSON.parse(e.postData.contents);
    var sheet = daySheet_(o.day);
    if (o.event === 'sent' || o.event === 'test') {
      // never write the same order twice
      if (o.event === 'sent' && findRow_(sheet, o.id) > 0) return text_('already there');
      sheet.appendRow([o.time, o.table, o.client || '', o.building || '', o.room || '', o.items, o.roomService ? 'Sì / Yes' : '',
        o.note || '', Number(o.total), o.waiter || '', STATUS[o.event], o.event === 'test' ? 'test' : o.id]);
      var r = sheet.getLastRow();
      sheet.getRange(r, 9).setNumberFormat('€ #,##0.00');
      sheet.getRange(r, 1, 1, HEADERS.length).setFontWeight('normal').setFontLine('none').setFontColor('#14224A').setBackground(null);
      if (o.room) sheet.getRange(r, 5).setFontWeight('bold');
      return text_('ok');
    }
    if (o.event === 'reopened' || o.event === 'deleted') {
      var row = findRow_(sheet, o.id);
      if (row < 0) row = findRowAnyDay_(o.id, function (s) { sheet = s; });
      if (row > 0) {
        sheet.getRange(row, 11).setValue(STATUS[o.event]);
        sheet.getRange(row, 1, 1, HEADERS.length).setFontLine('line-through').setFontColor('#9AA0AE').setBackground('#F4F5F8');
      }
      return text_('ok');
    }
    return text_('unknown event');
  } finally {
    lock.releaseLock();
  }
}

// One tab per day, e.g. "04-11-2026", newest first. Created with the headers the first time.
function daySheet_(day) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = String(day || '').replace(/\//g, '-') || 'Comande';
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, 0);
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#14224A').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setColumnWidth(6, 420);
    sh.setColumnWidth(3, 160);
    sh.hideColumns(12);
  }
  return sh;
}

function findRow_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 12, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

// an order reopened after midnight may be in another day's tab
function findRowAnyDay_(id, setSheet) {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  for (var i = 0; i < sheets.length && i < 10; i++) {
    var r = findRow_(sheets[i], id);
    if (r > 0) { setSheet(sheets[i]); return r; }
  }
  return -1;
}

function text_(s) { return ContentService.createTextOutput(s); }

// Opening the link in a browser shows this (useful to check it works)
function doGet() { return text_('Comande reception sheet is ready ✓'); }
