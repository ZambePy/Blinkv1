import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLicense } from '../../context/LicenseContext';
import { temConsentimentoValido } from '../../services/local/consent';
import { isDevMode } from '../../devMode';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireCaregiver?: boolean;
}

/**
 * Portão de entrada das rotas internas.
 *
 * A **ordem** das verificações é a parte que importa, e é o que os testes
 * prendem: mandar alguém sem licença direto para `/profiles` faria a pessoa
 * cadastrar um paciente inteiro — nome, idade, foto — para só então descobrir
 * que a assinatura não está ativa.
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requireCaregiver = false,
}) => {
  const { currentProfile, isCaregiver } = useAuth();
  const { status } = useLicense();

  // 1. Modo Desenvolvedor: atalho deliberado, mantido a pedido para inspecionar
  //    o produto sem refazer o fluxo. §9 do spec o registra como pendência de
  //    lançamento — ele pula licença, termo e perfil.
  if (isDevMode()) return <>{children}</>;

  // 2. A verificação ainda está em curso. Renderizar `<Navigate to="/login">`
  //    aqui expulsaria para o login todo mundo que tem licença válida, no
  //    intervalo de milissegundos antes da resposta.
  if (status === 'checking') {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-base)',
          color: '#1B54A8',
          fontSize: '1.1rem',
          fontWeight: 700,
        }}
      >
        Carregando…
      </div>
    );
  }

  // 3. Sem licença utilizável. `grace` passa: ficar sem comunicação porque a
  //    internet caiu é pior do que uma licença não reverificada.
  if (status === 'none' || status === 'blocked') return <Navigate to="/login" replace />;

  // 4. O termo explica o que acontece com os dados — vem antes de pedi-los.
  if (!temConsentimentoValido()) return <Navigate to="/consent" replace />;

  // 5. Sem paciente escolhido não há calibração nem vocabulário para carregar.
  if (!currentProfile) return <Navigate to="/profiles" replace />;

  if (requireCaregiver && !isCaregiver) return <Navigate to="/menu" replace />;

  return <>{children}</>;
};
