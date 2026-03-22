// api-client.js - Claude API wrapper with streaming and standard support
export class ClaudeAPIClient {
  constructor() {
    this.baseURL = 'https://api.anthropic.com/v1';
    this.model = 'claude-sonnet-4-5';
    this.maxTokens = 4096;
    this.anthropicVersion = '2023-06-01';
  }

  async chat(apiKey, messages, systemPrompt = '', stream = false) {
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: this.sanitizeMessages(messages),
    };
    if (systemPrompt) body.system = systemPrompt;
    if (stream) body.stream = true;

    const response = await fetch(this.baseURL + '/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': this.anthropicVersion,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error('Claude API error ' + response.status + ': ' + (err.error?.message || response.statusText));
    }

    if (stream) {
      return this.handleStream(response);
    }

    const data = await response.json();
    return data.content[0]?.text || '';
  }

  async *chatStream(apiKey, messages, systemPrompt = '') {
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      stream: true,
      messages: this.sanitizeMessages(messages),
    };
    if (systemPrompt) body.system = systemPrompt;

    const response = await fetch(this.baseURL + '/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': this.anthropicVersion,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error('Claude API error ' + response.status + ': ' + (err.error?.message || response.statusText));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield parsed.delta.text;
            }
          } catch { /* skip malformed lines */ }
        }
      }
    }
  }

  async handleStream(response) {
    let fullText = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return fullText;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullText += parsed.delta.text;
            }
          } catch { /* skip */ }
        }
      }
    }
    return fullText;
  }

  async testConnection(apiKey) {
    try {
      const result = await this.chat(
        apiKey,
        [{ role: 'user', content: 'Respond with just: OK' }],
        'You are a connection test. Reply with exactly: OK'
      );
      return { success: true, message: 'Connection successful! Claude responded: ' + result.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  sanitizeMessages(messages) {
    if (!messages || messages.length === 0) return [];
    // Ensure messages alternate properly and have the right structure
    return messages.filter(m => m && m.role && m.content)
      .map(m => ({ role: m.role === 'user' || m.role === 'assistant' ? m.role : 'user', content: String(m.content) }));
  }

  setModel(model) { this.model = model; }
  setMaxTokens(tokens) { this.maxTokens = tokens; }
      }
