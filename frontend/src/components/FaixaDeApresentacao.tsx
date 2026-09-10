import React, { useEffect, useState } from 'react';
import { modoApresentacaoAtivo, ouvirModoApresentacao } from '../services/apresentacao';

/**
 * Faixa fixa que declara "isto é uma demonstração".
 *
 * Existe para o público, não para quem opera: numa apresentação, quem assiste
 * precisa saber que o pedido de socorro não vai chegar a ninguém e que o nome
 * na tela não é de uma pessoa real. Fica no topo, fora do caminho dos alvos de
 * olhar, com `pointer-events: none` para não roubar uma fixação — a faixa
 * nunca pode ser o motivo de um clique perdido.
 */
export const FaixaDeApresentacao: React.FC = () => {
  const [ativo, setAtivo] = useState(modoApresentacaoAtivo);

  useEffect(() => ouvirModoApresentacao(setAtivo), []);

  if (!ativo) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2147483000,
        pointerEvents: 'none',
        padding: '0.35rem 1.4rem',
        borderRadius: '0 0 0.9rem 0.9rem',
        background: '#F0A030',
        color: '#1a1205',
        fontSize: '0.8rem',
        fontWeight: 900,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
      }}
    >
      Modo apresentação · nada é enviado ao cuidador
    </div>
  );
};
