import { Component } from 'react';

// Catches any render/runtime error in the tree below it and shows a recoverable
// message instead of a blank white screen. Without this, one bad render (e.g. an
// unexpected API shape) takes the whole app down.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface for debugging; in production this could go to a logging service.
    console.error('[Translator] render error:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg, #faf8f3)', color: 'var(--ink, #1a1a1a)', fontFamily: 'DM Sans, system-ui, sans-serif',
        padding: 24,
      }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ color: 'var(--muted, #777)', fontSize: 14, margin: '0 0 20px', lineHeight: 1.5 }}>
            The app hit an unexpected error and stopped rendering. Your work is saved — reloading
            usually fixes it.
          </p>
          <pre style={{
            textAlign: 'left', fontSize: 12, background: 'var(--surface, #fff)',
            border: '1px solid var(--line, #e5e1d8)', borderRadius: 8, padding: 12,
            overflow: 'auto', maxHeight: 160, color: '#c7522a', marginBottom: 20,
          }}>{String(this.state.error?.message || this.state.error)}</pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
              background: 'var(--accent, #1f5d4c)', color: '#fff', border: 'none', borderRadius: 10,
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
