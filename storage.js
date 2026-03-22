// storage.js - Typed wrapper around chrome.storage.local
export class Storage {
  constructor() {
    this.KEYS = {
      API_KEY: 'claude_api_key',
      CHAT_HISTORY: 'claude_chat_history',
      WORKFLOWS: 'claude_workflows',
      SETTINGS: 'claude_settings',
    };
    this.MAX_HISTORY = 50;
  }

  // API Key
  async getApiKey() {
    const data = await chrome.storage.local.get(this.KEYS.API_KEY);
    return data[this.KEYS.API_KEY] || null;
  }

  async saveApiKey(key) {
    await chrome.storage.local.set({ [this.KEYS.API_KEY]: key });
    return true;
  }

  async deleteApiKey() {
    await chrome.storage.local.remove(this.KEYS.API_KEY);
    return true;
  }

  // Chat History
  async getChatHistory() {
    const data = await chrome.storage.local.get(this.KEYS.CHAT_HISTORY);
    return data[this.KEYS.CHAT_HISTORY] || [];
  }

  async saveChatMessage(message) {
    const history = await this.getChatHistory();
    history.push({ ...message, timestamp: Date.now() });
    // Keep only the last MAX_HISTORY messages
    const trimmed = history.slice(-this.MAX_HISTORY);
    await chrome.storage.local.set({ [this.KEYS.CHAT_HISTORY]: trimmed });
    return true;
  }

  async clearChatHistory() {
    await chrome.storage.local.remove(this.KEYS.CHAT_HISTORY);
    return true;
  }

  // Workflows
  async getWorkflows() {
    const data = await chrome.storage.local.get(this.KEYS.WORKFLOWS);
    return data[this.KEYS.WORKFLOWS] || [];
  }

  async saveWorkflow(workflow) {
    const workflows = await this.getWorkflows();
    const existing = workflows.findIndex((w) => w.id === workflow.id);
    if (existing >= 0) {
      workflows[existing] = { ...workflow, updatedAt: Date.now() };
    } else {
      workflows.push({
        ...workflow,
        id: workflow.id || 'wf_' + Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    await chrome.storage.local.set({ [this.KEYS.WORKFLOWS]: workflows });
    return true;
  }

  async deleteWorkflow(id) {
    const workflows = await this.getWorkflows();
    const filtered = workflows.filter((w) => w.id !== id);
    await chrome.storage.local.set({ [this.KEYS.WORKFLOWS]: filtered });
    return true;
  }

  // Settings
  async getSettings() {
    const data = await chrome.storage.local.get(this.KEYS.SETTINGS);
    return {
      model: 'claude-sonnet-4-5',
      maxTokens: 4096,
      theme: 'dark',
      includePageContext: false,
      ...data[this.KEYS.SETTINGS],
    };
  }

  async saveSettings(settings) {
    const current = await this.getSettings();
    await chrome.storage.local.set({ [this.KEYS.SETTINGS]: { ...current, ...settings } });
    return true;
  }

  // Clear all data
  async clearAll() {
    await chrome.storage.local.clear();
    return true;
  }

  // Get storage usage stats
  async getStorageStats() {
    return new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(null, (bytes) => {
        resolve({
          bytesUsed: bytes,
          bytesAvailable: chrome.storage.local.QUOTA_BYTES - bytes,
          quotaBytes: chrome.storage.local.QUOTA_BYTES,
        });
      });
    });
  }
      }
