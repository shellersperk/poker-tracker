// Poker Tracker sync endpoint.
// Paste this into Extensions > Apps Script on the Google Sheet you want sessions logged to,
// then deploy it as a Web App (see README.md for the full walkthrough).

const SHEET_NAME = 'Sessions';
const HEADERS = ['Date', 'Day of Week', 'Time of Day', 'Check-In', 'Check-Out', 'Location', 'Game', 'Buy-In', 'Add-Ons',
  'Total Invested', 'Cash-Out', 'Profit', 'Duration (hrs)', 'Profit/Hr', 'Good', 'Bad', 'Needs Action', 'Session ID'];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getRange(1, 1).getValue() !== HEADERS[0]) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doPost(e) {
  const sheet = getSheet_();
  const row = JSON.parse(e.postData.contents);

  // Skip duplicates: if this session ID was already synced, overwrite that row instead of appending.
  const ids = sheet.getRange(2, HEADERS.length, Math.max(sheet.getLastRow() - 1, 0), 1).getValues().flat();
  const existingIndex = ids.indexOf(row.id);

  const values = [
    row.date || '', row.dayOfWeek || '', row.timeOfDay || '', row.checkIn || '', row.checkOut || '',
    row.location || '', row.game || '', row.buyIn || 0, row.addOns || 0, row.totalInvested || 0,
    row.cashOut || 0, row.profit || 0, row.durationHours || '', row.profitPerHour || '',
    row.notesGood || '', row.notesBad || '', row.notesAction || '', row.id || ''
  ];

  if (existingIndex >= 0) {
    sheet.getRange(existingIndex + 2, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('Poker Tracker sync endpoint is live.');
}
