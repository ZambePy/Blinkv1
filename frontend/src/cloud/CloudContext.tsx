/**
 * Ponte do desktop com o ecossistema IrisFlow (site + app do cuidador).
 *
 * Quem decide se há conta e licença é o `LicenseContext` (Bloco 1), através do
 * `supabaseLicenseService`. Este provider começa DEPOIS disso: quando a
 * licença está `active` ou `grace`, o `token` dela é a chave do computador
 * (`pair_device()`), e com ela:
 *
 *   SAÍDA  (paciente)    fala, socorro, calibração, sessão → Edge Function
 *                        `desktop-sync`
 *   ENTRADA (cuidador)   mensagens e ajustes remotos → realtime (postgres_changes)
 *                        com polling de reserva
 *
 * Nada de imagem, landmark, perfil de calibração ou relatório bruto passa por
 * aqui — só texto que o paciente quis falar, alertas e números agregados.
 *
 * Sem `VITE_SUPABASE_URL`/`ANON_KEY` o provider fica inerte: `configurada =
 * false`, todas as ações são no-op e o app se comporta como antes.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useGaze } from '../context/GazeContext';
import { useSettings } from '../context/SettingsContext';
import { useLicense } from '../context/LicenseContext';
import { limitarDwellMs } from '../dwellMs';
import { EVENTO_ANTES_DE_SAIR } from '../services/license/supabaseLicenseService';
import { cloudConfig, nuvemConfigurada } from './config';
import { cofre, CHAVES, infoDoApp } from './armazenamento';
import { supabase } from './supabaseClient';
import { DesktopSync } from './desktopSync';
import { ouvir, emitirFalaDoPaciente, type EventoDoPaciente } from './eventos';
import { camposDeCalibracao, resumoDoRelatorio } from './sessao';
import { falarComVozDoSistema } from '../services/voz/sistema';
import { assinarEstadoDaVoz, estadoDaVoz, vozClonadaPronta } from '../services/voz';
import type { HelpKind, Message, MessageKind, PatientSettings, QuickPhrase, VinculoLocal } from './types';

export interface CloudState {
  /** Há URL e chave do Supabase. Falso = app 100% local, como sempre. */
  configurada: boolean;
  online: boolean;
  /** Computador vinculado (chave + paciente). Nulo = sem licença ativa ou nuvem desligada. */
  vinculo: VinculoLocal | null;
  sessaoId: string | null;
  /** Últimas mensagens da conversa (as duas direções), mais antiga primeiro. */
  mensagens: Message[];
  /** Mensagem do cuidador recém-chegada, para o aviso na tela. */
  mensagemNaTela: Message | null;
  naoFaladas: number;
  ajustesRemotos: PatientSettings | null;
  frasesRemotas: QuickPhrase[];
  realtime: 'conectado' | 'desconectado' | 'indisponivel';
  filaPendente: number;
}

export interface CloudActions {
  enviarFalaDoPaciente: (texto: string, kind?: MessageKind) => Promise<void>;
  pedirAjuda: (kind: HelpKind, mensagem: string) => Promise<void>;
  repetirUltimaMensagem: () => void;
  dispensarMensagemNaTela: () => void;
  carregarConversa: () => Promise<void>;
}

const estadoInicial: CloudState = {
  configurada: nuvemConfigurada,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  vinculo: null,
  sessaoId: null,
  mensagens: [],
  mensagemNaTela: null,
  naoFaladas: 0,
  ajustesRemotos: null,
  frasesRemotas: [],
  realtime: 'indisponivel',
  filaPendente: 0,
};

const acoesInertes: CloudActions = {
  enviarFalaDoPaciente: async () => {},
  pedirAjuda: async () => {},
  repetirUltimaMensagem: () => {},
  dispensarMensagemNaTela: () => {},
  carregarConversa: async () => {},
};

const CloudContext = createContext<CloudState & CloudActions>({ ...estadoInicial, ...acoesInertes });

/** Fora do provider (testes de tela) devolve o estado inerte — nunca lança. */
export const useCloud = () => useContext(CloudContext);

/** O app do cuidador oferece 800/1500/2500; o desktop aceita qualquer valor na faixa. */
const dwellRemotoParaLocal = (ms: number) => limitarDwellMs(ms);
/** O banco só aceita 800/1500/2500 em `sessions.dwell_ms`: arredonda para o degrau mais próximo. */
const dwellLocalParaRemoto = (ms: number): 800 | 1500 | 2500 =>
  ms <= 1150 ? 800 : ms <= 2000 ? 1500 : 2500;
const MENSAGEM_NA_TELA_MS = 15_000;
const POLL_MS = 20_000;

// Mensagem do CUIDADOR lida em voz alta: voz do sistema, de propósito — a voz
// clonada é a do paciente e não deve dizer o que outra pessoa escreveu.
const falar = (texto: string): Promise<void> => falarComVozDoSistema(texto, { rate: 0.95 });

export const CloudProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const gaze = useGaze();
  const { settings, updateSettings } = useSettings();
  const { status: statusDaLicenca, license, reverificar } = useLicense();
  const [estado, setEstado] = useState<CloudState>(estadoInicial);
  const patch = useCallback((p: Partial<CloudState> | ((s: CloudState) => Partial<CloudState>)) => {
    setEstado((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));
  }, []);

  // Refs para o que os timers e o barramento leem sem re-assinar a cada render.
  const vinculoRef = useRef<VinculoLocal | null>(null);
  const sessaoIdRef = useRef<string | null>(null);
  const contadoresRef = useRef({ frases: 0, caracteres: 0, modulos: new Set<string>() });
  const ultimaDoCuidadorRef = useRef<Message | null>(null);
  const gazeRef = useRef(gaze);
  gazeRef.current = gaze;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const ajustesAplicadosRef = useRef<string | null>(null);
  const presetAplicadoRef = useRef<string | null>(null);
  /** Mensagens do cuidador sendo faladas agora — evita falar duas vezes (realtime × polling). */
  const falandoRef = useRef(new Set<string>());
  const realtimeRef = useRef<CloudState['realtime']>('indisponivel');
  const canalRef = useRef<RealtimeChannel | null>(null);
  const syncRef = useRef<DesktopSync | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sync = useMemo(
    () => new DesktopSync({
      chave: () => vinculoRef.current?.device_key ?? null,
      aoPerderCredencial: () => {
        // Computador desvinculado pelo cuidador (site ou app): esquece a chave,
        // fecha o realtime, descarta a fila (não pode vazar para outra conta) e
        // pede ao LicenseContext que reverifique — a resposta será `revoked` e
        // o portão de rotas leva ao login. Não derruba a sessão atual à força.
        console.warn('[cloud] chave do computador recusada — vínculo desfeito');
        vinculoRef.current = null;
        sessaoIdRef.current = null;
        if (canalRef.current) { void supabase().removeChannel(canalRef.current); canalRef.current = null; }
        void cofre.remover(CHAVES.vinculo);
        void cofre.remover(CHAVES.filaDeEnvio);
        patch({ vinculo: null, sessaoId: null, realtime: 'indisponivel' });
        void reverificarRef.current?.();
      },
    }),
    [patch],
  );
  const reverificarRef = useRef(reverificar);
  reverificarRef.current = reverificar;

  syncRef.current = sync;

  // ---------- helpers ----------
  const aplicarAjustesRemotos = useCallback((a: PatientSettings | null) => {
    if (!a) return;
    patch({ ajustesRemotos: a });
    if (ajustesAplicadosRef.current === a.updated_at) return;
    ajustesAplicadosRef.current = a.updated_at;
    const dwell = dwellRemotoParaLocal(Number(a.dwell_ms));
    if (Number.isFinite(dwell) && dwell !== settingsRef.current.dwellMs) {
      console.log(`[cloud] ajuste remoto: tempo de fixação → ${dwell} ms`);
      updateSettings({ dwellMs: dwell });
    }
    // Os presets de produção são os "-v2" (em graus); os v1 filtram em px com
    // τ de vários segundos e deixariam o cursor inutilizável.
    if (a.filter_preset && a.filter_preset !== presetAplicadoRef.current) {
      presetAplicadoRef.current = a.filter_preset;
      console.log(`[cloud] ajuste remoto: suavização → ${a.filter_preset}`);
      try { gazeRef.current.setFilterPreset(`${a.filter_preset}-v2`); } catch (e) { console.warn('[cloud] preset não aplicado', e); }
    }
  }, [patch, updateSettings]);

  const mostrarNaTela = useCallback((m: Message) => {
    patch({ mensagemNaTela: m });
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => patch((s) => (s.mensagemNaTela?.id === m.id ? { mensagemNaTela: null } : {})), MENSAGEM_NA_TELA_MS);
  }, [patch]);

  const receberDoCuidador = useCallback(async (m: Message) => {
    ultimaDoCuidadorRef.current = m;
    patch((s) => {
      const existe = s.mensagens.some((x) => x.id === m.id);
      const mensagens = existe ? s.mensagens.map((x) => (x.id === m.id ? m : x)) : [...s.mensagens, m].slice(-200);
      return { mensagens, naoFaladas: mensagens.filter((x) => x.sender === 'cuidador' && !x.spoken).length };
    });
    if (m.spoken || falandoRef.current.has(m.id)) return;
    falandoRef.current.add(m.id);
    try {
      mostrarNaTela(m);
      await falar(m.text);
      await sync.enviar({ action: 'message.spoken', message_id: m.id });
      patch((s) => {
        const mensagens = s.mensagens.map((x) => (x.id === m.id ? { ...x, spoken: true } : x));
        return { mensagens, naoFaladas: mensagens.filter((x) => x.sender === 'cuidador' && !x.spoken).length };
      });
    } finally {
      falandoRef.current.delete(m.id);
    }
  }, [patch, sync, mostrarNaTela]);

  const buscarPendentes = useCallback(async () => {
    if (!vinculoRef.current) return;
    const r = await sync.enviar({ action: 'messages.pending' });
    for (const m of r.messages ?? []) await receberDoCuidador(m);
  }, [sync, receberDoCuidador]);

  const carregarConversa = useCallback(async () => {
    const v = vinculoRef.current;
    if (!v) return;
    try {
      const { data } = await supabase()
        .from('messages')
        .select('*')
        .eq('beneficiary_id', v.beneficiary_id)
        .order('created_at', { ascending: false })
        .limit(60);
      const lista = ((data ?? []) as Message[]).reverse();
      const ultima = [...lista].reverse().find((m) => m.sender === 'cuidador') ?? null;
      if (ultima) ultimaDoCuidadorRef.current = ultima;
      patch({ mensagens: lista, naoFaladas: lista.filter((m) => m.sender === 'cuidador' && !m.spoken).length });
    } catch (e) {
      console.warn('[cloud] não foi possível carregar a conversa', e);
    }
  }, [patch]);

  const carregarAjustes = useCallback(async () => {
    if (!vinculoRef.current) return;
    const r = await sync.enviar({ action: 'settings.get' });
    if (r.settings) aplicarAjustesRemotos(r.settings);
    if (r.phrases) patch({ frasesRemotas: r.phrases });
    // Ao ligar os serviços, conta qual voz está em uso (o efeito abaixo só
    // reage a MUDANÇAS do motor, que podem ter acontecido antes do vínculo).
    const voz = estadoDaVoz();
    if (voz) void sync.enviar({ action: 'voice.status', voice: vozClonadaPronta(voz) ? 'Voz clonada (local)' : 'pt-BR padrão' });
  }, [sync, aplicarAjustesRemotos, patch]);

  const abrirSessao = useCallback(async (appVersion: string) => {
    if (!vinculoRef.current || sessaoIdRef.current) return;
    const s = settingsRef.current;
    const r = await sync.enviar({
      action: 'session.upsert',
      session: {
        status: 'active',
        started_at: new Date().toISOString(),
        dwell_ms: dwellLocalParaRemoto(s.dwellMs),
        filter_preset: 'balanceado',
        app_version: appVersion,
        modules_used: [],
      },
    });
    if (r.id) {
      sessaoIdRef.current = r.id;
      patch({ sessaoId: r.id });
    }
  }, [sync, patch]);

  const encerrarSessao = useCallback(async () => {
    const id = sessaoIdRef.current;
    if (!id) return;
    const c = contadoresRef.current;
    sessaoIdRef.current = null;
    patch({ sessaoId: null });
    await sync.enviar({
      action: 'session.end', session_id: id,
      utterances: c.frases, chars_typed: c.caracteres, modules_used: [...c.modulos],
    });
  }, [sync, patch]);

  const assinarRealtime = useCallback(async (beneficiaryId: string) => {
    // `channel()` reaproveita um canal com o mesmo tópico ainda em `leaving`
    // e o `subscribe()` vira no-op: espera o antigo sair e usa tópico único.
    if (canalRef.current) { await supabase().removeChannel(canalRef.current); canalRef.current = null; }
    const filter = `beneficiary_id=eq.${beneficiaryId}`;
    const canal = supabase()
      .channel(`desktop:${beneficiaryId}:${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, (p) => {
        const m = p.new as Message;
        if (m.sender === 'cuidador') void receberDoCuidador(m);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_settings', filter }, (p) => {
        if (p.new && 'beneficiary_id' in p.new) aplicarAjustesRemotos(p.new as PatientSettings);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quick_phrases', filter }, () => {
        void carregarAjustes();
      })
      .subscribe((status) => {
        realtimeRef.current = status === 'SUBSCRIBED' ? 'conectado' : 'desconectado';
        patch({ realtime: realtimeRef.current });
      });
    canalRef.current = canal;
  }, [receberDoCuidador, aplicarAjustesRemotos, carregarAjustes, patch]);

  const iniciarServicos = useCallback(async (v: VinculoLocal) => {
    vinculoRef.current = v;
    patch({ vinculo: v });
    const info = await infoDoApp();
    await Promise.all([carregarConversa(), carregarAjustes(), buscarPendentes()]);
    await abrirSessao(info.version);
    await assinarRealtime(v.beneficiary_id);
    void sync.drenar().then((n) => { if (n) console.log(`[cloud] ${n} item(ns) reenviado(s) da fila`); });
  }, [patch, carregarConversa, carregarAjustes, buscarPendentes, abrirSessao, assinarRealtime, sync]);

  const pararServicos = useCallback(async () => {
    if (canalRef.current) { void supabase().removeChannel(canalRef.current); canalRef.current = null; }
    await encerrarSessao();
    vinculoRef.current = null;
    patch({ vinculo: null, realtime: 'indisponivel', mensagens: [], naoFaladas: 0, mensagemNaTela: null });
  }, [encerrarSessao, patch]);

  // ---------- segue a licença ----------
  // `active`/`grace` com token = chave do computador → liga os serviços.
  // `none`/`blocked` (saiu, revogado, venceu) → desliga e encerra a sessão.
  const tokenAtivo = statusDaLicenca === 'active' || statusDaLicenca === 'grace' ? license?.token ?? null : null;
  useEffect(() => {
    if (!nuvemConfigurada) return;
    let vivo = true;
    (async () => {
      if (!tokenAtivo) {
        if (vinculoRef.current) await pararServicos();
        return;
      }
      if (vinculoRef.current?.device_key === tokenAtivo) return;
      if (vinculoRef.current) {
        // Chave nova (novo login neste PC): a anterior já foi revogada pelo
        // pareamento, então não há como encerrar a sessão antiga com ela.
        // Solta a referência e deixa `iniciarServicos` abrir outra.
        sessaoIdRef.current = null;
        patch({ sessaoId: null });
      }
      // O vínculo completo (id do paciente, e-mail) fica no cofre, gravado pelo
      // supabaseLicenseService no pareamento; a licença traz o essencial caso
      // o cofre tenha sido limpo.
      const doCofre = await cofre.lerJson<VinculoLocal>(CHAVES.vinculo);
      const beneficiaryId = doCofre?.beneficiary_id ?? license?.account.beneficiaryId;
      if (!beneficiaryId) {
        console.warn('[cloud] licença ativa sem paciente vinculado — conversa desligada');
        return;
      }
      const vinculo: VinculoLocal = {
        device_id: doCofre?.device_id ?? '',
        device_key: tokenAtivo,
        beneficiary_id: beneficiaryId,
        beneficiary_name: doCofre?.beneficiary_name ?? license?.account.beneficiaryName ?? license?.account.name ?? '',
        email: doCofre?.email ?? license?.account.email ?? '',
        pareado_em: doCofre?.pareado_em ?? license?.thisDevice.boundAt ?? new Date().toISOString(),
      };
      if (!vivo) return;
      try {
        await iniciarServicos(vinculo);
      } catch (e) {
        console.warn('[cloud] não foi possível iniciar os serviços da nuvem', e);
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenAtivo]);

  // Ao desmontar (fechar a janela sem `pagehide`), fecha o canal.
  useEffect(() => () => {
    if (canalRef.current) { void supabase().removeChannel(canalRef.current); canalRef.current = null; }
  }, []);

  // ---------- online/offline ----------
  useEffect(() => {
    const on = () => {
      patch({ online: true });
      void sync.drenar();
      void buscarPendentes();
      // A abertura de sessão não entra na fila (precisa da resposta): reabre aqui.
      if (vinculoRef.current && !sessaoIdRef.current) void infoDoApp().then((i) => abrirSessao(i.version));
    };
    const off = () => patch({ online: false });
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [patch, sync, buscarPendentes, abrirSessao]);

  // ---------- heartbeat + polling de reserva ----------
  useEffect(() => {
    if (!estado.vinculo) return;
    let versao = 'dev';
    void infoDoApp().then((i) => { versao = i.version; });
    const bater = () => {
      const g = gazeRef.current;
      void sync.enviar({
        action: 'heartbeat',
        app_version: versao,
        camera_ok: !g.cameraError && g.getCameraStream() !== null,
        tracker_ok: g.state === 'tracking' || g.state === 'calibrating' || g.state === 'uncalibrated',
        calibrated: g.calibration?.isCalibrated?.() ?? false,
      }).then((r) => {
        patch({ filaPendente: sync.tamanhoDaFila });
        if ((r.pending_messages ?? 0) > 0) void buscarPendentes();
      });
    };
    bater();
    const hb = setInterval(bater, cloudConfig.heartbeatMs);
    const poll = setInterval(() => { if (realtimeRef.current !== 'conectado') void buscarPendentes(); }, POLL_MS);
    return () => { clearInterval(hb); clearInterval(poll); };
  }, [estado.vinculo, sync, buscarPendentes, patch]);

  // ---------- fim da sessão ao fechar ----------
  useEffect(() => {
    const aoFechar = () => {
      const id = sessaoIdRef.current;
      const chave = vinculoRef.current?.device_key;
      if (!id || !chave || !cloudConfig.desktopSyncUrl || !syncRef.current) return;
      const c = contadoresRef.current;
      // keepalive: a requisição sobrevive ao fechamento da janela.
      void fetch(cloudConfig.desktopSyncUrl, {
        method: 'POST', keepalive: true,
        headers: syncRef.current.cabecalhos(chave),
        body: JSON.stringify({ action: 'session.end', session_id: id, utterances: c.frases, chars_typed: c.caracteres, modules_used: [...c.modulos] }),
      }).catch(() => undefined);
      sessaoIdRef.current = null;
    };
    window.addEventListener('pagehide', aoFechar);
    // Sair da conta revoga a chave em seguida: fecha a sessão enquanto ela vale.
    window.addEventListener(EVENTO_ANTES_DE_SAIR, aoFechar);
    return () => {
      window.removeEventListener('pagehide', aoFechar);
      window.removeEventListener(EVENTO_ANTES_DE_SAIR, aoFechar);
    };
  }, []);

  // ---------- eventos do paciente ----------
  useEffect(() => {
    return ouvir((e: EventoDoPaciente) => {
      const c = contadoresRef.current;
      switch (e.tipo) {
        case 'fala': {
          c.frases++;
          c.caracteres += e.texto.length;
          const local: Message = {
            id: `local-${Date.now()}`, beneficiary_id: vinculoRef.current?.beneficiary_id ?? '',
            sender: 'paciente', kind: e.kind, text: e.texto, created_at: new Date().toISOString(), read_at: null, spoken: true,
          };
          patch((s) => ({ mensagens: [...s.mensagens, local].slice(-200) }));
          void sync.enviar({ action: 'message.send', text: e.texto, kind: e.kind }).then((r) => {
            if (r.id) patch((s) => ({ mensagens: s.mensagens.map((m) => (m.id === local.id ? { ...m, id: r.id! } : m)) }));
          });
          break;
        }
        case 'ajuda':
          void sync.enviar({ action: 'help.create', kind: e.kind, message: e.mensagem, session_id: sessaoIdRef.current });
          break;
        case 'calibracao': {
          const r = e.resultado;
          void sync.enviar({
            action: 'calibration.result',
            session_id: sessaoIdRef.current ?? undefined,
            calibration: camposDeCalibracao(r, e.meta, e.duracaoCalibracaoS),
            report: resumoDoRelatorio(r, e.meta),
          }).then((resp) => {
            if (resp.id && !sessaoIdRef.current) { sessaoIdRef.current = resp.id; patch({ sessaoId: resp.id }); }
          });
          break;
        }
        case 'uso':
          if (e.caracteres) c.caracteres += e.caracteres;
          if (e.frases) c.frases += e.frases;
          if (e.modulo) c.modulos.add(e.modulo);
          break;
      }
    });
  }, [sync, patch]);

  // ---------- ações ----------
  // Passa pelo barramento como qualquer tela: um único caminho de saída.
  const enviarFalaDoPaciente = useCallback(async (texto: string, kind: MessageKind = 'texto') => {
    emitirFalaDoPaciente(texto, kind);
  }, []);

  const pedirAjuda = useCallback(async (kind: HelpKind, mensagem: string) => {
    await sync.enviar({ action: 'help.create', kind, message: mensagem, session_id: sessaoIdRef.current });
  }, [sync]);

  const repetirUltimaMensagem = useCallback(() => {
    const m = ultimaDoCuidadorRef.current;
    if (m) void falar(m.text);
  }, []);

  const dispensarMensagemNaTela = useCallback(() => patch({ mensagemNaTela: null }), [patch]);

  // Voz em uso → app do cuidador (Ajustes → Voz). Só um rótulo: "clonada" ou
  // "do sistema"; nada do áudio sai daqui. Enfileirável, como as outras.
  useEffect(() => {
    let ultimo: string | null = null;
    return assinarEstadoDaVoz((e) => {
      if (!e || !vinculoRef.current) return;
      const rotulo = vozClonadaPronta(e) ? 'Voz clonada (local)' : 'pt-BR padrão';
      if (rotulo === ultimo) return;
      ultimo = rotulo;
      void syncRef.current?.enviar({ action: 'voice.status', voice: rotulo });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({ ...estado, enviarFalaDoPaciente, pedirAjuda, repetirUltimaMensagem, dispensarMensagemNaTela, carregarConversa }),
    [estado, enviarFalaDoPaciente, pedirAjuda, repetirUltimaMensagem, dispensarMensagemNaTela, carregarConversa],
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
};
