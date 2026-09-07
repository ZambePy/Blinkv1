import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { PreparoGate } from './PreparoGate';
import { AuthProvider } from '../../context/AuthContext';
import { criarPerfil } from '../../services/local/profiles';
import { gravarPreparo, PREPARO_VERSION, chaveDoPreparo } from '../../services/local/setupProfile';

// -----------------------------------------------------------------------------
// O preparo bloqueia a CALIBRAÇÃO, não o app.
//
// Trancar o menu inteiro por preparo incompleto contradiz a premissa do
// projeto: nenhuma tela pode deixar alguém com ELA sem saída. Mas calibrar num
// ambiente não conferido produz um mapeamento ruim que o paciente vai carregar
// pela sessão toda — e ele não tem como diagnosticar isso.
// -----------------------------------------------------------------------------

const preparo = {
  cameraDeviceId: 'cam1',
  fpsMedido: 30,
  luxAmbiente: null,
  monitorDiagonalIn: 23.6,
  monitorOrigem: 'edid' as const,
};

let perfilId = '';

beforeEach(() => {
  sessionStorage.clear();
  const p = criarPerfil({ name: 'Joana' });
  perfilId = p.id;
  localStorage.setItem('irisflow_auth', JSON.stringify({ currentProfile: p }));
});

const montar = () =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/calibration-check']}>
        <Routes>
          <Route
            path="/calibration-check"
            element={
              <PreparoGate>
                <div>tela de calibracao</div>
              </PreparoGate>
            }
          />
          <Route path="/setup" element={<div>preparo do ambiente</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );

describe('sem preparo', () => {
  it('desvia para o wizard', () => {
    montar();
    expect(screen.getByText('preparo do ambiente')).toBeInTheDocument();
  });

  it('não deixa a calibração aparecer', () => {
    montar();
    expect(screen.queryByText('tela de calibracao')).toBeNull();
  });
});

describe('com preparo feito', () => {
  it('deixa calibrar', () => {
    gravarPreparo(perfilId, preparo);
    montar();
    expect(screen.getByText('tela de calibracao')).toBeInTheDocument();
  });

  it('não repete o wizard a cada calibração', () => {
    // O cuidador não refaz cinco telas todo dia. Este é o ponto de D7.
    gravarPreparo(perfilId, preparo);
    const primeira = montar();
    expect(screen.getByText('tela de calibracao')).toBeInTheDocument();
    primeira.unmount();

    montar();
    expect(screen.getByText('tela de calibracao')).toBeInTheDocument();
  });
});

describe('preparo de outra versão', () => {
  it('manda refazer', () => {
    // Um passo novo ou um limiar diferente torna o preparo antigo uma afirmação
    // sobre critérios que não existem mais.
    localStorage.setItem(
      chaveDoPreparo(perfilId),
      JSON.stringify({
        ...preparo,
        version: PREPARO_VERSION - 1,
        completedAt: new Date().toISOString(),
      })
    );

    montar();

    expect(screen.getByText('preparo do ambiente')).toBeInTheDocument();
  });
});

describe('preparo de outro perfil', () => {
  it('não vale para este', () => {
    // Dois pacientes na mesma casa podem usar o mesmo PC em salas diferentes.
    gravarPreparo('outro-perfil-qualquer', preparo);
    montar();
    expect(screen.getByText('preparo do ambiente')).toBeInTheDocument();
  });
});
