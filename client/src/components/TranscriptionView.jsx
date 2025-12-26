import { useState } from 'react';
import './TranscriptionView.css';

function TranscriptionView({ transcription, originalTranscription }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(transcription);

  const handleEdit = () => {
    setIsEditing(true);
    setEditedText(transcription);
  };

  const handleSave = () => {
    setIsEditing(false);
    // Could emit event to update parent
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(transcription);
      alert('Copied to clipboard!');
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  return (
    <div className="transcription-view">
      <div className="transcription-header">
        <h2>Transcription</h2>
        <div className="transcription-actions">
          <button onClick={handleCopy} className="btn btn-secondary">
            📋 Copy
          </button>
          <button onClick={handleEdit} className="btn btn-secondary">
            ✏️ Edit
          </button>
        </div>
      </div>

      <div className="transcription-content">
        {isEditing ? (
          <div className="edit-mode">
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="transcription-textarea"
              rows={20}
            />
            <div className="edit-actions">
              <button onClick={handleSave} className="btn btn-primary">
                Save
              </button>
              <button onClick={() => setIsEditing(false)} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="transcription-text">
            {transcription.split('\n').map((line, index) => (
              <p key={index}>{line || '\u00A0'}</p>
            ))}
          </div>
        )}
      </div>

      {originalTranscription && originalTranscription !== transcription && (
        <div className="transcription-note">
          <small>✨ This transcription has been refined by AI</small>
        </div>
      )}
    </div>
  );
}

export default TranscriptionView;

