export const PROVIDERS = {
  ollama: {
    id: 'ollama',
    label: 'Local Ollama (Private / Free)',
    requiresKey: false,
    defaultEndpoint: 'http://localhost:11434',
    defaultModels: ['qwen2.5:3b', 'llama3.2:3b', 'gemma2:2b'],
  },
  claude: {
    id: 'claude',
    label: 'Anthropic Claude (BYOK)',
    requiresKey: true,
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    defaultModels: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI / OpenRouter (BYOK)',
    requiresKey: true,
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModels: ['gpt-4o-mini', 'gpt-4o'],
  },
};

export async function fetchOllamaModels(baseUrl = PROVIDERS.ollama.defaultEndpoint) {
  const cleanUrl = baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const res = await fetch(`${cleanUrl}/api/tags`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.models)) {
      throw new Error('Response is not a valid Ollama /api/tags payload');
    }

    const names = data.models
      .map((m) => m?.name)
      .filter((name) => typeof name === 'string' && name.trim().length > 0);

    const preferred = ['qwen2.5:3b', 'llama3.2:3b', 'gemma2:2b', 'phi3:mini', 'qwen2.5:7b'];
    names.sort((a, b) => {
      const ia = preferred.findIndex((p) => a.startsWith(p));
      const ib = preferred.findIndex((p) => b.startsWith(p));
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    return names;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function streamSectionCompletion({
  provider,
  model,
  apiKey,
  endpoint,
  systemPrompt,
  userPrompt,
  signal,
  onToken,
}) {
  if (provider === 'ollama') {
    return streamOllama({
      baseUrl: endpoint || PROVIDERS.ollama.defaultEndpoint,
      model,
      systemPrompt,
      userPrompt,
      signal,
      onToken,
    });
  }
  if (provider === 'claude') {
    return streamClaude({
      endpoint: endpoint || PROVIDERS.claude.defaultEndpoint,
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      signal,
      onToken,
    });
  }
  if (provider === 'openai') {
    return streamOpenAI({
      endpoint: endpoint || PROVIDERS.openai.defaultEndpoint,
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      signal,
      onToken,
    });
  }
  throw new Error(`Unknown provider: ${provider}`);
}

async function streamOllama({ baseUrl, model, systemPrompt, userPrompt, signal, onToken }) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      stream: true,
      options: { num_ctx: 4096, temperature: 0.2 },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const chunk = JSON.parse(trimmed);
      if (chunk.message?.content) onToken(chunk.message.content);
    }
  }
}

async function streamClaude({ endpoint, apiKey, model, systemPrompt, userPrompt, signal, onToken }) {
  if (!apiKey) throw new Error('Enter your Anthropic API key (sk-ant-...) in the top bar.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    signal,
    body: JSON.stringify({
      model,
      max_tokens: 1800,
      temperature: 0.2,
      stream: true,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude HTTP ${res.status}: ${errText.slice(0, 120)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split('\n\n');
    buf = events.pop() || '';
    for (const ev of events) {
      const dataLine = ev.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      const str = dataLine.slice(6).trim();
      if (str === '[DONE]') return;
      const parsed = JSON.parse(str);
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        onToken(parsed.delta.text);
      }
    }
  }
}

async function streamOpenAI({ endpoint, apiKey, model, systemPrompt, userPrompt, signal, onToken }) {
  if (!apiKey) throw new Error('Enter your OpenAI / OpenRouter API key in the top bar.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    signal,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API HTTP ${res.status}: ${errText.slice(0, 120)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const str = trimmed.slice(6).trim();
      if (str === '[DONE]') return;
      const parsed = JSON.parse(str);
      const token = parsed.choices?.[0]?.delta?.content;
      if (token) onToken(token);
    }
  }
}