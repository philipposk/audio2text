import { useState } from 'react';
import Header from './components/Header';
import FileUpload from './components/FileUpload';
import TranscriptionView from './components/TranscriptionView';
import ChatInterface from './components/ChatInterface';
import ExportOptions from './components/ExportOptions';
import './styles/App.css';

function App() {
  const [transcription, setTranscription] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [refinedTranscription, setRefinedTranscription] = useState('');

  const handleTranscription = (text) => {
    setTranscription(text);
    setRefinedTranscription(text);
  };

  const handleChatResponse = (response) => {
    // Update transcription if AI provides refined version
    if (response.includes('refined') || response.includes('improved')) {
      // Extract refined text if provided
      setRefinedTranscription(response);
    }
  };

  return (
    <div className="app">
      <Header />
      <main className="main-content">
        <div className="container">
          <div className="upload-section">
            <FileUpload 
              onTranscription={handleTranscription}
              isTranscribing={isTranscribing}
              setIsTranscribing={setIsTranscribing}
            />
          </div>

          {(transcription || refinedTranscription) && (
            <div className="content-grid">
              <div className="transcription-section">
                <TranscriptionView 
                  transcription={refinedTranscription || transcription}
                  originalTranscription={transcription}
                />
                <ExportOptions 
                  transcription={refinedTranscription || transcription}
                />
              </div>

              <div className="chat-section">
                <ChatInterface
                  transcription={refinedTranscription || transcription}
                  onResponse={handleChatResponse}
                  chatHistory={chatHistory}
                  setChatHistory={setChatHistory}
                  setRefinedTranscription={setRefinedTranscription}
                />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;

