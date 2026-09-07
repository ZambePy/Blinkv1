import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import i18n from '../../i18n';
import { ProfileSelect } from './ProfileSelect';
import { AuthProvider } from '../../context/AuthContext';
import { criarPerfil, listarPerfis } from '../../services/local/profiles';

// -----------------------------------------------------------------------------
// Antes esta tela listava "Paciente A/B/C" cravados no código e a rota era
// órfã — nada navegava para ela. Agora ela é o último passo antes da
// calibração, e os perfis são reais e locais.
// -----------------------------------------------------------------------------

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
});

const montar = () =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/profiles']}>
        <Routes>
          <Route path="/profiles" element={<ProfileSelect />} />
          <Route path="/calibration-check" element={<div>tela de calibracao</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );

describe('lista vazia', () => {
  it('não mostra pacientes fictícios', () => {
    montar();
    expect(screen.queryByText(/paciente a/i)).toBeNull();
  });

  it('convida a criar o primeiro', () => {
    montar();
    expect(screen.getByText(/nenhum perfil ainda/i)).toBeInTheDocument();
  });
});

describe('criar um perfil', () => {
  const abrirFormulario = () =>
    fireEvent.click(screen.getByRole('button', { name: /novo paciente/i }));

  it('exige o nome', () => {
    montar();
    abrirFormulario();
    fireEvent.click(screen.getByRole('button', { name: /criar perfil/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/nome é obrigatório/i);
    expect(listarPerfis()).toHaveLength(0);
  });

  it('cria com só o nome — idade e condição são opcionais', () => {
    montar();
    abrirFormulario();
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Joana' } });
    fireEvent.click(screen.getByRole('button', { name: /criar perfil/i }));

    expect(screen.getByText('Joana')).toBeInTheDocument();
    expect(listarPerfis()).toHaveLength(1);
  });

  it('guarda idade e condição quando informadas', () => {
    montar();
    abrirFormulario();
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Joana' } });
    fireEvent.change(screen.getByLabelText(/idade/i), { target: { value: '58' } });
    fireEvent.change(screen.getByLabelText(/condição/i), { target: { value: 'ELA' } });
    fireEvent.click(screen.getByRole('button', { name: /criar perfil/i }));

    const [p] = listarPerfis();
    expect(p.age).toBe(58);
    expect(p.condition).toBe('ELA');
  });

  it('avisa que a foto não sai do computador', () => {
    montar();
    abrirFormulario();
    expect(screen.getByText(/fica só neste computador/i)).toBeInTheDocument();
  });

  it('cancelar fecha o formulário sem criar nada', () => {
    montar();
    abrirFormulario();
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Joana' } });
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(listarPerfis()).toHaveLength(0);
  });
});

describe('escolher um perfil', () => {
  it('leva à conferência de calibração', () => {
    criarPerfil({ name: 'Joana' });
    montar();

    // `/joana/i` sozinho casaria tambem o botao "Remover Joana".
    fireEvent.click(screen.getByRole('button', { name: /joana.*iniciar sess/i }));

    expect(screen.getByText('tela de calibracao')).toBeInTheDocument();
  });
});

describe('remover um perfil', () => {
  it('tira da lista', () => {
    criarPerfil({ name: 'Joana' });
    montar();

    fireEvent.click(screen.getByRole('button', { name: /remover joana/i }));

    expect(screen.queryByText('Joana')).toBeNull();
    expect(listarPerfis()).toHaveLength(0);
  });
});
