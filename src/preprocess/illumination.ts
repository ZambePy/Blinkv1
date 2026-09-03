// P4.4 — controle de iluminação antes de a imagem virar feature.
//
// ── A escada, e por que a ordem importa ──────────────────────────────────────
//
//   1. **Sensor** (`cameraTuner` → constraints do MediaStream). É o ÚNICO
//      degrau que corrige a luz antes da quantização. Ganhar um stop de
//      exposição aqui traz informação que não existia no buffer.
//
//   2. **Software** (CLAHE de `P4.5`, gama de `P4.6`). Redistribui o que
//      chegou. Não recupera o que o sensor perdeu: um crop estourado passado
//      por CLAHE fica com histograma de aparência saudável e continua sem a
//      borda da íris — e agora sem nada no diagnóstico acusando o problema.
//
//   3. **Aviso ao cuidador**, quando nenhum dos dois basta.
//
// Os degraus são exclusivos de propósito. Rodar software enquanto a malha da
// câmera ainda pode agir faz o `cameraTuner` perseguir um alvo que o software
// está mudando por baixo dele — as duas malhas competem e nenhuma converge.
//
// ── Custo medido (Sprint 4, Node nesta máquina, p50 sobre 50 execuções) ──────
//
//   CLAHE 448² inteiro ............ 5,93 ms
//   CLAHE 180×70 (região ocular) .. 0,67 ms
//   gama (hist + LUT + apply 448²)  2,67 ms
//   pipeline completo 448² ........ 12,16 ms
//   pipeline com CLAHE só nos olhos  4,31 ms
//
// A especificação estimava "~1 ms" para o CLAHE. O medido é ~6× isso, e o
// pipeline completo come 12 ms de um orçamento de 33 ms por frame a 30 fps. É
// o número que sustenta duas decisões: restringir o CLAHE à região ocular, e
// manter o estágio DESLIGADO por default até `F8.4` medir se ele compensa.
//
// O ADR completo, incluindo a alternativa OpenCV.js, está em
// `docs/DECISOES_PIPELINE.md`.

/** Faixa aceitável antes de acionar qualquer degrau. */
export const ILLUMINATION_BAND = {
  /** Cerca `TARGET_BRIGHTNESS = 0,45` do `cameraTuner`, com a mesma faixa
   *  morta de 0,08 usada lá — os dois estágios têm que concordar sobre o que é
   *  "bom", senão um desfaz o trabalho do outro. */
  brightness: { min: 0.37, max: 0.53 },
  /** Contraste abaixo de 0,08 é borda de íris mole. `TARGET_CONTRAST` é 0,20;
   *  aqui o piso é o ponto em que vale intervir, não o alvo. */
  contrast: { min: 0.08, max: 1 },
} as const;

/**
 * Fração de pixels saturados acima da qual o software passa a ser maquiagem.
 *
 * 5% dos pixels grudados em 0 ou 255 já significa perda estrutural de
 * informação na região — e a região que importa (a íris) é pequena, então uma
 * fração global de 5% pode ser 100% dela.
 */
export const SATURATION_LIMIT = 0.05;

export interface IlluminationInput {
  /** Do `qualityAnalyzer`. Campos ausentes = NÃO MEDIDO (B3.3), nunca zero. */
  measured: { brightness?: number; contrast?: number };
  /** O `cameraTuner` ainda tem constraint a aplicar neste passo. */
  sensorPodeAgir: boolean;
  /** O `cameraTuner` bateu no limite do hardware. */
  sensorNoLimite: boolean;
  /** Conselho físico já formulado pelo `cameraTuner`, se houver. */
  conselhoFisico: string | null;
  /** As flags de `P4.5`/`P4.6` estão ligadas. */
  softwareDisponivel: boolean;
  /** Fração de pixels em 0 ou 255 no crop ocular. Ver `fracaoSaturada`. */
  fracaoSaturada: number;
}

export type IlluminationLayer = 'ok' | 'sensor' | 'software' | 'advise';

export interface IlluminationPlan {
  layer: IlluminationLayer;
  /** Quais correções de software acionar neste frame. */
  software: { clahe: boolean; gamma: boolean };
  advice: string | null;
  reasons: string[];
}

/** Fração de pixels colados nos extremos da faixa. */
export function fracaoSaturada(hist: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i];
  if (total <= 0) return 0;
  return (hist[0] + hist[255]) / total;
}

/**
 * Escolhe o degrau da escada. Pura e determinística.
 */
export function planIllumination(input: IlluminationInput): IlluminationPlan {
  const reasons: string[] = [];
  const nada = { clahe: false, gamma: false };

  const b = input.measured.brightness;
  const c = input.measured.contrast;
  const temB = typeof b === 'number' && Number.isFinite(b);
  const temC = typeof c === 'number' && Number.isFinite(c);

  if (!temB && !temC) {
    // B3.3 — ausência de leitura não é leitura ruim. Agir aqui seria mexer na
    // câmera do paciente a partir de nada.
    reasons.push('brilho e contraste não medidos — nenhum degrau acionado');
    return { layer: 'ok', software: nada, advice: null, reasons };
  }

  const brilhoRuim = temB && (b < ILLUMINATION_BAND.brightness.min || b > ILLUMINATION_BAND.brightness.max);
  const contrasteRuim = temC && c < ILLUMINATION_BAND.contrast.min;
  if (!temB) reasons.push('brilho não medido — eixo ignorado');
  if (!temC) reasons.push('contraste não medido — eixo ignorado');

  if (!brilhoRuim && !contrasteRuim) {
    reasons.push('iluminação dentro da faixa aceitável');
    return { layer: 'ok', software: nada, advice: null, reasons };
  }

  // Degrau 1 — sensor. Enquanto a câmera puder agir, é dela a vez.
  if (input.sensorPodeAgir) {
    reasons.push('sensor ainda tem margem — corrigindo antes da quantização, que é o único lugar onde se ganha informação');
    return { layer: 'sensor', software: nada, advice: input.conselhoFisico, reasons };
  }

  // O limite honesto do software.
  if (input.fracaoSaturada > SATURATION_LIMIT) {
    reasons.push(
      `${(input.fracaoSaturada * 100).toFixed(0)}% dos pixels saturados: a informação foi perdida na ` +
      'captura e nenhuma redistribuição a traz de volta. CLAHE aqui produziria histograma saudável ' +
      'sobre uma íris que continua sem borda.',
    );
    return {
      layer: 'advise',
      software: nada,
      advice: input.conselhoFisico
        ?? 'A imagem está saturada. Reduza a luz direta sobre o rosto ou atrás do paciente, e evite janela no fundo.',
      reasons,
    };
  }

  // Degrau 2 — software.
  if (input.softwareDisponivel) {
    reasons.push('sensor esgotado; aplicando correção por software (paliativa: redistribui, não recupera)');
    return {
      layer: 'software',
      software: { clahe: contrasteRuim, gamma: brilhoRuim },
      // O conselho continua junto: o software é paliativo e o cuidador ainda
      // pode resolver na origem.
      advice: input.conselhoFisico,
      reasons,
    };
  }

  // Degrau 3 — aviso.
  reasons.push('sensor esgotado e correção por software desligada');
  if (input.sensorNoLimite) reasons.push('cameraTuner reportou limite de hardware');
  return {
    layer: 'advise',
    software: nada,
    advice: input.conselhoFisico
      ?? 'Ilumine o rosto de FRENTE, com luminária difusa atrás do monitor, e evite luz forte no fundo.',
    reasons,
  };
}
