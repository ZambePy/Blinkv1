import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18n from '../../i18n';
import { ChecagemRapida } from './ChecagemRapida';
import { MS_LIMITE_DE_ENQUADRAMENTO } from './tempos';
import { CHAVE_DA_REFERENCIA, lerReferencia } from '../../services/local/referenciaDaChecagem';
import { FOV_DE_REFERENCIA_DEG, iodFractionParaDistancia } from '@tracker/setupReadiness';

// -----------------------------------------------------------------------------
// A checagem de retomada NÃO é um teste de precisão, e a tela precisa continuar
// dizendo isso. Três alvos em nove segundos não separam 2,5° de 3,2° — mas um
// número em graus na tela seria lido como medição, e depois ninguém o
// distinguiria de uma medição de verdade no acompanhamento clínico.
//
// A outra promessa é a saída: PULAR está disponível em qualquer fase. Um
// paciente que precisa falar agora não pode ser detido por quinze segundos de
// verificação — e é justamente quem tem mais pressa que tem menos como
// reclamar da espera.
// -----------------------------------------------------------------------------

const CALIB_TS = 1_700_000_000_000;

vi.mock('@tracker/calibration', () => ({
  getCalibrationTimestampMs: () => CALIB_TS,
}));

const navegou = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navegou,
}));

vi.mock('../../context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      cameraHorizontalFovDeg: FOV_DE_REFERENCIA_DEG,
      screenDiagonalIn: 23.6,
      viewingDistanceCm: 60,
    },
  }),
}));

// O engine é substituído por um controle manual: a posição é ditada pelo teste
// e as amostras são empurradas quando ele quiser.
let posicionado = true;
let emitir: (s: { x: number; y: number; hasFace: boolean }) => void = () => {};

const VIDEO = { width: 1920, height: 1080 };

const diagnosticos = () => ({
  framing: {
    hasFace: posicionado,
    iod: 0.11,
    iodPx: iodFractionParaDistancia(60, FOV_DE_REFERENCIA_DEG) * VIDEO.width,
    faceCenter: { x: 0.5, y: 0.5 },
    specularRatio: 0,
    specularStability: 1,
  },
  video: VIDEO,
  pose: { yaw: 0, pitch: 0, roll: 0 },
  quality: { brightness: 120, contrast: 55, detectorConfidence: 0.95 },
});

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({
    getDiagnostics: () => diagnosticos(),
    subscribe: (cb: (s: { x: number; y: number; hasFace: boolean }) => void) => {
      emitir = cb;
      return () => {
        emitir = () => {};
      };
    },
  }),
}));

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  localStorage.clear();
  navegou.mockClear();
  posicionado = true;
  vi.useFakeTimers();
  // O erro angular é calculado a partir da geometria da tela; sem tamanho, a
  // conversão para graus não teria sentido.
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

const pular = () => screen.getByRole('button', { name: /pular/i });

/** Deixa a vigia de posição rodar uma volta. */
const umaVoltaDaVigia = () =>
  act(() => {
    vi.advanceTimersByTime(300);
  });

/** Onde cada alvo cai na tela — as mesmas frações que a tela desenha. */
const ALVOS_PX = [
  { x: 0.5, y: 0.5 },
  { x: 0.15, y: 0.15 },
  { x: 0.85, y: 0.85 },
].map((a) => ({ x: a.x * 1600, y: a.y * 900 }));

/**
 * Roda a checagem inteira, com o olhar `desvioPx` fora de CADA alvo.
 *
 * O desvio acompanha o alvo de propósito. Amostras num ponto fixo mediriam a
 * excentricidade dos cantos, não o erro de leitura — e um erro de 17° sairia de
 * um olhar perfeito.
 */
function checagemCompleta(desvioPx = 0) {
  render(<ChecagemRapida />);
  umaVoltaDaVigia();

  for (const alvo of ALVOS_PX) {
    act(() => {
      vi.advanceTimersByTime(800); // passa da acomodação
    });
    act(() => {
      for (let i = 0; i < 20; i++) emitir({ x: alvo.x + desvioPx, y: alvo.y, hasFace: true });
    });
    act(() => {
      vi.advanceTimersByTime(2000); // fecha o alvo
    });
  }
}

describe('pular está sempre disponível', () => {
  it('na fase de enquadramento', () => {
    posicionado = false;
    render(<ChecagemRapida />);
    expect(pular()).toBeTruthy();
  });

  it('durante os alvos', () => {
    render(<ChecagemRapida />);
    umaVoltaDaVigia();

    expect(screen.getByText(/ponto 1 de 3/i)).toBeTruthy();
    expect(pular()).toBeTruthy();
  });

  it('no veredito', () => {
    checagemCompleta();
    expect(pular()).toBeTruthy();
  });

  it('pular vai direto para o menu, sem exigir nada', () => {
    posicionado = false;
    render(<ChecagemRapida />);
    fireEvent.click(pular());

    expect(navegou).toHaveBeenCalledWith('/menu', { replace: true });
  });
});

describe('a tela não se apresenta como medição de precisão', () => {
  it('não mostra número em graus', () => {
    // O defeito de verdade não é a palavra: é o número. "2,8°" numa tela de
    // conferência vira dado clínico na cabeça de quem lê.
    checagemCompleta(300);

    expect(screen.queryByText(/\d+[.,]?\d*\s*°/)).toBeNull();
  });

  it('a única menção a precisão é para negá-la', () => {
    checagemCompleta();
    const texto = document.body.textContent ?? '';

    for (const trecho of texto.split(/(?<=\.)\s+/)) {
      if (/precis[ãa]o/i.test(trecho)) expect(trecho).toMatch(/N[ÃA]O mede/i);
    }
  });

  it('a ressalva do que a tela é fica visível desde o começo', () => {
    posicionado = false;
    render(<ChecagemRapida />);

    expect(screen.getByText(/N[ÃA]O mede a precisão/i)).toBeTruthy();
  });
});

describe('os três vereditos', () => {
  it('recalibrar: o rosto nunca entrou no enquadramento', () => {
    posicionado = false;
    render(<ChecagemRapida />);

    act(() => {
      vi.advanceTimersByTime(MS_LIMITE_DE_ENQUADRAMENTO + 100);
    });

    expect(screen.getByText(/calibrar de novo\./i)).toBeTruthy();
    expect(screen.getByText(/não ficou no enquadramento/i)).toBeTruthy();
  });

  it('seguir: com referência folgada, a leitura de hoje passa', () => {
    localStorage.setItem(
      CHAVE_DA_REFERENCIA,
      JSON.stringify({ calibTs: CALIB_TS, erroDeg: 30, em: new Date().toISOString() })
    );

    checagemCompleta(20);

    expect(screen.getByText(/tudo como antes/i)).toBeTruthy();
  });

  it('atenção: a leitura ficou muito pior que a referência', () => {
    // Referência mínima: qualquer erro real fica acima do fator de alerta.
    localStorage.setItem(
      CHAVE_DA_REFERENCIA,
      JSON.stringify({ calibTs: CALIB_TS, erroDeg: 0.01, em: new Date().toISOString() })
    );

    checagemCompleta(400);

    // Texto exato: a ressalva do rodapé também contém "algo mudou desde a
    // calibração", e um regex casaria com ela em vez do veredito.
    expect(screen.getByText('Algo mudou.')).toBeTruthy();
  });

  it('sair de posição no meio dos alvos reprova, mesmo voltando depois', () => {
    // As amostras já coletadas mediram a posição, não a calibração. Voltar ao
    // lugar no último segundo não as conserta.
    render(<ChecagemRapida />);
    umaVoltaDaVigia();

    // Um instante fora do lugar, no meio do primeiro alvo.
    posicionado = false;
    umaVoltaDaVigia();
    posicionado = true;

    // E daqui em diante um olhar impecável, colado nos alvos.
    for (const alvo of ALVOS_PX) {
      act(() => {
        vi.advanceTimersByTime(800);
      });
      act(() => {
        for (let i = 0; i < 20; i++) emitir({ x: alvo.x, y: alvo.y, hasFace: true });
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
    }

    expect(screen.getByText(/calibrar de novo\./i)).toBeTruthy();
  });
});

describe('a referência', () => {
  it('a primeira checagem estabelece a referência e nunca reprova', () => {
    checagemCompleta(400);

    expect(screen.getByText(/tudo como antes/i)).toBeTruthy();
    expect(screen.getByText(/primeira conferência desta calibração/i)).toBeTruthy();
    expect(lerReferencia(CALIB_TS)).not.toBeNull();
  });

  it('uma checagem posterior NÃO sobrescreve a referência', () => {
    // Sobrescrever mascararia a deriva justamente quando ela apareceu: cada dia
    // viraria a nova base e a comparação nunca acusaria nada.
    localStorage.setItem(
      CHAVE_DA_REFERENCIA,
      JSON.stringify({ calibTs: CALIB_TS, erroDeg: 2.5, em: new Date(0).toISOString() })
    );

    checagemCompleta(400);

    expect(lerReferencia(CALIB_TS)?.erroDeg).toBe(2.5);
  });
});

describe('os dois caminhos ficam abertos no veredito', () => {
  it('nem o pior veredito obriga a calibrar', () => {
    posicionado = false;
    render(<ChecagemRapida />);
    act(() => {
      vi.advanceTimersByTime(MS_LIMITE_DE_ENQUADRAMENTO + 100);
    });

    expect(screen.getByRole('button', { name: /usar assim/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /calibrar de novo/i })).toBeTruthy();
  });
});

describe('a checagem não é instrumento de medição', () => {
  it('não usa startAccuracyTest — ele grava o relatório canônico', () => {
    // Rodando a cada abertura, `startAccuracyTest` escreveria um relatório por
    // dia e incrementaria `blocoDeMedicao`, corrompendo a contagem de blocos
    // que o acompanhamento clínico usa. A MATEMÁTICA é reaproveitada
    // (`erroAngularDeg`); o instrumento, não.
    // Os comentários saem antes: o cabeçalho do arquivo cita
    // `startAccuracyTest` justamente para explicar por que NÃO o usa, e casar
    // com a explicação em vez do código seria o inverso do teste.
    const fonte = readFileSync(join(__dirname, 'ChecagemRapida.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(fonte).not.toMatch(/startAccuracyTest/);
    expect(fonte).toMatch(/erroAngularDeg/);
  });

  it('não escreve no histórico clínico', () => {
    checagemCompleta(300);

    expect(localStorage.getItem('irisflow_clinical_data')).toBeNull();
  });
});
