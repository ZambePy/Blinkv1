import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  UserCog,
  Clock,
  Mic,
  Volume2,
  VolumeX,
  Download,
  Target,
  Moon,
  Sun,
  Video,
  Square,
  FileText,
  Activity,
  Plus,
  Trash2,
  MessageSquare,
  SunDim,
  Droplet,
  Monitor,
  Sparkles,
} from 'lucide-react';
import { env } from '../config/env';
import { useSettings } from '../context/SettingsContext';
import { deriveHorizontalFovDeg } from '@tracker/cameraTuner';
import { resolveCalibrationDistances } from '@tracker/calibrationDistances';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useEstadoDaVoz } from '../services/voz';
import {
  apagarModelo,
  assistenteDesligadoPeloUsuario,
  definirAssistenteDesligado,
  resumoDoModelo,
} from '../services/assistente';
import { definirModoApresentacao, modoApresentacaoAtivo } from '../services/apresentacao';
import { baixarRelatorio, montarRelatorio } from '../services/diagnostico/relatorioDeSuporte';
import { useConfirmacao } from '../components/ui/DialogoDeConfirmacao';
import { definirRelatosAutomaticos, relatosAutomaticosLigados } from '../services/diagnostico/relatosAutomaticos';
import {
  ESTADO_SEM_PONTE,
  estadoDaAtualizacao,
  instalarAtualizacao,
  ouvirAtualizacao,
  verificarAtualizacao,
  type EstadoDaAtualizacao,
} from '../services/atualizacao';
import { useCloud } from '../cloud/CloudContext';
import { infoDoApp } from '../cloud/armazenamento';
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher';
import { GazeButton } from '../components/ui/GazeButton';
import { useGaze } from '../context/GazeContext';
import { useReminders } from '../context/ReminderContext';
import {
  hasConsent,
  setConsent,
  getClinicalData,
  clearClinicalData,
  getMostUsedPhrases,
  getActivityByHour,
  logCalibrationAccuracy,
} from '../utils/clinicalLogger';
import { CaregiverPageLayout } from '../components/ui/CaregiverPageLayout';
import { AtalhoDePreparo } from './setup/AtalhoDePreparo';
import { startAccuracyTest } from '@tracker/accuracy';
import { buildRuntimeInfo } from '../utils/runtimeInfo';
import type { AccuracyResult, RunMeta } from '@tracker/accuracy';
import type { FilterPresetV2 } from '@tracker/oneEuroFilter';
import { applyUptimeToRunMetaIfDefault } from '../utils/autoTestMeta';
import { proximoBloco } from '../registroDaSessao';
import { gravarUltimoRelatorio } from '../services/local/ultimoRelatorio';
import { getCalibrationTimestampMs } from '@tracker/calibration';
import { hoverAndFocusBackground } from '../components/ui/hoverFocus';
import { ControleDeDwell } from '../components/ui/ControleDeDwell';
import { AtalhoDeTutorial } from './tutorial/AtalhoDeTutorial';
import { AtalhoDePerfilEConta } from './conta/AtalhoDePerfilEConta';

const cardStyle: React.CSSProperties = {
  background: 'var(--color-card-bg, rgba(255,255,255,0.75))',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid var(--color-card-border, rgba(255,255,255,0.7))',
  borderRadius: '1.5rem',
  padding: '2rem',
  boxShadow: '0 8px 32px var(--color-card-shadow, rgba(27,84,168,0.08))',
  transition: 'background 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease',
};

// Slider de brilho do MONITOR — só aparece quando o Electron IPC está exposto
// (Windows/WMI). No browser puro o hook detecta ausência e o componente
// devolve null, então o cuidador não vê um controle que não faz nada.
const MonitorBrightnessSlider: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [current, setCurrent] = useState<number | null>(settings.monitorBrightness);

  useEffect(() => {
    const api = (
      window as unknown as {
        electronBrightness?: {
          get: () => Promise<{ ok: boolean; value?: number; error?: string }>;
          set: (pct: number) => Promise<{ ok: boolean; error?: string }>;
        };
      }
    ).electronBrightness;
    if (!api) {
      setAvailable(false);
      return;
    }

    api
      .get()
      .then((r) => {
        if (r.ok && typeof r.value === 'number') {
          setAvailable(true);
          // Preferência salva ganha do valor atual — o usuário já escolheu.
          if (current == null) setCurrent(r.value);
        } else {
          // API existe mas driver não suporta (Windows sem WMI habilitado).
          console.warn('[monitor-brightness] IPC disponível mas driver não respondeu:', r.error);
          setAvailable(false);
        }
      })
      .catch((e) => {
        console.warn('[monitor-brightness] erro no IPC get:', e);
        setAvailable(false);
      });
    // Roda uma única vez no mount — não depender de `current` evita loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (available !== true) return null;

  const value = current ?? 100;
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <label
        htmlFor="brightness-monitor"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.95rem',
          fontWeight: 700,
          marginBottom: '0.5rem',
          color: 'var(--color-text-base, #1e293b)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Monitor size={16} /> Brilho do monitor (todo o sistema)
        </span>
        <span style={{ color: '#1B54A8' }}>{value}%</span>
      </label>
      <input
        id="brightness-monitor"
        type="range"
        min={10}
        max={100}
        step={5}
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          setCurrent(v);
          updateSettings({ monitorBrightness: v });
        }}
        style={{ width: '100%', accentColor: '#1B54A8', height: '2rem', cursor: 'pointer' }}
      />
      <div
        style={{
          fontSize: '0.75rem',
          color: 'var(--color-text-base, #94a3b8)',
          opacity: 0.7,
          marginTop: '0.25rem',
        }}
      >
        Escurece o monitor inteiro. Requer suporte do driver (WMI no Windows).
      </div>
    </div>
  );
};

/**
 * Formata uma métrica de precisão que pode não ter sido medida.
 *
 * `null` significa "nenhum ponto de validação coletou amostra". Mostrar "0px"
 * seria afirmar precisão perfeita a partir de uma medição que não aconteceu —
 * Exatamente o que o relatório fazia antes, num campo, enquanto outro mostrava
 * `NaN` para o mesmo evento.
 */
function px(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)}px`;
}

export const SettingsScreen: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const { isCaregiver, loginCaregiver } = useAuth();
  const toast = useToast();

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  // Estado da voz clonada local (só para mostrar a situação; a tela própria
  // faz a importação e o download do modelo).
  const estadoDaVoz = useEstadoDaVoz();

  // Assistente de escrita: só duas coisas de estado, porque só há duas coisas
  // para fazer — ligar/desligar as sugestões e apagar o que ele aprendeu.
  const [assistenteLigado, setAssistenteLigado] = useState(() => !assistenteDesligadoPeloUsuario());
  const [aprendizado, setAprendizado] = useState(() => resumoDoModelo());

  // Apresentação e suporte.
  const [apresentacao, setApresentacao] = useState(modoApresentacaoAtivo);
  const [relatosLigados, setRelatosLigados] = useState(relatosAutomaticosLigados);
  const [enviandoRelato, setEnviandoRelato] = useState(false);
  const cloud = useCloud();
  const { confirmar, dialogo } = useConfirmacao();
  const [versaoDoApp, setVersaoDoApp] = useState<string | null>(null);
  useEffect(() => {
    void infoDoApp().then((i) => setVersaoDoApp(i.version)).catch(() => setVersaoDoApp(null));
  }, []);
  const [atualizacao, setAtualizacao] = useState<EstadoDaAtualizacao>(ESTADO_SEM_PONTE);
  useEffect(() => {
    let vivo = true;
    void estadoDaAtualizacao().then((e) => {
      if (vivo) setAtualizacao(e);
    });
    const parar = ouvirAtualizacao((e) => {
      if (vivo) setAtualizacao(e);
    });
    return () => {
      vivo = false;
      parar();
    };
  }, []);
  const descricaoDaAtualizacao = (() => {
    switch (atualizacao.fase) {
      case 'inativa':
        return `Atualização automática desligada (${atualizacao.motivo}).`;
      case 'verificando':
        return 'Verificando se há versão nova…';
      case 'em_dia':
        return `Esta é a versão mais recente (${atualizacao.versao}).`;
      case 'baixando':
        return `Baixando a versão ${atualizacao.versao}: ${atualizacao.progresso}%.`;
      case 'pronta':
        return `Versão ${atualizacao.versao} pronta. Entra ao reiniciar ou ao fechar o aplicativo.`;
      case 'erro':
        return `Não foi possível verificar agora (${atualizacao.mensagem}). O aplicativo segue normalmente.`;
    }
  })();

  const { calibration, recording, setFilterPreset, getSessionUptimeMs, getDiagnostics } = useGaze();
  const [filterPreset, setFilterPresetState] = useState<FilterPresetV2>('balanceado-v2');

  // Estado local do gravador de sessão. `active` é derivado do singleton do
  // recorder, mas mantido em state para o botão trocar de rótulo sem esperar
  // o poll; `stats` é atualizado por setInterval enquanto gravando (o
  // singleton não é reativo).
  const [recActive, setRecActive] = useState(false);
  const [recStats, setRecStats] = useState<{ frames: number; dropped: number }>({
    frames: 0,
    dropped: 0,
  });

  const [newReminderTitle, setNewReminderTitle] = useState('');
  const [newReminderTime, setNewReminderTime] = useState('');
  const { reminders, addReminder, deleteReminder } = useReminders();

  const [consentActive, setConsentActive] = useState(hasConsent());
  const [clinicalData, setClinicalData] = useState(getClinicalData());

  const handleToggleConsent = (consented: boolean) => {
    setConsent(consented);
    setConsentActive(consented);
    setClinicalData(getClinicalData());
    if (consented) {
      toast.success('Consentimento de dados clínicos registrado!');
    } else {
      toast.success('Consentimento removido. Todos os dados clínicos locais foram apagados.');
    }
  };

  const handleClearClinicalLogs = async () => {
    const ok = await confirmar({
      titulo: 'Apagar todos os registros clínicos deste computador?',
      descricao:
        'Sessões, medições e histórico do paciente somem para sempre. Não há como desfazer, e o que já foi exportado não volta sozinho.',
      confirmar: 'Apagar registros',
    });
    if (!ok) return;
    clearClinicalData();
    setClinicalData(getClinicalData());
    toast.success('Todos os dados clínicos locais foram excluídos.');
  };

  const handleExportClinicalLogs = () => {
    const dataStr = JSON.stringify(clinicalData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = `relatorio-clinico-paciente-${new Date().toISOString().split('T')[0]}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    toast.success('Relatório clínico exportado com sucesso!');
  };

  const handleAddReminder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReminderTitle.trim() || !newReminderTime.trim()) {
      toast.error('Por favor, preencha o título e o horário.');
      return;
    }
    addReminder({
      title: newReminderTitle.trim(),
      time: newReminderTime,
    });
    setNewReminderTitle('');
    setNewReminderTime('');
    toast.success('Lembrete adicionado com sucesso!');
  };
  useEffect(() => {
    if (!recActive) {
      // Após parar, atualiza uma última vez pra o painel refletir o total
      // final. Sem intervalo — não precisa continuar polling.
      setRecStats(recording.getStats());
      return;
    }
    const id = setInterval(() => {
      setRecStats(recording.getStats());
    }, 500);
    return () => clearInterval(id);
  }, [recActive, recording]);

  const toggleRecording = () => {
    if (recActive) {
      recording.stop();
      setRecActive(false);
      toast.success(`Gravação parada com ${recording.getStats().frames} frames.`);
    } else {
      recording.start();
      setRecActive(true);
      toast.success('Gravação iniciada.');
    }
  };

  const exportRecording = () => {
    const jsonl = recording.exportAsJSONL();
    if (!jsonl) {
      toast.error('Nada para exportar — inicie uma gravação primeiro.');
      return;
    }
    const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // ISO com ':' trocado por '-' pra o filesystem aceitar (Windows não
    // permite ':' em nomes de arquivo).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `irisflow-recording-${stamp}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exportado ${recording.getStats().frames} frames.`);
  };

  const clearRecording = () => {
    recording.clear();
    setRecActive(false);
    setRecStats({ frames: 0, dropped: 0 });
    toast.success('Gravação descartada.');
  };

  const chooseFilterPreset = (preset: FilterPresetV2) => {
    setFilterPresetState(preset);
    setFilterPreset(preset);
  };
  const [accuracyRunning, setAccuracyRunning] = useState(false);
  const [lastAccuracy, setLastAccuracy] = useState<AccuracyResult | null>(null);
  const [accuracyMeta, setAccuracyMeta] = useState<RunMeta>({
    data: new Date().toISOString().slice(0, 10),
    iluminacao: 'boa',
    oculos: false,
    movimentoCabeca: 'parada',
    minutosDeSessao: 0,
    // Geometria vem das settings persistidas (fonte única, compartilhada com
    // a grade de calibração). Os campos abaixo espelham o valor atual; editá-
    // los grava nas settings, não só neste state local.
    distanciaCm: settings.viewingDistanceCm,
    telaPolegadas: settings.screenDiagonalIn,
  });
  const handleAccuracyTest = () => {
    if (!calibration.isCalibrated()) {
      toast.error('Calibre primeiro para rodar o teste de precisão.');
      return;
    }
    // Se o cuidador não editou "Sessão (min)" (segue 0), preenche com o
    // uptime real do engine. Se ele escolheu manualmente no select (para
    // simular teste de deriva), a escolha manual é preservada.
    // A geometria SEMPRE vem das settings, mesmo que o state local esteja
    // defasado.
    //
    // ⚠️ A distância da TELA é a CONFIGURADA, nunca a medida.
    //
    // O comentário anterior aqui dizia o contrário — "a distância MEDIDA manda
    // quando existe" — e isso reintroduzia, neste fluxo, exatamente o
    // que `src/calibrationDistances.ts` existe para proibir.
    //
    // `estimateDistanceCm` mede olho→CÂMERA. `distanciaCm` do relatório é
    // olho→TELA. Num setup câmera-perto/tela-longe — o RECOMENDADO pelo
    // README — a medida cai para ~25 cm onde a tela está a 60, e o erro
    // angular do relatório sai inflado por ~2,4×.
    //
    // Pior: o `effectiveViewingDistanceCm` só prefere a medida quando ela cai
    // na faixa plausível E o FOV está calibrado. Ou seja, o defeito era
    // INTERMITENTE — aparecia em alguns postos e não em outros, e o mesmo
    // paciente teria históricos em escalas diferentes.
    //
    // E o `CalibrationCheck` (o fluxo automático) já fazia certo. Os dois
    // caminhos reportavam graus em escalas diferentes: comparar uma rodada
    // disparada pelas Configurações com uma disparada pós-calibração inverte
    // qualquer A/B do uma sessão de medição.
    const { screenCm } = resolveCalibrationDistances({
      measuredCameraDistanceCm: null,
      configuredViewingDistanceCm: settings.viewingDistanceCm,
    });

    const metaWithUptime = applyUptimeToRunMetaIfDefault(
      {
        ...accuracyMeta,
        distanciaCm: screenCm,
        telaPolegadas: settings.screenDiagonalIn,
        screenScaleFactor: settings.screenScaleFactor,
        // Sem isto, `geometriaFoiMedida(undefined)` devolve `false` e TODA
        // sessão manual sai marcada como geometria assumida — inclusive as em
        // que o cuidador mediu a tela com fita. O dano é simétrico ao do bug
        // original: depois do uma sessão de medição não haveria como separar as sessões com
        // geometria válida das inválidas neste fluxo.
        screenGeometrySource: settings.screenGeometrySource,
      },
      getSessionUptimeMs()
    );
    // O bloco entra aqui também — este é o caminho do BLOCO 2, e sem ele a
    // rodada de 10 minutos chegaria ao JSON sem nada que a identificasse como
    // tal. Iluminação e postura NÃO são sobrescritas aqui: nesta tela o
    // operador as escolheu à mão, e escolha humana vence medição automática
    // (mesma regra do "Sessão (min)" acima).
    const bloco = proximoBloco(getCalibrationTimestampMs());
    if (bloco !== null) metaWithUptime.blocoDeMedicao = bloco;

    setAccuracyRunning(true);
    startAccuracyTest(
      (r) => {
        setAccuracyRunning(false);
        setLastAccuracy(r);
        // Guarda para a tela de relatorio apresentar. O relatorio CANONICO ja
        // foi escrito pelo proprio `startAccuracyTest`; isto e o resumo.
        gravarUltimoRelatorio(r, metaWithUptime);
        // só registra no histórico clínico quando houve medição. Gravar
        // um `null` (ou pior, um `0`) como resultado de precisão contaminaria a
        // curva de acompanhamento do paciente com um teste que falhou.
        if (r.meanErrorDeg !== null) logCalibrationAccuracy(r.meanErrorDeg);
        setClinicalData(getClinicalData());
        if (r.meanError === null || r.meanErrorDeg === null) {
          toast.error(
            `Teste de precisão sem amostras (${r.pontosNaoMedidos} de ` +
              `${r.pontosMedidos + r.pontosNaoMedidos} pontos). Verifique o rastreamento e repita.`
          );
        } else {
          toast.success(
            `Precisão: ${Math.round(r.meanError)}px médio (${r.meanErrorDeg.toFixed(2)}°) — ${r.score}`
          );
        }
        // Sem o terceiro argumento o relatório sai com `pipeline.runtime: null`
        // — sem provider efetivo, sem fallback, sem staleness e sem fps. Uma
        // sessão assim não diz em que condição foi medida.
      },
      metaWithUptime,
      buildRuntimeInfo(getDiagnostics())
    );
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginCaregiver(pin)) {
      setPinError(null);
      setPin('');
    } else {
      setPinError(t('settings.auth.pinError'));
      setPin('');
    }
  };

  const handleBackup = () => {
    const data = JSON.stringify(settings, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'irisflow_backup.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Backup exportado.');
  };

  if (!isCaregiver) {
    return (
      <main
        role="main"
        aria-labelledby="settings-auth-title"
        style={{
          minHeight: '100vh',
          background:
            'var(--settings-bg, linear-gradient(160deg, #f0f4ff 0%, #e8f0fb 50%, #f1f5f9 100%))',
          transition: 'background 0.4s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <div
          className="glass animate-fade-in-up"
          style={{
            padding: '3rem',
            borderRadius: '2.5rem',
            maxWidth: 480,
            width: '100%',
            textAlign: 'center',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: '5rem',
              height: '5rem',
              background: 'linear-gradient(135deg, #dbeafe, #eff6ff)',
              borderRadius: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem',
            }}
          >
            <UserCog size={40} color="#1B54A8" />
          </div>
          <h2
            id="settings-auth-title"
            style={{ fontSize: '2rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem' }}
          >
            {t('settings.auth.title')}
          </h2>
          <p
            style={{
              color: 'var(--color-text-base)',
              opacity: 0.9,
              marginBottom: '2rem',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            {t('settings.auth.hint')}
          </p>

          <form
            onSubmit={handleLogin}
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            <label htmlFor="caregiver-pin" className="sr-only">
              {t('settings.auth.pinLabel')}
            </label>
            <input
              id="caregiver-pin"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={8}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="••••"
              aria-invalid={pinError ? true : undefined}
              aria-describedby={pinError ? 'pin-error' : undefined}
              style={{
                textAlign: 'center',
                fontSize: '3rem',
                letterSpacing: '1rem',
                padding: '1rem',
                borderRadius: '1rem',
                border: pinError ? '2px solid #dc2626' : '2px solid #e2e8f0',
                outline: 'none',
                fontFamily: 'Boldonse, sans-serif',
              }}
            />
            {pinError && (
              <p id="pin-error" role="alert" style={{ color: '#dc2626', fontSize: '0.9rem' }}>
                {pinError}
              </p>
            )}

            {/* Teclado Numérico Virtual */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '0.75rem',
                margin: '1.5rem 0',
                maxWidth: '300px',
                alignSelf: 'center',
                width: '100%',
              }}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => pin.length < 8 && setPin((p) => p + num)}
                  style={{
                    height: '60px',
                    borderRadius: '1rem',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    fontSize: '1.5rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    color: '#1e293b',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                  }}
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPin('')}
                style={{
                  height: '60px',
                  borderRadius: '1rem',
                  background: '#fef2f2',
                  border: '1px solid #fee2e2',
                  fontSize: '1.1rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  color: '#ef4444',
                }}
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => pin.length < 8 && setPin((p) => p + '0')}
                style={{
                  height: '60px',
                  borderRadius: '1rem',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  fontSize: '1.5rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  color: '#1e293b',
                }}
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setPin((p) => p.slice(0, -1))}
                style={{
                  height: '60px',
                  borderRadius: '1rem',
                  background: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  fontSize: '1.1rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  color: '#475569',
                }}
              >
                Apagar
              </button>
            </div>

            {/* A SAÍDA precisa ser alcançável POR OLHAR.
                O teclado numérico acima é do cuidador, com mouse, e por isso
                pode ter teclas de 60 px. Mas /settings é um dos cartões do menu
                do paciente: ele chega aqui por fixação, por engano ou por
                curiosidade, e cai neste portão. Com um "Cancelar" de ~50 px de
                altura, a única forma de sair era chamar alguém — uma tela sem
                saída, que é a pior coisa que este produto pode ter. */}
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
              <GazeButton
                type="button"
                onClick={() => navigate('/menu')}
                aria-label={t('common.cancel')}
                height={200}
                data-dwell-ms={1800}
                noWarn
                style={{
                  flex: 1,
                  minHeight: 200,
                  padding: '1rem',
                  background: '#f1f5f9',
                  borderRadius: '1rem',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.15rem',
                  fontWeight: 700,
                  color: 'var(--color-text-base)',
                  opacity: 0.9,
                }}
              >
                {t('common.cancel')}
              </GazeButton>
              <button
                type="submit"
                aria-label={t('settings.auth.submit')}
                style={{
                  flex: 1,
                  padding: '1rem',
                  background: 'linear-gradient(135deg, #1B54A8, #2563eb)',
                  borderRadius: '1rem',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: 'white',
                  boxShadow: '0 4px 16px rgba(27,84,168,0.3)',
                }}
              >
                {t('settings.auth.submit')}
              </button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  return (
    <CaregiverPageLayout title={t('settings.title')}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          maxWidth: 900,
          margin: '0 auto',
          width: '100%',
        }}
      >
        {/* Card de Acesso ao Painel do Cuidador */}
        <section
          aria-labelledby="dashboard-link-title"
          style={{
            ...cardStyle,
            background: 'rgba(34, 197, 94, 0.08)',
            borderColor: 'rgba(34, 197, 94, 0.2)',
          }}
        >
          <h2
            id="dashboard-link-title"
            style={{
              fontSize: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#4ade80',
              marginTop: 0,
            }}
          >
            <Activity size={24} /> Painel de Acompanhamento (Rotina & Diário)
          </h2>
          <p
            style={{
              color: '#cbd5e1',
              opacity: 0.9,
              marginBottom: '1.5rem',
              fontSize: '1rem',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Acesse a rotina diária de cuidados, registro clínico de sintomas e histórico recente do
            paciente.
          </p>
          <button
            onClick={() => navigate('/caregiver')}
            style={{
              padding: '0.8rem 1.8rem',
              background: '#22c55e',
              border: 'none',
              color: 'white',
              borderRadius: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
              fontSize: '1rem',
              transition: 'background 0.2s',
            }}
            {...hoverAndFocusBackground('#22c55e', '#15803d')}
          >
            {t('settings.dashboardLink.button')}
          </button>
        </section>

        {/* Preparo do ambiente — o atalho para refazer quando muda a sala,
            a webcam ou a posição do monitor. Sem ele, o preparo de um perfil
            só sairia apagando o perfil, e a calibração iria junto. */}
        {/* Trocar de paciente e ver a assinatura — os dois caminhos que
            faltavam aqui. Sem o primeiro, trocar de paciente exigia fechar o
            app; sem o segundo, so se descobria que a licenca venceu quando
            tudo parou. */}
        <AtalhoDePerfilEConta />

        <AtalhoDePreparo />

        <AtalhoDeTutorial />

        {/* Card do Guia do Cuidador */}
        <section
          aria-labelledby="guide-link-title"
          style={{
            ...cardStyle,
            background: 'rgba(245, 158, 11, 0.08)',
            borderColor: 'rgba(245, 158, 11, 0.2)',
          }}
        >
          <h2
            id="guide-link-title"
            style={{
              fontSize: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#f59e0b',
              marginTop: 0,
            }}
          >
            <FileText size={24} /> Guia de Instalação e Suporte do Cuidador
          </h2>
          <p
            style={{
              color: '#cbd5e1',
              opacity: 0.9,
              marginBottom: '1.5rem',
              fontSize: '1rem',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Instruções passo a passo sobre como posicionar a câmera, melhorar a iluminação do
            ambiente e solucionar problemas com óculos ou calibração.
          </p>
          <button
            onClick={() => navigate('/caregiver/guide?from=/settings')}
            style={{
              padding: '0.8rem 1.8rem',
              background: '#f59e0b',
              border: 'none',
              color: 'white',
              borderRadius: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)',
              fontSize: '1rem',
              transition: 'background 0.2s',
            }}
            {...hoverAndFocusBackground('#f59e0b', '#d97706')}
          >
            Abrir Guia do Cuidador
          </button>
        </section>
        {/* Temporizador */}
        <section aria-labelledby="dwell-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <Clock size={28} color="#1B54A8" aria-hidden="true" />
            <h2 id="dwell-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
              {t('settings.dwell.title')}
            </h2>
          </div>
          {/* O MESMO controle que o tutorial usa. Dois controles para a
              mesma grandeza e como limiares divergem: alguem ajusta a faixa
              num e esquece o outro. */}
          <ControleDeDwell
            valorMs={settings.dwellMs}
            aoMudar={(ms) => updateSettings({ dwellMs: ms })}
          />
        </section>

        {/* Som */}
        <section aria-labelledby="sound-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            {settings.soundEnabled ? (
              <Volume2 size={28} color="#1B54A8" aria-hidden="true" />
            ) : (
              <VolumeX size={28} color="#64748b" aria-hidden="true" />
            )}
            <h2 id="sound-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
              {t('settings.sound.title')}
            </h2>
          </div>
          <button
            role="switch"
            aria-checked={settings.soundEnabled}
            onClick={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
            style={{
              padding: '1rem 1.5rem',
              borderRadius: '1rem',
              border: '2px solid var(--color-card-border)',
              background: settings.soundEnabled ? '#1B54A8' : 'white',
              color: settings.soundEnabled ? 'white' : '#475569',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            {t(settings.soundEnabled ? 'settings.sound.on' : 'settings.sound.off')}
          </button>
        </section>

        {/* Tema */}
        <section aria-labelledby="theme-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            {settings.theme === 'dark' ? (
              <Moon size={28} color="#1B54A8" aria-hidden="true" />
            ) : (
              <Sun size={28} color="#1B54A8" aria-hidden="true" />
            )}
            <h2
              id="theme-title"
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                color: 'var(--color-text-base, #1e293b)',
              }}
            >
              Tema Visual
            </h2>
          </div>
          <div
            role="radiogroup"
            aria-labelledby="theme-title"
            style={{ display: 'flex', gap: '1rem' }}
          >
            {[
              { key: 'light', label: 'Modo Claro', icon: <Sun size={20} /> },
              { key: 'dark', label: 'Modo Escuro', icon: <Moon size={20} /> },
            ].map(({ key, label, icon }) => {
              const active = settings.theme === key;
              return (
                <button
                  key={key}
                  role="radio"
                  aria-checked={active}
                  onClick={() => updateSettings({ theme: key as 'light' | 'dark' })}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    padding: '1rem',
                    borderRadius: '1rem',
                    cursor: 'pointer',
                    fontWeight: 700,
                    border: '2px solid',
                    background: active ? '#1B54A8' : 'transparent',
                    color: active ? 'white' : 'var(--color-text-base, #475569)',
                    borderColor: active ? '#1B54A8' : '#e2e8f0',
                  }}
                >
                  {icon} {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Conforto Visual — Camadas 2 e 3 do plano de brilho.
         *
         * Um controle isolado por perfil. Slider de brilho da UI (CSS filter)
         * funciona em qualquer plataforma; slider de brilho de MONITOR só
         * aparece quando o Electron IPC está disponível (Windows via WMI).
         * Toggle âmbar bloqueia parte do azul do espectro — evidência AAO
         * de alívio de fotofobia. */}
        <section aria-labelledby="visual-comfort-title" style={cardStyle}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}
          >
            <SunDim size={28} color="#1B54A8" aria-hidden="true" />
            <h2
              id="visual-comfort-title"
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                color: 'var(--color-text-base, #1e293b)',
              }}
            >
              Conforto Visual
            </h2>
          </div>
          <p
            style={{
              margin: '0 0 1.25rem',
              fontSize: '0.95rem',
              color: 'var(--color-text-base, #64748b)',
              opacity: 0.75,
              lineHeight: 1.5,
            }}
          >
            Reduza o brilho e ative o filtro âmbar se o paciente piscar muito ou reclamar de
            deslumbramento. Evidência clínica: brilho excessivo em usuários com ALS aumenta fadiga
            visual e induz piscadas involuntárias.
          </p>

          {/* Slider de brilho da INTERFACE (CSS filter — funciona sempre) */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label
              htmlFor="brightness-ui"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.95rem',
                fontWeight: 700,
                marginBottom: '0.5rem',
                color: 'var(--color-text-base, #1e293b)',
              }}
            >
              <span>Brilho da tela do IrisFlow</span>
              <span style={{ color: '#1B54A8' }}>
                {Math.round(settings.brightnessLevel * 100)}%
              </span>
            </label>
            <input
              id="brightness-ui"
              type="range"
              min={40}
              max={100}
              step={5}
              value={Math.round(settings.brightnessLevel * 100)}
              onChange={(e) =>
                updateSettings({ brightnessLevel: parseInt(e.target.value, 10) / 100 })
              }
              aria-valuemin={40}
              aria-valuemax={100}
              aria-valuenow={Math.round(settings.brightnessLevel * 100)}
              style={{ width: '100%', accentColor: '#1B54A8', height: '2rem', cursor: 'pointer' }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                color: 'var(--color-text-base, #94a3b8)',
                opacity: 0.7,
                marginTop: '0.25rem',
              }}
            >
              <span>40% (muito escuro)</span>
              <span>100% (normal)</span>
            </div>
          </div>

          {/* Slider de brilho de MONITOR real — Camada 3 (opt-in, só Electron)
           * Detecta o IPC no boot; se ausente (roda no browser), o slider some
           * silenciosamente sem confundir o cuidador com botão que não faz nada. */}
          <MonitorBrightnessSlider />

          {/* Toggle Filtro Âmbar */}
          <div
            style={{
              marginTop: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '0.85rem 1rem',
              background: 'var(--color-primary-light, #f1f5f9)',
              borderRadius: '0.9rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Droplet size={22} color="#d97706" aria-hidden="true" />
              <div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    color: 'var(--color-text-base, #1e293b)',
                  }}
                >
                  Filtro âmbar
                </div>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--color-text-base, #64748b)',
                    opacity: 0.75,
                  }}
                >
                  Reduz a componente azul da luz. Alivia sensibilidade à luz.
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Filtro âmbar"
              aria-checked={settings.amberFilter}
              onClick={() => updateSettings({ amberFilter: !settings.amberFilter })}
              style={{
                width: 56,
                height: 30,
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                background: settings.amberFilter ? '#d97706' : '#cbd5e1',
                position: 'relative',
                transition: 'background 0.2s',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 3,
                  left: settings.amberFilter ? 29 : 3,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'white',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  transition: 'left 0.2s',
                }}
              />
            </button>
          </div>
        </section>

        {/* Idioma */}
        <section aria-labelledby="language-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <h2
              id="language-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              {t('settings.language.title')}
            </h2>
          </div>
          <LanguageSwitcher />
        </section>

        {/* Voz personalizada (clonagem local) — a tela própria tem o termo de
            consentimento, o download do modelo e a importação do áudio. */}
        <section aria-labelledby="voice-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <Mic size={28} color="#1B54A8" aria-hidden="true" />
            <h2 id="voice-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
              {t('settings.voice.title')}
            </h2>
            {/* O mesmo selo da tela de voz. Quem vê "Voz personalizada" nos
                ajustes precisa saber o estágio antes de entrar e baixar 1,5 GB. */}
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '0.2rem 0.55rem',
                borderRadius: '0.5rem',
                background: '#fef3c7',
                color: '#92400e',
                border: '1px solid #fbbf24',
              }}
            >
              Experimental
            </span>
          </div>
          <p
            style={{
              color: 'var(--color-text-base)',
              opacity: 0.9,
              marginBottom: '1.25rem',
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.6,
            }}
          >
            {t('settings.voice.description')}
          </p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => navigate('/settings/voice')}
              aria-label="Abrir a tela de voz personalizada"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.85rem 1.5rem',
                background: '#1e293b',
                color: 'white',
                border: 'none',
                borderRadius: '1rem',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              <Mic size={20} aria-hidden="true" /> {t('settings.voice.open')}
            </button>
            <span role="status" style={{ color: estadoDaVoz?.voz.importada && estadoDaVoz.ativa ? '#16a34a' : 'var(--color-text-base)', fontWeight: 700, opacity: estadoDaVoz?.voz.importada ? 1 : 0.8 }}>
              {estadoDaVoz === null
                ? t('settings.voice.onlyDesktop')
                : estadoDaVoz.voz.importada
                  ? estadoDaVoz.ativa ? t('settings.voice.ready') : t('settings.voice.importedOff')
                  : t('settings.voice.none')}
            </span>
          </div>
          <div
            style={{
              marginTop: '1.25rem',
              padding: '1rem 1.25rem',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '1rem',
              color: '#92400e',
              fontSize: '0.85rem',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            {t('settings.voice.lgpd')}
          </div>
        </section>

        {/* Assistente de escrita — o "chatbot integrado" do roteiro de produto.
            Fica aqui, e não numa tela própria, porque não há nada para
            configurar além de ligar/desligar e apagar: ele não pede áudio, não
            baixa modelo e não fala com a rede. */}
        <section aria-labelledby="assistente-title" style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Sparkles size={28} color="#F0A030" aria-hidden="true" />
            <h2 id="assistente-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
              Assistente de escrita
            </h2>
          </div>
          <p
            style={{
              color: 'var(--color-text-base)',
              opacity: 0.9,
              marginBottom: '1.25rem',
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.6,
            }}
          >
            Sugere a próxima palavra no teclado e frases inteiras na conversa, aprendendo com o que o
            paciente já escreveu. Tudo é calculado neste computador: nenhuma palavra, frase ou conversa
            é enviada para a internet.
          </p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => {
                const novo = !assistenteLigado;
                setAssistenteLigado(novo);
                definirAssistenteDesligado(!novo);
              }}
              aria-pressed={assistenteLigado}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.85rem 1.5rem',
                background: assistenteLigado ? '#1e293b' : 'transparent',
                color: assistenteLigado ? 'white' : '#1e293b',
                border: assistenteLigado ? 'none' : '2px solid #94a3b8',
                borderRadius: '1rem',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              <Sparkles size={20} aria-hidden="true" />
              {assistenteLigado ? 'Sugestões ligadas' : 'Sugestões desligadas'}
            </button>
            <span role="status" style={{ color: 'var(--color-text-base)', opacity: 0.85, fontWeight: 600 }}>
              {aprendizado.frases} {aprendizado.frases === 1 ? 'frase' : 'frases'} · {aprendizado.palavras}{' '}
              {aprendizado.palavras === 1 ? 'palavra' : 'palavras'} · {aprendizado.kb} KB neste computador
            </span>
            <button
              type="button"
              onClick={async () => {
                const ok = await confirmar({
                  titulo: 'Apagar tudo o que o assistente aprendeu?',
                  descricao:
                    'As sugestões voltam ao padrão de fábrica e o assistente recomeça do zero, aprendendo de novo com o uso.',
                  confirmar: 'Apagar aprendizado',
                });
                if (!ok) return;
                apagarModelo();
                setAprendizado(resumoDoModelo());
              }}
              style={{
                padding: '0.85rem 1.25rem',
                background: 'transparent',
                color: '#b91c1c',
                border: '2px solid #fecaca',
                borderRadius: '1rem',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              Apagar o aprendizado
            </button>
          </div>
        </section>

        {/* Apresentação e suporte — as duas coisas que existem para quem está
            FORA da rotina do paciente: quem demonstra o produto e quem precisa
            entender uma falha à distância. */}
        <section aria-labelledby="apresentacao-title" style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Monitor size={28} color="#1B54A8" aria-hidden="true" />
            <h2 id="apresentacao-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
              Apresentação e suporte
            </h2>
          </div>
          <p
            style={{
              color: 'var(--color-text-base)',
              opacity: 0.9,
              marginBottom: '1.25rem',
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.6,
            }}
          >
            No modo apresentação, nada sai deste computador: o pedido de socorro, as mensagens e os
            indicadores deixam de chegar ao celular do cuidador, e uma faixa fica visível na tela para que
            ninguém confunda a demonstração com uso real. As telas continuam mostrando o estado verdadeiro
            do rastreamento — o modo não inventa números.
          </p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => {
                const novo = !apresentacao;
                setApresentacao(novo);
                definirModoApresentacao(novo);
              }}
              aria-pressed={apresentacao}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.85rem 1.5rem',
                background: apresentacao ? '#F0A030' : 'transparent',
                color: apresentacao ? '#1a1205' : '#1e293b',
                border: apresentacao ? 'none' : '2px solid #94a3b8',
                borderRadius: '1rem',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              <Monitor size={20} aria-hidden="true" />
              {apresentacao ? 'Modo apresentação ligado' : 'Ligar modo apresentação'}
            </button>
            <button
              type="button"
              onClick={() => {
                baixarRelatorio(montarRelatorio({ versao: versaoDoApp, estadoDaVoz: estadoDaVoz ?? null }));
                toast.success('Relatório de suporte salvo. Anexe o arquivo ao pedido de ajuda.');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.85rem 1.5rem',
                background: '#1e293b',
                color: 'white',
                border: 'none',
                borderRadius: '1rem',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              <Download size={20} aria-hidden="true" /> Salvar relatório de suporte
            </button>
          </div>

          {/* Relatos automáticos: desligado por padrão, decisão do cuidador.
              Mesmo conteúdo do botão acima — só muda quem aperta o botão
              (o app, quando falha) e para onde vai (a conta IrisFlow). */}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '1rem' }}>
            <button
              type="button"
              onClick={() => {
                const novo = !relatosLigados;
                setRelatosLigados(novo);
                definirRelatosAutomaticos(novo);
              }}
              aria-pressed={relatosLigados}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.85rem 1.5rem',
                background: relatosLigados ? '#1e293b' : 'transparent',
                color: relatosLigados ? 'white' : '#1e293b',
                border: relatosLigados ? 'none' : '2px solid #94a3b8',
                borderRadius: '1rem',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              {relatosLigados ? 'Relatos automáticos ligados' : 'Ligar relatos automáticos de falha'}
            </button>
            <button
              type="button"
              disabled={enviandoRelato || !cloud.vinculo}
              title={cloud.vinculo ? undefined : 'Precisa de uma conta vinculada neste computador'}
              onClick={async () => {
                setEnviandoRelato(true);
                try {
                  const ok = await cloud.enviarRelatorioDeSuporte('manual', 'enviado pelo cuidador em Ajustes');
                  if (ok) toast.success('Relatório enviado à IrisFlow.');
                  else toast.error('Não foi possível enviar agora. Você pode salvar o arquivo e anexar por e-mail.');
                } finally {
                  setEnviandoRelato(false);
                }
              }}
              style={{
                padding: '0.85rem 1.25rem',
                background: 'transparent',
                color: cloud.vinculo ? '#1e293b' : '#94a3b8',
                border: '2px solid #cbd5e1',
                borderRadius: '1rem',
                cursor: cloud.vinculo ? 'pointer' : 'not-allowed',
                fontWeight: 700,
              }}
            >
              {enviandoRelato ? 'Enviando…' : 'Enviar relatório agora'}
            </button>
          </div>
          <p
            style={{
              marginTop: '1rem',
              padding: '1rem 1.25rem',
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: '1rem',
              color: '#075985',
              fontSize: '0.85rem',
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.6,
            }}
          >
            O relatório traz números sobre o funcionamento — precisão da calibração, quantidade de frases,
            memória e núcleos deste computador, últimos erros do aplicativo. <strong>Nenhuma frase escrita
            pelo paciente, nenhuma imagem e nenhum dado de calibração entram no arquivo.</strong> Com os
            relatos automáticos ligados, o mesmo relatório é enviado sozinho quando o aplicativo falha
            (no máximo um a cada dez minutos), só se houver conta vinculada.
          </p>
          <div
            style={{
              marginTop: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
              color: '#475569',
              fontSize: '0.9rem',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            <span>
              {versaoDoApp ? `Versão instalada: ${versaoDoApp}. ` : ''}
              {descricaoDaAtualizacao}
            </span>
            {atualizacao.fase === 'pronta' ? (
              <button
                type="button"
                data-no-dwell="true"
                onClick={() => void instalarAtualizacao()}
                style={{
                  padding: '0.6rem 1rem',
                  background: '#F0A030',
                  color: '#1a1205',
                  border: 'none',
                  borderRadius: '0.85rem',
                  cursor: 'pointer',
                  fontWeight: 800,
                }}
              >
                Reiniciar e atualizar
              </button>
            ) : atualizacao.fase !== 'inativa' ? (
              <button
                type="button"
                data-no-dwell="true"
                disabled={atualizacao.fase === 'verificando' || atualizacao.fase === 'baixando'}
                onClick={() => void verificarAtualizacao()}
                style={{
                  padding: '0.6rem 1rem',
                  background: 'transparent',
                  color: '#1e293b',
                  border: '2px solid #cbd5e1',
                  borderRadius: '0.85rem',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                Verificar agora
              </button>
            ) : null}
          </div>
        </section>


        <section aria-labelledby="filter-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <Clock size={28} color="#1B54A8" aria-hidden="true" />
            <h2
              id="filter-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              Suavização do cursor
            </h2>
          </div>
          <p
            style={{
              color: 'var(--color-text-base)',
              opacity: 0.9,
              marginBottom: '1.25rem',
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.6,
            }}
          >
            Preset do filtro temporal. <strong>Estável</strong>: jitter baixo, ideal para leitura.{' '}
            <strong>Responsivo</strong>: lag baixo, ideal para teclado virtual e jogos.
          </p>
          <div
            role="radiogroup"
            aria-labelledby="filter-title"
            style={{ display: 'flex', gap: '1rem' }}
          >
            {(['estavel-v2', 'balanceado-v2', 'responsivo-v2'] as FilterPresetV2[]).map(
              (preset) => {
                const active = filterPreset === preset;
                const label =
                  preset === 'estavel-v2'
                    ? 'Estável'
                    : preset === 'balanceado-v2'
                      ? 'Balanceado'
                      : 'Responsivo';
                return (
                  <button
                    key={preset}
                    role="radio"
                    aria-checked={active}
                    onClick={() => chooseFilterPreset(preset)}
                    style={{
                      flex: 1,
                      padding: '1rem',
                      borderRadius: '1rem',
                      cursor: 'pointer',
                      fontWeight: 700,
                      border: '2px solid',
                      background: active ? 'linear-gradient(135deg, #1B54A8, #2563eb)' : 'white',
                      color: active ? 'white' : '#475569',
                      borderColor: active ? '#1B54A8' : '#e2e8f0',
                    }}
                  >
                    {label}
                  </button>
                );
              }
            )}
          </div>
        </section>

        <section aria-labelledby="accuracy-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <Target size={28} color="#1B54A8" aria-hidden="true" />
            <h2
              id="accuracy-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              Teste de precisão
            </h2>
          </div>
          <p
            style={{
              color: 'var(--color-text-base)',
              opacity: 0.9,
              marginBottom: '1.25rem',
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.6,
            }}
          >
            Roda a matriz de 13 pontos de validação e exporta o JSON com métricas
            (mean/median/p90/jitter) + metadados. Preencha a condição abaixo antes de iniciar — ela
            vira parte do relatório.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              marginBottom: '1.25rem',
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'var(--color-text-base)',
                  opacity: 0.9,
                }}
              >
                Iluminação
              </span>
              <select
                value={accuracyMeta.iluminacao}
                onChange={(e) =>
                  setAccuracyMeta({
                    ...accuracyMeta,
                    iluminacao: e.target.value as 'boa' | 'ruim',
                  })
                }
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  fontSize: '0.95rem',
                }}
              >
                <option value="boa">Boa</option>
                <option value="ruim">Ruim</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'var(--color-text-base)',
                  opacity: 0.9,
                }}
              >
                Movimento da cabeça
              </span>
              <select
                value={accuracyMeta.movimentoCabeca}
                onChange={(e) =>
                  setAccuracyMeta({
                    ...accuracyMeta,
                    movimentoCabeca: e.target.value as 'parada' | 'livre',
                  })
                }
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  fontSize: '0.95rem',
                }}
              >
                <option value="parada">Parada</option>
                <option value="livre">Livre</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'var(--color-text-base)',
                  opacity: 0.9,
                }}
              >
                Óculos
              </span>
              <select
                value={accuracyMeta.oculos ? 'sim' : 'nao'}
                onChange={(e) =>
                  setAccuracyMeta({ ...accuracyMeta, oculos: e.target.value === 'sim' })
                }
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  fontSize: '0.95rem',
                }}
              >
                <option value="nao">Não</option>
                <option value="sim">Sim</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'var(--color-text-base)',
                  opacity: 0.9,
                }}
              >
                Sessão (min)
              </span>
              <select
                value={String(accuracyMeta.minutosDeSessao)}
                onChange={(e) =>
                  setAccuracyMeta({
                    ...accuracyMeta,
                    minutosDeSessao: Number(e.target.value),
                  })
                }
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  fontSize: '0.95rem',
                }}
              >
                <option value="0">0 (recém calibrado)</option>
                <option value="20">20</option>
                <option value="40">40</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'var(--color-text-base)',
                  opacity: 0.9,
                }}
              >
                Distância (cm)
              </span>
              <input
                type="number"
                value={settings.viewingDistanceCm}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v <= 0) return;
                  updateSettings({ viewingDistanceCm: v });
                  setAccuracyMeta({ ...accuracyMeta, distanciaCm: v });
                }}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  fontSize: '0.95rem',
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'var(--color-text-base)',
                  opacity: 0.9,
                }}
              >
                Tela (polegadas)
              </span>
              <input
                type="number"
                step="0.1"
                value={settings.screenDiagonalIn}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v <= 0) return;
                  // Edição manual passa a ser soberana sobre o EDID.
                  updateSettings({ screenDiagonalIn: v, screenGeometrySource: 'manual' });
                  setAccuracyMeta({ ...accuracyMeta, telaPolegadas: v });
                }}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  fontSize: '0.95rem',
                }}
              />
            </label>
          </div>

          {/* Calibração do campo de visão da câmera.
              Nenhuma API expõe o FOV da lente, e sem ele o medidor de
              distância da pré-calibração não tem como converter "tamanho do
              rosto no frame" em centímetros. Derivamos UMA vez: o cuidador
              mede a distância com fita, o app lê o tamanho do rosto naquele
              instante, e a geometria devolve o FOV. Depois disso o app
              estima a distância sozinho em toda sessão. */}
          <div
            style={{
              marginTop: '1rem',
              padding: '0.9rem 1rem',
              borderRadius: '0.75rem',
              border: '2px solid var(--color-card-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
            }}
          >
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-base)' }}>
              Campo de visão da câmera
            </div>
            <div style={{ fontSize: '0.82rem', opacity: 0.8, lineHeight: 1.5 }}>
              {settings.cameraHorizontalFovDeg !== null
                ? `Calibrado: ${settings.cameraHorizontalFovDeg.toFixed(1)}°. O medidor de distância da pré-calibração está ativo.`
                : 'Não calibrado — o medidor de distância da pré-calibração fica inativo. ' +
                  'Meça a distância do rosto até a CÂMERA com fita, digite acima em "Distância (cm)", ' +
                  'sente na posição de uso e clique abaixo.'}
            </div>
            <button
              type="button"
              onClick={() => {
                const d = getDiagnostics();
                if (!d || !d.framing.hasFace || d.video.width <= 0) {
                  toast.error(
                    'Rosto não detectado. Sente-se de frente para a câmera e tente de novo.'
                  );
                  return;
                }
                const fov = deriveHorizontalFovDeg(
                  d.framing.iodPx,
                  d.video.width,
                  settings.viewingDistanceCm
                );
                if (fov === null) {
                  toast.error(
                    'Não foi possível derivar o campo de visão. Confira a distância digitada.'
                  );
                  return;
                }
                updateSettings({ cameraHorizontalFovDeg: fov });
                toast.success(`Campo de visão calibrado: ${fov.toFixed(1)}°`);
              }}
              style={{
                alignSelf: 'flex-start',
                padding: '0.6rem 1.2rem',
                borderRadius: '1.5rem',
                border: 'none',
                background: 'var(--color-accent, #1B54A8)',
                color: '#fff',
                fontSize: '0.88rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Calibrar campo de visão
            </button>
            {settings.cameraHorizontalFovDeg !== null && (
              <button
                type="button"
                onClick={() => updateSettings({ cameraHorizontalFovDeg: null })}
                style={{
                  alignSelf: 'flex-start',
                  padding: '0.35rem 0',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-base)',
                  opacity: 0.6,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Limpar calibração
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleAccuracyTest}
            disabled={accuracyRunning}
            aria-label="Testar precisão"
            style={{
              padding: '1rem 1.5rem',
              borderRadius: '1rem',
              border: 'none',
              background: accuracyRunning ? '#94a3b8' : 'linear-gradient(135deg, #1B54A8, #2563eb)',
              color: 'white',
              fontWeight: 700,
              cursor: accuracyRunning ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <Target size={20} aria-hidden="true" />{' '}
            {accuracyRunning ? 'Rodando…' : 'Testar precisão'}
          </button>

          {lastAccuracy && (
            <div
              style={{
                marginTop: '1.25rem',
                padding: '1rem 1.25rem',
                background: '#f0f9ff',
                border: '1px solid #bae6fd',
                borderRadius: '1rem',
                color: '#0c4a6e',
                fontSize: '0.9rem',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
                Último resultado — {lastAccuracy.score}
              </div>
              {/* métricas podem ser `null` quando nenhum ponto de
                  validação coletou amostra. "—" é a resposta honesta; antes o
                  relatório mostrava `0px` num campo e `NaN` noutro para o
                  mesmo evento. */}
              <div>
                mean = {px(lastAccuracy.meanError)} · median = {px(lastAccuracy.medianError)} · p90
                = {px(lastAccuracy.p90Error)} · jitter ={' '}
                {lastAccuracy.jitterRMS === null ? '—' : `${lastAccuracy.jitterRMS.toFixed(1)}px`} ·{' '}
                {lastAccuracy.meanErrorDeg === null
                  ? '—'
                  : `${lastAccuracy.meanErrorDeg.toFixed(2)}°`}
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="recorder-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <Video size={28} color="#1B54A8" aria-hidden="true" />
            <h2
              id="recorder-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              Gravador de sessão
            </h2>
          </div>
          <p
            style={{
              color: 'var(--color-text-base)',
              opacity: 0.9,
              marginBottom: '1.25rem',
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.6,
            }}
          >
            Grava landmarks, saída do L2CS, features e ponto predito em JSONL —{' '}
            <strong>sem vídeo</strong>. Use para depurar sem se preocupar em reproduzir a sessão.
          </p>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={toggleRecording}
              aria-label={recActive ? 'Parar gravação' : 'Iniciar gravação'}
              style={{
                padding: '1rem 1.5rem',
                borderRadius: '1rem',
                border: 'none',
                background: recActive
                  ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                  : 'linear-gradient(135deg, #1B54A8, #2563eb)',
                color: 'white',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              {recActive ? (
                <Square size={20} aria-hidden="true" />
              ) : (
                <Video size={20} aria-hidden="true" />
              )}
              {recActive ? 'Parar gravação' : 'Iniciar gravação'}
            </button>

            <button
              type="button"
              onClick={exportRecording}
              disabled={recStats.frames === 0}
              aria-label="Exportar gravação em JSONL"
              style={{
                padding: '1rem 1.5rem',
                borderRadius: '1rem',
                border: '2px solid var(--color-card-border)',
                background: recStats.frames === 0 ? '#e2e8f0' : 'var(--color-card-bg)',
                color: 'var(--color-text-base)',
                opacity: recStats.frames === 0 ? 0.5 : 0.9,
                fontWeight: 700,
                cursor: recStats.frames === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <FileText size={20} aria-hidden="true" /> Exportar (.jsonl)
            </button>

            <button
              type="button"
              onClick={clearRecording}
              disabled={recStats.frames === 0}
              aria-label="Descartar gravação atual"
              style={{
                padding: '1rem 1.5rem',
                borderRadius: '1rem',
                border: '2px solid var(--color-card-border)',
                background: 'transparent',
                color: 'var(--color-text-base)',
                opacity: recStats.frames === 0 ? 0.4 : 0.9,
                fontWeight: 700,
                cursor: recStats.frames === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Descartar
            </button>

            <div
              role="status"
              aria-live="polite"
              style={{
                marginLeft: 'auto',
                padding: '0.75rem 1.25rem',
                background: recActive ? '#fef2f2' : '#f1f5f9',
                border: `1px solid ${recActive ? '#fecaca' : '#e2e8f0'}`,
                borderRadius: '0.75rem',
                fontSize: '0.9rem',
                fontFamily: 'system-ui, sans-serif',
                color: recActive ? '#991b1b' : '#475569',
                fontWeight: 600,
              }}
            >
              {recActive ? '● Gravando · ' : ''}
              {recStats.frames} frames
              {recStats.dropped > 0 && ` (${recStats.dropped} descartados — buffer cheio)`}
            </div>
          </div>
        </section>

        {/* Lembretes e Rotinas do Paciente */}
        <section aria-labelledby="reminders-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.5rem',
            }}
          >
            <Clock size={28} color="#1B54A8" aria-hidden="true" />
            <h2
              id="reminders-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              Lembretes e Rotina Diária
            </h2>
          </div>

          {/* Form para Adicionar Lembrete */}
          <form
            onSubmit={handleAddReminder}
            style={{
              display: 'flex',
              gap: '1rem',
              marginBottom: '2rem',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label
                htmlFor="reminder-title"
                style={{ fontSize: '0.9rem', fontWeight: 600, color: '#475569' }}
              >
                Atividade / Lembrete
              </label>
              <input
                id="reminder-title"
                type="text"
                value={newReminderTitle}
                onChange={(e) => setNewReminderTitle(e.target.value)}
                placeholder="Ex: Tomar água, Fisioterapia, etc."
                style={{
                  padding: '0.85rem 1.25rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  background: 'var(--color-card-bg)',
                  color: 'var(--color-text-base)',
                  fontSize: '1rem',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                minWidth: '130px',
              }}
            >
              <label
                htmlFor="reminder-time"
                style={{ fontSize: '0.9rem', fontWeight: 600, color: '#475569' }}
              >
                Horário
              </label>
              <input
                id="reminder-time"
                type="time"
                value={newReminderTime}
                onChange={(e) => setNewReminderTime(e.target.value)}
                style={{
                  padding: '0.85rem 1.25rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  background: 'var(--color-card-bg)',
                  color: 'var(--color-text-base)',
                  fontSize: '1rem',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              type="submit"
              style={{
                padding: '0.85rem 1.5rem',
                borderRadius: '0.75rem',
                border: 'none',
                background: '#1B54A8',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                height: '47px',
              }}
            >
              <Plus size={20} /> Adicionar
            </button>
          </form>

          {/* Lista de Lembretes Ativos */}
          <div>
            <h3
              style={{
                fontSize: '1.05rem',
                fontWeight: 700,
                color: '#475569',
                marginBottom: '1rem',
              }}
            >
              Lembretes Agendados ({reminders.length})
            </h3>
            {reminders.length === 0 ? (
              <p style={{ fontSize: '0.95rem', color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>
                Nenhum lembrete configurado no momento.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {reminders.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '1rem 1.25rem',
                      background: 'var(--color-bg-base)',
                      border: '1.5px solid var(--color-card-border)',
                      borderRadius: '1rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          background: 'rgba(27, 84, 168, 0.05)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#1B54A8',
                          fontWeight: 700,
                          fontSize: '0.9rem',
                        }}
                      >
                        {r.time}
                      </div>
                      <span
                        style={{
                          fontSize: '1.1rem',
                          fontWeight: 700,
                          color: 'var(--color-text-base)',
                        }}
                      >
                        {r.title}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        deleteReminder(r.id);
                        toast.success('Lembrete removido com sucesso!');
                      }}
                      aria-label={`Excluir lembrete ${r.title}`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '0.5rem',
                        borderRadius: '0.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.2s',
                      }}
                      onMouseOver={(e) =>
                        (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)')
                      }
                      onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                      onFocus={(e) =>
                        (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)')
                      }
                      onBlur={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Histórico Clínico e Telemetria */}
        <section aria-labelledby="clinical-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <UserCog size={28} color="#1B54A8" aria-hidden="true" />
            <h2
              id="clinical-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              Histórico Clínico e Telemetria (LGPD)
            </h2>
          </div>

          <div
            style={{
              background: 'rgba(27, 84, 168, 0.03)',
              border: '1.5px solid rgba(27, 84, 168, 0.15)',
              borderRadius: '1rem',
              padding: '1.25rem',
              marginBottom: '1.5rem',
              fontSize: '0.95rem',
              lineHeight: 1.5,
              color: '#334155',
            }}
          >
            <p style={{ margin: '0 0 0.75rem 0', fontWeight: 700, color: '#1B54A8' }}>
              🔒 Proteção de Dados e Privacidade (LGPD)
            </p>
            <p style={{ margin: 0 }}>
              Em conformidade com a LGPD, o IrisFlow apenas armazena dados de uso, calibrações e
              sentenças faladas localmente neste dispositivo para fins de acompanhamento clínico.
              Nenhum dado de saúde é enviado a servidores externos.
            </p>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginTop: '1.25rem',
                cursor: 'pointer',
                fontWeight: 700,
                color: '#1e293b',
              }}
            >
              <input
                type="checkbox"
                checked={consentActive}
                onChange={(e) => handleToggleConsent(e.target.checked)}
                style={{
                  width: '1.2rem',
                  height: '1.2rem',
                  cursor: 'pointer',
                }}
              />
              Autorizar a coleta de dados de rotina e calibração local do paciente
            </label>
          </div>

          {consentActive ? (
            <div>
              {/* Grid de Estatísticas */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '1.5rem',
                  marginBottom: '2rem',
                }}
              >
                {/* Cartão 1: Evolução da Calibração */}
                <div
                  style={{
                    background: 'var(--color-bg-base)',
                    border: '1.5px solid var(--color-card-border)',
                    borderRadius: '1.25rem',
                    padding: '1.25rem',
                  }}
                >
                  <h3
                    style={{
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color: '#475569',
                      margin: '0 0 1rem 0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <Activity size={20} color="#1B54A8" /> Histórico de Calibrações (
                    {clinicalData.calibrations.length})
                  </h3>
                  {clinicalData.calibrations.length === 0 ? (
                    <p
                      style={{
                        fontSize: '0.9rem',
                        color: '#94a3b8',
                        fontStyle: 'italic',
                        margin: 0,
                      }}
                    >
                      Nenhum teste de precisão registrado.
                    </p>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        maxHeight: '200px',
                        overflowY: 'auto',
                      }}
                    >
                      {[...clinicalData.calibrations].reverse().map((c) => {
                        const dateStr = new Date(c.timestamp).toLocaleString('pt-BR');
                        const isHighError = c.errorDeg >= 1.5;
                        return (
                          <div
                            key={c.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '0.6rem 0.85rem',
                              background: 'var(--color-card-bg)',
                              border: `1.5px solid ${isHighError ? '#fca5a5' : 'var(--color-card-border)'}`,
                              borderRadius: '0.75rem',
                            }}
                          >
                            <span
                              style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 500 }}
                            >
                              {dateStr}
                            </span>
                            <span
                              style={{
                                fontSize: '0.95rem',
                                fontWeight: 800,
                                color: isHighError ? '#ef4444' : '#16a34a',
                              }}
                            >
                              {c.errorDeg.toFixed(2)}° {isHighError ? '(Alto)' : '(Excelente)'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {clinicalData.calibrations.length > 2 && (
                    <div
                      style={{
                        marginTop: '1rem',
                        fontSize: '0.8rem',
                        color: '#64748b',
                        background: 'rgba(245, 158, 11, 0.05)',
                        border: '1px solid rgba(245, 158, 11, 0.2)',
                        borderRadius: '0.5rem',
                        padding: '0.5rem 0.75rem',
                        lineHeight: 1.4,
                      }}
                    >
                      💡 <strong>Aviso clínico:</strong> Um aumento progressivo no desvio angular (°
                      médio) ao longo das semanas pode indicar fadiga muscular ocular, alteração
                      postural ou progressão da doença motora.
                    </div>
                  )}
                </div>

                {/* Cartão 2: Frases mais Usadas */}
                <div
                  style={{
                    background: 'var(--color-bg-base)',
                    border: '1.5px solid var(--color-card-border)',
                    borderRadius: '1.25rem',
                    padding: '1.25rem',
                  }}
                >
                  <h3
                    style={{
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color: '#475569',
                      margin: '0 0 1rem 0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <MessageSquare size={20} color="#1B54A8" /> Frases mais Comuns
                  </h3>
                  {clinicalData.sentences.length === 0 ? (
                    <p
                      style={{
                        fontSize: '0.9rem',
                        color: '#94a3b8',
                        fontStyle: 'italic',
                        margin: 0,
                      }}
                    >
                      Nenhuma frase registrada no histórico.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {getMostUsedPhrases(4).map((p, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.6rem 0.85rem',
                            background: 'var(--color-card-bg)',
                            border: '1.5px solid var(--color-card-border)',
                            borderRadius: '0.75rem',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '0.95rem',
                              fontWeight: 700,
                              color: 'var(--color-text-base)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '80%',
                            }}
                          >
                            "{p.text}"
                          </span>
                          <span
                            style={{
                              fontSize: '0.85rem',
                              fontWeight: 800,
                              background: 'rgba(27, 84, 168, 0.08)',
                              color: '#1B54A8',
                              padding: '0.2rem 0.5rem',
                              borderRadius: '0.5rem',
                            }}
                          >
                            {p.count}x
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Cartão 3: Distribuição de Atividade */}
                <div
                  style={{
                    background: 'var(--color-bg-base)',
                    border: '1.5px solid var(--color-card-border)',
                    borderRadius: '1.25rem',
                    padding: '1.25rem',
                  }}
                >
                  <h3
                    style={{
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color: '#475569',
                      margin: '0 0 1rem 0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <Clock size={20} color="#1B54A8" /> Atividade por Período
                  </h3>
                  {clinicalData.sentences.length === 0 ? (
                    <p
                      style={{
                        fontSize: '0.9rem',
                        color: '#94a3b8',
                        fontStyle: 'italic',
                        margin: 0,
                      }}
                    >
                      Nenhum dado de atividade disponível.
                    </p>
                  ) : (
                    (() => {
                      const hourly = getActivityByHour();
                      const periods = {
                        'Madrugada (00h - 06h)': hourly.slice(0, 6).reduce((a, b) => a + b, 0),
                        'Manhã (06h - 12h)': hourly.slice(6, 12).reduce((a, b) => a + b, 0),
                        'Tarde (12h - 18h)': hourly.slice(12, 18).reduce((a, b) => a + b, 0),
                        'Noite (18h - 24h)': hourly.slice(18, 24).reduce((a, b) => a + b, 0),
                      };
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                          {Object.entries(periods).map(([name, count]) => (
                            <div
                              key={name}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                fontSize: '0.95rem',
                                color: '#475569',
                              }}
                            >
                              <span style={{ fontWeight: 600 }}>{name}</span>
                              <span style={{ fontWeight: 800, color: 'var(--color-primary)' }}>
                                {count} falas
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>

              {/* Botões de Ação de Dados */}
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleExportClinicalLogs}
                  style={{
                    padding: '0.85rem 1.5rem',
                    borderRadius: '0.75rem',
                    border: 'none',
                    background: '#1B54A8',
                    color: '#ffffff',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Download size={18} /> Exportar Relatório Clínico (JSON)
                </button>
                <button
                  type="button"
                  onClick={handleClearClinicalLogs}
                  style={{
                    padding: '0.85rem 1.5rem',
                    borderRadius: '0.75rem',
                    border: '1.5px solid #fca5a5',
                    background: 'transparent',
                    color: '#ef4444',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = '#fef2f2';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.background = '#fef2f2';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <Trash2 size={18} /> Excluir Todos os Dados Clínicos
                </button>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: '0.95rem', color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>
              Ative a autorização de coleta acima para visualizar o painel histórico e evolução de
              calibrações.
            </p>
          )}
        </section>

        {/* Backup */}
        <section aria-labelledby="backup-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <Download size={28} color="#1B54A8" aria-hidden="true" />
            <h2
              id="backup-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              {t('settings.backup.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleBackup}
            aria-label={t('settings.backup.export')}
            style={{
              padding: '1rem 1.5rem',
              borderRadius: '1rem',
              border: '2px solid var(--color-card-border)',
              background: 'var(--color-card-bg)',
              color: 'var(--color-text-base)',
              opacity: 0.9,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <Download size={20} aria-hidden="true" /> {t('settings.backup.export')}
          </button>
        </section>

        <p
          style={{
            fontSize: '0.75rem',
            color: '#94a3b8',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
          }}
        >
          PIN atual: configurado via <code>VITE_CAREGIVER_PIN</code> (env:{' '}
          {env.caregiverPin ? '***' : 'default'}). Substituir por autenticação no backend antes de
          produção.
        </p>
      </div>
      {dialogo}
    </CaregiverPageLayout>
  );
};
