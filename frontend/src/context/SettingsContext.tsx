import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { computeDisplayGeometry, pickPanelForDisplay } from '@tracker/displayGeometry';
import { aplicarGeometriaDoUsuario } from '../design/gazeMetrics';
import { setSessionGeometry } from '@tracker/calibration';

type DwellSpeed = 'slow' | 'normal' | 'fast';
type Theme = 'light' | 'dark';

interface Settings {
  dwellSpeed: DwellSpeed;
  soundEnabled: boolean;
  voiceGender: 'female' | 'male' | 'cloned';
  voiceProfileId?: string;
  eyeDominance: 'left' | 'right' | 'both';
  theme: Theme;
  // Conforto visual.
  // brightnessLevel: 0.4 (mínimo utilizável) — 1.0 (sem escurecimento).
  // Aplicado como CSS `filter: brightness()` no <html>, escurece TUDO em
  // software sem depender do brilho do monitor (útil quando o cuidador
  // não tem controle direto do brilho — TV, monitor sem OSD acessível).
  brightnessLevel: number;
  // Filtro âmbar sobre a UI inteira. Evidência AAO: pacientes com
  // fotofobia se aliviam bloqueando a componente azul do espectro.
  // Implementado via overlay fixo em html.amber-filter::after.
  amberFilter: boolean;
  // Brilho real do monitor (0-100). Só usado quando o Electron
  // IPC `window.electronBrightness` está disponível (Windows via WMI).
  // Persiste entre sessões e re-aplica no boot.
  monitorBrightness: number | null;
  // Geometria física do posto de uso. NÃO é cosmética: entra em duas contas
  // que antes usavam hardcodes separados e divergentes.
  //   1. `meanErrorDeg` do relatório de precisão. Com 15,6" hardcoded numa
  //      tela de 23,6", o erro angular saía 34% MENOR do que o real.
  //   2. A posição dos alvos de calibração, que sai de um orçamento de
  //      excentricidade angular (ver `computeCalibrationTargets`).
  // Só o cuidador sabe estes números — o browser não expõe tamanho físico.
  screenDiagonalIn: number;
  viewingDistanceCm: number;
  // Origem de `screenDiagonalIn`. Existe para o preenchimento automático
  // (EDID via Electron) NUNCA sobrescrever um valor que o cuidador digitou:
  // se ele mediu com fita, esse número vale mais que o EDID, que em vários
  // monitores vem arredondado a centímetro inteiro ou zerado.
  screenGeometrySource: 'default' | 'auto' | 'manual';
  // Consentimento para ler configurações do sistema (EDID do monitor, escala
  // da tela). `null` = ainda não perguntamos. Ler o hardware do usuário sem
  // avisar é o tipo de coisa que um software de saúde não faz por
  // conveniência, mesmo quando o dado é inócuo e o SO permitiria.
  systemAccessGranted: boolean | null;
  // Campo de visão HORIZONTAL da câmera, em graus. Nenhuma API expõe isso;
  // é derivado uma única vez, quando o cuidador mede a distância com fita e
  // aperta "Calibrar campo de visão" em Configurações. A partir daí o app
  // estima a distância sozinho em toda sessão, que é o que faz o medidor de
  // distância da pré-calibração funcionar de verdade.
  cameraHorizontalFovDeg: number | null;
  // Fator de escala do Windows relatado pelo SO. NÃO entra na conversão
  // px→cm (a escala se cancela, porque o erro é medido em px CSS e a tela
  // cobre um número fixo de px CSS). Guardado para (a) desambiguar monitores
  // e (b) registrar a configuração no relatório, já que "1280×800 numa tela
  // de 23,6\"" é a assinatura de escala em 150% e confunde quem lê o
  // histórico depois.
  screenScaleFactor: number | null;
}

const defaultSettings: Settings = {
  dwellSpeed: 'normal',
  soundEnabled: true,
  voiceGender: 'female',
  eyeDominance: 'both',
  // Dark por default para o paciente. Evidência PMC12027292: reduz olho seco
  // (22.73 vs 24.40, p<0.05) e preserva CFF (indicador de fadiga). Fundo
  // claro em tela grande satura a pupila e induz piscada — sintoma que o
  // usuário deste projeto reportou. O cuidador continua podendo escolher
  // 'light' em SettingsScreen; a preferência persiste em localStorage.
  theme: 'dark',
  brightnessLevel: 1.0,
  amberFilter: false,
  monitorBrightness: null,
  // Defaults = o posto de uso de referência (medido). Editáveis em
  // Configurações → Teste de precisão; qualquer tela diferente PRECISA ser
  // ajustada, senão o erro angular do relatório mente e a grade de
  // calibração fica posicionada para a tela errada.
  screenDiagonalIn: 23.6,
  viewingDistanceCm: 60,
  screenGeometrySource: 'default',
  systemAccessGranted: null,
  cameraHorizontalFovDeg: null,
  screenScaleFactor: null,
};

const SettingsContext = createContext<{
  settings: Settings;
  updateSettings: (s: Partial<Settings>) => void;
}>({ settings: defaultSettings, updateSettings: () => {} });

// Detecta preferência de sistema uma única vez no boot. Usado só quando
// não existe valor salvo — respeita a escolha explícita do usuário depois.
function initialTheme(saved: Partial<Settings> | null): Theme {
  if (saved?.theme) return saved.theme;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

// Aplicação centralizada no <html>. Concentrada em um lugar para evitar
// telas migrarem em momentos diferentes.
function applyVisualComfort(s: Pick<Settings, 'theme' | 'brightnessLevel' | 'amberFilter'>): void {
  const html = document.documentElement;

  html.classList.toggle('dark', s.theme === 'dark');
  html.classList.toggle('amber-filter', s.amberFilter === true);

  // Clamp por segurança — slider da UI já limita, mas localStorage pode
  // conter valor inválido de versões antigas.
  const b = Math.max(0.4, Math.min(1.0, s.brightnessLevel ?? 1.0));
  // brightness(1) = neutro, remove o filter para não pagar composite cost.
  html.style.filter = b < 1 ? `brightness(${b.toFixed(2)})` : '';
}

/** Versão do schema de `Settings` gravado no localStorage. */
const SETTINGS_SCHEMA_VERSION = 1;
const SETTINGS_KEY = 'irisflow_settings';

/**
 * Lê as configurações do disco sem nunca lançar. Um localStorage truncado
 * (acontece quando os perfis de calibração estouram a quota) não pode derrubar
 * o `SettingsProvider` no boot — seria tela branca sem recuperação.
 */
function lerSettingsDoDisco(): Partial<Settings> | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const obj = parsed as Partial<Settings> & { schemaVersion?: number };
    // Schema de versão diferente: descarta em vez de mesclar. Metade de um
    // formato com metade de outro é pior que voltar aos defaults, porque o
    // resultado não corresponde a nenhuma configuração que alguém escolheu.
    if (obj.schemaVersion !== undefined && obj.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
      console.warn(
        `[SettingsContext] configurações de schema v${obj.schemaVersion} ` +
        `(atual: v${SETTINGS_SCHEMA_VERSION}) — usando os defaults.`,
      );
      return null;
    }
    return obj;
  } catch (e) {
    console.warn('[SettingsContext] configurações ilegíveis no localStorage — usando os defaults.', e);
    return null;
  }
}

/** Grava sem nunca lançar. Quota estourada não pode derrubar a UI. */
function gravarSettingsNoDisco(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, schemaVersion: SETTINGS_SCHEMA_VERSION }));
  } catch (e) {
    // Quota excedida é o caso real: 5 perfis de calibração ocupam quase toda
    // a cota. Perder a persistência da configuração é ruim; derrubar a sessão
    // do paciente é pior.
    console.warn('[SettingsContext] não foi possível gravar as configurações:', e);
  }
}

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = lerSettingsDoDisco();
    return {
      ...defaultSettings,
      ...(saved ?? {}),
      theme: initialTheme(saved),
    };
  });

  // Preenche a diagonal a partir do EDID, uma vez no boot.
  //
  // Só age quando a origem atual é 'default' ou 'auto'. Um valor 'manual' (o
  // cuidador digitou em Configurações) é soberano: o EDID reporta em
  // centímetros inteiros, então erra por até ~0,4" — melhor que um hardcode
  // errado, pior que uma medição com fita.
  useEffect(() => {
    const sys = (window as unknown as {
      irisflowSystem?: {
        getMonitorSizes?: () => Promise<{ widthCm: number; heightCm: number }[]>;
        getDisplayInfo?: () => Promise<{
          widthPx: number; heightPx: number; scaleFactor: number;
        }>;
      };
    }).irisflowSystem;
    if (!sys?.getMonitorSizes) return;   // browser puro / build web: sem IPC
    // Só lê o sistema depois do consentimento explícito.
    if (settings.systemAccessGranted !== true) return;
    let cancelled = false;
    // Lê tamanho físico E info do display juntos: a segunda serve para
    // escolher QUAL painel corresponde ao monitor em uso quando há mais de um.
    void Promise.all([
      sys.getMonitorSizes(),
      sys.getDisplayInfo?.() ?? Promise.resolve(null),
    ]).then(([sizes, info]) => {
      if (cancelled) return;
      setSettings((prev) => {
        const scale = info?.scaleFactor ?? null;
        if (prev.screenGeometrySource === 'manual') {
          return scale !== null && scale !== prev.screenScaleFactor
            ? { ...prev, screenScaleFactor: scale }
            : prev;
        }
        const aspect = info && info.heightPx > 0 ? info.widthPx / info.heightPx : null;
        const { panel, ambiguous } = pickPanelForDisplay(sizes ?? [], aspect);
        const geo = computeDisplayGeometry(panel);
        if (!geo) {
          console.log('[display] EDID não utilizável; mantendo diagonal configurada.');
          return scale !== null ? { ...prev, screenScaleFactor: scale } : prev;
        }
        if (ambiguous) {
          console.warn(
            '[display] mais de um monitor com a mesma proporção — a diagonal lida ' +
            'pode ser do monitor errado. Se o número abaixo não bater com a sua tela, ' +
            'corrija à mão em Configurações → Teste de precisão.',
          );
        }
        const rounded = Math.round(geo.diagonalIn * 10) / 10;
        if (Math.abs(rounded - prev.screenDiagonalIn) < 0.05
          && prev.screenGeometrySource === 'auto'
          && scale === prev.screenScaleFactor) return prev;
        console.log(
          `[display] diagonal lida do sistema: ${rounded}" ` +
          `(${geo.widthCm}×${geo.heightCm} cm). Anterior: ${prev.screenDiagonalIn}".` +
          (scale && scale !== 1 ? ` Escala do Windows: ${(scale * 100).toFixed(0)}%.` : ''),
        );
        const next = {
          ...prev,
          screenDiagonalIn: rounded,
          screenGeometrySource: 'auto' as const,
          screenScaleFactor: scale,
        };
        gravarSettingsNoDisco(next);
        return next;
      });
    }).catch(() => { /* IPC indisponível: segue com o valor configurado */ });
    return () => { cancelled = true; };
  }, [settings.systemAccessGranted]);

  // Aplica conforto visual no boot e a cada mudança relevante.
  useEffect(() => {
    applyVisualComfort(settings);
  }, [settings.theme, settings.brightnessLevel, settings.amberFilter]);

  // Brilho real do monitor via IPC do Electron.
  // Reaplica no boot se houve valor salvo (o monitor volta pra 100%
  // quando a máquina reinicia; nós restauramos a preferência).
  useEffect(() => {
    const b = settings.monitorBrightness;
    if (b == null) return;
    const api = (window as unknown as {
      electronBrightness?: { set: (pct: number) => Promise<{ ok: boolean }> };
    }).electronBrightness;
    if (!api) return;
    api.set(b).catch((e) => {
      console.warn('[SettingsContext] falha ao aplicar brilho de monitor:', e);
    });
  }, [settings.monitorBrightness]);

  // Updater FUNCIONAL, não closure sobre `settings`: duas chamadas no mesmo
  // handler partiriam do mesmo valor e a segunda sobrescreveria a primeira
  // (inclusive no localStorage). Deps vazias mantêm a identidade estável.
  const updateSettings = useCallback((partial: Partial<Settings>) => {
    setSettings((anterior) => {
      const next = { ...anterior, ...partial };
      gravarSettingsNoDisco(next);
      return next;
    });
  }, []);

  // A geometria do usuário alimenta o design system (tokens CSS de tamanho
  // mínimo de alvo) e o pipeline. Propagar aqui, e não só ao calibrar, é o que
  // faz uma correção da diagonal valer na hora: `screenPxPerCm()` está no
  // caminho quente da compensação de pose.
  useEffect(() => {
    aplicarGeometriaDoUsuario(settings.viewingDistanceCm, settings.screenDiagonalIn);
    setSessionGeometry({
      viewingDistanceCm: settings.viewingDistanceCm,
      screenDiagonalIn: settings.screenDiagonalIn,
    });
  }, [settings.viewingDistanceCm, settings.screenDiagonalIn]);

  // Sem o `useMemo`, todo render do provider re-renderizaria todos os
  // consumidores de `useSettings`, mesmo sem nenhuma configuração mudar.
  const value = useMemo(() => ({ settings, updateSettings }), [settings, updateSettings]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
