// ============================================================
// Code.gs — Main router, doGet(), session handling, triggers
// Play Ops Store
// ============================================================

// ------------------------------------------------------------
// ENTRY POINT
// ------------------------------------------------------------

function doGet(e) {
  var ldap = getCurrentLdap();

  // Access check — must be in Agents or Managers sheet
  var role = getUserRole(ldap);
  if (!role) {
    return serveAccessDenied(ldap);
  }

  var template = HtmlService.createTemplateFromFile('Index');
  template.ldap = ldap;
  template.role = role;
  template.email = getSessionEmail();

  return template.evaluate()
    .setTitle('Play Ops Store')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getScriptScopes() {
  // This function exists to ensure UrlFetchApp scope is requested
  UrlFetchApp.fetch('https://www.google.com');
}

// Serve a locked-out page for unauthorized users
function serveAccessDenied(ldap) {
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;text-align:center;padding:80px 40px;">' +
    '<h2 style="color:#c0392b;">Access Denied</h2>' +
    '<p>Your account (<strong>' + (ldap || 'unknown') + '</strong>) is not authorized to access Play Ops Store.</p>' +
    '<p style="color:#888;font-size:13px;">Contact your manager to be added to the system.</p>' +
    '</div>'
  );
  html.setTitle('Play Ops Store — Access Denied');
  return html;
}

// Included in HTML templates via <?= include('Styles') ?>
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ------------------------------------------------------------
// CLIENT-CALLABLE FUNCTIONS (called via google.script.run)
// These are the API surface exposed to the frontend.
// ------------------------------------------------------------

// --- Session ---
function getSessionInfo() {
  var ldap = getCurrentLdap();
  var role = getUserRole(ldap);
  var agent = getAgentProfile(ldap);
  
  // Figure out the team name based on role
  var teamName = 'Play Ops';
  if (role === 'manager' || role === 'supervisor') {
    var mgrRow = findRow('Managers', 'LDAP', ldap);
    if (mgrRow) teamName = mgrRow['Team'];
  } else if (agent) {
    teamName = agent.teamLead || agent.workgroup || 'Play Ops';
  }

  return {
    ldap: ldap,
    email: getSessionEmail(),
    role: role,
    displayName: agent ? agent.displayName : ldap,
    photoUrl: getMomaPhotoUrl(ldap),
    team: teamName // <--- Pass the team name here
  };
}

// --- Tasks ---
function clientGetHomepageTasks() {
  return getHomepageTasks(getCurrentLdap());
}

function clientGetTaskDetail(taskId) {
  return getTaskDetail(taskId, getCurrentLdap());
}

function clientClaimTask(taskId) {
  var result = claimTask(taskId, getCurrentLdap());
  if (result && result.success) bustServerCaches();
  return result;
}

function clientCompleteTask(taskId) {
  var result = completeTask(taskId, getCurrentLdap());
  if (result && result.success) bustServerCaches();
  return result;
}

function clientAcknowledgeTask(taskId) {
  return acknowledgeTask(taskId, getCurrentLdap());
}

function clientSearchTasks(query) {
  return searchTasks(query, getCurrentLdap());
}

// --- Leaderboard ---
function clientGetLeaderboard() {
  return getLeaderboard(getCurrentLdap(), getUserRole(getCurrentLdap()));
}

// --- Profile ---
function clientGetMyProfile() {
  return getAgentFullProfile(getCurrentLdap());
}

function clientGetAgentProfile(ldap) {
  var requesterLdap = getCurrentLdap();
  var role = getUserRole(requesterLdap);

  if (role === 'manager') return getAgentFullProfile(ldap, true);

  if (role === 'supervisor') {
    var managed = getManagedLdaps(requesterLdap);
    if (managed.indexOf(ldap) !== -1 || ldap === requesterLdap) {
      return getAgentFullProfile(ldap, true);
    }
  }

  // Default to public profile
  return getAgentFullProfile(ldap, false);
}

// --- Kudos ---
function clientSubmitKudos(formData) {
  return submitKudos(formData, getCurrentLdap());
}

// --- Notifications ---
function clientGetNotifications() {
  return getNotifications(getCurrentLdap());
}

function clientMarkNotificationsRead() {
  return markAllNotificationsRead(getCurrentLdap());
}

// --- Supervisor/Manager functions ---
function clientCreateTask(taskData) {
  requireSupervisor();
  return createTask(taskData, getCurrentLdap());
}

function clientUpdateTask(taskId, taskData) {
  requireSupervisor();
  return updateTask(taskId, taskData, getCurrentLdap());
}

function clientGetKudosQueue() {
  requireSupervisor();
  var managedLdaps = getManagedLdaps(getCurrentLdap());
  return getKudosQueue(managedLdaps);
}

function clientReviewKudos(kudosId, decision, note) {
  requireSupervisor();
  return reviewKudos(kudosId, decision, note, getCurrentLdap());
}

function clientAddDemerit(demeritData) {
  requireSupervisor();
  // Ensure supervisor can only add demerit to their team
  var managedLdaps = getManagedLdaps(getCurrentLdap());
  if (managedLdaps && managedLdaps.indexOf(demeritData.ldap) === -1) {
    throw new Error('Unauthorized: You can only add demerits to your own team.');
  }
  return addDemerit(demeritData, getCurrentLdap());
}

function clientGetTeamAnalytics() {
  requireSupervisor();
  var managedLdaps = getManagedLdaps(getCurrentLdap());
  return getTeamAnalytics(managedLdaps);
}

function clientGetAgentLookup(ldap) {
  requireSupervisor();
  var managedLdaps = getManagedLdaps(getCurrentLdap());
  if (managedLdaps && managedLdaps.indexOf(ldap) === -1 && ldap !== getCurrentLdap()) {
    return getAgentFullProfile(ldap, false); // Public view only
  }
  return getAgentFullProfile(ldap, true);
}

function clientGetAllAgents() {
  requireSupervisor();
  var managedLdaps = getManagedLdaps(getCurrentLdap());
  return getAllAgents(managedLdaps);
}

function clientUpdateAgentDisplayName(ldap, displayName) {
  requireManager(); // Only Manager can edit display names
  return updateAgentDisplayName(ldap, displayName);
}

// --- Supervisor: Task Manager list ---
function clientGetAllTasks() {
  requireSupervisor();
  var managedLdaps = getManagedLdaps(getCurrentLdap());
  return getAllTasksForManager(managedLdaps);
}

// --- Concerns ---
function clientSubmitConcern(concernData) {
  var ldap = getCurrentLdap();
  return submitConcern(concernData, ldap);
}

function clientGetConcerns() {
  requireSupervisor();
  var ldap = getCurrentLdap();
  var managedLdaps = getManagedLdaps(ldap);
  return getConcerns(managedLdaps, ldap);
}

function clientGetLeadershipList() {
  return getLeadershipList();
}

// ------------------------------------------------------------
// ROLE GUARD
// ------------------------------------------------------------

function requireManager() {
  var ldap = getCurrentLdap();
  if (!isManager(ldap)) {
    throw new Error('Unauthorized: manager access required.');
  }
}

function requireSupervisor() {
  var ldap = getCurrentLdap();
  if (!isSupervisor(ldap)) {
    throw new Error('Unauthorized: supervisor/manager access required.');
  }
}

// --- CSAT Bridge ---
function clientGetMyCsat(ldap, month) {
  var requesterLdap = getCurrentLdap();
  var requesterRole = getUserRole(requesterLdap);
  var isMgmt = requesterRole === 'manager' || requesterRole === 'supervisor';
  var targetLdap = (ldap && isMgmt) ? ldap : requesterLdap;

  if (requesterRole === 'supervisor' && targetLdap !== requesterLdap) {
    var managed = getManagedLdaps(requesterLdap);
    if (managed.indexOf(targetLdap) === -1) {
      targetLdap = requesterLdap; // restrict to self
    }
  }

  return getMyCsatData(targetLdap, month);
}

function clientGetTeamCsat(month) {
  requireSupervisor();
  return getTeamCsatData(getCurrentLdap(), month);
}

function clientGetAllTeamsCsat(month) {
  requireManager(); // Strictly Manager only
  return getAllTeamsCsatData(month);
}

function clientGetAvailableCsatMonths() {
  return getAvailableCsatMonths();
}

function clientRunCsatAggregation() {
  requireManager();
  runCsatAggregation();
  return { success: true };
}

// ------------------------------------------------------------
// MOMA PHOTO URL
// ------------------------------------------------------------

function getMomaPhotoUrl(ldap) {
  // Standard Google internal Moma photo URL pattern
  return 'https://moma.corp.google.com/person/' + ldap + '/photo';
}

// ------------------------------------------------------------
// AUTOMATED TRIGGERS (set these up in Apps Script trigger menu)
// ------------------------------------------------------------

// Nightly at 00:00 — flags expired/abandoned tasks, deducts points
function triggerNightlyExpiry() {
  runExpiryCheck();
  sendExpiryWarnings();
}

// 1st of month at 00:01 — resets monthly points, updates tiers
function triggerMonthlyReset() {
  var today = new Date();
  var resetDay = parseInt(getConfig('MonthlyResetDay')) || 1;
  if (today.getDate() === resetDay) {
    runMonthlyReset();
  }
}

// onEdit trigger — detects new demerit rows
function triggerOnEdit(e) {
  try {
    var sheet = e.range.getSheet();
    if (sheet.getName() === 'Demerits') {
      var row = e.range.getRow();
      if (row > 1) {
        // Small delay to let the full row populate
        Utilities.sleep(500);
        onDemeritRowAdded(row);
      }
    }
  } catch (err) {
    Logger.log('triggerOnEdit error: ' + err.message);
  }
}

// ------------------------------------------------------------
// SETUP — Run once to create all sheets and seed data
// ------------------------------------------------------------

function setupSpreadsheet() {
  createAllSheets();
  seedConfigSheet();
  seedBadgeDefsSheet();
  seedAgentsSheet();
  Logger.log('Play Ops Store setup complete!');
}

function createAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var schemas = {
    'Tasks': ['ID','Title','Description','Category','TargetType','TargetValue','Deadline','BasePoints','Difficulty','EarlyBonusRate','Status','CreatedBy','CreatedAt','IsFeatured'],
    'Completions': ['ID','TaskID','LDAP','ClaimedAt','CompletedAt','TAT','BasePoints','BonusPoints','TotalPoints','IsFirst','IsEarly','Type'],
    'Kudos': ['ID','LDAP','CaseID','Channel','IssueType','Resolution','WhyKudos','Status','ReviewedBy','ReviewNote','SubmittedAt','ReviewedAt'],
    'Demerits': ['ID','Timestamp','LDAP','Type','Details','Points','EnteredBy','NotificationSent'],
    'Notifications': ['ID','LDAP','Type','Message','IsRead','CreatedAt'],
    'Agents': ['LDAP','Email','DisplayName','Channel','Site','Workgroup','TeamLead'],
    'Managers': ['LDAP','Email','Role','Team'],
    'Leaderboard': ['LDAP','Month','MonthlyPoints','AllTimePoints','CurrentStreak','BestStreak','Tier'],
    'Badges': ['LDAP','BadgeID','BadgeName','AwardedAt'],
    'BadgeDefs': ['BadgeID','BadgeName','Description','SVGIcon','Trigger'],
    'Config': ['Setting','Value'],
    'Concerns': ['ID','Timestamp','LDAP','AddressedTo','Type','Nature','Status','Resolution']
  };

  Object.keys(schemas).forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    // Only write headers if sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(schemas[name]);
      sheet.getRange(1, 1, 1, schemas[name].length)
        .setFontWeight('bold')
        .setBackground('#4285F4')
        .setFontColor('#FFFFFF');
    }
  });
}

function seedConfigSheet() {
  var sheet = getSheet('Config');
  if (sheet.getLastRow() > 1) return; // already seeded

  var defaults = [
    {Setting: 'PointsRTA', Value: -20},
    {Setting: 'PointsQAMarkdown', Value: -15},
    {Setting: 'PointsMissedTask', Value: -10},
    {Setting: 'PointsAbandonedTask', Value: -5},
    {Setting: 'PointsPerfectAttendance', Value: 50},
    {Setting: 'PointsKudosValidated', Value: 30},
    {Setting: 'PointsFirstToComplete', Value: 10},
    {Setting: 'EarlyBonus1Day', Value: 0.10},
    {Setting: 'EarlyBonus2PlusDays', Value: 0.20},
    {Setting: 'Streak3Bonus', Value: 15},
    {Setting: 'Streak5Bonus', Value: 25},
    {Setting: 'PointsFloor', Value: 0},
    {Setting: 'MonthlyResetDay', Value: 1},
    {Setting: 'ExpiryCheckTime', Value: '00:00'},
    {Setting: 'AdminEmail', Value: 'stevenjosephc@google.com'}
  ];

  batchAppendRows('Config', defaults);
}

function seedBadgeDefsSheet() {
  var sheet = getSheet('BadgeDefs');
  if (sheet.getLastRow() > 1) return;

  var badges = [
    {BadgeID: 'FIRST_BLOOD', BadgeName: 'First Blood', Description: 'First task ever completed', SVGIcon: '', Trigger: 'first_completion'},
    {BadgeID: 'SPEED_DEMON', BadgeName: 'Speed Demon', Description: 'Complete a task 3+ days before deadline', SVGIcon: '', Trigger: 'early_3days'},
    {BadgeID: 'PERFECTIONIST', BadgeName: 'Perfectionist', Description: '5 consecutive on-time completions', SVGIcon: '', Trigger: 'ontime_streak_5'},
    {BadgeID: 'KUDOS_KING', BadgeName: 'Kudos King/Queen', Description: '3 validated Kudos in a single month', SVGIcon: '', Trigger: 'kudos_3_month'},
    {BadgeID: 'CLEAN_SLATE', BadgeName: 'Clean Slate', Description: 'Full month with zero demerits', SVGIcon: '', Trigger: 'zero_demerits_month'},
    {BadgeID: 'OVERACHIEVER', BadgeName: 'Overachiever', Description: 'Complete 10+ tasks in a single month', SVGIcon: '', Trigger: 'tasks_10_month'},
    {BadgeID: 'STREAK_MASTER', BadgeName: 'Streak Master', Description: '10-task on-time streak', SVGIcon: '', Trigger: 'ontime_streak_10'},
    {BadgeID: 'ACKNOWLEDGED', BadgeName: 'Acknowledged', Description: 'First announcement acknowledgement', SVGIcon: '', Trigger: 'first_acknowledge'},
    {BadgeID: 'VETERAN', BadgeName: 'Veteran', Description: 'Active for 3 consecutive months', SVGIcon: '', Trigger: 'active_3months'},
    {BadgeID: 'LEGEND', BadgeName: 'Legend', Description: 'Reach Legend tier for the first time', SVGIcon: '', Trigger: 'tier_legend'},
    {BadgeID: 'COMEBACK_KID', BadgeName: 'Comeback Kid', Description: 'Reach Gold+ tier after being Bronze the previous month', SVGIcon: '', Trigger: 'comeback_gold'}
  ];

  batchAppendRows('BadgeDefs', badges);
}

function seedAgentsSheet() {
  var sheet = getSheet('Agents');
  if (sheet.getLastRow() > 1) return;

  var agents = [
    'anggam','maekaila','caranoo','codeniera','genlee',
    'nicoleflores','jecylangela','chilado','kennethwhesley',
    'leonoral','krisangelo','kareenm','palomarj','johnnoelp',
    'refugio','torreon','vequezo','cedricanthony'
  ];

  var domain = '@google.com';
  var rowObjs = agents.map(function(ldap) {
    return {
      LDAP: ldap,
      Email: ldap + domain,
      DisplayName: '',
      Channel: 'Chat',
      Site: 'Cebu',
      Workgroup: 'Play Ops',
      TeamLead: 'stevenjosephc'
    };
  });

  batchAppendRows('Agents', rowObjs);

  // Seed manager
  var managerSheet = getSheet('Managers');
  if (managerSheet.getLastRow() < 2) {
    batchAppendRows('Managers', [{
      LDAP: 'stevenjosephc',
      Email: 'stevenjosephc@google.com',
      Role: 'manager',
      Team: 'Team Steven'
    }]);
  }
}
function testTaskManager() {
  try {
    var result = getAllTasksForManager();
    Logger.log(JSON.stringify(result));
  } catch(e) {
    Logger.log('ERROR: ' + e.message + ' | Line: ' + e.lineNumber);
  }
}
function testSheets() {
  var names = ['Tasks','Completions','Kudos','Demerits','Notifications','Agents','Managers','Leaderboard','Badges','BadgeDefs','Config'];
  names.forEach(function(n) {
    try {
      var s = getSheet(n);
      Logger.log(n + ': OK (' + s.getLastRow() + ' rows)');
    } catch(e) {
      Logger.log(n + ': MISSING');
    }
  });
}
function testManagerAuth() {
  var ldap = getCurrentLdap();
  var role = getUserRole(ldap);
  Logger.log('LDAP: ' + ldap);
  Logger.log('Role: ' + role);
  Logger.log('Manager row: ' + JSON.stringify(findRow('Managers', 'LDAP', ldap)));
}
function testClientGetAllTasks() {
  try {
    requireManager();
    var result = getAllTasksForManager();
    Logger.log('Result type: ' + typeof result);
    Logger.log('Result: ' + JSON.stringify(result));
  } catch(e) {
    Logger.log('ERROR: ' + e.message);
    Logger.log('Stack: ' + e.stack);
  }
}
function clientGetPendingAgents(taskId) {
  requireManager();
  return getPendingAgentsForTask(taskId);
}
function deletePlayOpsTask(taskId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tasks');
  var data = sheet.getDataRange().getValues();
  
  // Loop through to find the matching Task ID (assuming it's in column A/index 0)
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === taskId) {
      sheet.deleteRow(i + 1); // +1 because sheet rows are 1-indexed
      clearSheetDataCache('Tasks');
      return { success: true };
    }
  }
  return { error: 'Task not found in database.' };
}
// ═══════════════════════════════════════════════
// FEEDBACK SYSTEM
// ═══════════════════════════════════════════════
function clientSubmitFeedback(type, text) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Feedback');
    
    // Auto-create the tab if it doesn't exist yet!
    if (!sheet) {
      sheet = ss.insertSheet('Feedback');
      sheet.appendRow(['Timestamp', 'Agent LDAP', 'Feedback Type', 'Details', 'Status']);
      sheet.getRange("A1:E1").setFontWeight("bold").setBackground("#f3f3f3");
      sheet.setFrozenRows(1);
    }
    
    // Grab the user who submitted it
    var email = Session.getActiveUser().getEmail();
    var ldap = email.split('@')[0]; // Adjust this if your IDs are formatted differently
    var timestamp = new Date();
    
    // Log the feedback into the sheet
    sheet.appendRow([timestamp, ldap, type, text, 'New']);
    clearSheetDataCache('Feedback');
    
    return { success: true };
  } catch (e) {
    Logger.log("Error saving feedback: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

function debugCsatColumns() {
  var ext = SpreadsheetApp.openById('1wH2AVGJ9jyZJUX1EIvhBkMn-i7gOAE9z9gxB7STjC0g');
  var dump = ext.getSheetByName('CSATdump');
  var headers = dump.getRange(1, 1, 1, dump.getLastColumn()).getValues()[0];
  
  Logger.log('=== ALL COLUMN HEADERS ===');
  headers.forEach(function(h, i) {
    if (h) Logger.log(i + ': [' + h + ']'); // brackets show hidden spaces
  });
  
  // Also check if CSATSummary exists and has data
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var summary = ss.getSheetByName('CSATSummary');
  Logger.log('CSATSummary exists: ' + (summary ? 'YES, rows: ' + summary.getLastRow() : 'NO'));
}

function bustServerCaches() {
  var cache = CacheService.getScriptCache();
  cache.removeAll([
    'shifts_display_v1',
    'breaks_display_v1',
    'csat_raw_dump',
    'leaderboard_agent',
    'leaderboard_manager',
    'team_analytics'
  ]);
  Logger.log('[Cache] All server caches busted at ' + new Date());
}

function warmCsatCache() {
  try {
    readCsatDump();
    Logger.log('[CSAT Cache] Warmed successfully at ' + new Date());
  } catch(e) {
    Logger.log('[CSAT Cache] Warm error: ' + e.message);
  }
}

function clientGetAgentCoaching(ldap, month) {
  var requesterLdap = getCurrentLdap();
  var requesterRole = getUserRole(requesterLdap);
  var isMgmt = requesterRole === 'manager' || requesterRole === 'supervisor';
  var targetLdap = (ldap && isMgmt) ? ldap : requesterLdap;

  // If supervisor, check if agent is in their team
  if (requesterRole === 'supervisor' && targetLdap !== requesterLdap) {
    var managed = getManagedLdaps(requesterLdap);
    if (managed.indexOf(targetLdap) === -1) {
       targetLdap = requesterLdap; // restricted to self
    }
  }

  return getAgentCsatCoaching(targetLdap, month);
}

function clientGetTeamCoaching(month) {
  requireSupervisor();
  return getTeamCsatCoaching(getCurrentLdap(), month);
}

function storeGroqKey() {
  PropertiesService.getScriptProperties().setProperty('GROQ_API_KEY', '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');
}

function clientGetAgentSchedule(month, targetLdap) {
  var ldap = getCurrentLdap();
  var role = getUserRole(ldap);
  var isMgmt = role === 'manager' || role === 'supervisor';
  var effectiveLdap = (targetLdap && isMgmt) ? targetLdap : ldap;

  if (role === 'supervisor' && effectiveLdap !== ldap) {
    var managed = getManagedLdaps(ldap);
    if (managed.indexOf(effectiveLdap) === -1) {
      effectiveLdap = ldap;
    }
  }

  return getAgentScheduleData(effectiveLdap, month);
}

function clientGetScheduleAgentList() {
  requireSupervisor();
  var managedLdaps = getManagedLdaps(getCurrentLdap());
  var agents = getAllAgents(managedLdaps);
  return agents.map(function(a) {
    return { ldap: a.ldap, displayName: a.displayName || a.ldap };
  }).filter(function(a) { return a.ldap; });
}

function clientGetTeamSchedule(dateKey) {
  requireSupervisor();
  return getTeamScheduleData(getCurrentLdap(), dateKey);
}

function clientGetScheduleMonths() {
  return getAvailableScheduleMonths();
}
