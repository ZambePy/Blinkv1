import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fracaoDoTetoDaCorrecao } from '@tracker/interaction/correcaoPorDwell';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useGaze } from '../../context/GazeContext';
import { useSettings } from '../../context/SettingsContext';
import { erroAngularDeg } from '@tracker/accuracy';
import { evaluateReadiness } from '@tracker/setupReadiness';
import { snapshotFromDiagnostics, lerViewport } from '@tracker/setupReadinessAdapter';
import { getCalibrationTimestampMs } from '@tracker/calibration';
import { lerReferencia, gravarReferencia } from '../../services/local/referenciaDaChecagem';
import { veredictoDaChecagem, type ResultadoDoVeredicto } from './veredictoDaChecagem';
import { MS_POR_ALVO, MS_DE_ACOMODACAO, MS_LIMITE_DE_ENQUADRAMENTO } from './tempos';

/**
 * Checagem de retomada — a 2ª abertura em diante.
 *
 * **Não mede precisão.** Com três alvos o ruído é grande demais para separar
 * 2,5° de 3,2°. O que ela detecta é mudança grosseira: pessoa diferente,
 * monitor movido, paciente 20 cm mais longe, perfil trocado. A tela diz isso —
 * um número de três pontos apresentado como medição vira dado ruim no
 * acompanhamento clínico, e depois ninguém o distingue de uma medição real.
 *
 * **Não usa `startAccuracyTest`.** Aquele é instrumento de medição: escreve o
 * relatório canônico e incrementa `blocoDeMedicao`. Rodando todo dia, gravaria
 * um relatório por dia e corromperia a contagem de blocos. Mas a MATEMÁTICA é
 * reaproveitada (`erroAngularDeg`), então não há segunda fórmula de erro.
 *
 * **Pular está sempre disponível.** Um paciente que precisa falar agora não
 * pode ser detido por quinze segundos de verificação.
 */

/** Centro e dois cantos opostos: cobre o máximo de excentricidade com 3 pontos. */
const ALVOS = [
  { x: 0.5, y: 0.5 },
  { x: 0.15, y: 0.15 },
  { x: 0.85, y: 0.85 },
] as const;

type Fase = 'enquadramento' | 'alvos' | 'fim';

export const ChecagemRapida: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { subscribe, getDiagnostics } = useGaze();
  const { settings } = useSettings();

  const [fase, setFase] = useState<Fase>('enquadramento');
  const [indice, setIndice] = useState(0);
  const [resultado, setResultado] = useState<ResultadoDoVeredicto | null>(null);
  const [eraPrimeira, setEraPrimeira] = useState(false);

  const posicaoOk = useRef({ rosto: false, distancia: false });
  /**
   * Sticky: uma vez quebrada, a posição não "desquebra".
   *
   * Se o paciente saiu do enquadramento durante os alvos, as amostras já
   * coletadas mediram a posição, não a calibração. Recuperar a posição no
   * último segundo não as conserta — e olhar só o estado final aprovaria
   * exatamente a checagem que não vale.
   */
  const quebrou = useRef({ rosto: false, distancia: false });
  const errosPorAlvo = useRef<number[]>([]);
  const amostrasDoAlvo = useRef<{ x: number; y: number }[]>([]);

  const pular = useCallback(() => navigate('/menu', { replace: true }), [navigate]);

  // ── Posição: vigiada no enquadramento E durante os alvos ─────────────────
  // Reaproveita `evaluateReadiness`, que já decide isto e já é testado.
  useEffect(() => {
    if (fase === 'fim') return;

    const id = setInterval(() => {
      const d = getDiagnostics();
      if (!d) return;
      const snap = snapshotFromDiagnostics(d, lerViewport());
      if (!snap) return;

      const r = evaluateReadiness(snap, {
        horizontalFovDeg: settings.cameraHorizontalFovDeg,
      });
      const acha = (idCheck: string) => r.checks.find((c) => c.id === idCheck)?.status;
      const agora = {
        rosto: acha('face') === 'ok' && acha('centering') === 'ok',
        distancia: acha('distance') === 'ok',
      };
      posicaoOk.current = agora;

      if (fase === 'alvos') {
        if (!agora.rosto) quebrou.current.rosto = true;
        if (!agora.distancia) quebrou.current.distancia = true;
      } else if (agora.rosto && agora.distancia) {
        setFase('alvos');
      }
    }, 300);

    return () => clearInterval(id);
  }, [fase, getDiagnostics, settings.cameraHorizontalFovDeg]);

  // Limite do enquadramento: sem isto a tela espera para sempre por uma posição
  // que talvez o paciente não consiga fazer hoje.
  useEffect(() => {
    if (fase !== 'enquadramento') return;
    const id = window.setTimeout(() => setFase('fim'), MS_LIMITE_DE_ENQUADRAMENTO);
    return () => window.clearTimeout(id);
  }, [fase]);

  // ── Fase 2: os três alvos ────────────────────────────────────────────────
  useEffect(() => {
    if (fase !== 'alvos') return;

    amostrasDoAlvo.current = [];
    const inicio = Date.now();

    const cancelar = subscribe((s) => {
      if (Date.now() - inicio < MS_DE_ACOMODACAO) return;
      if (s.hasFace) amostrasDoAlvo.current.push({ x: s.x, y: s.y });
    });

    const timer = window.setTimeout(() => {
      const alvo = ALVOS[indice];
      const amostras = amostrasDoAlvo.current;

      if (amostras.length > 0) {
        const alvoPx = { x: alvo.x * window.innerWidth, y: alvo.y * window.innerHeight };
        const centro = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        const distPx = distanciaEmPx(settings);
        const media = {
          x: amostras.reduce((a, p) => a + p.x, 0) / amostras.length,
          y: amostras.reduce((a, p) => a + p.y, 0) / amostras.length,
        };
        errosPorAlvo.current.push(erroAngularDeg(alvoPx, media, centro, distPx));
      }

      if (indice + 1 < ALVOS.length) setIndice(indice + 1);
      else setFase('fim');
    }, MS_POR_ALVO);

    return () => {
      cancelar();
      window.clearTimeout(timer);
    };
  }, [fase, indice, subscribe, settings]);

  // ── Fase 3: veredito ─────────────────────────────────────────────────────
  useEffect(() => {
    if (fase !== 'fim' || resultado !== null) return;

    const erros = errosPorAlvo.current;
    const erroDeg = erros.length > 0 ? erros.reduce((a, b) => a + b, 0) / erros.length : null;

    const calibTs = getCalibrationTimestampMs();
    const ref = lerReferencia(calibTs);
    setEraPrimeira(ref === null);

    setResultado(
      veredictoDaChecagem({
        erroDeg,
        referenciaDeg: ref?.erroDeg ?? null,
        rostoEnquadrado: posicaoOk.current.rosto && !quebrou.current.rosto,
        distanciaNaFaixa: posicaoOk.current.distancia && !quebrou.current.distancia,
        // Quanto do teto a correção por dwell já precisou gastar (sprint S3).
        // Perto do teto, o erro de três alvos pode estar bom justamente porque
        // a correção está segurando — e é aí que recalibrar vale a pena.
        fracaoDoTetoDaCorrecao: fracaoDoTetoDaCorrecao(),
      })
    );

    // A primeira checagem ESTABELECE a referência. Gravar depois disso
    // sobrescreveria a base de comparação com um valor pior e mascararia a
    // deriva justamente quando ela apareceu.
    if (ref === null && erroDeg !== null) gravarReferencia(calibTs, erroDeg);
  }, [fase, resultado]);

  const alvo = ALVOS[Math.min(indice, ALVOS.length - 1)];

  return (
    <main
      role="main"
      aria-labelledby="checagem-title"
      style={{
        minHeight: '100vh',
        background: 'var(--settings-bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.5rem',
        padding: '2rem 1.5rem',
        position: 'relative',
      }}
    >
      <h1
        id="checagem-title"
        style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: 'var(--color-text-base)' }}
      >
        {t('retomada.title')}
      </h1>

      {fase !== 'fim' && (
        <>
          <p
            role="status"
            aria-live="polite"
            style={{
              margin: 0,
              fontSize: '1.05rem',
              color: 'var(--color-text-base)',
              opacity: 0.85,
            }}
          >
            {t(`retomada.fase.${fase}`)}
          </p>

          {fase === 'alvos' && (
            <>
              <span style={{ fontSize: '0.9rem', opacity: 0.7, color: 'var(--color-text-base)' }}>
                {t('retomada.alvo', { n: indice + 1, total: ALVOS.length })}
              </span>
              <div
                aria-hidden="true"
                style={{
                  position: 'fixed',
                  left: `${alvo.x * 100}%`,
                  top: `${alvo.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'var(--color-primary)',
                  boxShadow: '0 0 0 8px rgba(27,84,168,0.18)',
                }}
              />
            </>
          )}
        </>
      )}

      {resultado && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.9rem',
            maxWidth: 520,
            padding: '1.5rem',
            borderRadius: '1.25rem',
            background:
              resultado.veredicto === 'seguir' ? 'var(--tint-ok-bg)' : 'var(--tint-warn-bg)',
            border: `1px solid ${
              resultado.veredicto === 'seguir' ? 'var(--tint-ok-border)' : 'var(--tint-warn-border)'
            }`,
          }}
        >
          <strong
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              fontSize: '1.2rem',
              fontWeight: 800,
              color: 'var(--color-text-base)',
            }}
          >
            {resultado.veredicto === 'seguir' ? (
              <CheckCircle2 size={22} color="var(--tint-ok-text)" aria-hidden="true" />
            ) : (
              <AlertTriangle size={22} color="var(--tint-warn-text)" aria-hidden="true" />
            )}
            {t(`retomada.veredicto.${resultado.veredicto}`)}
          </strong>

          <span style={{ fontSize: '1rem', lineHeight: 1.55, color: 'var(--color-text-base)' }}>
            {t(`retomada.corpo.${resultado.veredicto}`)}
          </span>

          {resultado.motivo && (
            <span style={{ fontSize: '0.96rem', fontWeight: 600, color: 'var(--color-text-base)' }}>
              {t(`retomada.motivo.${resultado.motivo}`)}
            </span>
          )}

          {eraPrimeira && (
            <span style={{ fontSize: '0.88rem', opacity: 0.8, color: 'var(--color-text-base)' }}>
              {t('retomada.primeira')}
            </span>
          )}

          {/* Os dois sempre disponíveis: nem o pior veredito obriga. */}
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <PrimaryButton type="button" onClick={() => navigate('/menu', { replace: true })}>
              {t('retomada.usar')}
            </PrimaryButton>
            <PrimaryButton
              type="button"
              variant="secondary"
              onClick={() => navigate('/calibration-check')}
            >
              {t('retomada.calibrar')}
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* A ressalva que define o que esta tela é. */}
      <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start', maxWidth: 520 }}>
        <Info
          size={15}
          color="var(--color-primary)"
          aria-hidden="true"
          style={{ flexShrink: 0, marginTop: 3 }}
        />
        <span
          style={{
            fontSize: '0.84rem',
            lineHeight: 1.5,
            opacity: 0.75,
            color: 'var(--color-text-base)',
          }}
        >
          {t('retomada.explica')}
        </span>
      </div>

      <button
        type="button"
        onClick={pular}
        data-dwell-ms="2000"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--color-primary)',
          fontSize: '0.9rem',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {t('retomada.pular')}
      </button>
    </main>
  );
};

/**
 * Distância olho→tela em px, para converter erro em graus.
 *
 * Mesma conversão que o teste de precisão usa; sem ela o erro sairia em px e
 * não seria comparável entre setups — nem com a própria referência, se a tela
 * mudar.
 */
function distanciaEmPx(settings: { screenDiagonalIn: number; viewingDistanceCm: number }): number {
  const diagPx = Math.hypot(window.screen.width, window.screen.height);
  const pxPorCm = settings.screenDiagonalIn > 0 ? diagPx / (settings.screenDiagonalIn * 2.54) : 0;
  return settings.viewingDistanceCm * pxPorCm;
}
