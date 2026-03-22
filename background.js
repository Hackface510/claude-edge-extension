// background.js - Service Worker: message router + Claude API caller
import { ClaudeAPIClient } from './api-client.js';
import { Storage } from './storage.js';

const storage = new Storage();
const apiClient = new ClaudeAPIClient();

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'summarize-page', title: 'Summarize this page with Claude', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'explain-selection', title: 'Explain selection with Claude', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'automate-action', title: 'Automate action with Claude', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
  await sleep(600);
  if (info.menuItemId === 'summarize-page') {
    chrome.runtime.sendMessage({ type: 'CONTEXT_MENU_SUMMARIZE', tabId: tab.id });
  } else if (info.menuItemId === 'explain-selection') {
    chrome.runtime.sendMessage({ type: 'CONTEXT_MENU_EXPLAIN', text: info.selectionText });
  } else if (info.menuItemId === 'automate-action') {
    chrome.runtime.sendMessage({ type: 'CONTEXT_MENU_AUTOMATE', tabId: tab.id });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'CHAT': return await handleChat(msg);
    case 'AUTOMATE': return await handleAutomate(msg, sender);
    case 'EXECUTE_STEP': return await executeAutomationStep(msg.step, msg.tabId);
    case 'EXTRACT': return await handleExtract(msg);
    case 'SUMMARIZE_DOC': return await handleDocSummarize(msg);
    case 'GET_PAGE_CONTENT': return await getPageContent(msg.tabId);
    case 'SAVE_WORKFLOW': return await storage.saveWorkflow(msg.workflow);
    case 'GET_WORKFLOWS': return { workflows: await storage.getWorkflows() };
    case 'DELETE_WORKFLOW': return await storage.deleteWorkflow(msg.id);
    case 'RUN_WORKFLOW': return await runWorkflow(msg.workflowId, msg.tabId);
    case 'TEST_CONNECTION': return await testConnection();
    default: throw new Error('Unknown message type: ' + msg.type);
  }
}

async function handleChat(msg) {
  const key = await storage.getApiKey();
  if (!key) throw new Error('No API key. Open Settings to add your Anthropic API key.');
  const history = await storage.getChatHistory();
  const messages = [...history];
  if (msg.includePageContext && msg.pageContent) {
    messages.push({ role: 'user', content: '[Page]\nURL: ' + msg.pageUrl + '\n\n' + msg.pageContent + '\n\n---\n\n' + msg.message });
  } else {
    messages.push({ role: 'user', content: msg.message });
  }
  const system = 'You are Claude, an AI assistant in a Microsoft Edge extension. Help with questions, page summaries, automation, extraction, and documents. Date: ' + new Date().toLocaleDateString();
  const response = await apiClient.chat(key, messages, system);
  await storage.saveChatMessage({ role: 'user', content: msg.message });
  await storage.saveChatMessage({ role: 'assistant', content: response });
  return { success: true, message: response };
}

async function handleAutomate(msg, sender) {
  const key = await storage.getApiKey();
  if (!key) throw new Error('No API key set.');
  const page = await getPageContent(msg.tabId);
  const system = 'Browser automation assistant. Return ONLY a valid JSON array. Each step has: action, selector (optional), value (optional), description. Actions: click, type, scroll, wait, navigate, extract.';
  const prompt = 'Page: ' + page.url + '\nTitle: ' + page.title + '\nContent: ' + page.text.substring(0, 3000) + '\n\nTask: ' + msg.task;
  const response = await apiClient.chat(key, [{ role: 'user', content: prompt }], system);
  try {
    const match = response.match(/\[[\s\S]*\]/);
    return { success: true, steps: JSON.parse(match ? match[0] : response), plan: response };
  } catch (e) {
    return { success: false, error: 'Could not parse automation steps.', raw: response };
  }
}

async function executeAutomationStep(step, tabId) {
  try {
    const result = await chrome.scripting.executeScript({ target: { tabId }, func: runStep, args: [step] });
    return { success: true, result: result[0]?.result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function runStep(step) {
  const el = step.selector ? document.querySelector(step.selector) : null;
  switch (step.action) {
    case 'click':
      if (!el) return { error: 'Not found: ' + step.selector };
      el.click(); return { done: true };
    case 'type':
      if (!el) return { error: 'Not found: ' + step.selector };
      el.focus(); el.value = step.value || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { done: true };
    case 'scroll':
      window.scrollBy(0, parseInt(step.value || '300')); return { done: true };
    case 'navigate':
      window.location.href = step.value; return { done: true };
    case 'extract':
      return { extracted: (el || document.body).innerText.trim() };
    case 'wait': return { done: true };
    default: return { error: 'Unknown action: ' + step.action };
  }
}

async function handleExtract(msg) {
  const key = await storage.getApiKey();
  if (!key) throw new Error('No API key.');
  const page = await getPageContent(msg.tabId);
  const system = 'Content extraction assistant. Extract and structure information accurately from the page.';
  const prompt = 'URL: ' + page.url + '\nTitle: ' + page.title + '\n\nContent:\n' + page.text.substring(0, 6000) + '\n\nRequest: ' + msg.request;
  const response = await apiClient.chat(key, [{ role: 'user', content: prompt }], system);
  return { success: true, result: response };
}

async function handleDocSummarize(msg) {
  const key = await storage.getApiKey();
  if (!key) throw new Error('No API key.');
  const system = 'Document analysis assistant. Summarize clearly and answer questions accurately.';
  const prompt = 'Document:\n' + msg.content.substring(0, 8000) + '\n\nRequest: ' + msg.request;
  const response = await apiClient.chat(key, [{ role: 'user', content: prompt }], system);
  return { success: true, result: response };
}

async function runWorkflow(workflowId, tabId) {
  const workflows = await storage.getWorkflows();
  const wf = workflows.find((w) => w.id === workflowId);
  if (!wf) throw new Error('Workflow not found');
  const results = [];
  for (const step of wf.steps) {
    if (step.delay) await sleep(step.delay);
    results.push({ step, result: await executeAutomationStep({ action: step.type, selector: step.selector, value: step.value }, tabId) });
  }
  return { success: true, results };
}

async function getPageContent(tabId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tid = tabId || tab?.id;
  if (!tid) return { url: '', title: '', text: '' };
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: () => ({ url: location.href, title: document.title, text: document.body?.innerText?.trim().substring(0, 10000) || '' }),
    });
    return r?.result || { url: '', title: '', text: '' };
  } catch {
    try {
      const t = await chrome.tabs.get(tid);
      return { url: t.url || '', title: t.title || '', text: '' };
    } catch { return { url: '', title: '', text: '' }; }
  }
}

async function testConnection() {
  const key = await storage.getApiKey();
  if (!key) return { success: false, error: 'No API key saved.' };
  return await apiClient.testConnection(key);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
