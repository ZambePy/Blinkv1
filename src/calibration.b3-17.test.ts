import { describe, it, expect } from 'vitest';
import {
  CALIBRATION_ACCLIMATION_MS,
  duracaoTotalDoPonto,
  janelaUtilDoPonto,
  medianaDeDistancias,
} from './calibration';
import { getCollectionMsForPoint } from './calibration';

// -----------------------------------------------------------------------------
// B3.17 — A janela de acomodação é SUBTRAÍDA da coleta, não somada.
//
//   if (elapsed < 400) return;                       // descarta acomodação
//   ...
//   if (elapsed >= currentCollectionMs) { parar(); }  // para no TOTAL
//
// A janela útil é portanto `currentCollectionMs − 400`, não `+400` como o log
// e o comentário de budget afirmam:
//
//   log:      "aguardando ${currentCollectionMs}ms + 400ms acomodação"
//   budget:   "9 pontos ~ 1680..2800ms + 400ms acomodação = 18.7..28.8s"
//
// Com `COLLECTION_MS_BASE = 1680`, a coleta útil real é 1280 ms em vez de
// 1680 — **~24% menos amostras que o documentado**. E o comentário de
// `MIN_ACCEPTED_SAMPLES` foi calibrado contra a suposição errada.
//
// B3.18 — A "mediana das distâncias dos quadros aceitos" é UM quadro
//         replicado N vezes.
//
// `getCurrentCameraDistanceCm()` é chamado uma única vez no fim do ponto e lê
// o ÚLTIMO frame visto — possivelmente um que o gate de qualidade rejeitou, ou
// um 800 ms posterior se o ponto terminou por hard timeout. Esse único valor é
// então replicado, e o bloco de comentário afirma corrigir "ruído de quadro
// único (σ≈0,13 cm)" — corrigindo com o próprio quadro único.
//
// B3.19 — Contadores de diagnóstico incrementam ANTES do `return` por
//         `MIN_ACCEPTED_SAMPLES`.
//
// Um alvo que precise de 3 tentativas contribui **3×** para
// `varianceFloorBreaches` e `specularWarningsIssued` — as métricas que o
// cuidador usa para comparar perfis. O perfil de um paciente inquieto parece
// pior do que é, e a comparação entre perfis fica enviesada pelo número de
// retentativas em vez da qualidade do dado.
// -----------------------------------------------------------------------------

describe('B3.17 — a acomodação é SOMADA ao tempo do ponto', () => {
  it('a janela útil é exatamente o tempo de coleta pedido', () => {
    // O contrato que o log promete: `currentCollectionMs` de coleta ÚTIL.
    for (const coleta of [1680, 2000, 2800]) {
      expect(janelaUtilDoPonto(coleta)).toBe(coleta);
    }
  });

  it('a duração total é coleta + acomodação', () => {
    for (const coleta of [1680, 2000, 2800]) {
      expect(duracaoTotalDoPonto(coleta)).toBe(coleta + CALIBRATION_ACCLIMATION_MS);
    }
  });

  it('a janela útil NÃO é mais coleta − acomodação (o bug)', () => {
    // 1680 − 400 = 1280, que é o que a implementação antiga entregava.
    expect(janelaUtilDoPonto(1680)).not.toBe(1680 - CALIBRATION_ACCLIMATION_MS);
  });

  it('a acomodação é uma constante nomeada, não um literal solto', () => {
    // O 400 aparecia como número mágico no meio do laço de coleta, e o
    // comentário de budget usava outro 400 escrito à mão — dois lugares que
    // podiam divergir sem nada acusar.
    expect(CALIBRATION_ACCLIMATION_MS).toBeGreaterThan(0);
    expect(CALIBRATION_ACCLIMATION_MS).toBeLessThan(1000);
  });

  it('o budget de sessão continua dentro do teto de fadiga', () => {
    // O comentário do módulo avisa: acima de ~40 s a fadiga do usuário-alvo
    // (ELA) piora as fixações finais e anula o ganho. Somar a acomodação
    // acrescenta 9 × 400 ms = 3,6 s — este teste garante que a conta ainda
    // fecha, em vez de a correção estourar o orçamento em silêncio.
    const pontos = [
      [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
      [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
      [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
    ] as const;
    const totalMs = pontos.reduce(
      (s, [x, y]) => s + duracaoTotalDoPonto(getCollectionMsForPoint(x, y)),
      0,
    );
    expect(totalMs / 1000).toBeLessThan(40);
  });
});

describe('B3.18 — a mediana de distância vem de VÁRIOS quadros', () => {
  it('a mediana de uma lista é a mediana, não o último valor', () => {
    expect(medianaDeDistancias([50, 51, 52, 53, 54])).toBeCloseTo(52, 6);
  });

  it('um outlier no fim não domina o resultado', () => {
    // O cenário do bug: o último frame visto podia ser um rejeitado pelo gate,
    // ou um 800 ms posterior vindo do hard timeout. Com a mediana de verdade,
    // ele não decide sozinho.
    const comOutlier = medianaDeDistancias([50, 50, 51, 51, 200]);
    expect(comOutlier).toBeLessThan(60);
  });

  it('lista com número par de elementos interpola', () => {
    expect(medianaDeDistancias([50, 52])).toBeCloseTo(51, 6);
  });

  it('lista vazia devolve null — não há mediana de nada', () => {
    // Fabricar um número aqui contaminaria `calibrationRefDistance`, que
    // governa a compensação de distância.
    expect(medianaDeDistancias([])).toBeNull();
  });

  it('valores não-finitos são descartados', () => {
    expect(medianaDeDistancias([50, NaN, 52, Infinity, 51])).toBeCloseTo(51, 6);
  });

  it('só valores não-finitos devolve null', () => {
    expect(medianaDeDistancias([NaN, Infinity])).toBeNull();
  });

  it('um único quadro ainda devolve esse valor — mas é UM quadro', () => {
    // Não é erro ter só um; o erro era chamar um de "mediana de N".
    expect(medianaDeDistancias([57.3])).toBeCloseTo(57.3, 6);
  });
});
