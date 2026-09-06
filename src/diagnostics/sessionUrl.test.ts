import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Reimplementação mínima do localStorage para o ambiente de teste.
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const store = new MemStore();
vi.stubGlobal('localStorage', store);
vi.stubGlobal('window', { location: { search: '', hash: '' } });

const { aplicarSessaoDaUrl } =
  await import('../../frontend/src/sessionFromUrl');

const exp = () => JSON.parse(store.getItem('irisflow.experiment') ?? '{}');
const sett = () => JSON.parse(store.getItem('irisflow_settings') ?? '{}');

beforeEach(() => store.clear());
afterEach(() => vi.restoreAllMocks());

describe('configuração de sessão pela URL', () => {
  it('aplica provider, tamanho do L2CS e filtro', () => {
    expect(aplicarSessaoDaUrl('?ep=webgpu&l2cs=224&filtro=kalmanEma')).toBe(true);
    expect(exp().l2cs).toBe('webgpu');
    expect(exp().l2csInputSize).toBe(224);
    expect(exp().filterMode).toBe('kalmanEma');
  });

  it('a diagonal entra como `manual` — quem escreveu a URL AFIRMOU o valor', () => {
    // Mesma procedência de digitar no campo, e distinta do default, que
    // significa "ninguém verificou".
    expect(aplicarSessaoDaUrl('?diagonal=23.6')).toBe(true);
    expect(sett().screenDiagonalIn).toBe(23.6);
    expect(sett().screenGeometrySource).toBe('manual');
  });

  it('NÃO pede reload quando nada mudou — senão a página entra em laço', () => {
    aplicarSessaoDaUrl('?ep=webgpu&diagonal=23.6');
    expect(aplicarSessaoDaUrl('?ep=webgpu&diagonal=23.6')).toBe(false);
  });

  it('valor inválido é IGNORADO, não aplicado pela metade', () => {
    // Uma condição meio aplicada é pior que nenhuma: o relatório registraria a
    // condição pedida e o pipeline rodaria outra.
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    aplicarSessaoDaUrl('?ep=cuda&l2cs=300&filtro=kalmanBayes&diagonal=abc');
    expect(exp().l2cs).toBeUndefined();
    expect(exp().l2csInputSize).toBeUndefined();
    expect(exp().filterMode).toBeUndefined();
    expect(sett().screenDiagonalIn).toBeUndefined();
    expect(avisos).toHaveBeenCalledTimes(4);
  });

  it('preserva o que já estava gravado', () => {
    store.setItem('irisflow.experiment', JSON.stringify({ expandFactor: 1.7 }));
    aplicarSessaoDaUrl('?ep=webgpu');
    expect(exp().expandFactor).toBe(1.7);
    expect(exp().l2cs).toBe('webgpu');
  });

  it('localStorage ilegível não derruba o boot', () => {
    // Sem app, o operador não tem como consertar a configuração que quebrou o app.
    store.setItem('irisflow.experiment', '{{{ não é json');
    expect(() => aplicarSessaoDaUrl('?ep=webgpu')).not.toThrow();
    expect(exp().l2cs).toBe('webgpu');
  });

  it('lê também do HASH — o app usa HashRouter', () => {
    // Quem digita a URL põe a query antes do `#`; o react-router só enxerga
    // depois dele. As duas formas valem.
    expect(aplicarSessaoDaUrl('', '#/?ep=webgpu&diagonal=23.6')).toBe(true);
    expect(exp().l2cs).toBe('webgpu');
    expect(sett().screenDiagonalIn).toBe(23.6);
  });

  it('`null` em hash ou busca nao derruba o boot', () => {
    // `undefined` NAO serve para testar isto: passar `undefined` explicitamente
    // aciona o valor default do parametro, entao o teste passaria sem exercitar
    // a guarda. Foi o que a primeira versao deste teste fazia — verde e vazia.
    //
    // `null` atravessa o default e chega ao corpo da funcao, que e o caminho
    // real de um host que entrega uma URL incompleta.
    expect(() => aplicarSessaoDaUrl('?ep=webgpu', null as unknown as string))
      .not.toThrow();
    expect(exp().l2cs).toBe('webgpu');
    expect(() => aplicarSessaoDaUrl(null as unknown as string, '#/?ep=wasm'))
      .not.toThrow();
    expect(exp().l2cs).toBe('wasm');
  });

  it('URL sem parâmetros não mexe em nada', () => {
    expect(aplicarSessaoDaUrl('')).toBe(false);
    expect(store.getItem('irisflow.experiment')).toBeNull();
  });
});
