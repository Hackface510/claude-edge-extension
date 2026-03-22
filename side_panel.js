// side_panel.js - Full UI controller for all 5 panels

// Utility: send message to background service worker
function bgMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

// Utility: get current active tab
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Utility: format time
function formatTime(ts) {
  return new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Utility: simple markdown renderer
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
}

// ============================================================
// TAB NAVIGATION
// ============================================================
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + target).classList.add('active');
    document.getElementById('clearChatBtn').style.display = target === 'chat' ? '' : 'none';
    if (target === 'workflows') loadWorkflows();
    if (target === 'settings') loadSettings();
  });
});

// ============================================================
// CHAT PANEL
// ============================================================
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const includePageCtx = document.getElementById('includePageCtx');
const clearChatBtn = document.getElementById('clearChatBtn');

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
});

// Send on Enter (Shift+Enter for newline)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

sendBtn.addEventListener('click', sendMessage);
clearChatBtn.addEventListener('click', async () => {
  await bgMessage({ type: 'GET_WORKFLOWS' }); // dummy to ensure bg alive
  await chrome.storage.local.remove('claude_chat_history');
  chatMessages.innerHTML = '<div class="empty-state"><div class="icon">🤖</div><div>Chat cleared. Ask Claude anything!</div></div>';
});

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  appendMessage('user', text);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;

  const typingEl = appendTypingIndicator();

  try {
    const tab = await getActiveTab();
    let pageContent = null;
    let pageUrl = tab?.url || '';

    if (includePageCtx.checked && tab) {
      try {
        const info = await bgMessage({ type: 'GET_PAGE_CONTENT', tabId: tab.id });
        pageContent = info?.text || null;
      } catch { /* non-critical */ }
    }

    const response = await bgMessage({ type: 'CHAT', message: text, includePageContext: includePageCtx.checked && !!pageContent, pageContent, pageUrl });
    typingEl.remove();
    if (response?.success) {
      appendMessage('assistant', response.message);
    } else {
      appendMessage('assistant', 'Error: ' + (response?.error || 'Unknown error'));
    }
  } catch (err) {
    typingEl.remove();
    appendMessage('assistant', 'Error: ' + err.message);
  } finally {
    sendBtn.disabled = false;
  }
}

function appendMessage(role, content) {
  const empty = chatMessages.querySelector('.empty-state');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = 'message ' + role;
  div.innerHTML = '<div class="bubble">' + renderMarkdown(content) + '</div><div class="message-time">' + formatTime() + '</div>';
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function appendTypingIndicator() {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = '<div class="bubble ai-bg"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>';
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

// Context menu triggers
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'CONTEXT_MENU_SUMMARIZE') {
    chatInput.value = 'Please summarize this page for me.';
    includePageCtx.checked = true;
    sendMessage();
  } else if (msg.type === 'CONTEXT_MENU_EXPLAIN') {
    chatInput.value = 'Please explain this: ' + (msg.text || '');
    sendMessage();
  } else if (msg.type === 'CONTEXT_MENU_AUTOMATE') {
    document.querySelector('[data-tab="automate"]').click();
  }
});

// Load and display existing chat history on open
(async () => {
  try {
    const data = await chrome.storage.local.get('claude_chat_history');
    const history = data['claude_chat_history'] || [];
    if (history.length > 0) {
      chatMessages.innerHTML = '';
      history.forEach((msg) => appendMessage(msg.role, msg.content));
    }
  } catch { /* ignore */ }
})();

// ============================================================
// AUTOMATE PANEL
// ============================================================
const automateTask = document.getElementById('automateTask');
const automateBtn = document.getElementById('automateBtn');
const executeAllBtn = document.getElementById('executeAllBtn');
const automateError = document.getElementById('automateError');
const stepsList = document.getElementById('stepsList');
let automationSteps = [];

automateBtn.addEventListener('click', async () => {
  const task = automateTask.value.trim();
  if (!task) return;
  automateBtn.disabled = true;
  automateBtn.innerHTML = '<span class="spinner"></span> Generating...';
  automateError.style.display = 'none';
  stepsList.innerHTML = '';
  executeAllBtn.style.display = 'none';
  automationSteps = [];

  try {
    const tab = await getActiveTab();
    const response = await bgMessage({ type: 'AUTOMATE', task, tabId: tab?.id });
    if (response?.success && response.steps?.length) {
      automationSteps = response.steps;
      renderSteps(response.steps);
      executeAllBtn.style.display = '';
    } else {
      showAutomateError(response?.error || 'Could not generate steps. Try rephrasing your task.');
      if (response?.raw) {
        const rawEl = document.createElement('pre');
        rawEl.className = 'result-box';
        rawEl.style.marginTop = '8px';
        rawEl.textContent = response.raw;
        stepsList.appendChild(rawEl);
      }
    }
  } catch (err) {
    showAutomateError('Error: ' + err.message);
  } finally {
    automateBtn.disabled = false;
    automateBtn.textContent = 'Generate Steps';
  }
});

function renderSteps(steps) {
  stepsList.innerHTML = '';
  steps.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'step-item';
    div.id = 'step-' + i;
    div.innerHTML = '<div class="step-num">' + (i + 1) + '</div><div style="flex:1"><span class="step-action">' + step.action + '</span> ' + (step.description || '') + (step.selector ? ' <span style="color:var(--text-2);font-size:11px">(' + step.selector.substring(0, 30) + ')</span>' : '') + '</div><button class="btn btn-secondary" style="padding:4px 10px;font-size:11px" onclick="executeStep(' + i + ')">Run</button>';
    stepsList.appendChild(div);
  });
}

window.executeStep = async function (index) {
  const step = automationSteps[index];
  const el = document.getElementById('step-' + index);
  const btn = el.querySelector('button');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const tab = await getActiveTab();
    if (step.action === 'wait') {
      await new Promise((r) => setTimeout(r, parseInt(step.value || '1000')));
      el.classList.add('step-done');
    } else {
      const result = await bgMessage({ type: 'EXECUTE_STEP', step, tabId: tab?.id });
      if (result?.success && !result.result?.error) {
        el.classList.add('step-done');
      } else {
        el.classList.add('step-error');
        const err = document.createElement('div');
        err.style.cssText = 'font-size:11px;color:var(--error);margin-top:4px';
        err.textContent = result?.result?.error || result?.error || 'Step failed';
        el.appendChild(err);
      }
    }
  } catch (err) {
    el.classList.add('step-error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Done';
  }
};

executeAllBtn.addEventListener('click', async () => {
  executeAllBtn.disabled = true;
  for (let i = 0; i < automationSteps.length; i++) {
    await window.executeStep(i);
    await new Promise((r) => setTimeout(r, 300));
  }
  executeAllBtn.disabled = false;
});

function showAutomateError(msg) {
  automateError.textContent = msg;
  automateError.style.display = '';
}

// ============================================================
// WORKFLOWS PANEL
// ============================================================
const startRecordBtn = document.getElementById('startRecordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const recordDot = document.getElementById('recordDot');
const recordStatus = document.getElementById('recordStatus');
const recordingSteps = document.getElementById('recordingSteps');
const stepCount = document.getElementById('stepCount');
const liveSteps = document.getElementById('liveSteps');
const workflowName = document.getElementById('workflowName');
const saveWorkflowBtn = document.getElementById('saveWorkflowBtn');
const workflowList = document.getElementById('workflowList');
let currentRecordedSteps = [];

startRecordBtn.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' });
    if (resp?.success) {
      recordDot.classList.add('recording');
      recordStatus.textContent = 'Recording... Perform your actions';
      startRecordBtn.style.display = 'none';
      stopRecordBtn.style.display = '';
      currentRecordedSteps = [];
      liveSteps.innerHTML = '';
      stepCount.textContent = '0';
      recordingSteps.style.display = '';
      startStepPolling(tab.id);
    }
  } catch (err) {
    recordStatus.textContent = 'Error: ' + err.message;
  }
});

let pollingInterval = null;
function startStepPolling(tabId) {
  pollingInterval = setInterval(async () => {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING' });
      if (resp?.steps && resp.steps.length > currentRecordedSteps.length) {
        currentRecordedSteps = resp.steps;
        stepCount.textContent = currentRecordedSteps.length;
        liveSteps.innerHTML = currentRecordedSteps.map((s, i) => '<div class="step-item"><div class="step-num">' + (i+1) + '</div><div><span class="step-action">' + s.type + '</span> ' + s.description + '</div></div>').join('');
        await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
      }
    } catch { clearInterval(pollingInterval); }
  }, 2000);
}

stopRecordBtn.addEventListener('click', async () => {
  clearInterval(pollingInterval);
  try {
    const tab = await getActiveTab();
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' });
    currentRecordedSteps = resp?.steps || currentRecordedSteps;
    stepCount.textContent = currentRecordedSteps.length;
  } catch { /* use what we have */ }
  recordDot.classList.remove('recording');
  recordStatus.textContent = 'Recording stopped. ' + currentRecordedSteps.length + ' steps captured.';
  startRecordBtn.style.display = '';
  stopRecordBtn.style.display = 'none';
  liveSteps.innerHTML = currentRecordedSteps.map((s, i) => '<div class="step-item"><div class="step-num">' + (i+1) + '</div><div><span class="step-action">' + s.type + '</span> ' + s.description + '</div></div>').join('');
});

saveWorkflowBtn.addEventListener('click', async () => {
  const name = workflowName.value.trim();
  if (!name || currentRecordedSteps.length === 0) {
    alert('Please record some steps and give the workflow a name.');
    return;
  }
  await bgMessage({ type: 'SAVE_WORKFLOW', workflow: { id: 'wf_' + Date.now(), name, steps: currentRecordedSteps, stepCount: currentRecordedSteps.length } });
  workflowName.value = '';
  recordingSteps.style.display = 'none';
  recordStatus.textContent = 'Workflow "' + name + '" saved!';
  loadWorkflows();
});

async function loadWorkflows() {
  const resp = await bgMessage({ type: 'GET_WORKFLOWS' });
  const workflows = resp?.workflows || [];
  if (workflows.length === 0) {
    workflowList.innerHTML = '<div class="empty-state"><div class="icon">🔄</div><div>No saved workflows yet.<br>Record one above!</div></div>';
    return;
  }
  workflowList.innerHTML = workflows.map((wf) => '<div class="workflow-card"><div class="workflow-name">' + wf.name + '</div><div class="workflow-meta">' + (wf.stepCount || wf.steps?.length || 0) + ' steps &bull; ' + new Date(wf.createdAt || Date.now()).toLocaleDateString() + '</div><div class="workflow-actions"><button class="btn btn-primary" onclick="runWorkflow('' + wf.id + '')">Run</button><button class="btn btn-danger" onclick="deleteWorkflow('' + wf.id + '')">Delete</button></div></div>').join('');
}

window.runWorkflow = async function (id) {
  const tab = await getActiveTab();
  const resp = await bgMessage({ type: 'RUN_WORKFLOW', workflowId: id, tabId: tab?.id });
  recordStatus.textContent = resp?.success ? 'Workflow completed!' : ('Error: ' + resp?.error);
};

window.deleteWorkflow = async function (id) {
  if (!confirm('Delete this workflow?')) return;
  await bgMessage({ type: 'DELETE_WORKFLOW', id });
  loadWorkflows();
};

// ============================================================
// EXTRACT PANEL
// ============================================================
const extractRequest = document.getElementById('extractRequest');
const extractBtn = document.getElementById('extractBtn');
const extractResult = document.getElementById('extractResult');
const docFile = document.getElementById('docFile');
const docRequest = document.getElementById('docRequest');
const analyzeDocBtn = document.getElementById('analyzeDocBtn');

extractBtn.addEventListener('click', async () => {
  const request = extractRequest.value.trim();
  if (!request) return;
  extractBtn.disabled = true;
  extractBtn.innerHTML = '<span class="spinner"></span> Extracting...';
  extractResult.style.display = 'none';

  try {
    const tab = await getActiveTab();
    const resp = await bgMessage({ type: 'EXTRACT', request, tabId: tab?.id });
    extractResult.textContent = resp?.result || 'No results';
    extractResult.style.display = '';
    extractResult.scrollTop = 0;
  } catch (err) {
    extractResult.textContent = 'Error: ' + err.message;
    extractResult.style.display = '';
  } finally {
    extractBtn.disabled = false;
    extractBtn.textContent = 'Extract';
  }
});

analyzeDocBtn.addEventListener('click', async () => {
  const file = docFile.files[0];
  const request = docRequest.value.trim();
  if (!file) { alert('Please select a document first.'); return; }
  if (!request) { alert('Please enter a question or request.'); return; }

  analyzeDocBtn.disabled = true;
  analyzeDocBtn.innerHTML = '<span class="spinner"></span> Analyzing...';
  extractResult.style.display = 'none';

  try {
    const content = await readFileAsText(file);
    const resp = await bgMessage({ type: 'SUMMARIZE_DOC', content, request });
    extractResult.textContent = resp?.result || 'No results';
    extractResult.style.display = '';
  } catch (err) {
    extractResult.textContent = 'Error: ' + err.message;
    extractResult.style.display = '';
  } finally {
    analyzeDocBtn.disabled = false;
    analyzeDocBtn.textContent = 'Analyze';
  }
});

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// ============================================================
// SETTINGS PANEL
// ============================================================
const apiKeyInput = document.getElementById('apiKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const testConnBtn = document.getElementById('testConnBtn');
const connStatus = document.getElementById('connStatus');
const modelSelect = document.getElementById('modelSelect');
const maxTokensInput = document.getElementById('maxTokensInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const clearAllDataBtn = document.getElementById('clearAllDataBtn');
const settingsMsg = document.getElementById('settingsMsg');
const toggleKeyVisibility = document.getElementById('toggleKeyVisibility');

async function loadSettings() {
  const data = await chrome.storage.local.get(['claude_api_key', 'claude_settings']);
  if (data['claude_api_key']) apiKeyInput.value = data['claude_api_key'];
  const settings = data['claude_settings'] || {};
  if (settings.model) modelSelect.value = settings.model;
  if (settings.maxTokens) maxTokensInput.value = settings.maxTokens;
}

toggleKeyVisibility.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key || !key.startsWith('sk-ant-')) { showConnStatus('Please enter a valid Anthropic API key (starts with sk-ant-)', 'error'); return; }
  await chrome.storage.local.set({ 'claude_api_key': key });
  showConnStatus('API key saved!', 'success');
});

testConnBtn.addEventListener('click', async () => {
  testConnBtn.disabled = true;
  testConnBtn.innerHTML = '<span class="spinner"></span> Testing...';
  connStatus.style.display = 'none';
  try {
    const resp = await bgMessage({ type: 'TEST_CONNECTION' });
    showConnStatus(resp?.success ? resp.message : ('Error: ' + resp?.error), resp?.success ? 'success' : 'error');
  } catch (err) {
    showConnStatus('Error: ' + err.message, 'error');
  } finally {
    testConnBtn.disabled = false;
    testConnBtn.textContent = 'Test Connection';
  }
});

saveSettingsBtn.addEventListener('click', async () => {
  const settings = { model: modelSelect.value, maxTokens: parseInt(maxTokensInput.value) };
  await chrome.storage.local.set({ 'claude_settings': settings });
  showSettingsMsg('Settings saved!', 'success');
});

clearAllDataBtn.addEventListener('click', async () => {
  if (!confirm('Clear all data including your API key, chat history, and workflows? This cannot be undone.')) return;
  await chrome.storage.local.clear();
  apiKeyInput.value = '';
  showSettingsMsg('All data cleared.', 'success');
});

function showConnStatus(msg, type) {
  connStatus.className = 'status-badge ' + (type || 'pending');
  connStatus.textContent = (type === 'success' ? 'OK ' : 'Error ') + msg;
  connStatus.style.display = '';
}

function showSettingsMsg(msg, type) {
  settingsMsg.className = type === 'success' ? 'success-msg' : 'error-msg';
  settingsMsg.textContent = msg;
  settingsMsg.style.display = '';
  setTimeout(() => { settingsMsg.style.display = 'none'; }, 3000);
}
