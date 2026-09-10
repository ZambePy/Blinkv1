import React, { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, Volume2, Keyboard, MessageSquare, Cloud, CloudOff, LogIn } from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeGrid } from '../../components/ui/GazeGrid';
import { GazeButton } from '../../components/ui/GazeButton';
import { useCloud } from '../../cloud/CloudContext';
import { emitirFalaDoPaciente } from '../../cloud/eventos';
import { falar } from '../../services/voz';
import type { Message } from '../../cloud/types';

/**
 * Conversa com o cuidador — o outro lado da aba "Conversa" do app mobile.
 *
 * O que o cuidador escreve no celular chega aqui (e é falado em voz alta ao
 * chegar, em qualquer tela). O que o paciente responde vai para o celular:
 * Sim/Não, uma frase rápida ou texto livre pelo teclado. Tudo passa pelo
 * barramento `cloud/eventos.ts`; esta tela não conhece o Supabase.
 */

const RESPOSTAS_PADRAO = ['Estou bem', 'Preciso de ajuda', 'Obrigado', 'Depois', 'Estou com sede', 'Quero descansar'];

const hora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

export const ConversationScreen: React.FC = () => {
  const navigate = useNavigate();
  const cloud = useCloud();
  const listaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cloud.vinculo) void cloud.carregarConversa();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.vinculo?.device_id]);

  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cloud.mensagens.length]);

  const respostasRapidas = useMemo(() => {
    const remotas = cloud.frasesRemotas.map((f) => f.text).filter(Boolean);
    return (remotas.length ? remotas : RESPOSTAS_PADRAO).slice(0, 6);
  }, [cloud.frasesRemotas]);

  const responder = (texto: string, kind: Message['kind']) => {
    emitirFalaDoPaciente(texto, kind);
    // Resposta do paciente: sai na voz dele (clonada) quando houver.
    void falar(texto, { rate: 1 });
  };

  const nomeDoCuidador = 'cuidador';
  const ultimas = cloud.mensagens.slice(-12);

  if (!cloud.configurada || !cloud.vinculo) {
    return (
      <GazePageLayout showBack backRoute="/menu" showEmergency>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1.5rem', textAlign: 'center' }}>
          <CloudOff size={72} color="#94a3b8" aria-hidden="true" />
          <h1 style={{ fontSize: '2.4rem', fontWeight: 900, margin: 0, color: 'var(--color-text-base)' }}>Conversa com o cuidador</h1>
          <p style={{ fontSize: '1.3rem', maxWidth: 640, margin: 0, color: 'var(--color-text-base)', opacity: 0.8, lineHeight: 1.5 }}>
            {cloud.configurada
              ? 'Este computador ainda não está ligado a uma conta IrisFlow. Entre com o e-mail e a senha da assinatura para receber e responder mensagens do celular do cuidador.'
              : 'A conversa com o celular do cuidador precisa da conta IrisFlow configurada neste computador (frontend/.env.local). Sem ela, o aplicativo funciona só localmente.'}
          </p>
          {cloud.configurada && (
            <GazeButton onClick={() => navigate('/login')} width={360} height={90} style={{ borderRadius: '1.5rem' }}>
              <LogIn size={30} /> <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>Entrar com a conta</span>
            </GazeButton>
          )}
        </div>
      </GazePageLayout>
    );
  }

  return (
    <GazePageLayout showBack backRoute="/menu" showEmergency>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: '1rem', boxSizing: 'border-box' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2.2rem', fontWeight: 900, margin: 0, color: 'var(--color-text-base)' }}>
              Conversa com o {nomeDoCuidador}
            </h1>
            <p style={{ margin: '0.25rem 0 0', fontSize: '1.1rem', opacity: 0.75, color: 'var(--color-text-base)' }}>
              {cloud.vinculo.beneficiary_name} · {cloud.online ? (cloud.realtime === 'conectado' ? 'ao vivo' : 'sincronizando') : 'sem internet — as respostas ficam na fila'}
            </p>
          </div>
          <div aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: cloud.online ? '#16a34a' : '#b45309', fontWeight: 700 }}>
            {cloud.online ? <Cloud size={26} /> : <CloudOff size={26} />}
            {cloud.filaPendente > 0 ? `${cloud.filaPendente} na fila` : cloud.online ? 'conectado' : 'offline'}
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: '1.5rem', flex: 1, minHeight: 0 }}>
          {/* mensagens */}
          <div
            ref={listaRef}
            role="log"
            aria-label="Mensagens"
            style={{
              overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem',
              padding: '1rem', borderRadius: '1.5rem',
              background: 'var(--color-card-bg, rgba(255,255,255,0.06))',
              border: '2px solid var(--color-card-border, rgba(148,163,184,0.3))',
            }}
          >
            {ultimas.length === 0 && (
              <p style={{ margin: 'auto', textAlign: 'center', opacity: 0.7, fontSize: '1.2rem', color: 'var(--color-text-base)' }}>
                Quando o cuidador escrever no celular, a mensagem aparece aqui e é falada em voz alta.
              </p>
            )}
            {ultimas.map((m) => {
              const doCuidador = m.sender === 'cuidador';
              return (
                <div key={m.id} style={{ display: 'flex', justifyContent: doCuidador ? 'flex-start' : 'flex-end' }}>
                  <div
                    style={{
                      maxWidth: '85%', padding: '0.9rem 1.2rem', borderRadius: '1.25rem',
                      background: doCuidador ? '#1B54A8' : 'rgba(22,163,74,0.18)',
                      color: doCuidador ? '#fff' : 'var(--color-text-base)',
                      border: doCuidador ? 'none' : '2px solid rgba(22,163,74,0.5)',
                      fontSize: m.kind === 'simnao' ? '1.8rem' : '1.35rem', fontWeight: m.kind === 'simnao' ? 900 : 600, lineHeight: 1.35,
                    }}
                  >
                    {m.text}
                    <div style={{ fontSize: '0.85rem', opacity: 0.75, marginTop: '0.3rem', fontWeight: 500 }}>
                      {doCuidador ? nomeDoCuidador : 'você'} · {hora(m.created_at)}{doCuidador && !m.spoken ? ' · nova' : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* respostas */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <GazeGrid columns={2} rows={2} gap={16}>
                <GazeButton onClick={() => responder('Sim', 'simnao')} style={{ height: '100%', background: '#16a34a', color: '#fff', border: '3px solid #15803d', borderRadius: '1.5rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                    <Check size={56} /> <span style={{ fontSize: '2rem', fontWeight: 900 }}>Sim</span>
                  </div>
                </GazeButton>
                <GazeButton onClick={() => responder('Não', 'simnao')} style={{ height: '100%', background: '#dc2626', color: '#fff', border: '3px solid #991b1b', borderRadius: '1.5rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                    <X size={56} /> <span style={{ fontSize: '2rem', fontWeight: 900 }}>Não</span>
                  </div>
                </GazeButton>
                <GazeButton onClick={() => cloud.repetirUltimaMensagem()} style={{ height: '100%', borderRadius: '1.5rem' }} aria-label="Repetir a última mensagem em voz alta">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                    <Volume2 size={48} color="#1B54A8" /> <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>Repetir</span>
                  </div>
                </GazeButton>
                <GazeButton onClick={() => navigate('/keyboard')} style={{ height: '100%', borderRadius: '1.5rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                    <Keyboard size={48} color="#1B54A8" /> <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>Escrever</span>
                  </div>
                </GazeButton>
              </GazeGrid>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <GazeGrid columns={3} rows={2} gap={12}>
                {respostasRapidas.map((r) => (
                  <GazeButton key={r} onClick={() => responder(r, 'frase')} style={{ height: '100%', borderRadius: '1.25rem' }}>
                    <span style={{ fontSize: '1.15rem', fontWeight: 700, padding: '0 0.5rem', textAlign: 'center' }}>
                      <MessageSquare size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />{r}
                    </span>
                  </GazeButton>
                ))}
              </GazeGrid>
            </div>
          </div>
        </div>
      </div>
    </GazePageLayout>
  );
};
