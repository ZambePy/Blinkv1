import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { preparoConcluido } from '../../services/local/setupProfile';
import { isDevMode } from '../../devMode';

/**
 * Portão do preparo de ambiente.
 *
 * Fica **só na calibração**, não nas rotas em geral. Trancar o menu por preparo
 * incompleto contradiz a premissa do projeto — nenhuma tela pode deixar alguém
 * com ELA sem saída. Mas calibrar num ambiente não conferido produz um
 * mapeamento ruim que o paciente carrega pela sessão inteira, sem ter como
 * diagnosticar.
 *
 * O preparo é por perfil: dois pacientes na mesma casa podem usar o mesmo
 * computador em salas diferentes.
 */
export const PreparoGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentProfile } = useAuth();

  // Mesmo atalho do Bloco 1, pelo mesmo motivo: inspecionar o produto sem
  // refazer o fluxo. §9 do spec do Bloco 1 o registra como pendência.
  if (isDevMode()) return <>{children}</>;

  // Sem perfil quem responde é o `ProtectedRoute`, que manda para `/profiles`.
  if (!currentProfile) return <>{children}</>;

  if (!preparoConcluido(currentProfile.id)) return <Navigate to="/setup" replace />;

  return <>{children}</>;
};
