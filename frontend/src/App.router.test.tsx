import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HashRouter, BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import React from 'react';
import { AppRouter } from './App';

// -----------------------------------------------------------------------------
// `BrowserRouter` com `loadFile` (`file://`) no build empacotado.
//
// Em produção o Electron faz `win.loadFile(path.join(..., 'index.html'))`, então
// O app roda sob `file://`. `BrowserRouter` usa a History API:
// `navigate('/menu')` gera `file:///menu` — um caminho que não existe no disco.
//
// Qualquer reload, crash-recovery do Chromium ou `location.reload()` cai em
// "file not found" e o app morre em **tela branca**, sem console para o
// cuidador. Para um usuário com ELA, possivelmente desacompanhado, isso é o
// fim da sessão.
//
// ⚠️ O plano marca este item como *suspeita* quanto à extensão exata: o build
// empacotado não foi executado na análise. O que é verificável aqui é a
// ESCOLHA do router — o par `BrowserRouter` + `loadFile` é incompatível por
// construção. A confirmação definitiva exige rodar o instalador, e fica
// registrada como verificação manual pendente.
// -----------------------------------------------------------------------------

describe('o app usa HashRouter, não BrowserRouter', () => {
  it('AppRouter é o HashRouter', () => {
    expect(AppRouter).toBe(HashRouter);
  });

  it('AppRouter NÃO é o BrowserRouter', () => {
    // A assertiva que descreve o bug pelo nome.
    expect(AppRouter).not.toBe(BrowserRouter);
  });
});

describe('a rota vive depois do "#", que o file:// ignora', () => {
  it('navegar escreve no hash, não no pathname', () => {
    // A propriedade que salva o app sob `file://`: o documento carregado
    // continua sendo sempre o mesmo `index.html`; só o fragmento muda.
    const pathnameAntes = window.location.pathname;

    render(
      <AppRouter>
        <Routes>
          <Route path="/" element={<Link to="/menu">ir</Link>} />
          <Route path="/menu" element={<div>menu</div>} />
        </Routes>
      </AppRouter>,
    );

    screen.getByText('ir').click();

    expect(window.location.hash).toContain('/menu');
    // O pathname — o que o `file://` usa para achar o arquivo no disco — não
    // foi tocado. Com BrowserRouter ele viraria `/menu` e o reload quebraria.
    expect(window.location.pathname).toBe(pathnameAntes);
  });

  it('a rota inicial resolve sem hash prévio', () => {
    // Boot do app: `index.html` abre sem fragmento nenhum. O HashRouter
    // precisa tratar isso como "/" em vez de não casar rota alguma e renderizar
    // a tela branca que este bug produz.
    window.location.hash = '';
    render(
      <AppRouter>
        <Routes>
          <Route path="/" element={<div>inicial</div>} />
        </Routes>
      </AppRouter>,
    );
    expect(screen.getByText('inicial')).toBeInTheDocument();
  });
});
