import React, { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import {
  ESTADO_SEM_PONTE,
  estadoDaAtualizacao,
  instalarAtualizacao,
  ouvirAtualizacao,
  textoDaFaixa,
  type EstadoDaAtualizacao,
} from '../services/atualizacao';

/**
 * Faixa discreta de atualização: "baixando…" e, depois, "nova versão pronta —
 * reiniciar agora".
 *
 * Quem decide reiniciar é o cuidador, com o mouse: o botão leva
 * `data-no-dwell`, porque uma fixação acidental de 1,5 s em "Reiniciar" no
 * meio de uma frase apagaria a frase. Se ninguém clicar, a versão nova entra
 * sozinha na próxima vez que o app fechar (electron/atualizacao.ts).
 *
 * Fica no canto inferior esquerdo, fora do caminho do teclado e dos alvos de
 * olhar, e some depois de reiniciar (o app inteiro reabre).
 */
export const FaixaDeAtualizacao: React.FC = () => {
  const [estado, setEstado] = useState<EstadoDaAtualizacao>(ESTADO_SEM_PONTE);
  const [reiniciando, setReiniciando] = useState(false);

  useEffect(() => {
    let vivo = true;
    estadoDaAtualizacao().then((e) => {
      if (vivo) setEstado(e);
    });
    const parar = ouvirAtualizacao((e) => {
      if (vivo) setEstado(e);
    });
    return () => {
      vivo = false;
      parar();
    };
  }, []);

  const texto = textoDaFaixa(estado);
  if (!texto) return null;

  const reiniciar = async () => {
    setReiniciando(true);
    const ok = await instalarAtualizacao();
    if (!ok) setReiniciando(false);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-no-dwell="true"
      style={{
        position: 'fixed',
        left: 24,
        bottom: 24,
        zIndex: 2147482000,
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.7rem 1rem',
        borderRadius: '1rem',
        background: '#0f172a',
        color: '#e2e8f0',
        border: '1px solid rgba(148,163,184,0.35)',
        boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '0.9rem',
        maxWidth: 'calc(100vw - 48px)',
      }}
    >
      {texto.acao === 'reiniciar' ? (
        <RefreshCw size={20} color="#F0A030" aria-hidden="true" />
      ) : (
        <Download size={20} color="#94a3b8" aria-hidden="true" />
      )}
      <span style={{ fontWeight: 700 }}>{texto.titulo}</span>
      {texto.acao === 'reiniciar' && (
        <button
          type="button"
          data-no-dwell="true"
          onClick={reiniciar}
          disabled={reiniciando}
          style={{
            padding: '0.45rem 0.9rem',
            borderRadius: '0.7rem',
            border: 'none',
            background: '#F0A030',
            color: '#1a1205',
            fontWeight: 800,
            cursor: reiniciando ? 'wait' : 'pointer',
            opacity: reiniciando ? 0.7 : 1,
          }}
        >
          {reiniciando ? 'Reiniciando…' : 'Reiniciar agora'}
        </button>
      )}
      {texto.acao === 'reiniciar' && !reiniciando && (
        <span style={{ fontSize: '0.78rem', opacity: 0.75 }}>ou ao fechar o app</span>
      )}
    </div>
  );
};
