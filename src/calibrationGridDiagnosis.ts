/**
 * Diagnóstico da GRADE de calibração a partir do erro leave-one-target-out.
 *
 * ── O problema que isto detecta ────────────────────────────────────────────
 *
 * `computeCalibrationTargets` posiciona os alvos a partir de `viewingDistanceCm`,
 * que é um valor CONFIGURADO pelo cuidador, não medido. Quando ele não bate com
 * a realidade, a grade pede ângulos de olhar fora da faixa utilizável, e a
 * calibração sai ruim sem que nada diga por quê.
 *
 * Duas sessões reais, mesma grade 3×3, LOO médio por linha:
 *
 *                          topo    meio   baixo   |  LOO global
 *   gravação de referência   73,5    58,3   110,5  |      80,7
 *   sessão "Ruim"           196,7    80,9   397,1  |     224,9
 *
 * Na sessão ruim o usuário estava a 0,64× da distância da gravação (medido pelo
 * `iodFraction`: 0,155 contra 0,099). A grade tinha sido montada assumindo
 * 60 cm, e a essa distância real os cantos exigem 26–37° de excentricidade —
 * contra um orçamento de 16° e um joelho de hipometria medido em 12,43°.
 *
 * Repare no formato: o CENTRO continua bom nas duas (58 e 81 px). Não é o
 * pipeline que quebrou, é a periferia da grade que saiu do alcance. É isso que
 * a razão periferia/centro captura, e é por isso que ela funciona sem saber a
 * distância — uma razão é adimensional.
 *
 * ── Por que não basta olhar o erro médio ───────────────────────────────────
 *
 * O erro médio de calibração diz QUE está ruim, não POR QUÊ. Um alvo que o
 * modelo não consegue aprender não é só um ponto ruim no relatório: ele está
 * DENTRO do treino dos outros oito, empurrando o ajuste. Distinguir "a periferia
 * saiu do alcance" de "a sessão inteira está ruim" muda o conselho ao usuário
 * de "tente de novo" para "afaste-se da tela".
 */

export interface AlvoLOO {
  x: number;
  y: number;
  errorPx: number;
  samples: number;
}

export type VeredictoGrade = 'ok' | 'periferia_fora_de_alcance' | 'sessao_ruim' | 'indeterminado';

export interface DiagnosticoGrade {
  veredicto: VeredictoGrade;
  /** Erro LOO mediano dos alvos centrais (os mais próximos do centro da tela). */
  centroPx: number;
  /** Erro LOO mediano dos alvos periféricos. */
  periferiaPx: number;
  /** periferia / centro. Adimensional, então não depende de distância nem de
   *  tela — é o que torna o diagnóstico transferível entre setups. */
  razao: number;
  /** Mensagem pronta para o operador, ou `null` quando está tudo bem. */
  mensagem: string | null;
}

/**
 * Acima disto a periferia é considerada fora de alcance.
 *
 * Calibrado contra as duas sessões: a gravação boa dá razão 1,7 e a sessão ruim
 * dá 4,3. 2,5 separa as duas com folga dos dois lados — não é um número que eu
 * possa justificar por teoria, e sim o ponto médio geométrico entre uma medição
 * boa e uma ruim. Com mais sessões ele deve ser revisto.
 */
export const RAZAO_PERIFERIA_LIMITE = 2.5;

/** Acima disto a sessão inteira está ruim, periferia ou não. O centro é a parte
 *  mais fácil da tela; se ele já erra tanto, o problema não é a grade. */
export const CENTRO_RUIM_PX = 150;

/** Mediana simples. Mediana e não média porque um único alvo catastrófico
 *  (615 px na sessão ruim) arrastaria a média e mascararia o padrão. */
function mediana(v: number[]): number {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Classifica os alvos em centro e periferia pela distância ao centro da tela,
 * em coordenadas normalizadas.
 *
 * Divisão pela MEDIANA das distâncias, e não por um limiar fixo: a grade muda
 * de extensão com a geometria configurada (o orçamento de excentricidade a
 * encolhe ou alarga), então qualquer fração fixa erraria em telas diferentes.
 */
export function diagnosticarGrade(alvos: readonly AlvoLOO[]): DiagnosticoGrade {
  const validos = alvos.filter((a) => Number.isFinite(a.errorPx) && a.samples > 0);
  if (validos.length < 4) {
    return {
      veredicto: 'indeterminado',
      centroPx: NaN, periferiaPx: NaN, razao: NaN,
      mensagem: null,
    };
  }

  const raio = (a: AlvoLOO) => Math.hypot(a.x - 0.5, a.y - 0.5);
  const corte = mediana(validos.map(raio));
  const centro = validos.filter((a) => raio(a) <= corte).map((a) => a.errorPx);
  const periferia = validos.filter((a) => raio(a) > corte).map((a) => a.errorPx);
  if (centro.length === 0 || periferia.length === 0) {
    return { veredicto: 'indeterminado', centroPx: NaN, periferiaPx: NaN, razao: NaN, mensagem: null };
  }

  const centroPx = mediana(centro);
  const periferiaPx = mediana(periferia);
  const razao = centroPx > 0 ? periferiaPx / centroPx : Infinity;

  if (centroPx > CENTRO_RUIM_PX) {
    return {
      veredicto: 'sessao_ruim', centroPx, periferiaPx, razao,
      mensagem:
        `O erro está alto até no centro da tela (${centroPx.toFixed(0)} px), que é a parte mais fácil. ` +
        `Isso não é a grade estar larga demais — é a sessão inteira. ` +
        `Verifique iluminação, óculos e se o rosto está bem enquadrado antes de recalibrar.`,
    };
  }

  if (razao > RAZAO_PERIFERIA_LIMITE) {
    return {
      veredicto: 'periferia_fora_de_alcance', centroPx, periferiaPx, razao,
      mensagem:
        `O centro da tela está bom (${centroPx.toFixed(0)} px) mas a periferia erra ` +
        `${razao.toFixed(1)}× mais (${periferiaPx.toFixed(0)} px). O padrão é de alvos ` +
        `pedindo mais rotação de olho do que dá para medir. ` +
        `AFASTE-SE DA TELA e recalibre: a mesma tela mais longe exige ângulos menores. ` +
        `Se a distância configurada não bate com a real, a grade é montada larga demais.`,
    };
  }

  return { veredicto: 'ok', centroPx, periferiaPx, razao, mensagem: null };
}
