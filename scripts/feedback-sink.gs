// Feedback sink for the Camp Week Schedule app.
//
// Collects the Info-tab feedback box into a private Google Sheet.
// Setup (~2 minutes, one time):
//   1. sheets.new → name it "Camp App Feedback"
//   2. Extensions → Apps Script → replace Code.gs with this file
//   3. Set SHEET_ID below (the long id in the spreadsheet's URL)
//   4. Deploy → New deployment → Web app → Execute as: Me,
//      Who has access: Anyone → Deploy → copy the /exec URL
//   5. Paste that URL into FEEDBACK_URL in index.html, bump sw.js, push
//
// Until this is deployed, the app falls back to opening an email instead.

const SHEET_ID = 'PASTE_SPREADSHEET_ID_HERE';

function doPost(e) {
  const d = JSON.parse((e.postData && e.postData.contents) || '{}');
  SpreadsheetApp.openById(SHEET_ID).getSheets()[0].appendRow([
    new Date(),
    d.week || '',
    d.rating || '',
    String(d.feedback || '').slice(0, 2000),
  ]);
  return ContentService.createTextOutput('ok');
}
