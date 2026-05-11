// ============================================================
// MeritService.gs — Streaks, badges, demerits, expiry check
// Play Ops Store
// ============================================================

// ------------------------------------------------------------
// BADGE AWARDING
// ------------------------------------------------------------

// Awards a badge only if the agent doesn't already have it
function awardBadgeIfNew(ldap, badgeId) {
  var existing = findRows('Badges', 'LDAP', ldap);
  var alreadyHas = existing.some(function(b) { return b['BadgeID'] === badgeId; });
  if (alreadyHas) return false;

  var def = findRow('BadgeDefs', 'BadgeID', badgeId);
  if (!def) return false;

  appendRow('Badges', {
    LDAP: ldap,
    BadgeID: badgeId,
    BadgeName: def['BadgeName'],
    AwardedAt: now()
  });

  // Notify agent
  createNotification(ldap, 'badge', 'You earned the "' + def['BadgeName'] + '" badge!');
  Logger.log('[Badge] ' + ldap + ' awarded: ' + badgeId);
  return true;
}

// ------------------------------------------------------------
// BADGE EVALUATION — called after every completion/point event
// ------------------------------------------------------------

function evaluateBadges(ldap, context) {
  // context = { completionCount, isEarly, daysEarly, isAcknowledge, onTimeStreak }

  // First Blood — first task ever completed
  if (context.completionCount === 1) {
    awardBadgeIfNew(ldap, 'FIRST_BLOOD');
  }

  // First Acknowledge
  if (context.isAcknowledge && context.completionCount === 1) {
    awardBadgeIfNew(ldap, 'ACKNOWLEDGED');
  }

  // Speed Demon — 3+ days early
  if (context.isEarly && context.daysEarly >= 3) {
    awardBadgeIfNew(ldap, 'SPEED_DEMON');
  }

  // Perfectionist — 5 consecutive on-time
  if (context.onTimeStreak >= 5) {
    awardBadgeIfNew(ldap, 'PERFECTIONIST');
  }

  // Streak Master — 10 consecutive on-time
  if (context.onTimeStreak >= 10) {
    awardBadgeIfNew(ldap, 'STREAK_MASTER');
  }

  // Overachiever — 10+ tasks this month
  var monthlyCount = getMonthlyCompletionCount(ldap);
  if (monthlyCount >= 10) {
    awardBadgeIfNew(ldap, 'OVERACHIEVER');
  }

  // Kudos King/Queen — 3 validated kudos this month
  var monthlyKudos = getMonthlyKudosCount(ldap);
  if (monthlyKudos >= 3) {
    awardBadgeIfNew(ldap, 'KUDOS_KING');
  }
}

// ------------------------------------------------------------
// STREAK MANAGEMENT
// ------------------------------------------------------------

function updateStreak(ldap, wasOnTime) {
  ensureLeaderboardRow(ldap);
  var row = findRow('Leaderboard', 'LDAP', ldap);
  if (!row) return 0;

  var current = parseInt(row['CurrentStreak']) || 0;
  var best = parseInt(row['BestStreak']) || 0;

  if (wasOnTime) {
    current += 1;
  } else {
    current = 0; // broken streak
  }

  if (current > best) best = current;

  var bonus = 0;
  var bonusMsg = '';
  if (wasOnTime) {
    if (current === 3) {
      bonus = parseInt(getConfig('Streak3Bonus')) || 15;
      bonusMsg = '3-task streak! +' + bonus + ' bonus points.';
    } else if (current === 5) {
      bonus = parseInt(getConfig('Streak5Bonus')) || 25;
      bonusMsg = '5-task streak! +' + bonus + ' bonus points.';
    } else if (current > 0 && current % 10 === 0) {
      bonus = parseInt(getConfig('Streak5Bonus')) || 25;
      bonusMsg = current + '-task streak! +' + bonus + ' bonus points.';
    }
  }

  if (bonus > 0) {
    var monthly = (row['MonthlyPoints'] || 0) + bonus;
    var allTime = (row['AllTimePoints'] || 0) + bonus;
    var tier = getTierForPoints(allTime);
    var prevTier = row['Tier'];

    updateRow('Leaderboard', 'LDAP', ldap, {
      CurrentStreak: current,
      BestStreak: best,
      MonthlyPoints: monthly,
      AllTimePoints: allTime,
      Tier: tier
    });

    createNotification(ldap, 'streak', bonusMsg);
    if (tier === 'Legend' && prevTier !== 'Legend') awardBadgeIfNew(ldap, 'LEGEND');
    checkComebackKid(ldap, prevTier, tier);
  } else {
    updateRow('Leaderboard', 'LDAP', ldap, {
      CurrentStreak: current,
      BestStreak: best
    });
  }

  return current;
}

// ------------------------------------------------------------
// DEMERIT HANDLING
// ------------------------------------------------------------

function addDemerit(demeritData, enteredBy) {
  var id = generateDemeritId();
  var timestamp = now();

  var points = resolveDemeritPoints(demeritData.type);

  appendRow('Demerits', {
    ID: id,
    Timestamp: timestamp,
    LDAP: demeritData.ldap,
    Type: demeritData.type,
    Details: demeritData.details || '',
    Points: points,
    EnteredBy: enteredBy,
    NotificationSent: false
  });

  // Deduct points
  deductPoints(demeritData.ldap, Math.abs(points), 'Demerit: ' + demeritData.type);

  // Notify agent (in-app + email)
  var message = 'A demerit was added to your record: ' + demeritData.type + ' (' + points + ' pts). Details: ' + (demeritData.details || 'N/A');
  createNotification(demeritData.ldap, 'demerit', message);
  sendDemeritEmail(demeritData.ldap, demeritData.type, demeritData.details, points);

  // Mark notification sent
  updateRow('Demerits', 'ID', id, { NotificationSent: true });

  // Check Clean Slate badge eligibility will be done at monthly reset
  invalidateCache(['leaderboard_agent', 'leaderboard_manager', 'team_analytics']);
  Logger.log('[Demerit] ' + demeritData.ldap + ' | ' + demeritData.type + ' | ' + points + ' pts');
  return { success: true, id: id, points: points };
}

function onDemeritRowAdded(row) {
  // Called from onEdit trigger when a new row appears in Demerits sheet
  var sheet = getSheet('Demerits');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var rowData = data[row - 1];

  var obj = {};
  headers.forEach(function(h, i) { obj[h] = rowData[i]; });

  if (!obj['LDAP'] || obj['NotificationSent'] === true) return;

  var points = obj['Points'] || resolveDemeritPoints(obj['Type']);
  var message = 'A demerit was added to your record: ' + obj['Type'] + ' (' + points + ' pts).';
  createNotification(obj['LDAP'], 'demerit', message);
  sendDemeritEmail(obj['LDAP'], obj['Type'], obj['Details'], points);
  sheet.getRange(row, headers.indexOf('NotificationSent') + 1).setValue(true);
}

function resolveDemeritPoints(type) {
  var map = {
    'RTA': parseInt(getConfig('PointsRTA')) || -20,
    'QA Markdown': parseInt(getConfig('PointsQAMarkdown')) || -15,
    'Missed Task': parseInt(getConfig('PointsMissedTask')) || -10,
    'Abandoned Task': parseInt(getConfig('PointsAbandonedTask')) || -5
  };
  return map[type] || -10;
}

// ------------------------------------------------------------
// CLEAN SLATE BADGE — checked at monthly reset
// ------------------------------------------------------------

function checkCleanSlateBadge(ldap, month) {
  // Check if agent had zero demerits in the given month
  var demerits = findRows('Demerits', 'LDAP', ldap);
  var monthStart = getMonthStart(month);
  var monthEnd = getMonthEnd(month);

  var hasDemerits = demerits.some(function(d) {
    var ts = new Date(d['Timestamp']);
    return ts >= monthStart && ts <= monthEnd;
  });

  if (!hasDemerits) {
    awardBadgeIfNew(ldap, 'CLEAN_SLATE');
  }
}

// ------------------------------------------------------------
// NIGHTLY EXPIRY CHECK
// ------------------------------------------------------------

function runExpiryCheck() {
  var tasks = getSheetData('Tasks');
  var completions = getSheetData('Completions');
  var leaderboard = getSheetData('Leaderboard');

  var lbMap = {};
  leaderboard.forEach(function(r) { lbMap[r.LDAP] = r; });

  var rightNow = now();
  var missedPoints = Math.abs(parseInt(getConfig('PointsMissedTask')) || -10);

  var taskUpdates = {};
  var completionUpdates = {};
  var lbUpdates = {};
  var notifications = [];

  tasks.forEach(function(task) {
    if (task['Status'] === 'Expired' || task['Status'] === 'Completed') return;
    if (!task['Deadline']) return;

    var deadline = new Date(task['Deadline']);
    if (deadline >= rightNow) return; // not expired yet

    var taskId = task['ID'];

    // Find claimed-but-uncompleted entries for this task
    var claimedEntries = completions.filter(function(c) {
      return c['TaskID'] === taskId && c['ClaimedAt'] && !c['CompletedAt'];
    });

    if (claimedEntries.length > 0) {
      claimedEntries.forEach(function(c) {
        completionUpdates[c['ID']] = { CompletedAt: '', Type: 'Missed' };

        var ldap = c['LDAP'];
        var lbRow = lbMap[ldap];
        if (lbRow) {
          var currentMonthly = lbUpdates[ldap] ? lbUpdates[ldap].MonthlyPoints : (lbRow.MonthlyPoints || 0);
          lbUpdates[ldap] = {
            MonthlyPoints: applyPointsFloor(currentMonthly - missedPoints),
            CurrentStreak: 0
          };
        }

        notifications.push({
          ldap: ldap,
          type: 'missed',
          message: 'You missed the deadline for task: ' + task['Title'] + '. ' + (-missedPoints) + ' pts deducted.'
        });
        Logger.log('[Expiry] Missed: ' + ldap + ' | Task: ' + taskId);
      });
      taskUpdates[taskId] = { Status: 'Expired' };

    } else {
      // Published or Claimed but no completion row — just expire
      taskUpdates[taskId] = { Status: 'Expired' };
      if (task['Status'] === 'Published') {
        Logger.log('[Expiry] Unclaimed expired: ' + taskId);
      }
    }
  });

  if (Object.keys(taskUpdates).length > 0) batchUpdateRows('Tasks', 'ID', taskUpdates);
  if (Object.keys(completionUpdates).length > 0) batchUpdateRows('Completions', 'ID', completionUpdates);
  if (Object.keys(lbUpdates).length > 0) batchUpdateRows('Leaderboard', 'LDAP', lbUpdates);
  if (notifications.length > 0) createNotifications(notifications);

  SpreadsheetApp.flush();
  invalidateCache(['leaderboard_agent', 'leaderboard_manager', 'team_analytics']);
  Logger.log('[Expiry Check] Done at ' + formatDateTime(rightNow));
}

// ------------------------------------------------------------
// HELPER: Monthly counts
// ------------------------------------------------------------

function getMonthlyCompletionCount(ldap) {
  var completions = findRows('Completions', 'LDAP', ldap);
  var now = new Date();
  return completions.filter(function(c) {
    if (!c['CompletedAt']) return false;
    var d = new Date(c['CompletedAt']);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
}

function getMonthlyKudosCount(ldap) {
  var kudos = findRows('Kudos', 'LDAP', ldap).filter(function(k) {
    return k['Status'] === 'Approved';
  });
  var now = new Date();
  return kudos.filter(function(k) {
    if (!k['ReviewedAt']) return false;
    var d = new Date(k['ReviewedAt']);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
}

function getMonthStart(month) {
  // month = 'M/YYYY'
  var parts = month.split('/');
  return new Date(parseInt(parts[1]), parseInt(parts[0]) - 1, 1);
}

function getMonthEnd(month) {
  var parts = month.split('/');
  var d = new Date(parseInt(parts[1]), parseInt(parts[0]), 0); // day 0 = last day of previous month
  return d;
}
