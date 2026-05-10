// ============================================================
// Utilities.gs — Shared helpers for Play Ops Store
// ============================================================

// ------------------------------------------------------------
// SHEET ACCESS
// ------------------------------------------------------------

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

function getSheetData(name) {
  var sheet = getSheet(name);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function getConfig(setting) {
  var rows = getSheetData('Config');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['Setting'] === setting) return rows[i]['Value'];
  }
  return null;
}

// ------------------------------------------------------------
// ID GENERATION
// ------------------------------------------------------------

function generateTaskId() {
  return generateId('Tasks', 'TASK');
}

function generateCompletionId() {
  return generateId('Completions', 'COMP');
}

function generateKudosId() {
  return generateId('Kudos', 'KUD');
}

function generateDemeritId() {
  return generateId('Demerits', 'DEM');
}

function generateNotificationId() {
  return generateId('Notifications', 'NOTIF');
}

function generateId(sheetName, prefix) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet(sheetName);
    var lastRow = sheet.getLastRow();
    var count = lastRow < 2 ? 1 : lastRow;
    var padded = String(count).padStart(4, '0');
    var timestamp = new Date().getTime().toString().slice(-4);
    return prefix + '-' + padded + '-' + timestamp;
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------
// DATE & TIME HELPERS
// ------------------------------------------------------------

function now() {
  return new Date();
}

function formatDate(date) {
  if (!date) return '';
  return Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), 'MMM dd, yyyy');
}

function formatDateTime(date) {
  if (!date) return '';
  return Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), 'MMM dd, yyyy hh:mm a');
}

function isExpired(deadline) {
  if (!deadline) return false;
  return new Date(deadline) < now();
}

function hoursUntil(deadline) {
  var diff = new Date(deadline) - now();
  return diff / (1000 * 60 * 60);
}

function minutesToHours(minutes) {
  return Math.round(minutes / 60 * 10) / 10;
}

// Calculate TAT in hours between two dates
function calcTAT(claimedAt, completedAt) {
  if (!claimedAt || !completedAt) return null;
  var diff = new Date(completedAt) - new Date(claimedAt);
  return Math.round(diff / (1000 * 60 * 60) * 10) / 10; // hours, 1 decimal
}

// Days before deadline the task was completed (excluding weekends)
function daysEarly(completedAt, deadline) {
  if (!completedAt || !deadline) return 0;
  var start = new Date(completedAt);
  var end = new Date(deadline);
  if (start >= end) return 0;

  var businessDays = 0;
  var current = new Date(start);
  while (current < end) {
    current.setDate(current.getDate() + 1);
    var dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0 = Sunday, 6 = Saturday
      businessDays++;
    }
  }
  return businessDays;
}

// ------------------------------------------------------------
// POINTS & BONUS HELPERS
// ------------------------------------------------------------

function calcEarlyBonus(basePoints, completedAt, deadline) {
  var days = daysEarly(completedAt, deadline);
  if (days >= 2) {
    var rate = parseFloat(getConfig('EarlyBonus2PlusDays')) || 0.2;
    return Math.round(basePoints * rate);
  } else if (days >= 1) {
    var rate = parseFloat(getConfig('EarlyBonus1Day')) || 0.1;
    return Math.round(basePoints * rate);
  }
  return 0;
}

function applyPointsFloor(points) {
  var floor = parseInt(getConfig('PointsFloor')) || 0;
  return Math.max(points, floor);
}

// ------------------------------------------------------------
// SESSION & AUTH HELPERS
// ------------------------------------------------------------

function getSessionEmail() {
  return Session.getActiveUser().getEmail();
}

function getLdapFromEmail(email) {
  if (!email) return null;
  return email.split('@')[0].toLowerCase();
}

function getCurrentLdap() {
  return getLdapFromEmail(getSessionEmail());
}

// ------------------------------------------------------------
// RESPONSE HELPERS (for doGet / doPost JSON responses)
// ------------------------------------------------------------

function jsonSuccess(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
// APPEND ROW HELPER
// ------------------------------------------------------------

// Pass an object with column headers as keys; appends a row in correct column order
function appendRow(sheetName, rowObj) {
  var sheet = getSheet(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function(h) {
    return rowObj.hasOwnProperty(h) ? rowObj[h] : '';
  });
  sheet.appendRow(row);
}

// Update a row where a column matches a value
function updateRow(sheetName, matchCol, matchVal, updates) {
  var sheet = getSheet(sheetName);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var matchIdx = headers.indexOf(matchCol);
  if (matchIdx === -1) throw new Error('Column not found: ' + matchCol);

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][matchIdx]) === String(matchVal)) {
      Object.keys(updates).forEach(function(key) {
        var colIdx = headers.indexOf(key);
        if (colIdx !== -1) {
          sheet.getRange(i + 1, colIdx + 1).setValue(updates[key]);
        }
      });
      return true;
    }
  }
  return false;
}

// Find a single row as an object
function findRow(sheetName, matchCol, matchVal) {
  var rows = getSheetData(sheetName);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][matchCol]) === String(matchVal)) return rows[i];
  }
  return null;
}

// Find all rows matching a column value
function findRows(sheetName, matchCol, matchVal) {
  var rows = getSheetData(sheetName);
  return rows.filter(function(r) {
    return String(r[matchCol]) === String(matchVal);
  });
}

// ------------------------------------------------------------
// CACHE HELPERS
// ------------------------------------------------------------

function getCached(key) {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch(e) {
    Logger.log('[Cache] Read error: ' + e.message);
    return null;
  }
}

function setCached(key, data, ttlSeconds) {
  try {
    var cache = CacheService.getScriptCache();
    var serialized = JSON.stringify(data);
    // Apps Script cache has a 100KB per-item limit
    if (serialized.length < 100000) {
      cache.put(key, serialized, ttlSeconds || 300);
    }
  } catch(e) {
    Logger.log('[Cache] Write error: ' + e.message);
  }
}

function invalidateCache(keys) {
  try {
    var cache = CacheService.getScriptCache();
    cache.removeAll(keys);
  } catch(e) {
    Logger.log('[Cache] Invalidate error: ' + e.message);
  }
}
