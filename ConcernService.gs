// ============================================================
// ConcernService.gs — Backend for Submit Concerns module
// ============================================================

function submitConcern(concernData, ldap) {
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
  var role = getUserRole(currentUserLdap);
  var allConcerns = getSheetData('Concerns');

  if (role === 'manager') {
    return allConcerns;
  }

  if (role === 'supervisor') {
    return allConcerns.filter(function(c) {
      // Rule: Can see if submitter is direct report OR explicitly addressed to them
      var isDirectReport = managedLdaps && managedLdaps.indexOf(c.LDAP) !== -1;
      var isAddressedToMe = c.AddressedTo === currentUserLdap || c.AddressedTo === 'Both';
      return isDirectReport || isAddressedToMe;
    });
  }

  return []; // Agents shouldn't be calling this
}

function notifyLeadershipOfConcern(id, data, agentLdap) {
  var addressedTo = data.addressedTo;
  var targets = [];

  if (addressedTo === 'Both') {
    // Notify team lead and all managers
    var agent = findRow('Agents', 'LDAP', agentLdap);
    if (agent && agent.TeamLead) targets.push(agent.TeamLead);

    var managers = getSheetData('Managers').filter(function(m) { return m.Role === 'manager'; });
    managers.forEach(function(m) { targets.push(m.LDAP); });
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
    return {
      ldap: m.LDAP,
      role: m.Role,
      displayName: formatDisplayName(m.LDAP)
    };
  });
}
