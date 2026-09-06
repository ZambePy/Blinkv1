import React from 'react';
import { TriangleAlert } from 'lucide-react';

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

  // Sob `file://` (Electron), `location.href = '/'` aponta para a raiz do
  // disco e mata o app em tela branca. Limpar o hash e recarregar mantém o
  // mesmo index.html e volta para a rota inicial do HashRouter.
  private handleReload = () => {
    window.location.hash = '';
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div role="alert" aria-live="assertive" className="error-screen">
        <div className="error-screen__card">
          <TriangleAlert size={56} className="error-screen__icon" aria-hidden="true" />
          <h1 className="error-screen__title">Algo deu errado</h1>
          <p className="error-screen__text">
            Encontramos um problema inesperado. Você pode tentar recarregar a aplicação.
          </p>
          {this.state.error?.message && (
            <pre className="error-screen__detail">{this.state.error.message}</pre>
          )}
          <button
            type="button"
            onClick={this.handleReload}
            aria-label="Recarregar aplicação"
            className="btn btn--primary"
            style={{ minHeight: 64, minWidth: 200, fontSize: 'var(--fs-20)' }}
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
