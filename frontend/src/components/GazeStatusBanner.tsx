import React from 'react';

/**
 * Falhas que bloqueiam o controle por olhar precisam ser VISÍVEIS.
 *
 * `cameraError` era calculado no `GazeProvider` e exposto no contexto, mas
 * ninguém renderizava: a câmera podia falhar e o app seguia mudo. Uma webcam
 * desconectada deixa o cursor sumido e nada clicável — indistinguível de "o
 * programa travou", e o usuário-alvo não tem como diagnosticar isso sozinho.
 *
 * **Os avisos de calibração foram removidos em definitivo, a pedido.** Eram
 * três — "Ainda não há calibração", "A calibração deixou de valer" e
 * "Distância diferente da calibração" — e apareciam em TODAS as telas, porque
 * este componente mora no `GazeProvider`, que envolve o app inteiro. Cobriam o
 * topo do login e do onboarding, telas que o cuidador opera com mouse e teclado
 * e onde não existe controle por olhar nenhum.
 *
 * O bloqueio que eles anunciavam continua valendo: sem calibração o dwell segue
 * desligado, inclusive para emergência (ver `GazeContext.dwell.test.tsx`). O
 * que saiu foi o aviso, não a proteção.
 *
 * Renderizado dentro do `GazeProvider`, que fica FORA do router: por isso não
 * navega, apenas instrui. Quem age é o cuidador, com mouse ou toque.
 */

interface Props {
  /** Estado corrente do engine. */
  state: string;
  cameraError: string | null;
  calibrationInvalidated: string | null;
  /**
   * gaze perdido além do hold de 2 s. `null` no caminho feliz.
   *
   * Vem pronto do `GazeFallback` (que já aplicou a histerese) em vez de ser
   * derivado aqui de `state === 'no_face'`: o banner não pode piscar a cada
   * quadro que o detector pula, senão o paciente aprende a ignorá-lo — e aí
   * ele não serve para a perda que importa.
   */
  gazeLostMessage?: string | null;
  /**
   * Aviso de distância fora da faixa de calibração. `null` quando a
   * distância está na faixa ou não há medição.
   *
   * Fica ABAIXO dos outros na ordem de precedência de propósito: sem câmera ou
   * sem calibração, a distância não importa — e empilhar dois banners num
   * software assistivo é pior que mostrar só o mais grave.
   */
  distanceAdvice?: string | null;
}

const WRAP: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  // Acima de qualquer overlay do app: este aviso não pode ficar escondido.
  zIndex: 1000000,
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',
  padding: '0.75rem',
};

const CARD: React.CSSProperties = {
  pointerEvents: 'auto',
  maxWidth: 760,
  width: '100%',
  padding: '1rem 1.4rem',
  borderRadius: '0.9rem',
  display: 'flex',
  alignItems: 'center',
  gap: '0.9rem',
  fontSize: '1.05rem',
  lineHeight: 1.45,
  boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
};

export const GazeStatusBanner: React.FC<Props> = ({ cameraError, gazeLostMessage = null }) => {
  // `state`, `calibrationInvalidated` e `distanceAdvice` continuam no contrato
  // e sao IGNORADOS de proposito. Ficam por dois motivos: o `GazeProvider`
  // segue calculando e passando os tres, e os testes precisam de um jeito de
  // afirmar que passa-los nao produz banner nenhum. Removidos do tipo, essa
  // afirmacao viraria erro de compilacao em vez de teste.
  // Ordem de precedência = ordem de gravidade. Sem câmera, nada mais importa.
  let tom: 'erro' | 'aviso' | null = null;
  let titulo = '';
  let detalhe = '';

  if (cameraError) {
    tom = 'erro';
    titulo = 'A câmera não está disponível';
    detalhe = `${cameraError} O controle por olhar está desligado até a câmera voltar.`;
  } else if (gazeLostMessage) {
    // acima do aviso de distância e abaixo dos erros de configuração.
    //
    // A ordem não é arbitrária: sem rosto na câmera, dizer que a distância
    // está diferente da calibração é responder a uma pergunta que ninguém
    // fez. E é 'aviso' e não 'erro' porque a situação é reversível pela
    // própria pessoa em um segundo — que é exatamente o que a mensagem pede.
    tom = 'aviso';
    titulo = gazeLostMessage;
    detalhe =
      'O rastreamento perdeu o rosto. O cursor volta assim que a câmera ' +
      'enxergar você de novo.';
  }

  if (!tom) return null;

  const cores =
    tom === 'erro'
      ? { bg: '#7f1d1d', border: '#ef4444', fg: '#fee2e2' }
      : { bg: '#78350f', border: '#f59e0b', fg: '#fef3c7' };

  return (
    <div style={WRAP} role="status" aria-live="polite" data-testid="gaze-status-banner">
      <div
        style={{
          ...CARD,
          background: cores.bg,
          border: `2px solid ${cores.border}`,
          color: cores.fg,
        }}
        // O banner não é alvo de dwell: em `uncalibrated` nada é clicável, e
        // deixá-lo dwellável criaria a falsa impressão de que o olhar funciona.
        data-no-dwell="true"
      >
        <span aria-hidden="true" style={{ fontSize: '1.7rem', lineHeight: 1 }}>
          {tom === 'erro' ? '⛔' : '⚠️'}
        </span>
        <span>
          <strong style={{ display: 'block', fontSize: '1.15rem', marginBottom: '0.2rem' }}>
            {titulo}
          </strong>
          {detalhe}
        </span>
      </div>
    </div>
  );
};
