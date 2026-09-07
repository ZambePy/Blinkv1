import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { podeRolarVerticalmente, alvoDeRolagem, rolarSobOOlhar } from './rolarSobOOlhar';

// -----------------------------------------------------------------------------
// Qual elemento rola quando o olhar está na borda.
//
// O ancestral rolável mais próximo manda. Sem isso, olhar na borda de baixo
// dentro de uma lista rolaria a PÁGINA em vez da lista, e o conteúdo que a
// pessoa está lendo sairia da tela — o oposto do que ela pediu.
// -----------------------------------------------------------------------------

/** Contêiner com transbordo de verdade. jsdom não faz layout, então as
 *  dimensões vão à mão. */
function contêinerRolável(overflowY: string, transbordo = 500): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { value: 1000 + transbordo, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 1000, configurable: true });
  el.style.overflowY = overflowY;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  // jsdom não implementa `elementFromPoint` — não dá nem para espioná-lo sem
  // ele existir. O `spyOn` de cada teste substitui este stub.
  if (!document.elementFromPoint) {
    (document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      null;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('podeRolarVerticalmente', () => {
  it('aceita overflow auto com transbordo', () => {
    expect(podeRolarVerticalmente(contêinerRolável('auto'))).toBe(true);
  });

  it('aceita overflow scroll', () => {
    expect(podeRolarVerticalmente(contêinerRolável('scroll'))).toBe(true);
  });

  it('recusa overflow visible, mesmo com transbordo', () => {
    expect(podeRolarVerticalmente(contêinerRolável('visible'))).toBe(false);
  });

  it('recusa overflow hidden — transborda, mas não é para rolar', () => {
    expect(podeRolarVerticalmente(contêinerRolável('hidden'))).toBe(false);
  });

  it('recusa quando não há para onde rolar', () => {
    expect(podeRolarVerticalmente(contêinerRolável('auto', 0))).toBe(false);
  });

  it('tolera 1 px de diferença — subpixel de tela com escala', () => {
    // Sem a folga, metade dos contêineres pareceria rolável sem ter para onde.
    expect(podeRolarVerticalmente(contêinerRolável('auto', 1))).toBe(false);
  });
});

describe('alvoDeRolagem', () => {
  it('acha o ancestral rolável mais próximo, e não a página', () => {
    const lista = contêinerRolável('auto');
    const item = document.createElement('span');
    lista.appendChild(item);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(item);

    expect(alvoDeRolagem(10, 10)).toBe(lista);
  });

  it('devolve null quando nada no caminho rola', () => {
    const caixa = contêinerRolável('visible');
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(caixa);

    // `null` significa "quem rola é a janela".
    expect(alvoDeRolagem(10, 10)).toBeNull();
  });

  it('devolve null quando não há elemento sob o ponto', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);
    expect(alvoDeRolagem(10, 10)).toBeNull();
  });
});

describe('rolarSobOOlhar', () => {
  it('desloca proporcional ao tempo, não por passo fixo', () => {
    // Velocidade em px/s tem de valer igual a 30 fps e a 15 fps. Um passo fixo
    // por quadro faria a rolagem depender da webcam.
    const lista = contêinerRolável('auto');
    lista.scrollTop = 0;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(lista);

    rolarSobOOlhar(10, 10, 600, 100); // 600 px/s por 100 ms = 60 px
    expect(lista.scrollTop).toBeCloseTo(60, 5);
  });

  it('velocidade negativa sobe', () => {
    const lista = contêinerRolável('auto');
    lista.scrollTop = 200;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(lista);

    rolarSobOOlhar(10, 10, -600, 100);
    expect(lista.scrollTop).toBeCloseTo(140, 5);
  });

  it('cai para a janela quando nada rola no caminho', () => {
    const caixa = contêinerRolável('visible');
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(caixa);
    const scrollBy = vi.fn();
    window.scrollBy = scrollBy as typeof window.scrollBy;

    rolarSobOOlhar(10, 10, 600, 100);

    expect(scrollBy).toHaveBeenCalledWith({ top: 60, behavior: 'auto' });
  });

  it('um delta absurdo é limitado', () => {
    // Aba em segundo plano ou engasgo do detector produzem deltas de segundos.
    // Sem o teto, um quadro rolaria a página inteira.
    const lista = contêinerRolável('auto');
    lista.scrollTop = 0;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(lista);

    rolarSobOOlhar(10, 10, 600, 30_000);

    expect(lista.scrollTop).toBeLessThanOrEqual(60);
  });

  it('velocidade zero não toca em nada', () => {
    const lista = contêinerRolável('auto');
    lista.scrollTop = 42;
    const spy = vi.spyOn(document, 'elementFromPoint');

    rolarSobOOlhar(10, 10, 0, 100);

    expect(lista.scrollTop).toBe(42);
    // Nem procura o alvo: a 30 Hz, um `elementFromPoint` por quadro sem nada
    // para fazer é custo puro.
    expect(spy).not.toHaveBeenCalled();
  });
});
