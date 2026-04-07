// server/middleware/validation.ts

export interface ValidationError {
  status: number;
  message: string;
}

export function validateChatRequest(body: unknown): ValidationError | null {
  const req = body as { chatId?: string; message?: string };

  if (!req.chatId || typeof req.chatId !== 'string') {
    return { status: 400, message: 'chatId is required' };
  }
  if (!req.message || typeof req.message !== 'string') {
    return { status: 400, message: 'message is required and must be a string' };
  }
  if (req.message.trim().length === 0) {
    return { status: 400, message: 'message cannot be empty' };
  }
  if (req.message.length > 4000) {
    return { status: 400, message: 'message exceeds 4000 character limit' };
  }
  return null;
}
