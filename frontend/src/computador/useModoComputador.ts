import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EXPERIMENT } from '@tracker/config/experiment';
import { tamanhoDoCursorNoSistema } from '@tracker/computador/geometria';
import type { CapacidadesDoSistema } from '@tracker/computador/protocolo';
import { useGaze, suspenderDwell } from '../context/GazeContext';
import { useSettings } from '../context/SettingsContext';
import { limitarDwellMs } from '../dwellMs';
import { mensagemDeSaida, ponteDoModoComputador, type PonteDoModoComputador } from './ponte';

/**
 * Liga e desliga o Modo Computador a partir do app.
 *
 * Enquanto ativo, cada amostra do motor vai para o processo principal, que a
 * converte para a tela e a entrega à sobreposição. O app fica escondido; quem
 * termina o modo é a sobreposição (botão "IrisFlow", "Socorro", inatividade)
 * ou o sistema (tela mudou). O motivo volta por `onParou`, e é aqui que
 * "Socorro" vira a tela de emergência do app.
 */
export interface ModoComputador {
  disponivel: boolean;
  capacidades: CapacidadesDoSistema | null;
  ativo: boolean;
  iniciando: boolean;
  erro: string | null;
  aviso: string | null;
  iniciar: () => Promise<void>;
  parar: () => Promise<void>;
}

export function useModoComputador(ponte: PonteDoModoComputador | null = ponteDoModoComputador()): ModoComputador {
  const navigate = useNavigate();
  const { subscribe } = useGaze();
  const { settings } = useSettings();
  const [capacidades, setCapacidades] = useState<CapacidadesDoSistema | null>(null);
  const [ativo, setAtivo] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const cancelarFluxoRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!ponte) return;
    let vivo = true;
    void ponte.capacidades().then((c) => { if (vivo) setCapacidades(c); }).catch(() => { if (vivo) setCapacidades(null); });
    return () => { vivo = false; };
  }, [ponte]);

  const ativoRef = useRef(false);

  // Corta o fluxo de olhar e devolve o dwell ao app. Chamado em toda saída.
  const pararFluxo = useCallback(() => {
    cancelarFluxoRef.current?.();
    cancelarFluxoRef.current = null;
    suspenderDwell(false);
    ativoRef.current = false;
  }, []);

  useEffect(() => {
    if (!ponte) return;
    const off = ponte.onParou((motivo) => {
      pararFluxo();
      setAtivo(false);
      setIniciando(false);
      if (motivo === 'emergencia') {
        navigate('/emergency?autoTrigger=other');
        return;
      }
      setAviso(mensagemDeSaida(motivo));
    });
    return () => {
      off();
      // A tela saiu de cena com o modo ligado (um banner navegou, por
      // exemplo): encerra no sistema também, senão o app fica escondido sem
      // ninguém ouvindo o `parou`.
      if (ativoRef.current) void ponte.parar();
      pararFluxo();
    };
  }, [ponte, navigate, pararFluxo]);

  const iniciar = useCallback(async () => {
    if (!ponte || ativo || iniciando) return;
    setErro(null);
    setAviso(null);
    setIniciando(true);
    const r = await ponte.iniciar({
      dwellMs: limitarDwellMs(settings.dwellMs),
      tamanhoCursorPx: tamanhoDoCursorNoSistema(EXPERIMENT.cursorSizePx),
      lupa: true,
    });
    if (!r.ok) {
      setIniciando(false);
      setErro(r.motivo);
      return;
    }
    pararFluxo();
    // Dwell do app suspenso ANTES de ligar o fluxo: a janela fica oculta e o
    // olhar passa a ser da sobreposição.
    suspenderDwell(true);
    ativoRef.current = true;
    cancelarFluxoRef.current = subscribe((s) => {
      ponte.olhar({
        x: s.x,
        y: s.y,
        t: Number.isFinite(s.timestamp) ? s.timestamp : performance.now(),
        hasFace: s.hasFace,
        eyeState: s.eyeState ?? 'unknown',
        degraded: s.degraded === true,
        uncalibrated: s.uncalibrated === true,
      });
    });
    setIniciando(false);
    setAtivo(true);
  }, [ponte, ativo, iniciando, settings.dwellMs, subscribe, pararFluxo]);

  const parar = useCallback(async () => {
    if (!ponte) return;
    pararFluxo();
    await ponte.parar();
    setAtivo(false);
  }, [ponte, pararFluxo]);

  return {
    disponivel: ponte !== null,
    capacidades,
    ativo,
    iniciando,
    erro,
    aviso,
    iniciar,
    parar,
  };
}
