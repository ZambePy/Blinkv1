import React, { useEffect, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { useCloud } from '../cloud/CloudContext';
import {
  conviteJaVisto,
  definirRelatosAutomaticos,
  marcarConviteVisto,
  relatosAutomaticosLigados,
} from '../services/diagnostico/relatosAutomaticos';

/**
 * Convite para ligar os relatos automáticos de falha.
 *
 * Aparece UMA vez, na primeira abertura com conta vinculada, e nunca mais —
 * seja qual for a resposta. É uma decisão do cuidador (o cartão é operado com
 * mouse e some com um clique), não do paciente, e por isso não é um alvo de
 * olhar: o paciente não deve conseguir autorizar por acidente o envio de dados
 * do próprio aplicativo, mesmo sendo só números.
 *
 * Cada botão leva `data-no-dwell`: o dispatcher lê a marca no próprio botão
 * (não no ancestral), e sem ela um olhar de 1,5 s em "Ligar" autorizaria o
 * envio.
 */
export const ConviteDeRelatos: React.FC = () => {
  const cloud = useCloud();
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (!cloud.vinculo) return;
    if (conviteJaVisto() || relatosAutomaticosLigados()) return;
    setVisivel(true);
  }, [cloud.vinculo]);

  if (!visivel) return null;

  const fechar = (ligar: boolean) => {
    if (ligar) definirRelatosAutomaticos(true);
    else marcarConviteVisto();
    setVisivel(false);
  };

  return (
    <div
      role="dialog"
      aria-labelledby="convite-relatos-titulo"
      data-no-dwell="true"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        zIndex: 2147482000,
        width: 420,
        maxWidth: 'calc(100vw - 48px)',
        padding: '1.25rem 1.4rem',
        borderRadius: '1.25rem',
        background: '#0f172a',
        color: '#e2e8f0',
        boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
        border: '1px solid rgba(148,163,184,0.35)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '0.95rem',
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <ShieldCheck size={28} color="#F0A030" aria-hidden="true" style={{ flex: '0 0 auto', marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <h2 id="convite-relatos-titulo" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>
            Avisar a IrisFlow quando o aplicativo falhar?
          </h2>
          <p style={{ margin: '0.5rem 0 0', opacity: 0.9 }}>
            Se ligar, cada erro do aplicativo envia um relatório com <strong>números</strong> — precisão
            da calibração, memória do computador, os últimos erros. <strong>Nenhuma frase do paciente,
            imagem ou dado de calibração</strong> vai junto. Dá para desligar em Ajustes a qualquer hora.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-no-dwell="true"
              onClick={() => fechar(true)}
              style={{
                padding: '0.6rem 1rem',
                borderRadius: '0.75rem',
                border: 'none',
                background: '#F0A030',
                color: '#1a1205',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Ligar relatos automáticos
            </button>
            <button
              type="button"
              data-no-dwell="true"
              onClick={() => fechar(false)}
              style={{
                padding: '0.6rem 1rem',
                borderRadius: '0.75rem',
                border: '1px solid rgba(148,163,184,0.5)',
                background: 'transparent',
                color: '#e2e8f0',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Agora não
            </button>
          </div>
        </div>
        <button
          type="button"
          data-no-dwell="true"
          onClick={() => fechar(false)}
          aria-label="Fechar"
          style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
