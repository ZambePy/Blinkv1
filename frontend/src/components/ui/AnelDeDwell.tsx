import React from 'react';
import { geometriaDoAnel } from '@tracker/interaction/dwellRing';

/**
 * O anel de progresso do dwell.
 *
 * A geometria vem de `dwellRing.ts`, do core — o MESMO cálculo que desenha o
 * anel real. Um desenho parecido feito aqui divergiria do real no primeiro
 * ajuste de espessura ou folga, e o tutorial passaria a ensinar uma coisa que
 * não acontece na tela de uso.
 *
 * Decorativo por escolha: quem anuncia o progresso a um leitor de tela é o
 * componente em volta, que sabe o que está sendo preenchido. Um `role`
 * aqui produziria "50%" sem dizer 50% de quê.
 */
export const AnelDeDwell: React.FC<{
  tamanhoPx: number;
  /** 0 a 1. Valores fora da faixa são presos pelo core. */
  progresso: number;
  cor?: string;
}> = ({ tamanhoPx, progresso, cor = 'var(--color-primary)' }) => {
  const g = geometriaDoAnel(tamanhoPx, progresso);

  return (
    <svg
      aria-hidden="true"
      width={g.lado}
      height={g.lado}
      viewBox={`0 0 ${g.lado} ${g.lado}`}
      style={{ display: 'block' }}
    >
      <circle
        cx={g.centro}
        cy={g.centro}
        r={g.raio}
        fill="none"
        stroke="var(--color-card-border)"
        strokeWidth={g.espessura}
      />
      <circle
        cx={g.centro}
        cy={g.centro}
        r={g.raio}
        fill="none"
        stroke={cor}
        strokeWidth={g.espessura}
        strokeDasharray={g.circunferencia}
        strokeDashoffset={g.offset}
        strokeLinecap="round"
        transform={`rotate(${g.rotacaoDeg} ${g.centro} ${g.centro})`}
      />
    </svg>
  );
};
