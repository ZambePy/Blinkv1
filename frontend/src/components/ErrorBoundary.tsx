import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary capturou:', error, info);
  }

  private handleReload = () => {
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          background: 'linear-gradient(160deg, #fef2f2 0%, #fee2e2 100%)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 560,
            width: '100%',
            background: 'white',
            borderRadius: '1.5rem',
            padding: '2.5rem',
            boxShadow: '0 20px 40px rgba(220,38,38,0.15)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }} aria-hidden="true">
            ⚠️
          </div>
          <h1 style={{ fontSize: '1.75rem', color: '#991b1b', marginBottom: '0.75rem' }}>
            Algo deu errado
          </h1>
          <p style={{ color: '#7f1d1d', marginBottom: '1.5rem', lineHeight: 1.6 }}>
            Encontramos um problema inesperado. Você pode tentar recarregar a aplicação.
          </p>
          {this.state.error?.message && (
            <pre
              style={{
                background: '#fef2f2',
                padding: '1rem',
                borderRadius: '0.75rem',
                fontSize: '0.85rem',
                color: '#991b1b',
                textAlign: 'left',
                overflow: 'auto',
                marginBottom: '1.5rem',
                maxHeight: 160,
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleReload}
            aria-label="Recarregar aplicação"
            style={{
              padding: '1rem 2rem',
              background: '#1B54A8',
              color: 'white',
              border: 'none',
              borderRadius: '1rem',
              fontSize: '1.1rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(27,84,168,0.3)',
            }}
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
