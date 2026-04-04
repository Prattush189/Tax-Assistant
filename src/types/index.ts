export interface Message {
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
}

export interface UploadResponse {
  success: boolean;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  summary: string;
}

// Shape expected by /api/chat server route
export interface HistoryItem {
  role: string;
  parts: Array<{ text: string }>;
}
