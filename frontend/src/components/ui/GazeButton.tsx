import React, { useRef, useEffect } from 'react';
import { alvoMinimoPx } from '../../design/gazeMetrics';

interface GazeButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  width?: number;
  height?: number;
  emergency?: boolean;
  /**
   * Alvo de RECUPERAÇÃO.
   *
   * Marca o botão como acionável mesmo com o rastreamento em `degraded`, onde
   * o dispatcher bloqueia todo alvo comum. Existe para o botão "Recalibre
   * aqui": ele só aparece em `degraded` e, sem esta marcação, era inalcançável
   * pelo olhar — o paciente via a saída anunciada e não conseguia usá-la.
   *
   * Use APENAS em controles que consertam o próprio rastreamento. O dwell é
   * mais longo nesses alvos (2,5× em degradado) porque um acionamento
   * acidental custa uma recalibração inteira.
   */
  recovery?: boolean;
  noWarn?: boolean;
  /**
   * Alvo ISOLADO: a zona de acerto invisível cresce até o alvo mínimo de 5°
   * (`alvoMinimoPx`), mesmo que o botão visível seja menor.
   *
   * A zona padrão é limitada a 12 px de propósito, porque num teclado ocular
   * zonas maiores invadem a tecla vizinha. Um botão "Voltar" no cabeçalho não
   * tem vizinho: ao redor dele há título e espaço vazio. Ali a limitação só
   * serve para o jitter de poucos pixels na borda zerar o dwell, e o paciente
   * não consegue sair da tela. Use APENAS em botões sem outro alvo a menos de
   * `alvoMinimoPx()` de distância.
   */
  isolado?: boolean;
}

export const GazeButton: React.FC<GazeButtonProps> = ({
  children,
  width,
  height,
  emergency = false,
  recovery = false,
  noWarn = false,
  isolado = false,
  disabled,
  style,
  className = '',
  ...props
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // fonte única. Antes era o literal `198` aqui E em `GazeGrid`,
  // derivado de 5,0° a 60 cm com 96 dpi hardcoded — números que o app conhece
  // de verdade em `settings` e que o design system ignorava.
  const minPx = alvoMinimoPx();

  useEffect(() => {
    if (import.meta.env?.DEV && !noWarn) {
      const w = width ?? buttonRef.current?.offsetWidth;
      const h = height ?? buttonRef.current?.offsetHeight;
      // O que importa para acionar é a ZONA, não o retângulo pintado: um botão
      // isolado tem a zona ampliada até o mínimo e não deve avisar por um
      // problema que já foi resolvido. Sem `isolado`, a zona padrão é de 12 px
      // por lado.
      const extra = isolado ? insetParaAlvoMinimo(width, height, minPx) : { x: 12, y: 12 };
      if ((w && w + 2 * extra.x < minPx) || (h && h + 2 * extra.y < minPx)) {
        console.warn(
          `[GazeButton] Alvo visual menor que o mínimo recomendado de 5.0° (${minPx}px).`
        );
      }
    }
  }, [width, height, noWarn, isolado, minPx]);

  // Quanto a zona de acerto cresce em cada eixo para o alvo isolado chegar ao
  // mínimo. Sem largura/altura declaradas, assume-se que o botão já é grande.
  const insetIsolado = isolado ? insetParaAlvoMinimo(width, height, minPx) : null;

  return (
    <button
      ref={buttonRef}
      disabled={disabled}
      data-emergency={emergency ? 'true' : undefined}
      data-recovery={recovery ? 'true' : undefined}
      data-no-dwell={disabled ? 'true' : undefined}
      // Lido pelo dispatcher (sprint S3): só alvo isolado — grande e sem
      // vizinho acionável — vira rótulo para a correção por dwell. A classe
      // acima não serve para isso: `dataset` é o contrato com o dispatcher.
      data-isolado={isolado ? 'true' : undefined}
      className={`gaze-button ${emergency ? 'emergency' : ''} ${isolado ? 'gaze-button--isolado' : ''} ${className}`}
      style={{
        width: width ? `${width}px` : undefined,
        height: height ? `${height}px` : undefined,
        ...(insetIsolado
          ? ({
              '--gaze-hit-inset-x': `${insetIsolado.x}px`,
              '--gaze-hit-inset-y': `${insetIsolado.y}px`,
            } as React.CSSProperties)
          : {}),
        ...style,
      }}
      {...props}
    >
      <span className="gaze-button-hit-area" />
      <span className="gaze-button-content">{children}</span>
      <span className="gaze-button-progress-ring" />
    </button>
  );
};

/**
 * Quanto estender a zona de acerto em cada eixo para que (tamanho + 2·inset)
 * chegue ao alvo mínimo. Nunca menor que a zona padrão (12 px), nunca maior
 * que o necessário — crescer além do mínimo só aumenta a chance de a zona
 * alcançar algo que não deveria.
 */
export function insetParaAlvoMinimo(
  width: number | undefined,
  height: number | undefined,
  minPx: number,
): { x: number; y: number } {
  const inset = (lado: number | undefined) =>
    lado === undefined ? 12 : Math.max(12, Math.ceil((minPx - lado) / 2));
  return { x: inset(width), y: inset(height) };
}
