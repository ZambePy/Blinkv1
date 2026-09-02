import { describe, it, expect } from 'vitest';
import { diagnosticarGrade, RAZAO_PERIFERIA_LIMITE, CENTRO_RUIM_PX, PIOR_ALVO_PX } from './calibrationGridDiagnosis';

// Os dois casos que importam são medições reais, não sintéticos. Os limiares
// foram escolhidos para separar estes dois; se um terceiro caso real aparecer e
// não couber, é o limiar que muda, não o teste.

/** Sessão que produziu 134,8 px de erro — LOO por alvo medido. */
const GRAVACAO_BOA = [
  { x: 0.168, y: 0.05, errorPx: 82.6, samples: 63 },
  { x: 0.500, y: 0.05, errorPx: 67.5, samples: 58 },
  { x: 0.832, y: 0.05, errorPx: 70.4, samples: 63 },
  { x: 0.168, y: 0.50, errorPx: 62.4, samples: 53 },
  { x: 0.500, y: 0.50, errorPx: 56.5, samples: 37 },
  { x: 0.832, y: 0.50, errorPx: 55.9, samples: 53 },
  { x: 0.168, y: 0.95, errorPx: 143.2, samples: 65 },
  { x: 0.500, y: 0.95, errorPx: 87.7, samples: 58 },
  { x: 0.832, y: 0.95, errorPx: 100.5, samples: 64 },
];

/** Sessão ao vivo classificada "Ruim": 125 px no interior, 333 px na borda.
 *  O usuário estava a 0,64× da distância da gravação. */
const SESSAO_RUIM = [
  { x: 0.171, y: 0.05, errorPx: 334.6, samples: 65 },
  { x: 0.500, y: 0.05, errorPx: 128.8, samples: 60 },
  { x: 0.829, y: 0.05, errorPx: 126.7, samples: 65 },
  { x: 0.171, y: 0.50, errorPx: 105.9, samples: 54 },
  { x: 0.500, y: 0.50, errorPx: 32.6, samples: 39 },
  { x: 0.829, y: 0.50, errorPx: 104.1, samples: 53 },
  { x: 0.171, y: 0.95, errorPx: 419.5, samples: 65 },
  { x: 0.500, y: 0.95, errorPx: 157.2, samples: 60 },
  { x: 0.829, y: 0.95, errorPx: 614.8, samples: 64 },
];

describe('diagnosticarGrade — validado contra as duas sessões reais', () => {
  it('a gravação boa passa sem alarme', () => {
    const d = diagnosticarGrade(GRAVACAO_BOA);
    expect(d.veredicto).toBe('ok');
    expect(d.mensagem).toBeNull();
    expect(d.razao).toBeLessThan(RAZAO_PERIFERIA_LIMITE);
  });

  it('a sessão ruim é acusada, e pelo motivo certo', () => {
    const d = diagnosticarGrade(SESSAO_RUIM);
    expect(d.veredicto).toBe('periferia_fora_de_alcance');
    expect(d.razao).toBeGreaterThan(RAZAO_PERIFERIA_LIMITE);
    // O conselho tem que ser acionável, não "tente de novo".
    expect(d.mensagem).toContain('AFASTE-SE');
  });

  it('as duas ficam de lados opostos com folga — o limiar não está no fio', () => {
    const boa = diagnosticarGrade(GRAVACAO_BOA).razao;
    const ruim = diagnosticarGrade(SESSAO_RUIM).razao;
    expect(boa).toBeLessThan(RAZAO_PERIFERIA_LIMITE / 1.3);
    expect(ruim).toBeGreaterThan(RAZAO_PERIFERIA_LIMITE * 1.3);
  });

  it('o centro da sessão ruim está BOM — é isso que distingue os dois casos', () => {
    // 32,6 px no centro contra 615 px num canto. Não é o pipeline que quebrou.
    const d = diagnosticarGrade(SESSAO_RUIM);
    expect(d.centroPx).toBeLessThan(CENTRO_RUIM_PX);
  });
});

describe('diagnosticarGrade — os outros casos', () => {
  const uniforme = (erro: number) => [
    { x: 0.17, y: 0.05, errorPx: erro, samples: 60 }, { x: 0.5, y: 0.05, errorPx: erro, samples: 60 },
    { x: 0.83, y: 0.05, errorPx: erro, samples: 60 }, { x: 0.17, y: 0.5, errorPx: erro, samples: 60 },
    { x: 0.5, y: 0.5, errorPx: erro, samples: 60 }, { x: 0.83, y: 0.5, errorPx: erro, samples: 60 },
    { x: 0.17, y: 0.95, errorPx: erro, samples: 60 }, { x: 0.5, y: 0.95, errorPx: erro, samples: 60 },
    { x: 0.83, y: 0.95, errorPx: erro, samples: 60 },
  ];

  it('erro alto e UNIFORME é sessão ruim, não grade larga', () => {
    // Distinção que muda o conselho: aqui afastar-se não resolve nada.
    const d = diagnosticarGrade(uniforme(300));
    expect(d.veredicto).toBe('sessao_ruim');
    expect(d.mensagem).toContain('iluminação');
  });

  it('erro baixo e uniforme passa', () => {
    expect(diagnosticarGrade(uniforme(50)).veredicto).toBe('ok');
  });

  it('poucos alvos não geram veredito inventado', () => {
    expect(diagnosticarGrade(GRAVACAO_BOA.slice(0, 3)).veredicto).toBe('indeterminado');
    expect(diagnosticarGrade([]).veredicto).toBe('indeterminado');
  });

  it('alvos com LOO não-finito são ignorados, não contaminam', () => {
    const comNaN = [...GRAVACAO_BOA, { x: 0.5, y: 0.5, errorPx: NaN, samples: 0 }];
    expect(diagnosticarGrade(comNaN).veredicto).toBe('ok');
  });

  it('o corte centro/periferia acompanha a grade, não é fração fixa', () => {
    // Grade estreita: os mesmos nove alvos comprimidos perto do centro. A
    // classificação tem que continuar separando interior de periferia.
    const estreita = GRAVACAO_BOA.map((a) => ({
      ...a, x: 0.5 + (a.x - 0.5) * 0.3, y: 0.5 + (a.y - 0.5) * 0.3,
    }));
    expect(diagnosticarGrade(estreita).veredicto).toBe('ok');
    const estreitaRuim = SESSAO_RUIM.map((a) => ({
      ...a, x: 0.5 + (a.x - 0.5) * 0.3, y: 0.5 + (a.y - 0.5) * 0.3,
    }));
    expect(diagnosticarGrade(estreitaRuim).veredicto).toBe('periferia_fora_de_alcance');
  });
});

/** Terceira sessao real: razao 2,43 -- ABAIXO do limiar de 2,5 -- e mesmo assim
 *  ruim, com LOO global 186,6 e um alvo em 564 px. Foi ela que mostrou que a
 *  razao periferia/centro sozinha nao basta: a media da periferia diluiu o
 *  alvo catastrofico entre os vizinhos bons. */
const SESSAO_C = [
  { x: 0.182, y: 0.05, errorPx: 564.4, samples: 65 },
  { x: 0.500, y: 0.05, errorPx: 220.0, samples: 29 },
  { x: 0.818, y: 0.05, errorPx: 155.5, samples: 64 },
  { x: 0.182, y: 0.50, errorPx: 86.6, samples: 53 },
  { x: 0.500, y: 0.50, errorPx: 66.5, samples: 38 },
  { x: 0.818, y: 0.50, errorPx: 68.5, samples: 53 },
  { x: 0.182, y: 0.95, errorPx: 197.8, samples: 65 },
  { x: 0.500, y: 0.95, errorPx: 96.7, samples: 52 },
  { x: 0.818, y: 0.95, errorPx: 223.3, samples: 60 },
];

describe('a terceira sessao, que a razao sozinha deixou passar', () => {
  it('a razao dela fica ABAIXO do limiar — por isso o criterio do pior alvo existe', () => {
    const d = diagnosticarGrade(SESSAO_C);
    expect(d.razao).toBeLessThan(RAZAO_PERIFERIA_LIMITE);
    expect(d.piorAlvoPx).toBeGreaterThan(PIOR_ALVO_PX);
  });

  it('e agora ela e acusada, pelo alvo inaprendivel', () => {
    const d = diagnosticarGrade(SESSAO_C);
    expect(d.veredicto).toBe('alvo_inaprendivel');
    expect(d.mensagem).toContain('RECALIBRE');
  });

  it('a gravacao boa continua passando — o criterio novo nao gera falso positivo', () => {
    const d = diagnosticarGrade(GRAVACAO_BOA);
    expect(d.piorAlvoPx).toBeLessThan(PIOR_ALVO_PX);
    expect(d.veredicto).toBe('ok');
  });

  it('as tres sessoes separam com folga no pior alvo', () => {
    // 143 px na boa contra 564 e 615 nas ruins. O limiar de 300 fica no meio.
    expect(diagnosticarGrade(GRAVACAO_BOA).piorAlvoPx).toBeLessThan(PIOR_ALVO_PX / 1.8);
    expect(diagnosticarGrade(SESSAO_RUIM).piorAlvoPx).toBeGreaterThan(PIOR_ALVO_PX * 1.8);
    expect(diagnosticarGrade(SESSAO_C).piorAlvoPx).toBeGreaterThan(PIOR_ALVO_PX * 1.8);
  });
});
