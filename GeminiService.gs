// ============================================================
// GeminiService.gs — Groq AI coaching for CSAT Dashboard
// ============================================================

var GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
var GROQ_MODEL   = 'llama-3.3-70b-versatile';

function getGroqApiKey() {
  return PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');
}

function callGroq(prompt) {
  var apiKey = getGroqApiKey();
  if (!apiKey) throw new Error('Groq API key not configured.');

  var payload = {
    model: GROQ_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a Google Play Operations coaching assistant. Be encouraging, specific, and actionable.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    max_tokens: 1024,
    temperature: 0.7
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(GROQ_API_URL, options);
  var json = JSON.parse(response.getContentText());
  if (json.error) throw new Error(json.error.message);
  return json.choices[0].message.content;
}

// ── AGENT COACHING ───────────────────────────────────────────
function getAgentCsatCoaching(ldap, month) {
  var data = getMyCsatData(ldap, month);
  if (!data || !data.hasData) {
    return { success: false, error: 'No CSAT data available for this agent.' };
  }

  var prompt =
    'You are a Google Play Operations team leader providing coaching to a customer support agent. ' +
    'Be encouraging, specific, and actionable. Use a warm but professional tone. ' +
    'Format your response in clear sections using these exact headers:\n' +
    '## Performance Summary\n' +
    '## What You Are Doing Well\n' +
    '## Areas to Focus On\n' +
    '## Your Coaching Plan This Month\n' +
    '## Quick Wins for Next Week\n\n' +
    'Here is the agent data for ' + data.month + ':\n' +
    'Agent: ' + (data.displayName || ldap) + '\n' +
    'Overall CSAT: ' + (data.overall !== null ? data.overall + '%' : 'No data') + '\n' +
    'Chat CSAT: ' + (data.chat !== null ? data.chat + '% (' + data.chatResponses + ' responses)' : 'No data') + '\n' +
    'Phone CSAT: ' + (data.phone !== null ? data.phone + '% (' + data.phoneResponses + ' responses)' : 'No data') + '\n' +
    'Email CSAT: ' + (data.email !== null ? data.email + '% (' + data.emailResponses + ' responses)' : 'No data') + '\n' +
    'CSAT count: ' + data.csatCount + '\n' +
    'DSAT count: ' + data.dsatCount + '\n' +
    'Total surveyed: ' + data.totalSurveyed + '\n' +
    'Team rank: ' + (data.teamRank ? '#' + data.teamRank + ' of ' + data.teamSize : 'N/A') + '\n' +
    'Status: ' + (data.status || 'unknown') + '\n' +
    'Month-over-month overall delta: ' + (data.delta && data.delta.overall !== null ? data.delta.overall + 'pp' : 'N/A') + '\n' +
    'Top DSAT themes: ' + (data.dsatThemes && data.dsatThemes.length > 0
      ? data.dsatThemes.map(function(t) { return t.symptom + ' (' + t.count + ')'; }).join(', ')
      : 'None') + '\n' +
    'Cases resolution rate: ' + (data.casesResolutionRate !== null ? data.casesResolutionRate + '%' : 'N/A') + '\n' +
    'Repeat contact rate: ' + (data.repeatContactRate !== null ? data.repeatContactRate + '%' : 'N/A') + '\n\n' +
    'Provide specific, actionable coaching based on this data. ' +
    'If DSAT themes exist, address them directly with handling tips. ' +
    'Keep each section concise — 2 to 4 sentences or bullet points max.';

  try {
    var response = callGroq(prompt);
    return { success: true, coaching: response, agentName: data.displayName || ldap, month: data.month };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ── TEAM COACHING ────────────────────────────────────────────
function getTeamCsatCoaching(managerLdap, month) {
  var data = getTeamCsatData(managerLdap, month);
  if (!data || data.overall === null) {
    return { success: false, error: 'No team CSAT data available.' };
  }

  var agentSummary = (data.agents || []).map(function(a) {
    return a.displayName + ': ' + (a.overall !== null ? a.overall + '%' : 'no data') +
      ' (' + a.status + ')' +
      (a.dsatThemes && a.dsatThemes.length > 0
        ? ' — top DSAT: ' + a.dsatThemes[0].symptom
        : '');
  }).join('\n');

  var prompt =
    'You are a senior Google Play Operations manager reviewing your team\'s CSAT performance. ' +
    'Be data-driven, strategic, and actionable. Use a professional coaching tone. ' +
    'Format your response using these exact headers:\n' +
    '## Team Performance Summary\n' +
    '## Team Strengths\n' +
    '## Key Risk Areas\n' +
    '## Recommended Coaching Actions\n' +
    '## Focus for Next Month\n\n' +
    'Here is the team data for ' + data.month + ':\n' +
    'Team overall CSAT: ' + (data.overall !== null ? data.overall + '%' : 'No data') + '\n' +
    'Chat CSAT: ' + (data.chat !== null ? data.chat + '% (' + data.chatResponses + ' responses)' : 'No data') + '\n' +
    'Phone CSAT: ' + (data.phone !== null ? data.phone + '% (' + data.phoneResponses + ' responses)' : 'No data') + '\n' +
    'Email CSAT: ' + (data.email !== null ? data.email + '% (' + data.emailResponses + ' responses)' : 'No data') + '\n' +
    'Total surveys: ' + data.totalSurveyed + '\n' +
    'CSAT count: ' + data.csatCount + '\n' +
    'DSAT count: ' + data.dsatCount + '\n' +
    'Agents at risk: ' + data.atRiskCount + '\n' +
    'Month-over-month delta: ' + (data.delta && data.delta.overall !== null ? data.delta.overall + 'pp' : 'N/A') + '\n' +
    'Top team DSAT themes: ' + (data.topDsatThemes && data.topDsatThemes.length > 0
      ? data.topDsatThemes.map(function(t) { return t.symptom + ' (' + t.count + ')'; }).join(', ')
      : 'None') + '\n\n' +
    'Individual agent breakdown:\n' + agentSummary + '\n\n' +
    'Provide strategic team coaching. Name specific agents who need attention. ' +
    'Suggest concrete actions the manager can take this week. ' +
    'Keep each section to 3 to 5 bullet points max.';

  try {
    var response = callGroq(prompt);
    return { success: true, coaching: response, month: data.month };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ── TEST FUNCTION ─────────────────────────────────────────────
function testGroq() {
  try {
    var result = callGroq('Say hello in one sentence.');
    Logger.log('SUCCESS: ' + result);
  } catch(e) {
    Logger.log('ERROR: ' + e.message);
  }
}
