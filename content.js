// content.js - Injected into every page. Handles recording, automation notifications, and page interaction.
(function () {
  'use strict';

  // Prevent double injection
  if (window.__claudeExtensionLoaded) return;
  window.__claudeExtensionLoaded = true;

  // Recording state
  let isRecording = false;
  let recordedSteps = [];
  let highlightedEl = null;

  // Listen for messages from background / side panel
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'START_RECORDING':
        startRecording();
        sendResponse({ success: true });
        break;
      case 'STOP_RECORDING':
        sendResponse({ success: true, steps: stopRecording() });
        break;
      case 'GET_PAGE_INFO':
        sendResponse({
          url: location.href,
          title: document.title,
          text: document.body?.innerText?.trim().substring(0, 10000) || '',
          html: document.documentElement.outerHTML.substring(0, 20000),
        });
        break;
      case 'SHOW_TOAST':
        showToast(msg.message, msg.type || 'info');
        sendResponse({ success: true });
        break;
      case 'HIGHLIGHT_ELEMENT':
        highlightElement(msg.selector);
        sendResponse({ success: true });
        break;
      case 'PING':
        sendResponse({ alive: true });
        break;
    }
    return true;
  });

  // Recording
  function startRecording() {
    isRecording = true;
    recordedSteps = [];
    document.addEventListener('click', onRecordClick, true);
    document.addEventListener('input', onRecordInput, true);
    document.addEventListener('scroll', onRecordScroll, true);
    showToast('Recording started. Perform your actions...', 'info');
  }

  function stopRecording() {
    isRecording = false;
    document.removeEventListener('click', onRecordClick, true);
    document.removeEventListener('input', onRecordInput, true);
    document.removeEventListener('scroll', onRecordScroll, true);
    showToast('Recording stopped. ' + recordedSteps.length + ' steps captured.', 'success');
    return recordedSteps;
  }

  function onRecordClick(e) {
    if (!isRecording) return;
    const el = e.target;
    const selector = getBestSelector(el);
    recordedSteps.push({
      type: 'click',
      selector,
      description: 'Click on ' + (el.textContent?.trim().substring(0, 40) || el.tagName),
      timestamp: Date.now(),
    });
  }

  function onRecordInput(e) {
    if (!isRecording) return;
    const el = e.target;
    if (!el.value) return;
    const selector = getBestSelector(el);
    // Update last type step for same element or add new
    const last = recordedSteps[recordedSteps.length - 1];
    if (last && last.type === 'type' && last.selector === selector) {
      last.value = el.value;
    } else {
      recordedSteps.push({
        type: 'type',
        selector,
        value: el.value,
        description: 'Type into ' + (el.placeholder || el.name || el.id || el.tagName),
        timestamp: Date.now(),
      });
    }
  }

  function onRecordScroll(e) {
    if (!isRecording) return;
    const last = recordedSteps[recordedSteps.length - 1];
    // Debounce scroll recording
    if (last && last.type === 'scroll') {
      last.value = String(window.scrollY);
      last.timestamp = Date.now();
    } else {
      recordedSteps.push({
        type: 'scroll',
        value: String(window.scrollY),
        description: 'Scroll to ' + window.scrollY,
        timestamp: Date.now(),
      });
    }
  }

  // Best-effort CSS selector generation
  function getBestSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
    if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
    if (el.className) {
      const classes = el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (classes.length) return el.tagName.toLowerCase() + '.' + classes.join('.');
    }
    // Build path from root
    const path = [];
    let current = el;
    while (current && current !== document.body && path.length < 5) {
      let selector = current.tagName.toLowerCase();
      if (current.id) { selector = '#' + CSS.escape(current.id); path.unshift(selector); break; }
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(c => c.tagName === current.tagName) : [];
      if (siblings.length > 1) selector += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(' > ');
  }

  // Toast notifications
  function showToast(message, type = 'info') {
    const existing = document.getElementById('claude-ext-toast');
    if (existing) existing.remove();

    const colors = { info: '#3b82f6', success: '#22c55e', error: '#ef4444', warning: '#f59e0b' };
    const toast = document.createElement('div');
    toast.id = 'claude-ext-toast';
    toast.style.cssText = [
      'position: fixed', 'bottom: 24px', 'right: 24px', 'z-index: 2147483647',
      'background: ' + (colors[type] || colors.info), 'color: white',
      'padding: 12px 20px', 'border-radius: 8px', 'font-size: 14px',
      'font-family: -apple-system, BlinkMacSystemFont, sans-serif',
      'box-shadow: 0 4px 20px rgba(0,0,0,0.3)', 'max-width: 320px',
      'line-height: 1.4', 'transition: opacity 0.3s ease',
    ].join('; ');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
  }

  // Element highlighting
  function highlightElement(selector) {
    if (highlightedEl) {
      highlightedEl.style.outline = '';
      highlightedEl.style.outlineOffset = '';
    }
    const el = selector ? document.querySelector(selector) : null;
    if (el) {
      el.style.outline = '3px solid #6366f1';
      el.style.outlineOffset = '2px';
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightedEl = el;
      setTimeout(() => { if (highlightedEl === el) { el.style.outline = ''; el.style.outlineOffset = ''; } }, 3000);
    }
  }

  // Signal to side panel that content script is ready
  chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY', url: location.href }).catch(() => {});
})();
