/**
 * Tiny SSE writer used by streaming AI routes (chat, notices). Centralizes
 * the wire format so the chat and notice routes can't drift apart and the
 * client (`src/services/api.ts`) sees a stable schema.
 *
 * Wire format (one event per write):
 *   data: {"text": "..."}            ← incremental token chunk
 *   data: {"done": true, ...}        ← final event with optional metadata
 *   data: {"error": true, "message": "..."}  ← terminal error event
 *
 * Each event is followed by a blank line (\n\n) per the SSE spec.
 */
import type { Response } from 'express';

export class SseWriter {
  private closed = false;

  constructor(private readonly res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Disable proxy buffering so chunks reach the client immediately.
    res.setHeader('X-Accel-Buffering', 'no');
  }

  /** Write a single text chunk. Empty strings are dropped. */
  writeText(text: string): void {
    if (this.closed || !text) return;
    this.res.write(`data: ${JSON.stringify({ text })}\n\n`);
  }

  /** Emit the terminal `done` event. Extra fields are merged into the payload. */
  writeDone(extra: Record<string, unknown> = {}): void {
    if (this.closed) return;
    this.res.write(`data: ${JSON.stringify({ done: true, ...extra })}\n\n`);
  }

  /** Emit a terminal error event. Safe to call multiple times — only the first lands. */
  writeError(message: string): void {
    if (this.closed) return;
    this.res.write(`data: ${JSON.stringify({ error: true, message })}\n\n`);
  }

  /** Close the stream. Idempotent. */
  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }
}
