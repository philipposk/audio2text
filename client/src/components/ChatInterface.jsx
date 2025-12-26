import { useState, useRef, useEffect } from 'react';
import './ChatInterface.css';

function ChatInterface({ transcription, onResponse, chatHistory, setChatHistory, setRefinedTranscription }) {
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!message.trim() || isLoading) return;

    const userMessage = message.trim();
    setMessage('');
    setIsLoading(true);

    // Add user message to history
    const newHistory = [...chatHistory, { role: 'user', content: userMessage }];
    setChatHistory(newHistory);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: userMessage,
          transcription: transcription,
          history: newHistory.slice(-10) // Last 10 messages for context
        })
      });

      if (!response.ok) {
        throw new Error('Chat request failed');
      }

      const data = await response.json();
      const aiResponse = data.response;

      // Add AI response to history
      setChatHistory([...newHistory, { role: 'assistant', content: aiResponse }]);
      onResponse(aiResponse);

      // Check if user wants to refine transcription
      if (userMessage.toLowerCase().includes('refine') || 
          userMessage.toLowerCase().includes('improve') ||
          userMessage.toLowerCase().includes('fix')) {
        await handleRefine(aiResponse);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setChatHistory([...newHistory, { 
        role: 'assistant', 
        content: 'Sorry, I encountered an error. Please try again.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefine = async (instructions) => {
    try {
      const response = await fetch('/api/chat/refine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transcription: transcription,
          instructions: instructions
        })
      });

      if (response.ok) {
        const data = await response.json();
        setRefinedTranscription(data.refinedTranscription);
      }
    } catch (error) {
      console.error('Refinement error:', error);
    }
  };

  const quickActions = [
    { text: 'Fix grammar and punctuation', action: 'Please fix all grammar errors and add proper punctuation to this transcription.' },
    { text: 'Improve formatting', action: 'Please improve the formatting and structure of this transcription, adding proper paragraphs and line breaks.' },
    { text: 'Translate to English', action: 'Please translate this transcription to English while maintaining the original meaning.' },
    { text: 'Make it more formal', action: 'Please rewrite this transcription in a more formal and professional tone.' }
  ];

  const handleQuickAction = (action) => {
    setMessage(action);
  };

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <h2>💬 Chat with Mr.Transcribe</h2>
        <p>Ask me to refine, improve, or modify your transcription</p>
      </div>

      <div className="quick-actions">
        {quickActions.map((item, index) => (
          <button
            key={index}
            onClick={() => handleQuickAction(item.action)}
            className="quick-action-btn"
          >
            {item.text}
          </button>
        ))}
      </div>

      <div className="chat-messages">
        {chatHistory.length === 0 && (
          <div className="welcome-message">
            <p>👋 Hi! I'm Mr.Transcribe. I can help you:</p>
            <ul>
              <li>Fix grammar and punctuation errors</li>
              <li>Improve formatting and structure</li>
              <li>Translate to other languages</li>
              <li>Adjust tone and style</li>
              <li>Answer questions about the transcription</li>
            </ul>
            <p>Just type your request below!</p>
          </div>
        )}

        {chatHistory.map((msg, index) => (
          <div key={index} className={`message ${msg.role}`}>
            <div className="message-content">
              {msg.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="message assistant">
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} className="chat-input-form">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask me to refine your transcription..."
          className="chat-input"
          disabled={isLoading}
        />
        <button type="submit" className="btn btn-primary" disabled={isLoading || !message.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

export default ChatInterface;

