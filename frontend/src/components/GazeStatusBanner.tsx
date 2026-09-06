import React from 'react';

/**
 * Falhas que bloqueiam o controle por olhar precisam ser VISÍVEIS.
 *
 * `cameraError` e `calibrationInvalidated` já eram calculados no
 * `GazeProvider` e expostos no contexto, mas ninguém renderizava: a câmera
 * podia falhar e o app seguia mudo.
 *
 * O caso `uncalibrated` também é tratado: sem calibração o cursor é escondido
 * (não há mapeamento para desenhar) e o dwell fica desligado — inclusive para
 * emergência, por decisão de segurança: sobre o fallback do nariz, permitir
 * emergência é disparar alarme por acaso. Cursor invisível + nada clicável,
 * sem aviso, é indistinguível de "o programa travou" — e o usuário-alvo não
 * tem como reiniciar sozinho. Este banner é o que fecha esse beco.
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

export const GazeStatusBanner: React.FC<Props> = ({
  state,
  cameraError,
  calibrationInvalidated,
  distanceAdvice = null,
  gazeLostMessage = null,
}) => {
  // Ordem de precedência = ordem de gravidade. Sem câmera, nada mais importa.
  let tom: 'erro' | 'aviso' | null = null;
  let titulo = '';
  let detalhe = '';

  if (cameraError) {
    tom = 'erro';
    titulo = 'A câmera não está disponível';
    detalhe = `${cameraError} O controle por olhar está desligado até a câmera voltar.`;
  } else if (calibrationInvalidated) {
    tom = 'erro';
    titulo = 'A calibração deixou de valer';
    detalhe = `${calibrationInvalidated} É preciso calibrar de novo antes de usar o olhar.`;
  } else if (state === 'uncalibrated') {
    tom = 'aviso';
    titulo = 'Ainda não há calibração';
    detalhe =
      'O controle por olhar está desligado, inclusive o botão de emergência — ' +
      'sem calibração o sistema não sabe para onde você está olhando. ' +
      'Peça ao cuidador para abrir a calibração e seguir os pontos na tela.';
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
  } else if (distanceAdvice) {
    // o tom é 'aviso', não 'erro': o sistema continua funcionando, só
    // com precisão pior que a medida na calibração. Tratar isso como erro
    // ensinaria o cuidador a ignorar banners vermelhos.
    tom = 'aviso';
    titulo = 'Distância diferente da calibração';
    detalhe = distanceAdvice;
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
