import React, { useEffect } from 'react';
import { AlertTriangle, CameraOff } from 'lucide-react';

/**
 * Faixa de status no topo da tela.
 *
 * Falhas que bloqueiam o controle por olhar precisam ser VISÍVEIS: câmera
 * indisponível, calibração invalidada, falta de calibração, rosto perdido e
 * distância fora da faixa. Cursor invisível + nada clicável, sem aviso, é
 * indistinguível de "o programa travou" — e o usuário-alvo não tem como
 * reiniciar sozinho.
 *
 * A faixa tem altura fixa (`--status-band-h`) e, enquanto está visível,
 * marca `html.has-status-band`: os layouts do paciente e o botão de
 * emergência descem para não ficarem cobertos.
 *
 * Renderizada dentro do `GazeProvider`, fora do router: não navega, apenas
 * instrui. Quem age é o cuidador, com mouse ou toque.
 */

interface Props {
  /** Estado corrente do engine. */
  state: string;
  cameraError: string | null;
  calibrationInvalidated: string | null;
  /**
   * Gaze perdido além do hold de 2 s. `null` no caminho feliz. Já vem com a
   * histerese aplicada: a faixa não pode piscar a cada quadro perdido.
   */
  gazeLostMessage?: string | null;
  /**
   * Aviso de distância fora da faixa de calibração. `null` quando está na
   * faixa ou não há medição. Fica abaixo dos outros na precedência: sem
   * câmera ou sem calibração, a distância não importa.
   */
  distanceAdvice?: string | null;
}

type Tom = 'erro' | 'aviso';

const HTML_FLAG = 'has-status-band';

export const GazeStatusBanner: React.FC<Props> = ({
  state,
  cameraError,
  calibrationInvalidated,
  distanceAdvice = null,
  gazeLostMessage = null,
}) => {
  // Ordem de precedência = ordem de gravidade. Sem câmera, nada mais importa.
  let tom: Tom | null = null;
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
      'O controle por olhar está desligado, inclusive o botão de emergência. ' +
      'Peça ao cuidador para abrir a calibração e seguir os pontos na tela.';
  } else if (gazeLostMessage) {
    // Acima do aviso de distância e abaixo dos erros de configuração: sem
    // rosto na câmera, falar de distância é responder a uma pergunta que
    // ninguém fez. É 'aviso' porque a pessoa resolve em um segundo.
    tom = 'aviso';
    titulo = gazeLostMessage;
    detalhe =
      'O rastreamento perdeu o rosto. O cursor volta assim que a câmera enxergar você de novo.';
  } else if (distanceAdvice) {
    // 'aviso', não 'erro': o sistema continua funcionando, só com precisão
    // pior que a medida na calibração.
    tom = 'aviso';
    titulo = 'Distância diferente da calibração';
    detalhe = distanceAdvice;
  }

  const visivel = tom !== null;

  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle(HTML_FLAG, visivel);
    return () => html.classList.remove(HTML_FLAG);
  }, [visivel]);

  if (!tom) return null;

  const classe = tom === 'erro' ? 'status-band--error' : 'status-band--warn';
  const Icone = tom === 'erro' ? CameraOff : AlertTriangle;

  return (
    <div
      className={`status-band ${classe}`}
      role="status"
      aria-live="polite"
      data-testid="gaze-status-banner"
      data-tone={tom}
      title={`${titulo}. ${detalhe}`}
      // A faixa não é alvo de dwell: em `uncalibrated` nada é clicável, e
      // deixá-la dwellável criaria a falsa impressão de que o olhar funciona.
      data-no-dwell="true"
    >
      <span className="status-band__icon" aria-hidden="true">
        <Icone size={32} />
      </span>
      <span className="status-band__text">
        <strong className="status-band__title">{titulo}</strong>
        <span className="status-band__detail">{detalhe}</span>
      </span>
    </div>
  );
};
