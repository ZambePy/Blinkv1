import { describe, it, expect } from 'vitest';
import { lerCalibracao, LOO_BOM_PX, DERIVA_ALTA_GRAUS } from './veredito';
import type { CalibrationFitDiagnostics } from '@tracker/calibration';

// -----------------------------------------------------------------------------
// Tradução do diagnóstico de ajuste para linguagem de cuidador.
//
// Quem decide o veredito é o `gridDiagnosis` do core, que já distingue
// "a periferia saiu do alcance" de "a sessão inteira está ruim" e já é testado.
// Um segundo classificador aqui divergiria dele no primeiro ajuste de limiar, e
// a tela diria "bom" sobre uma calibração que o core reprova.
//
// LOO e deriva postural escolhem o MOTIVO, não o veredito.
//
// Os números vêm das seis sessões reais em `docs/medicoes/historico/`:
//
//   LOO:    68 (melhor) · 170 (mediana) · 252 (pior)
//   deriva: 1,7° a 3,5°
//
// A sessão com deriva de 3,47° foi classificada pelo core como
// `periferia_fora_de_alcance`, e não como sessão ruim. Um limiar de deriva que
// reprovasse por conta própria contradiria o core em dado medido.
// -----------------------------------------------------------------------------

type Grade = CalibrationFitDiagnostics['gridDiagnosis'];

const grade = (veredicto: string, over: Partial<Grade> = {}): Grade =>
  ({
    veredicto,
    centroPx: 100,
    periferiaPx: 110,
    razao: 1.1,
    piorAlvoPx: 150,
    mensagem: null,
    ...over,
  }) as Grade;

const diag = (over: Partial<CalibrationFitDiagnostics> = {}): CalibrationFitDiagnostics =>
  ({
    trainErrorPx: 50,
    looErrorPx: 70,
    looByTarget: [],
    poseMean: null,
    poseStd: null,
    poseDrift: { targets: 8, yawDeg: 1.0, pitchDeg: 1.0, rollDeg: 1.0 },
    gridDiagnosis: grade('ok'),
    ...over,
  }) as CalibrationFitDiagnostics;

describe('quem decide é o veredito da grade', () => {
  it('sessão ruim manda refazer', () => {
    expect(lerCalibracao(diag({ gridDiagnosis: grade('sessao_ruim') })).veredicto).toBe('refazer');
  });

  it('alvo inaprendível manda refazer', () => {
    // O comentário do core: um único alvo inaprendível não move muito a média,
    // mas está DENTRO do treino dos outros e corrompe o ajuste todo.
    expect(lerCalibracao(diag({ gridDiagnosis: grade('alvo_inaprendivel') })).veredicto).toBe(
      'refazer'
    );
  });

  it('periferia fora de alcance é aceitável, não reprovação', () => {
    // É um problema específico e parcial: o centro da tela continua utilizável.
    expect(
      lerCalibracao(diag({ gridDiagnosis: grade('periferia_fora_de_alcance') })).veredicto
    ).toBe('aceitavel');
  });

  it('grade ok com LOO baixo é bom', () => {
    expect(lerCalibracao(diag({ looErrorPx: 68 })).veredicto).toBe('bom');
  });
});

describe('o LOO rebaixa, mas não reprova sozinho', () => {
  it('grade ok com LOO alto vira aceitável', () => {
    // Dizer "bom" sobre um LOO de 170 px — a mediana das sessões reais —
    // ensinaria o cuidador a confiar num número que não merece.
    expect(lerCalibracao(diag({ looErrorPx: 170 })).veredicto).toBe('aceitavel');
  });

  it('LOO alto NÃO manda refazer por conta própria', () => {
    // Quem reprova é a grade. LOO alto com grade ok pode ser distância ou luz,
    // e refazer a calibração não corrige nenhuma das duas.
    expect(lerCalibracao(diag({ looErrorPx: 250 })).veredicto).not.toBe('refazer');
  });

  it('exatamente no limiar ainda é bom', () => {
    expect(lerCalibracao(diag({ looErrorPx: LOO_BOM_PX })).veredicto).toBe('bom');
  });
});

describe('a deriva postural escolhe o motivo', () => {
  it('deriva alta vira o motivo quando o veredito não é bom', () => {
    // "Você se mexeu entre os alvos" é acionável; recalibrar sem corrigir a
    // posição repete o resultado.
    const r = lerCalibracao(
      diag({
        gridDiagnosis: grade('sessao_ruim'),
        poseDrift: { targets: 8, yawDeg: 4.2, pitchDeg: 1.0, rollDeg: 1.0 },
      })
    );
    expect(r.motivo).toMatch(/deriva|movimento|posicao|posição/i);
  });

  it('deriva alta sozinha NÃO reprova', () => {
    // A sessão real com 3,47° de deriva foi classificada como
    // `periferia_fora_de_alcance` pelo core, não como ruim.
    const r = lerCalibracao(
      diag({ poseDrift: { targets: 8, yawDeg: DERIVA_ALTA_GRAUS + 0.5, pitchDeg: 1, rollDeg: 1 } })
    );
    expect(r.veredicto).not.toBe('refazer');
  });

  it('reporta a maior deriva entre os eixos', () => {
    const r = lerCalibracao(
      diag({ poseDrift: { targets: 8, yawDeg: 1.2, pitchDeg: 3.9, rollDeg: 0.8 } })
    );
    expect(r.derivaGraus).toBeCloseTo(3.9, 5);
  });
});

describe('sem diagnóstico', () => {
  it('não manda refazer', () => {
    // Reprovar por ausência de medição faria o paciente repetir a calibração
    // inteira sem que nada estivesse errado.
    expect(lerCalibracao(null).veredicto).not.toBe('refazer');
  });

  it('não inventa motivo nem número', () => {
    const r = lerCalibracao(null);
    expect(r.motivo).toBeNull();
    expect(r.derivaGraus).toBeNull();
  });
});

describe('o que a tela precisa mostrar', () => {
  it('o LOO sempre acompanha o veredito', () => {
    expect(lerCalibracao(diag({ looErrorPx: 123 })).looErrorPx).toBe(123);
  });

  it('grade ok e LOO baixo não têm motivo a explicar', () => {
    expect(lerCalibracao(diag({ looErrorPx: 68 })).motivo).toBeNull();
  });
});
