import { useState } from 'react';
import './ExportOptions.css';

function ExportOptions({ transcription }) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState('');

  const formats = [
    { value: 'txt', label: '📄 Plain Text (.txt)', icon: '📄' },
    { value: 'docx', label: '📝 Word Document (.docx)', icon: '📝' },
    { value: 'pdf', label: '📕 PDF Document (.pdf)', icon: '📕' },
    { value: 'json', label: '🔧 JSON (.json)', icon: '🔧' },
    { value: 'srt', label: '🎬 Subtitle (.srt)', icon: '🎬' },
    { value: 'vtt', label: '📺 WebVTT (.vtt)', icon: '📺' }
  ];

  const handleExport = async (format) => {
    if (!transcription) {
      alert('No transcription to export');
      return;
    }

    setIsExporting(true);
    setExportFormat(format);

    try {
      const response = await fetch(`/api/export/${format}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transcription: transcription,
          title: `transcription-${Date.now()}`
        })
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transcription-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export file. Please try again.');
    } finally {
      setIsExporting(false);
      setExportFormat('');
    }
  };

  return (
    <div className="export-options">
      <h3>Export Transcription</h3>
      <div className="export-buttons">
        {formats.map((format) => (
          <button
            key={format.value}
            onClick={() => handleExport(format.value)}
            disabled={isExporting}
            className={`export-btn ${isExporting && exportFormat === format.value ? 'exporting' : ''}`}
          >
            {isExporting && exportFormat === format.value ? (
              <span className="spinner-small"></span>
            ) : (
              format.icon
            )}
            <span>{format.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default ExportOptions;

