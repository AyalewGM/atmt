import React, { useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

import ApiService from '../services/apiService';
import firebaseService from '../services/firebaseService';
import Modal from './Modal';

export default function VisualInsights({ userId, onClose }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    setSelectedFile(file || null);
    setError('');
    if (file) setPreviewUrl(URL.createObjectURL(file));
    else setPreviewUrl('');
  };

  const handleAnalyzeImage = async () => {
    if (!selectedFile) return;
    setIsLoading(true);
    setError('');
    setAnalysis('');

    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64Data = String(reader.result).split(',')[1];
        const mimeType = selectedFile.type || 'image/jpeg';
        const prompt = `You are an art historian and theologian specializing in Ethiopian Orthodox Tewahedo iconography and sacred art. Analyze the uploaded image. Provide a detailed description of the iconography, its theological meaning, and any relevant historical or liturgical context within the Ethiopian Orthodox Tewahedo tradition. If it's not explicitly Orthodox iconography, interpret it from a general Christian sacred art perspective. Format your response in markdown, including sections for "Visual Description", "Theological Interpretation", and "Context/Significance".`;
        const result = await ApiService.callGeminiVision(prompt, base64Data, mimeType);
        setAnalysis(result);
      } catch (e) {
        console.error('Image analysis error:', e);
        setError(e?.message || 'Failed to analyze image');
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleSave = async () => {
    if (!userId || !analysis) return;
    try {
      const title = `Visual Insight: ${selectedFile ? selectedFile.name : 'Untitled Image'}`;
      await firebaseService.createProject(userId, { title, content: analysis, type: 'blog' });
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Failed to save project');
    }
  };

  const safeHtml = DOMPurify.sanitize(marked.parse(analysis || ''));

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 800 }}>Visual Insights</h3>
            <p style={{ margin: 0, color: '#9ca3af' }}>Upload an image for theological and artistic analysis.</p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', color: '#e5e7eb', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px' }}>Close</button>
        </div>

        <div style={{ border: '1px solid rgba(212,175,55,0.2)', borderRadius: 8, padding: 12 }}>
          <input type="file" accept="image/png,image/jpeg,image/jpg" onChange={handleFileChange} />

          {previewUrl ? (
            <div style={{ marginTop: 12 }}>
              <img src={previewUrl} alt="Preview" style={{ maxHeight: 240, width: '100%', objectFit: 'contain', borderRadius: 8, border: '1px solid rgba(212,175,55,0.2)' }} />
            </div>
          ) : (
            <p style={{ marginTop: 12, color: '#9ca3af' }}>No image selected</p>
          )}

          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button onClick={handleAnalyzeImage} disabled={!selectedFile || isLoading} style={{ background: '#D4AF37', color: '#111827', fontWeight: 700, padding: '8px 12px', borderRadius: 8, opacity: !selectedFile || isLoading ? 0.7 : 1 }}> {isLoading ? 'Analyzing…' : 'Analyze Image'} </button>
            {analysis && !isLoading && (
              <button onClick={handleSave} style={{ background: '#800020', color: 'white', fontWeight: 700, padding: '8px 12px', borderRadius: 8 }}>Save as Project</button>
            )}
          </div>

          {error && (
            <div style={{ marginTop: 12, color: '#fca5a5' }}>Error: {error}</div>
          )}

          {analysis && (
            <div style={{ marginTop: 12, padding: 12, background: '#0f1a2b', border: '1px solid rgba(212,175,55,0.2)', borderRadius: 8 }}>
              <div className="prose prose-invert" dangerouslySetInnerHTML={{ __html: safeHtml }} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

