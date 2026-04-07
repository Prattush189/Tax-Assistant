import { useState, useCallback } from 'react';
import { DocumentContext } from '../types';
import { uploadFile } from '../services/api';

export type UploadPhase = 'idle' | 'uploading' | 'analyzing' | 'done' | 'error';

export function useFileUpload() {
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleFile = useCallback(async (file: File): Promise<DocumentContext | null> => {
    setUploadPhase('uploading');
    setErrorMessage('');

    try {
      setUploadPhase('analyzing');
      const result = await uploadFile(file);
      setUploadPhase('done');

      return {
        filename: result.filename,
        mimeType: result.mimeType,
        fileUri: result.fileUri,
        extractedData: result.extractedData,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setErrorMessage(msg);
      setUploadPhase('error');
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setUploadPhase('idle');
    setErrorMessage('');
  }, []);

  return { uploadPhase, errorMessage, handleFile, reset };
}
