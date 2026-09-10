import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import React from 'react';
import i18n from '../../i18n';
import { LoginScreen } from './LoginScreen';
import { LicenseProvider } from '../../context/LicenseContext';
import {
  createMockLicenseService,
  CONTAS_DE_TESTE,
  SENHA_DE_TESTE,
  MOCK_NETWORK_KEY,
} from '../../services/license';
import type { LicenseService } from '../../services/license';

// -----------------------------------------------------------------------------
// Esta é a tela que mais gera suporte se for mal feita. Antes ela aceitava
// qualquer e-mail com qualquer senha não-vazia e navegava para o tutorial: não
// havia estado de erro possível além de "campo vazio".
//
// Cada motivo de recusa aqui tem uma saída diferente. Mostrar "algo deu errado"
// para os seis casos deixaria o cuidador sem saber se o problema é a senha, o
// cartão de crédito, ou o Wi-Fi.
// -----------------------------------------------------------------------------

let service: LicenseService;

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  service = createMockLicenseService();
});

/** Mostra a rota atual, para afirmar navegação sem depender da tela de destino. */
const Sonda: React.FC = () => {
  const loc = useLocation();
  return <div data-testid="rota">{loc.pathname}</div>;
};

const montar = () =>
  render(
    <LicenseProvider service={service}>
      <MemoryRouter initialEntries={['/login']}>
        <Sonda />
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/activated" element={<div>tela de ativacao</div>} />
        </Routes>
      </MemoryRouter>
    </LicenseProvider>
  );

const preencher = (email: string, senha: string) => {
  fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/senha/i), { target: { value: senha } });
};

// Depois de uma recusa o botao passa a dizer "Tentar de novo" — de proposito:
// repetir "Entrar" apos um erro nao sinaliza que houve uma tentativa.
const botaoEnviar = () => screen.getByRole('button', { name: /entrar|tentar de novo/i });
const enviar = () => fireEvent.click(botaoEnviar());

describe('campos vazios', () => {
  it('avisa sem chamar o servidor', () => {
    montar();
    enviar();
    expect(screen.getByRole('alert')).toHaveTextContent(/informe o e-mail e a senha/i);
  });
});

describe('cada recusa tem a sua saída', () => {
  it('senha errada: mensagem e link de recuperar senha', async () => {
    montar();
    preencher(CONTAS_DE_TESTE.ativa, 'errada');
    enviar();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/e-mail ou senha incorretos/i)
    );
    expect(screen.getByRole('link', { name: /esqueci minha senha/i })).toBeInTheDocument();
  });

  it('sem assinatura: mensagem e link para gerenciar no site', async () => {
    montar();
    preencher(CONTAS_DE_TESTE.semPlano, SENHA_DE_TESTE);
    enviar();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem uma assinatura ativa/i)
    );
    expect(screen.getByRole('link', { name: /gerenciar assinatura/i })).toBeInTheDocument();
  });

  it('sem assinatura: mostra a URL como texto, porque o Electron bloqueia abrir janela', async () => {
    // `setWindowOpenHandler` do processo principal nega toda janela nova. Sem a
    // URL visível, o link seria um botão morto e o cuidador ficaria travado.
    montar();
    preencher(CONTAS_DE_TESTE.semPlano, SENHA_DE_TESTE);
    enviar();

    await waitFor(() => expect(screen.getByText(/irisflow\.com\.br/i)).toBeInTheDocument());
  });

  it('já ativa em outro PC: leva à tela de ativação para transferir', async () => {
    montar();
    preencher(CONTAS_DE_TESTE.outroPC, SENHA_DE_TESTE);
    enviar();

    await waitFor(() => expect(screen.getByText('tela de ativacao')).toBeInTheDocument());
  });

  it('sem internet: mensagem e botão de tentar de novo', async () => {
    localStorage.setItem(MOCK_NETWORK_KEY, 'offline');
    montar();
    preencher(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE);
    enviar();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/sem conexão/i));
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument();
  });

  it('servidor fora: mensagem e horário da tentativa', async () => {
    localStorage.setItem(MOCK_NETWORK_KEY, 'down');
    montar();
    preencher(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE);
    enviar();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/servidor não respondeu/i)
    );
    expect(screen.getByText(/última tentativa às/i)).toBeInTheDocument();
  });

  it('tentativas demais: bloqueia o envio e conta o tempo', async () => {
    montar();
    for (let i = 0; i < 6; i++) {
      preencher(CONTAS_DE_TESTE.ativa, 'errada');
      enviar();
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    }

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/tentativas demais/i));
    expect(screen.getByRole('button', { name: /tentar de novo em/i })).toBeDisabled();
  });
});

describe('login que dá certo', () => {
  it('leva à tela de ativação', async () => {
    montar();
    preencher(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE);
    enviar();

    await waitFor(() => expect(screen.getByText('tela de ativacao')).toBeInTheDocument());
  });
});

describe('enquanto envia', () => {
  it('não deixa enviar duas vezes', async () => {
    montar();
    preencher(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE);

    const botao = botaoEnviar();
    fireEvent.click(botao);
    // Dois cliques rápidos: o segundo não pode virar um segundo login.
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute('aria-busy', 'true');

    await waitFor(() => expect(screen.getByText('tela de ativacao')).toBeInTheDocument());
  });
});

describe('criar conta', () => {
  it('aponta para o site, porque o cadastro não é feito no app', () => {
    montar();
    expect(screen.getByRole('link', { name: /criar no site/i })).toBeInTheDocument();
  });

  it('Modo Desenvolvedor liga o atalho e abre o menu sem licença nem calibração', async () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: /modo desenvolvedor/i }));
    await waitFor(() => expect(screen.getByTestId('rota').textContent).toBe('/menu'));
    expect(sessionStorage.getItem('irisflow_dev_mode')).toBe('true');
    sessionStorage.removeItem('irisflow_dev_mode');
  });
});
