import type { CalibrationFitDiagnostics } from '@tracker/calibration';

/**
 * Traduz o diagnóstico de ajuste da calibração para linguagem de cuidador.
 *
 * ## Quem decide
 *
 * O **veredito da grade** (`gridDiagnosis`), que já é do core e já é testado.
 * Ele distingue "a periferia saiu do alcance" de "a sessão inteira está ruim" —
 * exatamente a distinção que o cuidador precisa. Um segundo classificador aqui
 * divergiria dele no primeiro ajuste de limiar, e a tela diria "bom" sobre uma
 * calibração que o core reprova.
 *
 * O LOO **rebaixa** de bom para aceitável; não reprova sozinho. A deriva
 * postural escolhe o **motivo**; também não reprova sozinha.
 *
 * ## De onde vêm os números
 *
 * Das seis sessões reais em `docs/medicoes/historico/`:
 *
 *     LOO:    68 (melhor) · 170 (mediana) · 252 (pior)
 *     deriva: 1,7° a 3,5°
 *
 * A sessão com deriva de 3,47° foi classificada pelo core como
 * `periferia_fora_de_alcance`, e não como sessão ruim. Um limiar de deriva que
 * reprovasse por conta própria contradiria o core em dado medido — daí ela só
 * escolher o motivo.
 *
 * ⚠️ Seis sessões, um setup só. Os limiares vão precisar de revisão quando
 * houver dados de outras máquinas; estão em constantes nomeadas para isso.
 */

/** Até aqui o ajuste é bom. A melhor sessão medida deu 68 px. */
export const LOO_BOM_PX = 110;

/** Acima disto a cabeça migrou entre alvos o bastante para virar o motivo. */
export const DERIVA_ALTA_GRAUS = 3;

export type VeredictoDaCalibracao = 'bom' | 'aceitavel' | 'refazer';

export interface LeituraDaCalibracao {
  veredicto: VeredictoDaCalibracao;
  /** Sufixo da chave i18n do motivo. `null` quando não há o que explicar. */
  motivo: string | null;
  looErrorPx: number | null;
  /** Maior deriva entre os eixos, em graus. */
  derivaGraus: number | null;
}

export function lerCalibracao(
  diag: CalibrationFitDiagnostics | null
): LeituraDaCalibracao {
  // Sem diagnóstico não há o que julgar. `aceitavel` e não `refazer`: reprovar
  // por ausência de medição faria o paciente repetir a calibração inteira sem
  // que nada estivesse errado.
  if (!diag) {
    return { veredicto: 'aceitavel', motivo: null, looErrorPx: null, derivaGraus: null };
  }

  const d = diag.poseDrift;
  const derivaGraus = d
    ? Math.max(Math.abs(d.yawDeg), Math.abs(d.pitchDeg), Math.abs(d.rollDeg))
    : null;

  const looErrorPx = Number.isFinite(diag.looErrorPx) ? diag.looErrorPx : null;
  const grade = diag.gridDiagnosis?.veredicto;

  let veredicto: VeredictoDaCalibracao;
  let motivo: string | null = null;

  if (grade === 'sessao_ruim') {
    veredicto = 'refazer';
    motivo = 'sessaoRuim';
  } else if (grade === 'alvo_inaprendivel') {
    // O core registra por quê: um único alvo inaprendível não move muito a
    // média, mas está DENTRO do treino dos outros e corrompe o ajuste todo.
    veredicto = 'refazer';
    motivo = 'alvoInaprendivel';
  } else if (grade === 'periferia_fora_de_alcance') {
    // Problema específico e parcial — o centro da tela continua utilizável.
    veredicto = 'aceitavel';
    motivo = 'periferia';
  } else if (looErrorPx !== null && looErrorPx > LOO_BOM_PX) {
    // Rebaixa, não reprova: LOO alto com grade ok pode ser distância ou luz, e
    // refazer a calibração não corrige nenhuma das duas.
    veredicto = 'aceitavel';
    motivo = 'erroAlto';
  } else {
    veredicto = 'bom';
  }

  // A deriva postural VENCE o motivo quando é alta e o veredito não é bom:
  // "você se mexeu entre os alvos" é acionável, e recalibrar sem corrigir a
  // posição repete o resultado.
  if (veredicto !== 'bom' && derivaGraus !== null && derivaGraus > DERIVA_ALTA_GRAUS) {
    motivo = 'derivaPostural';
  }

  return { veredicto, motivo, looErrorPx, derivaGraus };
}
