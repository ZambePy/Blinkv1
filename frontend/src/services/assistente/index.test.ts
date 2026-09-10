import { beforeEach, describe, expect, it } from 'vitest';
import { LICENSE_KEY } from '../../context/LicenseContext';
import {
  apagarModelo,
  assistenteEstaAtivo,
  CHAVE_DESLIGADO,
  definirAssistenteDesligado,
  registrarFalaDoPaciente,
  resumoDoModelo,
  sugerirFrases,
  sugerirPalavras,
  ultimaPerguntaDoCuidador,
} from './index';
import { CHAVE_DO_MODELO, reiniciarParaTeste } from './armazenamento';
import { getPredictions } from '../../utils/wordPredictor';

const licenca = (features: Record<string, boolean> | undefined) =>
  JSON.stringify({ plan: features ? { features } : {} });

beforeEach(() => {
  localStorage.clear();
  reiniciarParaTeste();
});

describe('licença e chave de desligar', () => {
  it('sem licença gravada, o assistente funciona', () => {
    expect(assistenteEstaAtivo()).toBe(true);
  });

  it('licença sem o campo features não bloqueia (cache antigo)', () => {
    localStorage.setItem(LICENSE_KEY, licenca(undefined));
    expect(assistenteEstaAtivo()).toBe(true);
  });

  it('plano sem assistente bloqueia as sugestões', () => {
    localStorage.setItem(LICENSE_KEY, licenca({ assistente: false }));
    expect(assistenteEstaAtivo()).toBe(false);
    expect(sugerirPalavras('qu')).toEqual([]);
    expect(sugerirFrases({ mensagemDoCuidador: 'Quer água?' })).toEqual([]);
  });

  it('desligar pelo usuário some com as sugestões mas não apaga o aprendizado', () => {
    registrarFalaDoPaciente('quero mudar de posição');
    definirAssistenteDesligado(true);
    expect(localStorage.getItem(CHAVE_DESLIGADO)).toBe('1');
    expect(assistenteEstaAtivo()).toBe(false);
    expect(sugerirPalavras('quero ')).toEqual([]);
    // O modelo continua lá: religar não devolve um assistente amnésico.
    expect(resumoDoModelo().frases).toBe(1);

    definirAssistenteDesligado(false);
    expect(sugerirFrases({ textoAtual: 'quero mudar' })[0]?.texto).toBe('quero mudar de posição');
  });
});

describe('aprendizado e persistência', () => {
  it('aprende a resposta ligada à pergunta do cuidador', () => {
    registrarFalaDoPaciente('Só um gole', 'Quer água?');
    const s = sugerirFrases({ mensagemDoCuidador: 'quer agua', maximo: 3 });
    expect(s[0]).toEqual({ texto: 'Só um gole', origem: 'aprendida' });
  });

  it('grava no localStorage e relê depois de reiniciar', async () => {
    registrarFalaDoPaciente('estou com dor nas costas');
    // A gravação é adiada de propósito; forçamos o descarregamento.
    const { descarregar } = await import('./armazenamento');
    descarregar();
    expect(localStorage.getItem(CHAVE_DO_MODELO)).toContain('costas');

    reiniciarParaTeste();
    expect(resumoDoModelo().frases).toBe(1);
  });

  it('apagar limpa o modelo e o resíduo do preditor antigo', () => {
    localStorage.setItem('irisflow_user_words', '[]');
    registrarFalaDoPaciente('quero água');
    apagarModelo();
    expect(resumoDoModelo()).toEqual({ palavras: 0, frases: 0, perguntas: 0, kb: expect.any(Number) });
    expect(localStorage.getItem('irisflow_user_words')).toBeNull();
    expect(localStorage.getItem(CHAVE_DO_MODELO)).toBeNull();
  });

  it('migra o vocabulário do preditor antigo uma única vez', () => {
    localStorage.setItem('irisflow_user_words', JSON.stringify([{ word: 'gabriel', count: 7 }]));
    localStorage.setItem('irisflow_user_bigrams', JSON.stringify([{ w1: 'chamar', w2: 'gabriel', count: 4 }]));
    reiniciarParaTeste();
    expect(getPredictions('chamar ')).toContain('gabriel');
    expect(resumoDoModelo().palavras).toBe(1);
  });
});

describe('pergunta no ar', () => {
  it('é a última do cuidador quando o paciente ainda não respondeu', () => {
    expect(
      ultimaPerguntaDoCuidador([
        { sender: 'paciente', text: 'oi' },
        { sender: 'cuidador', text: 'Quer água?' },
      ]),
    ).toBe('Quer água?');
  });

  it('some depois que o paciente responde', () => {
    expect(
      ultimaPerguntaDoCuidador([
        { sender: 'cuidador', text: 'Quer água?' },
        { sender: 'paciente', text: 'Sim' },
      ]),
    ).toBeUndefined();
  });

  it('conversa vazia não tem pergunta', () => {
    expect(ultimaPerguntaDoCuidador([])).toBeUndefined();
  });
});
