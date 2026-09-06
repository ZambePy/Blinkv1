// Geometria física da tela lida do sistema operacional.
//
// POR QUE EXISTE
//
// A diagonal da tela entra em duas contas que NÃO são cosméticas:
//   1. `meanErrorDeg` do relatório de precisão. Com 15,6" configurado numa tela
//      de 23,6", o erro angular saía 34% MENOR que o real.
//   2. A posição dos alvos de calibração, que sai de um orçamento de
//      excentricidade angular e portanto depende do tamanho físico.
//
// Nenhuma API de browser expõe tamanho físico — só pixels. Mas o EDID do
// monitor carrega as dimensões em centímetros, e o Windows expõe isso via WMI
// (`WmiMonitorBasicDisplayParams`). Pedir ao cuidador que digite a diagonal
// funciona até ele trocar de monitor e esquecer de atualizar; ler do sistema
// não tem esse modo de falha.
//
// Este arquivo é só a parte pura: converter o que o SO devolve em diagonal.
// A ponte com o Electron fica em `electron/main.ts` + `preload.ts`.

// O comando WMI mora aqui, e não inline em `electron/main.ts`, para ser
// testável: o CI roda `windows-latest` mas não abre o Electron, então o que dá
// para verificar deterministicamente é a string gerada.

/**
 * Namespace WMI que expõe os parâmetros do painel.
 *
 * Escrito com barra DUPLA de propósito — em literal JavaScript, `'\w'` vira
 * `'w'` e o namespace colapsa para `rootwmi`.
 */
export const WMI_NAMESPACE = 'root\\wmi';

/**
 * Comando PowerShell que devolve as dimensões físicas dos monitores.
 *
 * `MaxHorizontalImageSize` e `MaxVerticalImageSize` vêm do EDID em
 * CENTÍMETROS — o consumidor monta `{widthCm, heightCm}` assumindo isso.
 */
export function buildMonitorSizeQuery(): string {
  return (
    `Get-CimInstance -Namespace ${WMI_NAMESPACE} -ClassName WmiMonitorBasicDisplayParams | ` +
    'Select-Object MaxHorizontalImageSize,MaxVerticalImageSize | ConvertTo-Json -Compress'
  );
}

/** Dimensões da área ativa do painel, em centímetros, vindas do EDID. */
export interface PhysicalPanelSize {
  widthCm: number;
  heightCm: number;
}

export interface DisplayGeometry {
  diagonalIn: number;
  widthCm: number;
  heightCm: number;
  /** Proporção largura/altura — serve de sanidade contra EDID corrompido. */
  aspectRatio: number;
}

/**
 * Converte dimensões físicas em diagonal em polegadas.
 *
 * Devolve `null` para entradas implausíveis em vez de propagar um número
 * errado: uma diagonal inventada é PIOR que nenhuma, porque alimenta
 * silenciosamente o erro angular e a grade de calibração. Vários monitores
 * relatam EDID zerado ou truncado, e projetores costumam relatar lixo.
 */
export function computeDisplayGeometry(size: PhysicalPanelSize | null | undefined): DisplayGeometry | null {
  if (!size) return null;
  const { widthCm, heightCm } = size;
  if (!Number.isFinite(widthCm) || !Number.isFinite(heightCm)) return null;
  // EDID em centímetros com resolução de 1 cm: abaixo de 10 cm de largura não
  // existe monitor de uso, é campo zerado ou truncado.
  if (widthCm < 10 || heightCm < 6) return null;
  // Acima de 200 cm de largura é televisor/projetor — fora do caso de uso, e
  // provavelmente lixo de EDID.
  if (widthCm > 200 || heightCm > 200) return null;

  const aspectRatio = widthCm / heightCm;
  // Formatos reais vão de 4:3 (1,33) a 21:9 (2,37). Fora disso o EDID mente.
  if (aspectRatio < 1.1 || aspectRatio > 2.6) return null;

  const diagonalCm = Math.hypot(widthCm, heightCm);
  const diagonalIn = diagonalCm / 2.54;
  if (!(diagonalIn > 5) || !(diagonalIn < 100)) return null;

  return { diagonalIn, widthCm, heightCm, aspectRatio };
}

/**
 * Escolhe qual monitor usar quando o sistema relata vários.
 *
 * Heurística: o maior. Num posto com notebook + monitor externo, o paciente
 * está olhando para o grande; e errar para o maior é o erro menos ruim, porque
 * subestimar a diagonal faz o orçamento de excentricidade colocar alvos mais
 * para fora do que o olho alcança.
 */
export function pickPrimaryPanel(sizes: readonly PhysicalPanelSize[]): PhysicalPanelSize | null {
  let best: PhysicalPanelSize | null = null;
  let bestDiag = 0;
  for (const s of sizes) {
    const g = computeDisplayGeometry(s);
    if (!g) continue;
    if (g.diagonalIn > bestDiag) { bestDiag = g.diagonalIn; best = s; }
  }
  return best;
}

/**
 * Escolhe, entre os painéis relatados pelo EDID, o que corresponde ao display
 * em que o app está rodando.
 *
 * POR QUE NÃO BASTA "O MAIOR": num posto com notebook + monitor externo, o
 * maior é um chute razoável mas continua chute. A proporção resolve: se o
 * display ativo é 16:9 e há um painel 16:9 e outro 16:10 na lista, a escolha
 * deixa de ser arbitrária.
 *
 * O `scaleFactor` do Windows NÃO entra na conversão px→cm: o app mede erro em
 * px CSS e a tela física cobre um número fixo de px CSS, então a escala se
 * cancela. Ele serve só para desambiguar qual monitor é qual e para registrar
 * a configuração no relatório.
 */
export function pickPanelForDisplay(
  sizes: readonly PhysicalPanelSize[],
  displayAspectRatio: number | null | undefined,
): { panel: PhysicalPanelSize | null; ambiguous: boolean } {
  const valid = sizes.filter((s) => computeDisplayGeometry(s) !== null);
  if (valid.length === 0) return { panel: null, ambiguous: false };
  if (valid.length === 1) return { panel: valid[0], ambiguous: false };

  if (displayAspectRatio && displayAspectRatio > 0) {
    const scored = valid
      .map((s) => ({ s, err: Math.abs(s.widthCm / s.heightCm - displayAspectRatio) }))
      .sort((a, b) => a.err - b.err);
    // Empate na proporção (dois monitores 16:9) → não dá para desambiguar por
    // aí; cai no maior e avisa que a escolha é um chute.
    const empatado = scored.length > 1 && Math.abs(scored[0].err - scored[1].err) < 0.02;
    if (!empatado) return { panel: scored[0].s, ambiguous: false };
  }
  return { panel: pickPrimaryPanel(valid), ambiguous: true };
}
