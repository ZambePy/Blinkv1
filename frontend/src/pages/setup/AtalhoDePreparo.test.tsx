import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import i18n from '../../i18n';
import { AtalhoDePreparo } from './AtalhoDePreparo';
import { AuthProvider } from '../../context/AuthContext';
import { criarPerfil } from '../../services/local/profiles';
import { gravarPreparo, preparoConcluido, lerPreparo } from '../../services/local/setupProfile';

// -----------------------------------------------------------------------------
// D7 do spec do Bloco 2: o preparo roda uma vez por perfil, "com atalho nas
// Configurações depois". Sem o atalho, trocar de sala ou de webcam deixa o
// cuidador preso a um preparo que não vale mais — e o único jeito de refazer
// seria apagar o perfil, junto com a calibração dele.
//
// O atalho NÃO apaga o preparo ao ser clicado. Ele leva ao wizard; quem grava
// por cima é a conclusão do wizard. Apagar antes deixaria o perfil sem preparo
// se o cuidador desistisse no meio — e aí ele nem calibrar conseguiria.
// -----------------------------------------------------------------------------

const preparo = {
  cameraDeviceId: 'cam1',
  fpsMedido: 30,
  luxAmbiente: null,
  monitorDiagonalIn: 23.6,
  monitorOrigem: 'edid' as const,
};

let perfilId = '';

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  const p = criarPerfil({ name: 'Joana' });
  perfilId = p.id;
  localStorage.setItem('irisflow_auth', JSON.stringify({ currentProfile: p }));
});

const montar = () =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<AtalhoDePreparo />} />
          <Route path="/setup" element={<div>wizard de preparo</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );

const botao = () => screen.getByRole('button', { name: /refazer|preparo/i });

describe('com preparo feito', () => {
  it('diz quando foi feito, para o cuidador saber se ainda vale', () => {
    gravarPreparo(perfilId, preparo);
    montar();
    expect(screen.getByText(/conclu[ií]do em/i)).toBeInTheDocument();
  });

  it('mostra a câmera e a taxa que ficaram registradas', () => {
    // Se a webcam foi trocada, é por aqui que o cuidador percebe.
    gravarPreparo(perfilId, { ...preparo, fpsMedido: 30 });
    montar();
    expect(screen.getByText(/30/)).toBeInTheDocument();
  });

  it('leva ao wizard', () => {
    gravarPreparo(perfilId, preparo);
    montar();
    fireEvent.click(botao());
    expect(screen.getByText('wizard de preparo')).toBeInTheDocument();
  });

  it('NÃO apaga o preparo ao abrir o wizard', () => {
    // Apagar aqui deixaria o perfil sem preparo se o cuidador desistisse no
    // meio — e sem preparo ele não passa nem pela calibração.
    gravarPreparo(perfilId, preparo);
    montar();

    fireEvent.click(botao());

    expect(preparoConcluido(perfilId)).toBe(true);
    expect(lerPreparo(perfilId)?.cameraDeviceId).toBe('cam1');
  });
});

describe('sem preparo ainda', () => {
  it('convida a fazer, em vez de mostrar um cartão vazio', () => {
    montar();
    expect(screen.getByText(/ainda n[ãa]o foi feito/i)).toBeInTheDocument();
  });

  it('o botão continua levando ao wizard', () => {
    montar();
    fireEvent.click(botao());
    expect(screen.getByText('wizard de preparo')).toBeInTheDocument();
  });
});

describe('sem perfil selecionado', () => {
  it('não renderiza nada — não há preparo de quem não existe', () => {
    localStorage.removeItem('irisflow_auth');
    const { container } = montar();
    expect(container.firstChild).toBeNull();
  });
});
