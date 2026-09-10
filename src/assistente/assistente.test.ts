import { describe, it, expect } from 'vitest';
import {
  aprenderFrase,
  aprenderResposta,
  ehPergunta,
  LIMITES,
  modeloVazio,
  normalizar,
  podar,
  regraPara,
  sanearModelo,
  sugerirFrases,
  sugerirPalavras,
  tamanhoDoModelo,
  assistenteAtivo,
} from './index';

const DIA = 24 * 3600_000;

describe('normalização', () => {
  it('tira acento, caixa e pontuação', () => {
    expect(normalizar('Você quer ÁGUA?')).toBe('voce quer agua');
    expect(normalizar('  Não,   obrigado! ')).toBe('nao obrigado');
  });

  it('não confunde texto vazio com espaço', () => {
    expect(normalizar('   ')).toBe('');
  });
});

describe('modelo', () => {
  it('aprende palavras, bigramas e a frase inteira de uma vez', () => {
    const m = aprenderFrase(modeloVazio(), 'estou com dor de cabeça', 1000);
    expect(m.palavras['estou']).toBe(1);
    expect(m.bigramas['estou']?.['com']).toBe(1);
    expect(m.frases['estou com dor de cabeca'].texto).toBe('estou com dor de cabeça');
    expect(m.frases['estou com dor de cabeca'].n).toBe(1);
  });

  it('conta repetição da mesma frase escrita de formas diferentes', () => {
    let m = aprenderFrase(modeloVazio(), 'quero agua', 1000);
    m = aprenderFrase(m, 'Quero água!', 2000);
    expect(m.frases['quero agua'].n).toBe(2);
    // A grafia mais recente é a que volta para a tela.
    expect(m.frases['quero agua'].texto).toBe('Quero água!');
    expect(m.frases['quero agua'].em).toBe(2000);
  });

  it('ignora palavra de uma letra só', () => {
    const m = aprenderFrase(modeloVazio(), 'a b c', 0);
    expect(Object.keys(m.palavras)).toHaveLength(0);
  });

  it('sanear devolve modelo vazio para lixo e preserva o que é válido', () => {
    expect(tamanhoDoModelo(sanearModelo(null)).palavras).toBe(0);
    expect(tamanhoDoModelo(sanearModelo({ versao: 99 })).palavras).toBe(0);
    const bom = aprenderFrase(modeloVazio(), 'quero água', 5);
    const ida = JSON.parse(JSON.stringify(bom));
    expect(sanearModelo(ida).frases['quero agua'].texto).toBe('quero água');
  });

  it('podar respeita os limites e prefere o recente ao antigo', () => {
    let m = modeloVazio();
    // Uma frase muito usada, porém de um ano atrás.
    for (let i = 0; i < 20; i++) m = aprenderFrase(m, 'frase antiga muito repetida', 0);
    // E uma dita só duas vezes, ontem.
    const agora = 365 * DIA;
    m = aprenderFrase(m, 'frase de ontem', agora - DIA);
    m = aprenderFrase(m, 'frase de ontem', agora - DIA);

    for (let i = 0; i < LIMITES.frases + 50; i++) m = aprenderFrase(m, `enchimento numero ${i}`, agora - 200 * DIA);
    podar(m, agora);

    expect(Object.keys(m.frases).length).toBeLessThanOrEqual(LIMITES.frases);
    expect(m.frases['frase de ontem']).toBeDefined();
    expect(m.frases['frase antiga muito repetida']).toBeUndefined();
  });
});

describe('predição de palavra', () => {
  it('completa prefixo pelo dicionário, ignorando acento', () => {
    const p = sugerirPalavras({ texto: 'agu', modelo: modeloVazio() });
    expect(p).toContain('água');
  });

  it('não devolve a própria palavra já digitada', () => {
    const p = sugerirPalavras({ texto: 'água', modelo: modeloVazio() });
    expect(p).not.toContain('água');
  });

  it('usa bigrama do dicionário para a próxima palavra', () => {
    const p = sugerirPalavras({ texto: 'quero ', modelo: modeloVazio() });
    expect(p).toContain('comer');
    expect(p).not.toContain('quero');
  });

  it('o que o paciente escreve ganha do dicionário', () => {
    let m = modeloVazio();
    for (let i = 0; i < 5; i++) m = aprenderFrase(m, 'chamar gabriel', i);
    const p = sugerirPalavras({ texto: 'chamar ', modelo: m, maximo: 1 });
    expect(p[0]).toBe('gabriel');
  });

  it('contexto ganha de frequência', () => {
    let m = modeloVazio();
    // "obrigado" é a palavra mais usada do paciente…
    for (let i = 0; i < 30; i++) m = aprenderFrase(m, 'obrigado', i);
    // …mas depois de "com" o que vem é "dor".
    const p = sugerirPalavras({ texto: 'estou com ', modelo: m, maximo: 1 });
    expect(p[0]).toBe('dor');
  });

  it('sempre devolve o número pedido de sugestões, mesmo sem contexto', () => {
    expect(sugerirPalavras({ texto: '', modelo: modeloVazio(), maximo: 4 })).toHaveLength(4);
    expect(sugerirPalavras({ texto: 'xyzabc', modelo: modeloVazio(), maximo: 4 })).toHaveLength(4);
  });
});

describe('sugestão de frase', () => {
  it('reconhece pergunta com e sem interrogação', () => {
    expect(ehPergunta('Você quer água?')).toBe(true);
    expect(ehPergunta('quer água')).toBe(true);
    expect(ehPergunta('Estou aqui do seu lado')).toBe(false);
  });

  it('escolhe a regra pela forma da pergunta', () => {
    expect(regraPara('Está com dor?')?.nome).toBe('dor');
    expect(regraPara('Quer que eu chame a enfermeira?')?.nome).toBe('chamar-alguem');
    expect(regraPara('Bom dia!')?.nome).toBe('saudacao');
    expect(regraPara('O almoço chegou')).toBeNull();
  });

  it('responde a uma pergunta de oferta com sim/não úteis', () => {
    const s = sugerirFrases({ mensagemDoCuidador: 'Quer água?', modelo: modeloVazio() });
    expect(s.map((x) => x.texto)).toContain('Sim, por favor');
    expect(s.map((x) => x.texto)).toContain('Não, obrigado');
    expect(s[0].origem).toBe('regra');
  });

  it('o que o paciente já respondeu vem antes da regra', () => {
    let m = modeloVazio();
    m = aprenderResposta(m, 'Quer água?', 'Só um gole', 1000);
    m = aprenderResposta(m, 'quer agua', 'Só um gole', 2000);
    const s = sugerirFrases({ mensagemDoCuidador: 'Quer água?', modelo: m, agoraMs: 3000 });
    expect(s[0]).toEqual({ texto: 'Só um gole', origem: 'aprendida' });
  });

  it('completa a frase que o paciente começou em vez de responder a pergunta', () => {
    let m = modeloVazio();
    m = aprenderFrase(m, 'quero mudar de posição', 1000);
    const s = sugerirFrases({
      mensagemDoCuidador: 'Quer água?',
      textoAtual: 'quero mudar',
      modelo: m,
      agoraMs: 2000,
    });
    expect(s[0]).toEqual({ texto: 'quero mudar de posição', origem: 'completar' });
  });

  it('texto só de pontuação não engole as respostas à pergunta', () => {
    // "?" normaliza para string vazia; prefixo vazio casaria com TODAS as
    // frases do histórico e as respostas prontas nunca apareceriam.
    let m = modeloVazio();
    m = aprenderFrase(m, 'quero mudar de posição', 1000);
    m = aprenderFrase(m, 'estou com sede', 1000);
    const s = sugerirFrases({ mensagemDoCuidador: 'Quer água?', textoAtual: '?', modelo: m, agoraMs: 2000 });
    expect(s.map((x) => x.texto)).toContain('Sim, por favor');
    expect(s.some((x) => x.origem === 'completar')).toBe(false);
  });

  it('sem histórico e sem pergunta, oferece as frases de partida', () => {
    const s = sugerirFrases({ modelo: modeloVazio(), maximo: 3 });
    expect(s).toHaveLength(3);
    expect(s.every((x) => x.origem === 'frequente')).toBe(true);
  });

  it('nunca repete a mesma frase, mesmo vinda de fontes diferentes', () => {
    let m = modeloVazio();
    m = aprenderResposta(m, 'Quer água?', 'Sim, por favor', 1000);
    const s = sugerirFrases({ mensagemDoCuidador: 'Quer água?', modelo: m, maximo: 4, agoraMs: 2000 });
    const chaves = s.map((x) => normalizar(x.texto));
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

describe('estado do assistente', () => {
  it('só fica ativo liberado, ligado e em modo local', () => {
    expect(assistenteAtivo({ liberado: true, modo: 'local', desligadoPeloUsuario: false })).toBe(true);
    expect(assistenteAtivo({ liberado: false, modo: 'local', desligadoPeloUsuario: false })).toBe(false);
    expect(assistenteAtivo({ liberado: true, modo: 'local', desligadoPeloUsuario: true })).toBe(false);
    expect(assistenteAtivo({ liberado: true, modo: 'nuvem', desligadoPeloUsuario: false })).toBe(false);
  });
});
