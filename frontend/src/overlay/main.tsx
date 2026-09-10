import React from 'react';
import ReactDOM from 'react-dom/client';
import { Overlay } from './Overlay';

// Página da sobreposição do Modo Computador. Entrada separada do app
// (`overlay.html`): sem router, sem providers, sem câmera — o olhar chega
// pronto pelo preload. Nada do `index.css` do app: o fundo TEM de ser
// transparente, e o tema escuro do app pintaria a tela inteira.
document.documentElement.style.background = 'transparent';
document.body.style.margin = '0';
document.body.style.background = 'transparent';
document.body.style.overflow = 'hidden';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>,
);
