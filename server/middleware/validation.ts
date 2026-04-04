// server/middleware/validation.ts

export interface ChatRequest {
  message: string;
  history?: Array<{ role: string; parts: Array<{ text: string }> }>;
}

export interface ValidationError {
  status: number;
  message: string;
}

export function validateChatRequest(body: unknown): ValidationError | null {
  const req = body as ChatRequest;

  if (!req.message || typeof req.message !== 'string') {
    return { status: 400, message: 'message is required and must be a string' };
  }
  if (req.message.trim().length === 0) {
    return { status: 400, message: 'message cannot be empty' };
  }
  if (req.message.length > 4000) {
    return { status: 400, message: 'message exceeds 4000 character limit' };
  }
  if (req.history !== undefined) {
    if (!Array.isArray(req.history)) {
      return { status: 400, message: 'history must be an array' };
    }
    if (req.history.length > 50) {
      return { status: 400, message: 'history exceeds 50 message limit' };
    }
  }
  return null;
}
