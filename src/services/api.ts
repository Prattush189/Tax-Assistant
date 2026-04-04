import { Message, UploadResponse, HistoryItem } from '../types';

export async function sendChatMessage(
  message: string,
  history: Message[],
  onChunk: (text: string) => void,
  onError: (msg: string) => void
): Promise<void> {
  const conversationHistory: HistoryItem[] = history.map(m => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      history: conversationHistory,
    }),
  });

  if (!response.ok || !response.body) {
    let errorMessage = "I encountered an error while processing your request. Please try again.";
    try {
      const errData = await response.json();
      if (errData.error) errorMessage = errData.error;
    } catch {
      // ignore parse errors
    }
    onError(errorMessage);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';  // keep incomplete last line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) {
          onError(parsed.message ?? "I'm having trouble connecting. Please try again in a moment.");
          return;
        }
        if (parsed.text) {
          onChunk(parsed.text);
        }
      } catch {
        // Malformed JSON chunk — skip
      }
    }
  }
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Upload failed.');
  }

  return data as UploadResponse;
}
