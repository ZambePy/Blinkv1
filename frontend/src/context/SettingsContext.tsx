import React, { createContext, useContext, useState, useEffect } from 'react';

type DwellSpeed = 'slow' | 'normal' | 'fast';
type KeyboardLayout = 'frequency' | 'alphabetical' | 'qwerty' | 'hierarchical';
type Theme = 'light' | 'dark';

interface Settings {
  dwellSpeed: DwellSpeed;
  keyboardLayout: KeyboardLayout;
  soundEnabled: boolean;
  voiceGender: 'female' | 'male' | 'cloned';
  voiceProfileId?: string;
  eyeDominance: 'left' | 'right' | 'both';
  theme: Theme;
  // Conforto visual (Camada 2 do plano de brilho/cores).
  // brightnessLevel: 0.4 (mínimo utilizável) — 1.0 (sem escurecimento).
  // Aplicado como CSS `filter: brightness()` no <html>, escurece TUDO em
  // software sem depender do brilho do monitor (útil quando o cuidador
  // não tem controle direto do brilho — TV, monitor sem OSD acessível).
  brightnessLevel: number;
  // Filtro âmbar sobre a UI inteira. Evidência AAO: pacientes com
  // fotofobia se aliviam bloqueando a componente azul do espectro.
  // Implementado via overlay fixo em html.amber-filter::after.
  amberFilter: boolean;
  // Brilho real do monitor (0-100). Camada 3: só usado quando o Electron
  // IPC `window.electronBrightness` está disponível (Windows via WMI).
  // Persiste entre sessões e re-aplica no boot.
  monitorBrightness: number | null;
  // D9 — geometria física do posto de uso. NÃO é cosmética: entra em duas
  // contas que antes usavam hardcodes separados e divergentes.
  //   1. `meanErrorDeg` do relatório de precisão. Com 15,6" hardcoded numa
  //      tela de 23,6", o erro angular saía 34% MENOR do que o real
  //      (2,98° reportado vs 4,50° verdadeiro no relatório 1787682565489).
  //   2. A posição dos alvos de calibração, que passou a sair de um orçamento
  //      de excentricidade angular (ver `computeCalibrationTargets`).
  // Só o cuidador sabe estes números — o browser não expõe tamanho físico.
  screenDiagonalIn: number;
  viewingDistanceCm: number;
}

const defaultSettings: Settings = {
  dwellSpeed: 'normal',
  keyboardLayout: 'frequency',
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

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>(() => {
    const raw = localStorage.getItem('irisflow_settings');
    const saved = raw ? (JSON.parse(raw) as Partial<Settings>) : null;
    return {
      ...defaultSettings,
      ...(saved ?? {}),
      theme: initialTheme(saved),
    };
  });

  // Aplica conforto visual no boot e a cada mudança relevante.
  useEffect(() => {
    applyVisualComfort(settings);
  }, [settings.theme, settings.brightnessLevel, settings.amberFilter]);

  // Camada 3 — brilho real do monitor via IPC do Electron.
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

  const updateSettings = (partial: Partial<Settings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    localStorage.setItem('irisflow_settings', JSON.stringify(next));
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
