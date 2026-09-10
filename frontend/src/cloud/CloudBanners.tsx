import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MessageCircle, Volume2 } from 'lucide-react';
import { GazeButton } from '../components/ui/GazeButton';
import { useCloud } from './CloudContext';

/**
 * Aviso de mensagem do cuidador, em qualquer tela do paciente.
 *
 * A mensagem já foi falada em voz alta pelo `CloudProvider`; este cartão a
 * deixa visível por alguns segundos com dois alvos grandes: ouvir de novo e
 * abrir a conversa para responder. Não aparece na calibração nem no teste de
 * precisão (cobriria alvos) e nem na própria tela de conversa.
 */
export const CloudBanners: React.FC = () => {
  const { mensagemNaTela, repetirUltimaMensagem, dispensarMensagemNaTela } = useCloud();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const escondido = !mensagemNaTela
    || pathname === '/conversation'
    || pathname === '/calibration-check'
    || pathname === '/emergency'
    || pathname === '/'
    || pathname === '/login';
  if (escondido || !mensagemNaTela) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', left: '50%', bottom: '2rem', transform: 'translateX(-50%)',
        zIndex: 99970, width: 'min(760px, 92vw)',
        background: '#1B54A8', color: '#fff', borderRadius: '1.75rem',
        boxShadow: '0 20px 50px rgba(27,84,168,0.45)', padding: '1.25rem 1.5rem',
        display: 'flex', alignItems: 'center', gap: '1.25rem',
      }}
    >
      <MessageCircle size={40} aria-hidden="true" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.95rem', opacity: 0.85, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Mensagem do cuidador
        </div>
        <div style={{ fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.3, wordBreak: 'break-word' }}>{mensagemNaTela.text}</div>
      </div>
      <GazeButton
        onClick={repetirUltimaMensagem}
        width={92}
        height={72}
        data-dwell-ms={1200}
        aria-label="Ouvir de novo"
        style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '2px solid rgba(255,255,255,0.5)', borderRadius: '1.25rem' }}
      >
        <Volume2 size={30} />
      </GazeButton>
      <GazeButton
        onClick={() => { dispensarMensagemNaTela(); navigate('/conversation'); }}
        width={170}
        height={72}
        data-dwell-ms={1500}
        style={{ background: '#fff', color: '#1B54A8', border: 'none', borderRadius: '1.25rem' }}
      >
        <span style={{ fontSize: '1.15rem', fontWeight: 900 }}>Responder</span>
      </GazeButton>
    </div>
  );
};
