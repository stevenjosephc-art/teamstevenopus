// ============================================================
// ConcernService.gs — Backend for Submit Concerns module
// ============================================================

function ensureConcernsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Concerns');
  if (!sheet) {
    sheet = ss.insertSheet('Concerns');
    sheet.appendRow(['ID','Timestamp','LDAP','AddressedTo','Type','Nature','Status','Resolution']);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#4285F4').setFontColor('#FFFFFF');
  }
  return sheet;
}

function submitConcern(concernData, ldap) {
  ensureConcernsSheet();
  var id = generateId('Concerns', 'CONC');
  var timestamp = new Date();

  appendRow('Concerns', {
    ID: id,
    Timestamp: timestamp,
    LDAP: ldap,
    AddressedTo: concernData.addressedTo, // LDAP or "Both"
    Type: concernData.type,
    Nature: concernData.nature,
    Status: 'New',
    Resolution: ''
  });

  // Notify addressed parties
  notifyLeadershipOfConcern(id, concernData, ldap);

  return { success: true, id: id };
}

function getConcerns(managedLdaps, currentUserLdap) {
  ensureConcernsSheet();
  var role = getUserRole(currentUserLdap);
  var allConcerns = getSheetData('Concerns');
  var userLdap = (currentUserLdap || '').toLowerCase();
  var reports = (managedLdaps || []).map(function(l) { return l.toLowerCase(); });

  var filtered;
  if (role === 'manager') {
    filtered = allConcerns;
  } else if (role === 'supervisor') {
    filtered = allConcerns.filter(function(c) {
      var submitterLdap = (c.LDAP || '').toLowerCase();
      var addressedTo = (c.AddressedTo || '').toLowerCase();

      // Rule: Can see if submitter is direct report OR explicitly addressed to them
      var isDirectReport = reports.indexOf(submitterLdap) !== -1;
      var isAddressedToMe = addressedTo === userLdap || addressedTo === 'both';
      return isDirectReport || isAddressedToMe;
    });
  } else {
    return []; // Agents shouldn't be calling this
  }

  // Sanitize for client: Date objects cannot be passed via google.script.run
  // We explicitly convert any Date object or non-primitive to string to prevent serialization errors.
  var sanitized = filtered.map(function(c) {
    var item = {};
    for (var key in c) {
      var val = c[key];
      // Robust Date check
      if (val && Object.prototype.toString.call(val) === '[object Date]') {
        item[key] = val.toISOString();
      } else if (val !== null && typeof val === 'object') {
        // Fallback for any other objects
        item[key] = String(val);
      } else {
        item[key] = val;
      }
    }
    return item;
  });

  Logger.log('[Concerns] Returning ' + sanitized.length + ' concerns to client.');
  return sanitized;
}

function notifyLeadershipOfConcern(id, data, agentLdap) {
  var addressedTo = (data.addressedTo || '').toLowerCase();
  var agentLdapLower = (agentLdap || '').toLowerCase();
  var targets = [];

  if (addressedTo === 'both') {
    // Notify team lead and all managers
    var agent = findRow('Agents', 'LDAP', agentLdapLower);
    if (agent && agent.TeamLead) targets.push(agent.TeamLead.toLowerCase());

    var managers = getSheetData('Managers').filter(function(m) { return String(m.Role).toLowerCase() === 'manager'; });
    managers.forEach(function(m) { if (m.LDAP) targets.push(m.LDAP.toLowerCase()); });
  } else {
    targets.push(addressedTo);
  }

  // Deduplicate and filter empty
  targets = targets.filter(function(v, i, a) { return v && a.indexOf(v) === i; });

  var notifications = targets.map(function(ldap) {
    return {
      ldap: ldap,
      type: 'new_concern',
      message: 'New concern from ' + agentLdap + ': ' + data.type
    };
  });

  createNotifications(notifications);
}

function getLeadershipList() {
  var managers = getSheetData('Managers');
  return managers.map(function(m) {
    var ldap = (m.LDAP || '').toLowerCase();
    return {
      ldap: ldap,
      role: String(m.Role || '').toLowerCase(),
      displayName: formatDisplayName(ldap)
    };
  });
}

function updateConcern(id, updates) {
  var success = updateRow('Concerns', 'ID', id, updates);
  if (success && updates.Status) {
    var concern = findRow('Concerns', 'ID', id);
    if (concern && concern.LDAP) {
      createNotification(concern.LDAP, 'concern_update', 'Your concern (' + id + ') status was updated to: ' + updates.Status);
    }
  }
  return { success: success };
}
