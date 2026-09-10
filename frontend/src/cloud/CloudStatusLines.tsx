import React from 'react';
import { Smartphone, ShieldCheck, CloudOff } from 'lucide-react';
import { useCloud } from './CloudContext';
import { cofre } from './armazenamento';
import { licenseBackend } from '../services/license';

/**
 * Linhas da página **Conta e assinatura** sobre a ligação com o celular do
 * cuidador. Só aparecem quando a nuvem está configurada: em modo local (mock
 * de licença) não há o que dizer.
 *
 * Não tem botão: entrar e sair são do `LicenseContext`, que já vive nessa
 * página. Aqui é só o estado — o que o cuidador precisa saber quando uma
 * mensagem "não chegou".
 */
export const CloudStatusLines: React.FC<{ Linha: React.FC<{ icone: React.ReactNode; children: React.ReactNode }> }> = ({ Linha }) => {
  const cloud = useCloud();
  if (!cloud.configurada || licenseBackend !== 'supabase') return null;

  const celular = !cloud.vinculo
    ? 'celular do cuidador: sem vínculo neste computador'
    : !cloud.online
      ? 'celular do cuidador: sem internet — mensagens e alertas ficam na fila'
      : cloud.realtime === 'conectado'
        ? 'celular do cuidador: conectado em tempo real'
        : 'celular do cuidador: sincronizando por consulta periódica';

  return (
    <>
      <Linha icone={cloud.online && cloud.vinculo ? <Smartphone size={17} aria-hidden="true" /> : <CloudOff size={17} aria-hidden="true" />}>
        {celular}
        {cloud.filaPendente > 0 ? ` · ${cloud.filaPendente} envio(s) aguardando` : ''}
        {cloud.naoFaladas > 0 ? ` · ${cloud.naoFaladas} mensagem(ns) não falada(s)` : ''}
      </Linha>
      <Linha icone={<ShieldCheck size={17} aria-hidden="true" />}>
        {cofre.cifrado()
          ? 'credenciais da nuvem guardadas cifradas pelo sistema (safeStorage)'
          : 'credenciais da nuvem guardadas no navegador (modo de desenvolvimento)'}
        {' — sai deste computador só o texto que o paciente escolheu falar, alertas e o resumo numérico da calibração'}
      </Linha>
    </>
  );
};
