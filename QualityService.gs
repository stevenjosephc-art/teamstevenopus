// ============================================================
// QualityService.gs — Aggregations and logic for Quality Audits
// Source: 'QualityAudits' tab in the same spreadsheet
// ============================================================

var QUALITY_SHEET_NAME = 'QualityAudits';

// ── SCHEMA MAPPING ────────────────────────────────────────────────────────

var Q_COLS = {
  CASE_ID: 0,            // A
  ENTITY_GROUP: 1,       // B
  AGENT_LDAP: 2,         // C
  OPENING_CHANNEL: 3,    // D
  REVIEW_DATE: 4,        // E
  REVIEW_WEEK: 5,        // F
  REVIEW_MONTH: 6,       // G
  CASE_DATE: 7,          // H
  CASE_WEEK: 8,          // I
  CASE_MONTH: 9,         // J
  CUSTOMER_CRITICAL: 10, // K
  BUSINESS_CRITICAL: 11, // L
  COMPLIANCE_CRITICAL: 12,// M
  REVIEWER_COMMENTS: 13, // N

  // Customer Critical Parameters (O-W)
  LISTENING: 14,
  PROBING: 15,
  COMPLETE_RESOLUTION: 16,
  TROUBLESHOOTING: 17,
  USER_EXPECTATIONS: 18,
  EMPATHY: 19,
  OWNERSHIP: 20,
  REFUNDS: 21,
  RESPONSIVENESS: 22,

  // Business Critical Parameters (X-AD)
  CONSULTS_ESCALATIONS: 23,
  CASE_DETAILS: 24,
  CATEGORIZATION: 25,
  CSAT_REMINDER: 26,
  CASE_STATE: 27,
  OPENING_CLOSING: 28,
  LANGUAGE_PROFICIENCY: 29,

  // Compliance Critical Parameters (AE-AH)
  AUTHENTICATION: 30,
  GOOGLE_ONLY_INFO: 31,
  PROFESSIONAL_CONDUCT: 32,
  PAYMENT_COMPLAINTS: 33,

  TEAM: 36,              // AK (index 36)
  AGENT_WORKFLOW: 37     // AL (index 37)
};

var Q_TARGETS = {
  CUSTOMER: 95,
  BUSINESS: 90,
  COMPLIANCE: 99.50
};

// ── DATA LOADING ──────────────────────────────────────────────────────────

function getRawQualityData() {
  var sheet = getSheet(QUALITY_SHEET_NAME);
  var raw = sheet.getDataRange().getValues();
  if (raw.length < 2) return [];

  // Skip header
  return raw.slice(1);
}

function getAvailableQualityMonths() {
  var rows = getRawQualityData();
  var seen = {};
  rows.forEach(function(r) {
    var month = r[Q_COLS.REVIEW_MONTH];
    if (month) {
      if (month instanceof Date) {
        month = Utilities.formatDate(month, Session.getScriptTimeZone(), 'yyyy-MM');
      }
      seen[month] = true;
    }
  });
  return Object.keys(seen).sort().reverse();
}

function normalizeQualityMonth(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  return String(val).trim();
}

function normalizeLdap(val) {
  if (!val) return '';
  return String(val).trim().toLowerCase().split('@')[0];
}

// ── AGGREGATION ───────────────────────────────────────────────────────────

function aggregateQualityRows(rows) {
  if (rows.length === 0) return null;

  var customerSum = 0;
  var businessSum = 0;
  var complianceSum = 0;

  var params = {};
  // Initialize param counters
  var paramCols = [
    'LISTENING', 'PROBING', 'COMPLETE_RESOLUTION', 'TROUBLESHOOTING', 'USER_EXPECTATIONS',
    'EMPATHY', 'OWNERSHIP', 'REFUNDS', 'RESPONSIVENESS',
    'CONSULTS_ESCALATIONS', 'CASE_DETAILS', 'CATEGORIZATION', 'CSAT_REMINDER', 'CASE_STATE',
    'OPENING_CLOSING', 'LANGUAGE_PROFICIENCY',
    'AUTHENTICATION', 'GOOGLE_ONLY_INFO', 'PROFESSIONAL_CONDUCT', 'PAYMENT_COMPLAINTS'
  ];

  paramCols.forEach(function(p) { params[p] = { yes: 0, total: 0 }; });

  rows.forEach(function(r) {
    customerSum += (parseFloat(r[Q_COLS.CUSTOMER_CRITICAL]) || 0);
    businessSum += (parseFloat(r[Q_COLS.BUSINESS_CRITICAL]) || 0);
    complianceSum += (parseFloat(r[Q_COLS.COMPLIANCE_CRITICAL]) || 0);

    paramCols.forEach(function(p) {
      var val = String(r[Q_COLS[p]]).trim().toLowerCase();
      if (val === 'yes' || val === 'no') {
        params[p].total++;
        if (val === 'yes') params[p].yes++;
      }
    });
  });

  var count = rows.length;

  var paramScores = {};
  paramCols.forEach(function(p) {
    paramScores[p] = params[p].total > 0 ? (params[p].yes / params[p].total) * 100 : null;
  });

  return {
    customer: (customerSum / count) * 100,
    business: (businessSum / count) * 100,
    compliance: (complianceSum / count) * 100,
    count: count,
    params: paramScores,
    targets: Q_TARGETS
  };
}

// ── VIEW DATA FETCHERS ────────────────────────────────────────────────────

function getMyQualityData(ldap, month) {
  var allRows = getRawQualityData();
  var filtered = allRows.filter(function(r) {
    return normalizeLdap(r[Q_COLS.AGENT_LDAP]) === normalizeLdap(ldap) &&
           normalizeQualityMonth(r[Q_COLS.REVIEW_MONTH]) === month;
  });

  var stats = aggregateQualityRows(filtered);

  var caseLog = filtered.map(function(r) {
    return {
      caseId: r[Q_COLS.CASE_ID],
      reviewDate: formatDate(r[Q_COLS.REVIEW_DATE]),
      customer: r[Q_COLS.CUSTOMER_CRITICAL],
      business: r[Q_COLS.BUSINESS_CRITICAL],
      compliance: r[Q_COLS.COMPLIANCE_CRITICAL],
      comments: r[Q_COLS.REVIEWER_COMMENTS],
      details: {
        customer: {
          listening: r[Q_COLS.LISTENING],
          probing: r[Q_COLS.PROBING],
          resolution: r[Q_COLS.COMPLETE_RESOLUTION],
          troubleshooting: r[Q_COLS.TROUBLESHOOTING],
          expectations: r[Q_COLS.USER_EXPECTATIONS],
          empathy: r[Q_COLS.EMPATHY],
          ownership: r[Q_COLS.OWNERSHIP],
          refunds: r[Q_COLS.REFUNDS],
          responsiveness: r[Q_COLS.RESPONSIVENESS]
        },
        business: {
          escalations: r[Q_COLS.CONSULTS_ESCALATIONS],
          details: r[Q_COLS.CASE_DETAILS],
          categorization: r[Q_COLS.CATEGORIZATION],
          csat: r[Q_COLS.CSAT_REMINDER],
          state: r[Q_COLS.CASE_STATE],
          opening: r[Q_COLS.OPENING_CLOSING],
          language: r[Q_COLS.LANGUAGE_PROFICIENCY]
        },
        compliance: {
          auth: r[Q_COLS.AUTHENTICATION],
          googleInfo: r[Q_COLS.GOOGLE_ONLY_INFO],
          conduct: r[Q_COLS.PROFESSIONAL_CONDUCT],
          payments: r[Q_COLS.PAYMENT_COMPLAINTS]
        }
      }
    };
  });

  return {
    ldap: ldap,
    month: month,
    stats: stats,
    caseLog: caseLog,
    hasData: filtered.length > 0
  };
}

function getTeamQualityData(managerLdap, month) {
  var managedLdaps = getManagedLdaps(managerLdap);
  var allRows = getRawQualityData();

  var teamRows = allRows.filter(function(r) {
    var agentLdap = normalizeLdap(r[Q_COLS.AGENT_LDAP]);
    return (managedLdaps === null || managedLdaps.indexOf(agentLdap) !== -1) &&
           normalizeQualityMonth(r[Q_COLS.REVIEW_MONTH]) === month;
  });

  var teamStats = aggregateQualityRows(teamRows);

  var agentStats = {};
  var uniqueLdaps = [];
  teamRows.forEach(function(r) {
    var ldap = normalizeLdap(r[Q_COLS.AGENT_LDAP]);
    if (!agentStats[ldap]) {
      agentStats[ldap] = [];
      uniqueLdaps.push(ldap);
    }
    agentStats[ldap].push(r);
  });

  var agents = uniqueLdaps.map(function(ldap) {
    var stats = aggregateQualityRows(agentStats[ldap]);
    return {
      ldap: ldap,
      displayName: formatDisplayName(ldap),
      stats: stats
    };
  }).sort(function(a, b) {
    // Sort by compliance then customer then business? Or just average.
    var avgA = (a.stats.customer + a.stats.business + a.stats.compliance) / 3;
    var avgB = (b.stats.customer + b.stats.business + b.stats.compliance) / 3;
    return avgB - avgA;
  });

  return {
    managerLdap: managerLdap,
    month: month,
    stats: teamStats,
    agents: agents,
    hasData: teamRows.length > 0
  };
}

function getAllTeamsQualityData(month) {
  var allRows = getRawQualityData();
  var monthRows = allRows.filter(function(r) {
    return normalizeQualityMonth(r[Q_COLS.REVIEW_MONTH]) === month;
  });

  var siteStats = aggregateQualityRows(monthRows);

  // Group by TeamLead (or Team column if reliable)
  // User said "Use the existing manager/supervisor mapping already established in the Managers and Agents sheets."
  // So I'll fetch all managers/supervisors and their teams.

  var managers = getSheetData('Managers');
  var teams = managers.filter(function(m) { return m.Role === 'manager' || m.Role === 'supervisor'; }).map(function(m) {
    var mLdap = normalizeLdap(m.LDAP);
    var managed = getManagedLdaps(mLdap);
    var teamRows = monthRows.filter(function(r) {
      var agentLdap = normalizeLdap(r[Q_COLS.AGENT_LDAP]);
      return (managed === null || managed.indexOf(agentLdap) !== -1);
    });

    return {
      managerLdap: mLdap,
      teamName: m.Team || ('Team ' + formatDisplayName(mLdap)),
      stats: aggregateQualityRows(teamRows),
      agentCount: managed ? managed.length : 0
    };
  }).filter(function(t) { return t.stats !== null; })
    .sort(function(a, b) {
      var avgA = (a.stats.customer + a.stats.business + a.stats.compliance) / 3;
      var avgB = (b.stats.customer + b.stats.business + b.stats.compliance) / 3;
      return avgB - avgA;
    });

  return {
    month: month,
    siteStats: siteStats,
    teams: teams
  };
}
