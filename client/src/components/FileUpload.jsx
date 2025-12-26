import { useState, useRef } from 'react';
import './FileUpload.css';

function FileUpload({ onTranscription, isTranscribing, setIsTranscribing }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file) => {
    // Validate file size (25MB limit)
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (file.size > maxSize) {
      alert(`File is too large. Maximum size is 25MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)}MB.`);
      return;
    }

    // Validate file type
    const audioTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 
                       'audio/flac', 'audio/ogg', 'audio/webm', 'audio/aac'];
    const isValidAudio = audioTypes.includes(file.type) || 
                        file.name.match(/\.(mp3|wav|m4a|flac|ogg|webm|aac|amr|3gp)$/i);

    if (!isValidAudio) {
      alert('Please upload a valid audio file (MP3, WAV, M4A, FLAC, etc.)');
      return;
    }

    setSelectedFile(file);
    setIsTranscribing(true);

    try {
      const formData = new FormData();
      formData.append('audio', file);
      formData.append('language', 'el'); // Greek

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        if (response.status === 413) {
          throw new Error('File is too large. Maximum size is 25MB.');
        } else if (response.status === 404) {
          throw new Error('API endpoint not found. Please check the deployment.');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Transcription failed (${response.status})`);
      }

      const data = await response.json();
      onTranscription(data.transcription);
    } catch (error) {
      console.error('Transcription error:', error);
      alert('Failed to transcribe audio. Please try again.');
    } finally {
      setIsTranscribing(false);
      setSelectedFile(null);
    }
  };

  return (
    <div className="file-upload">
      <div
        className={`upload-area ${dragActive ? 'drag-active' : ''} ${isTranscribing ? 'transcribing' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {isTranscribing ? (
          <div className="upload-content">
            <div className="spinner"></div>
            <p>Transcribing audio... This may take a moment.</p>
          </div>
        ) : (
          <div className="upload-content">
            <div className="upload-icon">📁</div>
            <h3>Drop your audio file here</h3>
            <p>or click to browse</p>
            <p className="upload-hint">Supports: MP3, WAV, M4A, FLAC, OGG, WEBM, AAC (Max 25MB)</p>
            {selectedFile && (
              <p className="selected-file">Selected: {selectedFile.name}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default FileUpload;

