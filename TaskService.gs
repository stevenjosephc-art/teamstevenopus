// ============================================================
// TaskService.gs — Task CRUD, claim, complete, acknowledge,
//                  search, homepage feed
// Play Ops Store
// ============================================================

// ------------------------------------------------------------
// CREATE TASK (manager only)
// ------------------------------------------------------------

function createTask(taskData, createdBy) {
  var id = generateTaskId();
  var createdAt = now();

  appendRow('Tasks', {
    ID: id,
    Title: taskData.title,
    Description: taskData.description || '',
    Category: taskData.category || 'General',
    TargetType: taskData.targetType || 'team',   // 'team', 'specific', 'group'
    TargetValue: taskData.targetValue || '',      // LDAP or group name
    Deadline: taskData.deadline ? new Date(taskData.deadline) : '',
    BasePoints: taskData.basePoints || 10,
    Difficulty: taskData.difficulty || 'Easy',
    EarlyBonusRate: taskData.earlyBonusRate || '',
    Status: 'Published',
    CreatedBy: createdBy,
    CreatedAt: createdAt,
    IsFeatured: taskData.isFeatured || false
  });

  // Notify targeted agents
  notifyNewTask(id, taskData);

  Logger.log('[Task Created] ' + id + ' by ' + createdBy);
  return { success: true, taskId: id };
}

// ------------------------------------------------------------
// UPDATE TASK (manager only)
// ------------------------------------------------------------

function updateTask(taskId, taskData, updatedBy) {
  var task = findRow('Tasks', 'ID', taskId);
  if (!task) return { success: false, error: 'Task not found.' };

  var updates = {};
  if (taskData.title !== undefined)       updates['Title'] = taskData.title;
  if (taskData.description !== undefined) updates['Description'] = taskData.description;
  if (taskData.category !== undefined)    updates['Category'] = taskData.category;
  if (taskData.deadline !== undefined)    updates['Deadline'] = new Date(taskData.deadline);
  if (taskData.basePoints !== undefined)  updates['BasePoints'] = taskData.basePoints;
  if (taskData.difficulty !== undefined)  updates['Difficulty'] = taskData.difficulty;
  if (taskData.isFeatured !== undefined)  updates['IsFeatured'] = taskData.isFeatured;
  if (taskData.status !== undefined)      updates['Status'] = taskData.status;

  updateRow('Tasks', 'ID', taskId, updates);
  Logger.log('[Task Updated] ' + taskId + ' by ' + updatedBy);
  return { success: true };
}

// ------------------------------------------------------------
// GET ALL TASKS (manager task manager view)
// ------------------------------------------------------------

function getAllTasksForManager() {
  var tasks = getSheetData('Tasks');
  var allCompletions = getSheetData('Completions');

  // Group completions by TaskID once, instead of scanning full sheet per task
  var completionsByTask = {};
  allCompletions.forEach(function(c) {
    var tid = c['TaskID'];
    if (!completionsByTask[tid]) completionsByTask[tid] = [];
    completionsByTask[tid].push(c);
  });

  return tasks.map(function(t) {
    var completions = completionsByTask[t['ID']] || [];
    return {
      id: t['ID'],
      title: t['Title'],
      category: t['Category'],
      targetType: t['TargetType'],
      targetValue: t['TargetValue'],
      deadline: formatDate(t['Deadline']),
      basePoints: t['BasePoints'],
      difficulty: t['Difficulty'],
      status: t['Status'],
      isFeatured: t['IsFeatured'],
      createdBy: t['CreatedBy'],
      createdAt: formatDate(t['CreatedAt']),
      completionCount: completions.filter(function(c) { return c['CompletedAt']; }).length,
      claimCount: completions.length
    };
  });
}

// ------------------------------------------------------------
// HOMEPAGE FEED
// ------------------------------------------------------------

function getHomepageTasks(ldap) {
  var allTasks = getSheetData('Tasks');
  var myCompletions = findRows('Completions', 'LDAP', ldap);
  var completedTaskIds = myCompletions
    .filter(function(c) { return c['CompletedAt']; })
    .map(function(c) { return c['TaskID']; });
  var claimedTaskIds = myCompletions
    .filter(function(c) { return c['ClaimedAt'] && !c['CompletedAt']; })
    .map(function(c) { return c['TaskID']; });

  // Filter to tasks visible to this agent
  var visible = allTasks.filter(function(t) {
    return isTaskVisibleTo(t, ldap) && t['Status'] !== 'Expired';
  });

  // Enrich each task with agent-specific status
  var enriched = visible.map(function(t) {
    return enrichTask(t, ldap, completedTaskIds, claimedTaskIds);
  });

  var rightNow = now();

  // Featured / pinned
  var featured = enriched.filter(function(t) {
    return t.isFeatured && t.status !== 'Expired';
  }).slice(0, 3);

  // For You — targeted specifically at this agent
  var forYou = enriched.filter(function(t) {
    return (t.targetType === 'specific' && t.targetValue === ldap) && t.agentStatus === 'Available';
  });

  // New This Week
  var oneWeekAgo = new Date(rightNow - 7 * 24 * 60 * 60 * 1000);
  var newThisWeek = enriched.filter(function(t) {
    return new Date(t.createdAt) >= oneWeekAgo && t.agentStatus === 'Available';
  });

  // Closing Soon — expires within 48 hours
  var in48hrs = new Date(rightNow.getTime() + 48 * 60 * 60 * 1000);
  var closingSoon = enriched.filter(function(t) {
    if (!t.deadline) return false;
    var dl = new Date(t.deadline);
    return dl <= in48hrs && dl > rightNow && t.agentStatus !== 'Completed';
  });

  // Quick Wins — Easy difficulty
  var quickWins = enriched.filter(function(t) {
    return t.difficulty === 'Easy' && t.agentStatus === 'Available';
  });

  // ADDED: Grab all completed tasks before they get thrown out
  var completedTasks = enriched.filter(function(t) {
    return t.agentStatus === 'Completed';
  });

  return {
    featured: featured,
    forYou: forYou,
    newThisWeek: newThisWeek,
    closingSoon: closingSoon,
    quickWins: quickWins,
    completedTasks: completedTasks, // ADDED: Send to frontend
    categories: getTaskCategories(enriched)
  };
}

// ------------------------------------------------------------
// TASK DETAIL PAGE
// ------------------------------------------------------------

function getTaskDetail(taskId, ldap) {
  var task = findRow('Tasks', 'ID', taskId);
  if (!task) return null;

  if (!isTaskVisibleTo(task, ldap)) return null;

  var myCompletions = findRows('Completions', 'LDAP', ldap);
  var completedTaskIds = myCompletions.filter(function(c) { return c['CompletedAt']; }).map(function(c) { return c['TaskID']; });
  var claimedTaskIds = myCompletions.filter(function(c) { return c['ClaimedAt'] && !c['CompletedAt']; }).map(function(c) { return c['TaskID']; });

  var enriched = enrichTask(task, ldap, completedTaskIds, claimedTaskIds);

  // Team completion history (who else completed it)
  var allCompletions = findRows('Completions', 'TaskID', taskId).filter(function(c) { return c['CompletedAt']; });
  enriched.completionHistory = allCompletions.map(function(c) {
    return {
      ldap: c['LDAP'],
      displayName: formatDisplayName(c['LDAP']),
      completedAt: formatDate(c['CompletedAt']),
      totalPoints: c['TotalPoints'],
      photoUrl: getMomaPhotoUrl(c['LDAP'])
    };
  });

  // If claimed by this agent, add TAT info
  var myClaim = myCompletions.find(function(c) {
    return c['TaskID'] === taskId && c['ClaimedAt'] && !c['CompletedAt'];
  });
  if (myClaim) {
    enriched.claimedAt = formatDateTime(myClaim['ClaimedAt']);
    enriched.tatSoFar = calcTAT(myClaim['ClaimedAt'], now());
  }

  return enriched;
}

// ------------------------------------------------------------
// CLAIM TASK
// ------------------------------------------------------------

function claimTask(taskId, ldap) {
  var task = findRow('Tasks', 'ID', taskId);
  if (!task) return { success: false, error: 'Task not found.' };
  if (!isTaskVisibleTo(task, ldap)) return { success: false, error: 'Task not available to you.' };
  if (task['Status'] === 'Expired') return { success: false, error: 'This task has expired.' };
  if (isExpired(task['Deadline'])) return { success: false, error: 'This task deadline has passed.' };

  // Check if already claimed by this agent
  var existing = findRows('Completions', 'TaskID', taskId).find(function(c) {
    return c['LDAP'] === ldap && c['ClaimedAt'];
  });
  if (existing) return { success: false, error: 'You have already claimed this task.' };
  // --- NEW: TASK HOARDING LIMIT ---
  var myActiveClaims = findRows('Completions', 'LDAP', ldap).filter(function(c) {
    return c['ClaimedAt'] && !c['CompletedAt']; // Task is claimed but not yet completed
  });
  
  if (myActiveClaims.length >= 3) {
    return { success: false, error: 'Limit reached: You already have 3 active claims. Complete them to unlock more!' };
  }
  // --------------------------------

  var compId = generateCompletionId();
  var claimedAt = now();

  appendRow('Completions', {
    ID: compId,
    TaskID: taskId,
    LDAP: ldap,
    ClaimedAt: claimedAt,
    CompletedAt: '',
    TAT: '',
    BasePoints: task['BasePoints'],
    BonusPoints: '',
    TotalPoints: '',
    IsFirst: '',
    IsEarly: '',
    Type: 'Claimed'
  });

  // Update task status (for specific/group tasks)
  if (task['TargetType'] === 'specific') {
    updateRow('Tasks', 'ID', taskId, { Status: 'Claimed' });
  }

  // Notify agent
  var deadlineStr = task['Deadline'] ? formatDate(task['Deadline']) : 'No deadline';
  createNotification(ldap, 'claimed', 'You claimed "' + task['Title'] + '" — deadline: ' + deadlineStr);
  sendTaskClaimedEmail(ldap, task, claimedAt);

  // Expiry warning (24hr) — scheduled via notification, actual check in nightly trigger
  Logger.log('[Claimed] ' + ldap + ' | Task: ' + taskId);
  return { success: true, compId: compId, claimedAt: formatDateTime(claimedAt) };
}

// ------------------------------------------------------------
// COMPLETE TASK
// ------------------------------------------------------------

function completeTask(taskId, ldap) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // Wait up to 10 seconds for other clicks to process
  
  try {
    var task = findRow('Tasks', 'ID', taskId);
    if (!task) return { success: false, error: 'Task not found.' };

  // Find the claim row
  var claimRow = findRows('Completions', 'TaskID', taskId).find(function(c) {
    return c['LDAP'] === ldap && c['ClaimedAt'] && !c['CompletedAt'];
  });
  if (!claimRow) return { success: false, error: 'You have not claimed this task.' };

  var completedAt = now();
  var tat = calcTAT(claimRow['ClaimedAt'], completedAt);
  var basePoints = parseInt(task['BasePoints']) || 10;
  var bonusPoints = calcEarlyBonus(basePoints, completedAt, task['Deadline']);
  var days = daysEarly(completedAt, task['Deadline']);
  var isEarly = days > 0;
  var isOnTime = !isExpired(task['Deadline']);

  // First to complete bonus
  var allDone = findRows('Completions', 'TaskID', taskId).filter(function(c) { return c['CompletedAt']; });
  var isFirst = allDone.length === 0;
  if (isFirst) {
    bonusPoints += parseInt(getConfig('PointsFirstToComplete')) || 10;
  }

  var totalPoints = basePoints + bonusPoints;

  // Update completion row
  updateRow('Completions', 'ID', claimRow['ID'], {
    CompletedAt: completedAt,
    TAT: tat,
    BonusPoints: bonusPoints,
    TotalPoints: totalPoints,
    IsFirst: isFirst,
    IsEarly: isEarly,
    Type: isOnTime ? 'Completed' : 'Late'
  });

  // Update task status for specific tasks
  if (task['TargetType'] === 'specific') {
    updateRow('Tasks', 'ID', taskId, { Status: 'Completed' });
  }

  // Award points
  addPoints(ldap, totalPoints, 'Task completed: ' + taskId);

  // Update streak
  var streak = updateStreak(ldap, isOnTime);

  // Evaluate badges
  var totalCompletions = findRows('Completions', 'LDAP', ldap).filter(function(c) { return c['CompletedAt']; }).length;
  evaluateBadges(ldap, {
    completionCount: totalCompletions,
    isEarly: isEarly,
    daysEarly: days,
    isAcknowledge: false,
    onTimeStreak: streak
  });

  // Notify agent
  var msg = 'You completed "' + task['Title'] + '" — ' + totalPoints + ' pts awarded';
  if (isFirst) msg += ' (First to complete! +' + getConfig('PointsFirstToComplete') + ' bonus)';
  if (isEarly) msg += ' (Early bonus: +' + bonusPoints + ')';
  createNotification(ldap, 'completed', msg);
  sendTaskCompletedEmail(ldap, task, totalPoints, bonusPoints, isFirst);

  Logger.log('[Completed] ' + ldap + ' | Task: ' + taskId + ' | Points: ' + totalPoints);
  return {
      success: true,
      totalPoints: totalPoints,
      basePoints: basePoints,
      bonusPoints: bonusPoints,
      isFirst: isFirst,
      isEarly: isEarly,
      tat: tat,
      streak: streak
    };
  } finally {
    lock.releaseLock(); // Release the queue for the next agent
  }
}

// ------------------------------------------------------------
// ACKNOWLEDGE ANNOUNCEMENT
// ------------------------------------------------------------

function acknowledgeTask(taskId, ldap) {
  var task = findRow('Tasks', 'ID', taskId);
  if (!task) return { success: false, error: 'Task not found.' };
  if (task['TargetType'] !== 'announcement') return { success: false, error: 'This task is not an announcement.' };

  // Check if already acknowledged
  var existing = findRows('Completions', 'TaskID', taskId).find(function(c) {
    return c['LDAP'] === ldap && c['CompletedAt'];
  });
  if (existing) return { success: false, error: 'Already acknowledged.' };

  var compId = generateCompletionId();
  var completedAt = now();
  var basePoints = parseInt(task['BasePoints']) || 5;

  appendRow('Completions', {
    ID: compId,
    TaskID: taskId,
    LDAP: ldap,
    ClaimedAt: completedAt,
    CompletedAt: completedAt,
    TAT: 0,
    BasePoints: basePoints,
    BonusPoints: 0,
    TotalPoints: basePoints,
    IsFirst: false,
    IsEarly: false,
    Type: 'Acknowledged'
  });

  addPoints(ldap, basePoints, 'Announcement acknowledged: ' + taskId);

  // Badge check
  var totalAck = findRows('Completions', 'LDAP', ldap).filter(function(c) {
    return c['Type'] === 'Acknowledged';
  }).length;
  if (totalAck === 1) {
    awardBadgeIfNew(ldap, 'ACKNOWLEDGED');
  }

  createNotification(ldap, 'acknowledged', 'You acknowledged "' + task['Title'] + '" — ' + basePoints + ' pts awarded.');
  Logger.log('[Acknowledged] ' + ldap + ' | Task: ' + taskId);
  return { success: true, points: basePoints };
}

// ------------------------------------------------------------
// SEARCH TASKS
// ------------------------------------------------------------

function searchTasks(query, ldap) {
  if (!query || query.trim() === '') return [];
  var q = query.toLowerCase();

  var allTasks = getSheetData('Tasks');
  var myCompletions = findRows('Completions', 'LDAP', ldap);
  var completedTaskIds = myCompletions.filter(function(c) { return c['CompletedAt']; }).map(function(c) { return c['TaskID']; });
  var claimedTaskIds = myCompletions.filter(function(c) { return c['ClaimedAt'] && !c['CompletedAt']; }).map(function(c) { return c['TaskID']; });

  return allTasks
    .filter(function(t) {
      return isTaskVisibleTo(t, ldap) &&
        t['Status'] !== 'Expired' &&
        (t['Title'].toLowerCase().indexOf(q) !== -1 ||
         t['Description'].toLowerCase().indexOf(q) !== -1 ||
         t['Category'].toLowerCase().indexOf(q) !== -1);
    })
    .map(function(t) {
      return enrichTask(t, ldap, completedTaskIds, claimedTaskIds);
    });
}

// ------------------------------------------------------------
// TASK VISIBILITY CHECK
// ------------------------------------------------------------

function isTaskVisibleTo(task, ldap) {
  var type = task['TargetType'];
  if (type === 'team') return true;
  if (type === 'announcement') {
    // Only visible if not already acknowledged
    var existing = findRows('Completions', 'TaskID', task['ID']).find(function(c) {
      return c['LDAP'] === ldap && c['CompletedAt'];
    });
    return !existing;
  }
  if (type === 'specific') return task['TargetValue'] === ldap;
  if (type === 'group') {
    // Force both targets and agent data to lowercase for flawless matching
    var targets = task['TargetValue'].split(',').map(function(s) { return s.trim().toLowerCase(); });
    if (targets.indexOf(ldap.toLowerCase()) !== -1) return true;
    
    var agent = findRow('Agents', 'LDAP', ldap);
    return agent && agent['Workgroup'] && targets.indexOf(agent['Workgroup'].toLowerCase()) !== -1;
  }
  return false;
}

// ------------------------------------------------------------
// TASK ENRICHMENT (adds agent-specific status + display fields)
// ------------------------------------------------------------

function enrichTask(task, ldap, completedTaskIds, claimedTaskIds) {
  var taskId = task['ID'];
  var agentStatus = 'Available';
  if (completedTaskIds.indexOf(taskId) !== -1) agentStatus = 'Completed';
  else if (claimedTaskIds.indexOf(taskId) !== -1) agentStatus = 'In Progress';

  var deadline = task['Deadline'] ? new Date(task['Deadline']) : null;
  var hoursLeft = deadline ? hoursUntil(deadline) : null;
  var urgency = 'normal';
  if (hoursLeft !== null) {
    if (hoursLeft < 0) urgency = 'expired';
    else if (hoursLeft < 24) urgency = 'critical';
    else if (hoursLeft < 48) urgency = 'warning';
  }

  return {
    id: taskId,
    title: task['Title'],
    description: task['Description'],
    category: task['Category'],
    targetType: task['TargetType'],
    targetValue: task['TargetValue'],
    deadline: deadline ? formatDate(deadline) : null,
    deadlineRaw: deadline ? deadline.toISOString() : null,
    basePoints: parseInt(task['BasePoints']) || 0,
    difficulty: task['Difficulty'],
    status: task['Status'],
    isFeatured: task['IsFeatured'] === true || task['IsFeatured'] === 'TRUE',
    createdAt: task['CreatedAt'] ? new Date(task['CreatedAt']).toISOString() : null,
    agentStatus: agentStatus,
    urgency: urgency,
    hoursLeft: hoursLeft !== null ? Math.round(hoursLeft) : null
  };
}

// ------------------------------------------------------------
// CATEGORIES
// ------------------------------------------------------------

function getTaskCategories(enrichedTasks) {
  var cats = {};
  enrichedTasks.forEach(function(t) {
    if (t.category) cats[t.category] = (cats[t.category] || 0) + 1;
  });
  return Object.keys(cats).map(function(c) {
    return { name: c, count: cats[c] };
  }).sort(function(a, b) { return b.count - a.count; });
}

// ------------------------------------------------------------
// TASK NOTIFICATION HELPERS
// ------------------------------------------------------------

function notifyNewTask(taskId, taskData) {
  var type = taskData.targetType || 'team';
  var agents = [];

  if (type === 'team' || type === 'announcement') {
    agents = getSheetData('Agents').map(function(a) { return a['LDAP']; });
  } else if (type === 'specific') {
    agents = [taskData.targetValue];
  } else if (type === 'group') {
    var targets = taskData.targetValue.split(',').map(function(s) { return s.trim(); });
    var allAgents = getSheetData('Agents');
    agents = allAgents
      .filter(function(a) {
        return targets.indexOf(a['LDAP']) !== -1 || targets.indexOf(a['Workgroup']) !== -1;
      })
      .map(function(a) { return a['LDAP']; });
  }

  agents.forEach(function(ldap) {
    createNotification(ldap, 'new_task', 'New task available: "' + taskData.title + '" — ' + (taskData.basePoints || 10) + ' pts');
  });
}

// ------------------------------------------------------------
// EXPIRY WARNING NOTIFICATIONS (called from nightly trigger)
// ------------------------------------------------------------

function sendExpiryWarnings() {
  var completions = getSheetData('Completions');
  var tasks = getSheetData('Tasks');

  completions.forEach(function(c) {
    if (!c['ClaimedAt'] || c['CompletedAt']) return;

    var task = tasks.find(function(t) { return t['ID'] === c['TaskID']; });
    if (!task || !task['Deadline']) return;

    var hrs = hoursUntil(task['Deadline']);
    if (hrs > 0 && hrs <= 24) {
      // Check we haven't already warned them
      var alreadyWarned = findRows('Notifications', 'LDAP', c['LDAP']).some(function(n) {
        return n['Type'] === 'expiry_warning' && n['Message'].indexOf(c['TaskID']) !== -1;
      });
      if (!alreadyWarned) {
        createNotification(c['LDAP'], 'expiry_warning',
          '"' + task['Title'] + '" expires in ' + Math.round(hrs) + ' hours! Complete it now.');
      }
    }
  });
}
// ------------------------------------------------------------
// TRACK MISSING AGENTS (Manager Only)
// ------------------------------------------------------------
function getPendingAgentsForTask(taskId) {
  var task = findRow('Tasks', 'ID', taskId);
  if (!task) return { success: false, error: 'Task not found' };

  var allAgents = getSheetData('Agents');
  var targetAgents = [];

  // 1. Determine who SHOULD complete this task
  var type = task['TargetType'];
  if (type === 'team' || type === 'announcement') {
    targetAgents = allAgents;
  } else if (type === 'specific') {
    var targetLdap = String(task['TargetValue']).trim().toLowerCase();
    targetAgents = allAgents.filter(function(a) { return String(a['LDAP']).toLowerCase() === targetLdap; });
  } else if (type === 'group') {
    var targets = String(task['TargetValue']).split(',').map(function(s) { return s.trim().toLowerCase(); });
    targetAgents = allAgents.filter(function(a) {
      // Force everything to lowercase to prevent matching errors
      var aLdap = String(a['LDAP']).toLowerCase();
      var aWorkgroup = a['Workgroup'] ? String(a['Workgroup']).toLowerCase() : '';
      var aTeamLead = a['TeamLead'] ? String(a['TeamLead']).toLowerCase() : '';
      
      return targets.indexOf(aLdap) !== -1 || 
             targets.indexOf(aWorkgroup) !== -1 || 
             targets.indexOf(aTeamLead) !== -1;
    });
  }

  // 2. Find who HAS completed it
  var completions = findRows('Completions', 'TaskID', taskId).filter(function(c) {
    // Strictly ensure they actually have a completion timestamp, not just a claim
    return c['CompletedAt'] && String(c['CompletedAt']).trim() !== '';
  });
  
  // Convert all completed LDAPs to lowercase for safe matching
  var completedLdaps = completions.map(function(c) { return String(c['LDAP']).trim().toLowerCase(); });

  // 3. Find the missing agents
  var pending = targetAgents.filter(function(a) {
    return completedLdaps.indexOf(String(a['LDAP']).trim().toLowerCase()) === -1;
  }).map(function(a) {
    // Fallback to LDAP if DisplayName is somehow blank in the DB
    var dName = a['DisplayName'] && a['DisplayName'] !== '' ? a['DisplayName'] : a['LDAP'];
    return { ldap: a['LDAP'], displayName: dName };
  });

  return { success: true, pending: pending, taskTitle: task['Title'] };
}
