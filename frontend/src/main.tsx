import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './i18n';
import './index.css';
import { aplicarSessaoDaUrl } from './sessionFromUrl';

// ANTES de renderizar: a configuração de sessão vinda da URL. `EXPERIMENT` é
// resolvido no import do módulo, então aplicar depois não valeria para esta
// sessão — grava e recarrega, e só recarrega quando algo mudou de fato.
if (aplicarSessaoDaUrl()) {
  console.warn('[sessão] configuração da URL aplicada — recarregando.');
  window.location.reload();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
