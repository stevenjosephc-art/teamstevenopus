// ============================================================
// AgentService.gs — Access control, role checking, profiles
// Play Ops Store
// ============================================================

// ------------------------------------------------------------
// ROLE & ACCESS CONTROL
// ------------------------------------------------------------

// Returns 'manager', 'agent', or null (no access)
function getUserRole(ldap) {
  if (!ldap) return null;

  // Check Managers sheet first
  var manager = findRow('Managers', 'LDAP', ldap);
  if (manager) return 'manager';

  // Check Agents sheet
  var agent = findRow('Agents', 'LDAP', ldap);
  if (agent) return 'agent';

  return null;
}

function isManager(ldap) {
  return getUserRole(ldap) === 'manager';
}

function isAgent(ldap) {
  var role = getUserRole(ldap);
  return role === 'agent' || role === 'manager';
}

// ------------------------------------------------------------
// AGENT PROFILE — BASIC
// ------------------------------------------------------------

function getAgentProfile(ldap) {
  if (!ldap) return null;

  var agentRow = findRow('Agents', 'LDAP', ldap);
  var managerRow = findRow('Managers', 'LDAP', ldap);

  if (!agentRow && !managerRow) return null;

  var leaderboardRow = findRow('Leaderboard', 'LDAP', ldap);
  var tier = leaderboardRow ? leaderboardRow['Tier'] : 'Bronze';
  var monthlyPoints = leaderboardRow ? (leaderboardRow['MonthlyPoints'] || 0) : 0;
  var allTimePoints = leaderboardRow ? (leaderboardRow['AllTimePoints'] || 0) : 0;
  var currentStreak = leaderboardRow ? (leaderboardRow['CurrentStreak'] || 0) : 0;

  return {
    ldap: ldap,
    email: agentRow ? agentRow['Email'] : (managerRow ? managerRow['Email'] : ''),
    displayName: formatDisplayName(ldap),
    channel: agentRow ? agentRow['Channel'] : '',
    site: agentRow ? agentRow['Site'] : '',
    workgroup: agentRow ? agentRow['Workgroup'] : '',
    teamLead: agentRow ? agentRow['TeamLead'] : '',
    role: managerRow ? 'manager' : 'agent',
    tier: tier || 'Bronze',
    monthlyPoints: monthlyPoints,
    allTimePoints: allTimePoints,
    currentStreak: currentStreak,
    photoUrl: getMomaPhotoUrl(ldap)
  };
}

// ------------------------------------------------------------
// AGENT PROFILE — FULL (for profile page)
// ------------------------------------------------------------

function getAgentFullProfile(ldap, includeManagerData) {
  var base = getAgentProfile(ldap);
  if (!base) return null;

  // Badges
  var badgeRows = findRows('Badges', 'LDAP', ldap);
  var badges = badgeRows.map(function(b) {
    var def = findRow('BadgeDefs', 'BadgeID', b['BadgeID']);
    return {
      badgeId: b['BadgeID'],
      name: b['BadgeName'],
      awardedAt: formatDate(b['AwardedAt']),
      description: def ? def['Description'] : '',
      icon: def ? def['SVGIcon'] : ''
    };
  });

  // Completion history (last 20)
  var completions = findRows('Completions', 'LDAP', ldap);
  completions.sort(function(a, b) {
    return new Date(b['CompletedAt']) - new Date(a['CompletedAt']);
  });
  var recentCompletions = completions.slice(0, 20).map(function(c) {
    var task = findRow('Tasks', 'ID', c['TaskID']);
    return {
      taskId: c['TaskID'],
      taskTitle: task ? task['Title'] : c['TaskID'],
      completedAt: formatDate(c['CompletedAt']),
      totalPoints: c['TotalPoints'],
      isEarly: c['IsEarly'],
      tat: c['TAT'],
      type: c['Type']
    };
  });

  // Kudos history
  var kudosList = findRows('Kudos', 'LDAP', ldap).filter(function(k) {
    return k['Status'] === 'Approved';
  });

  // Demerits (for agent's own view or manager view)
  var demerits = [];
  if (includeManagerData) {
    var demeritRows = findRows('Demerits', 'LDAP', ldap);
    demeritRows.sort(function(a, b) {
      return new Date(b['Timestamp']) - new Date(a['Timestamp']);
    });
    demerits = demeritRows.map(function(d) {
      return {
        id: d['ID'],
        timestamp: formatDateTime(d['Timestamp']),
        type: d['Type'],
        details: d['Details'],
        points: d['Points'],
        enteredBy: d['EnteredBy']
      };
    });
  }

  // Leaderboard rank
  var rank = getAgentRank(ldap);

  var profile = Object.assign({}, base, {
    badges: badges,
    recentCompletions: recentCompletions,
    kudosCount: kudosList.length,
    tasksCompleted: completions.length,
    rank: rank
  });

  if (includeManagerData) {
    profile.demerits = demerits;
    profile.demeritCount = demerits.length;
    profile.demeritPoints = demerits.reduce(function(sum, d) {
      return sum + (parseInt(d.points) || 0);
    }, 0);
    profile.lastActive = recentCompletions.length > 0 ? recentCompletions[0].completedAt : 'No activity';
  }

  return profile;
}

// ------------------------------------------------------------
// ALL AGENTS (for manager views)
// ------------------------------------------------------------

function getAllAgents() {
  var agents = getSheetData('Agents');
  return agents.map(function(a) {
    return getAgentProfile(a['LDAP']);
  }).filter(Boolean);
}

// ------------------------------------------------------------
// LEADERBOARD RANK
// ------------------------------------------------------------

function getAgentRank(ldap) {
  var board = getSheetData('Leaderboard');
  board.sort(function(a, b) {
    return (b['MonthlyPoints'] || 0) - (a['MonthlyPoints'] || 0);
  });
  for (var i = 0; i < board.length; i++) {
    if (board[i]['LDAP'] === ldap) return i + 1;
  }
  return null;
}

// ------------------------------------------------------------
// LEADERBOARD
// ------------------------------------------------------------

function getLeaderboard(requestingLdap, role) {
  var cacheKey = 'leaderboard_' + role;
  var cached = getCached(cacheKey);
  if (cached) {
    // Re-apply isMe flag since it's user-specific
    cached.forEach(function(e) { e.isMe = e.ldap === requestingLdap; });
    return cached;
  }

  var board = getSheetData('Leaderboard');
  board.sort(function(a, b) {
    return (b['MonthlyPoints'] || 0) - (a['MonthlyPoints'] || 0);
  });

  // Load all sheets once if manager
  var allCompletions = [], allKudos = [], allDemerits = [];
  if (role === 'manager') {
    allCompletions = getSheetData('Completions');
    allKudos = getSheetData('Kudos');
    allDemerits = getSheetData('Demerits');
  }

  var result = board.map(function(row, index) {
    var entry = {
      rank: index + 1,
      ldap: row['LDAP'],
      displayName: formatDisplayName(row['LDAP']),
      tier: row['Tier'] || 'Bronze',
      monthlyPoints: row['MonthlyPoints'] || 0,
      allTimePoints: row['AllTimePoints'] || 0,
      currentStreak: row['CurrentStreak'] || 0,
      photoUrl: getMomaPhotoUrl(row['LDAP']),
      isMe: row['LDAP'] === requestingLdap
    };

    if (role === 'manager') {
      var ldap = row['LDAP'];
      var completions = allCompletions.filter(function(c) { return c['LDAP'] === ldap; });
      var kudos = allKudos.filter(function(k) { return k['LDAP'] === ldap && k['Status'] === 'Approved'; });
      var demerits = allDemerits.filter(function(d) { return d['LDAP'] === ldap; });
      var doneCompletions = completions.filter(function(c) { return c['CompletedAt']; });
      doneCompletions.sort(function(a, b) { return new Date(b['CompletedAt']) - new Date(a['CompletedAt']); });

      entry.tasksCompleted = doneCompletions.length;
      entry.kudosCount = kudos.length;
      entry.demeritCount = demerits.length;
      entry.lastActive = doneCompletions.length > 0 ? formatDate(doneCompletions[0]['CompletedAt']) : 'No activity';
    }

    return entry;
  });

  setCached(cacheKey, result, 300); // 5 minute TTL
  return result;
}

// ------------------------------------------------------------
// LEADERBOARD TIER CALCULATION
// ------------------------------------------------------------

// Called after every point event to recalculate tier
function recalculateTier(ldap) {
  var row = findRow('Leaderboard', 'LDAP', ldap);
  if (!row) return;

  var points = row['AllTimePoints'] || 0;
  var tier = getTierForPoints(points);

  // Check for Legend badge trigger
  var previousTier = row['Tier'];
  updateRow('Leaderboard', 'LDAP', ldap, { Tier: tier });

  if (tier === 'Legend' && previousTier !== 'Legend') {
    awardBadgeIfNew(ldap, 'LEGEND');
  }

  // Comeback Kid: Gold+ this month after Bronze last month
  checkComebackKid(ldap, previousTier, tier);
}

function getTierForPoints(allTimePoints) {
  if (allTimePoints >= 2000) return 'Legend';
  if (allTimePoints >= 1000) return 'Platinum';
  if (allTimePoints >= 500)  return 'Gold';
  if (allTimePoints >= 200)  return 'Silver';
  return 'Bronze';
}

function checkComebackKid(ldap, previousTier, currentTier) {
  var goldTiers = ['Gold', 'Platinum', 'Legend'];
  if (previousTier === 'Bronze' && goldTiers.indexOf(currentTier) !== -1) {
    awardBadgeIfNew(ldap, 'COMEBACK_KID');
  }
}

// ------------------------------------------------------------
// LEADERBOARD ROW INIT (called on first point event for agent)
// ------------------------------------------------------------

function ensureLeaderboardRow(ldap) {
  var existing = findRow('Leaderboard', 'LDAP', ldap);
  if (!existing) {
    var month = getCurrentMonth();
    appendRow('Leaderboard', {
      LDAP: ldap,
      Month: month,
      MonthlyPoints: 0,
      AllTimePoints: 0,
      CurrentStreak: 0,
      BestStreak: 0,
      Tier: 'Bronze'
    });
  }
}

function getCurrentMonth() {
  var d = new Date();
  return (d.getMonth() + 1) + '/' + d.getFullYear();
}

// ------------------------------------------------------------
// POINTS MANAGEMENT
// ------------------------------------------------------------

function addPoints(ldap, points, reason) {
  ensureLeaderboardRow(ldap);

  var row = findRow('Leaderboard', 'LDAP', ldap);
  if (!row) return;

  var newMonthly = applyPointsFloor((row['MonthlyPoints'] || 0) + points);
  // If points are negative (demerit), don't touch AllTimePoints. Lifetime XP only goes up!
  var newAllTime = points < 0 ? (row['AllTimePoints'] || 0) : Math.max(0, (row['AllTimePoints'] || 0) + points);
  
  updateRow('Leaderboard', 'LDAP', ldap, {
    MonthlyPoints: newMonthly,
    AllTimePoints: newAllTime
  });

  recalculateTier(ldap);
  invalidateCache(['leaderboard_agent', 'leaderboard_manager', 'team_analytics']);
  Logger.log('[Points] ' + ldap + ' | ' + (points > 0 ? '+' : '') + points + ' | ' + reason + ' | Monthly: ' + newMonthly + ' | AllTime: ' + newAllTime);
}

function deductPoints(ldap, points, reason) {
  // points should be negative or will be made negative here
  var deduction = points > 0 ? -points : points;
  addPoints(ldap, deduction, reason);
}

// ------------------------------------------------------------
// MONTHLY RESET
// ------------------------------------------------------------

function runMonthlyReset() {
  var agents = getSheetData('Agents');
  var month = getCurrentMonth();
  var prevMonth = getPreviousMonth();

  agents.forEach(function(a) {
    var ldap = a['LDAP'];
    ensureLeaderboardRow(ldap);
    checkVeteranBadge(ldap);
    checkCleanSlateBadge(ldap, prevMonth);
    updateRow('Leaderboard', 'LDAP', ldap, {
      MonthlyPoints: 0,
      Month: month
    });
  });

  Logger.log('[Monthly Reset] Completed for month: ' + month);
}

function checkVeteranBadge(ldap) {
  // Award Veteran badge if agent has completions in 3+ distinct months
  var completions = findRows('Completions', 'LDAP', ldap);
  var months = {};
  completions.forEach(function(c) {
    if (c['CompletedAt']) {
      var d = new Date(c['CompletedAt']);
      var key = d.getFullYear() + '-' + d.getMonth();
      months[key] = true;
    }
  });
  if (Object.keys(months).length >= 3) {
    awardBadgeIfNew(ldap, 'VETERAN');
  }
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
function updateAgentDisplayName(ldap, displayName) {
  if (!ldap || !displayName || displayName.trim() === '') {
    return { success: false, error: 'Display name cannot be empty.' };
  }
  var result = updateRow('Agents', 'LDAP', ldap, { DisplayName: displayName.trim() });
  if (!result) return { success: false, error: 'Agent not found.' };
  invalidateCache(['leaderboard_agent', 'leaderboard_manager', 'team_analytics']);
  Logger.log('[DisplayName] ' + ldap + ' updated to: ' + displayName.trim());
  return { success: true };
}

function formatDisplayName(ldap) {
  if (!ldap) return '';
  var agent = findRow('Agents', 'LDAP', ldap);
  if (agent && agent['DisplayName'] && agent['DisplayName'].trim() !== '') {
    return agent['DisplayName'].trim();
  }
  return ldap.toLowerCase();
}
function getPreviousMonth() {
  var d = new Date();
  d.setMonth(d.getMonth() - 1);
  return (d.getMonth() + 1) + '/' + d.getFullYear();
}
