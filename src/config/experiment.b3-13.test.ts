import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  sanitizeExperiment,
  EXPERIMENT_RANGES,
  L2CS_INPUT_SIZES_ACEITOS,
} from './experiment';

// -----------------------------------------------------------------------------
// B3.13 — `{...DEFAULTS, ...JSON.parse(raw)}` com cast de tipo e ZERO validação.
//
//   return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ExperimentConfig>), ... };
//
// O `as Partial<ExperimentConfig>` é uma afirmação, não uma verificação: o que
// estiver no localStorage entra intacto.
//
// Dois exemplos concretos, ambos alcançáveis pelo console que o próprio módulo
// documenta (`__irisflowExp.set(...)`):
//
//   `{"l2csCadenceMs": 0}`  → o throttle some. Crop 448², `getImageData` e
//                             `postMessage` A CADA FRAME. Com o backpressure
//                             de B1.2 o vazamento não volta, mas ~5 ms/frame
//                             de crop são queimados para nada.
//
//   `{"expandFactor": "x"}` → `Number("x")` é `NaN`. O crop sai degenerado e o
//                             `console.warn` dispara UMA VEZ POR FRAME, para
//                             sempre.
//
// E `set()` persiste o resultado de `load()`, que já inclui os `envOverrides`.
// Uma variável de ambiente usada uma vez numa sessão de teste fica GRAVADA no
// localStorage e continua valendo depois — sem nada indicando de onde veio.
// -----------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B3.13 — sanitize rejeita tipo errado', () => {
  it('string onde deveria ser número cai no default', () => {
    const r = sanitizeExperiment({ expandFactor: 'x' as unknown as number });
    expect(r.expandFactor).toBe(1.4);
  });

  it('NaN cai no default', () => {
    const r = sanitizeExperiment({ expandFactor: NaN });
    expect(r.expandFactor).toBe(1.4);
  });

  it('Infinity cai no default', () => {
    const r = sanitizeExperiment({ l2csCadenceMs: Infinity });
    expect(r.l2csCadenceMs).toBe(100);
  });

  it('número onde deveria ser booleano cai no default', () => {
    const r = sanitizeExperiment({ enableL2CS: 1 as unknown as boolean });
    expect(r.enableL2CS).toBe(true);
  });

  it('null cai no default', () => {
    const r = sanitizeExperiment({ polynomialFeatures: null as unknown as boolean });
    expect(r.polynomialFeatures).toBe(true);
  });

  it('chave desconhecida é descartada', () => {
    const r = sanitizeExperiment({ naoExiste: 42 } as unknown as Record<string, never>);
    expect((r as unknown as Record<string, unknown>).naoExiste).toBeUndefined();
  });

  it('entrada não-objeto devolve os defaults', () => {
    for (const lixo of [null, undefined, 'texto', 42, []]) {
      const r = sanitizeExperiment(lixo as never);
      expect(r.expandFactor).toBe(1.4);
      expect(r.l2csCadenceMs).toBe(100);
    }
  });
});

describe('B3.13 — sanitize aplica faixa por chave', () => {
  it('l2csCadenceMs = 0 é rejeitado — desliga o throttle', () => {
    // O caso mais caro: sem throttle, o crop 448² + `getImageData` roda a cada
    // frame. ~5 ms/frame queimados produzindo tensores que o worker descarta.
    const r = sanitizeExperiment({ l2csCadenceMs: 0 });
    expect(r.l2csCadenceMs).toBeGreaterThanOrEqual(EXPERIMENT_RANGES.l2csCadenceMs.min);
  });

  it('l2csCadenceMs negativo é rejeitado', () => {
    const r = sanitizeExperiment({ l2csCadenceMs: -50 });
    expect(r.l2csCadenceMs).toBeGreaterThanOrEqual(EXPERIMENT_RANGES.l2csCadenceMs.min);
  });

  it('expandFactor absurdo é rejeitado', () => {
    // `expandFactor` multiplica a bbox facial antes do resize. Valores
    // extremos produzem um crop que é quase só fundo, ou quase só nariz.
    expect(sanitizeExperiment({ expandFactor: 0.01 }).expandFactor).toBe(1.4);
    expect(sanitizeExperiment({ expandFactor: 50 }).expandFactor).toBe(1.4);
  });

  it('valores DENTRO da faixa passam', () => {
    const r = sanitizeExperiment({ expandFactor: 1.6, l2csCadenceMs: 200 });
    expect(r.expandFactor).toBe(1.6);
    expect(r.l2csCadenceMs).toBe(200);
  });

  it('toda chave numérica tem faixa declarada', () => {
    // Defesa contra alguém adicionar uma flag numérica nova e esquecer a
    // faixa — que é como este bug nasceu.
    //
    // Uma faixa NÃO é a única forma válida de restringir. `l2csInputSize` usa
    // lista fechada porque faixa é fraca demais para ele: `{min:224,max:448}`
    // aceitava 244, que não é múltiplo de 32 e faz a ResNet-50 padear
    // assimetricamente — rodando sem erro e medindo outra coisa. O que este
    // teste exige é que exista ALGUMA restrição declarada, não que ela seja
    // sempre uma faixa.
    const listasFechadas: Record<string, readonly number[]> = {
      l2csInputSize: L2CS_INPUT_SIZES_ACEITOS,
    };
    const defaults = sanitizeExperiment({});
    for (const [k, v] of Object.entries(defaults)) {
      if (typeof v === 'number') {
        const temFaixa = EXPERIMENT_RANGES[k as keyof typeof EXPERIMENT_RANGES] !== undefined;
        const temLista = listasFechadas[k] !== undefined;
        expect(
          temFaixa || temLista,
          `chave numérica '${k}' sem faixa em EXPERIMENT_RANGES nem lista fechada`,
        ).toBe(true);
      }
    }
  });

  it('`l2csInputSize` recusa valores que não são múltiplos de 32', () => {
    // O risco concreto do Dia 7 é um dedo trocado: `244` em vez de `224`.
    // Sob a faixa antiga ele passava, e a condição C8 mediria uma terceira
    // coisa que ninguém pediu — sem erro, sem aviso, com aparência normal.
    for (const bom of L2CS_INPUT_SIZES_ACEITOS) {
      expect(sanitizeExperiment({ l2csInputSize: bom }).l2csInputSize).toBe(bom);
    }
    for (const ruim of [244, 300, 256, 0, -224]) {
      expect(
        sanitizeExperiment({ l2csInputSize: ruim }).l2csInputSize,
        `${ruim} deveria cair no default`,
      ).toBe(448);
    }
  });

  it('booleanos válidos passam', () => {
    const r = sanitizeExperiment({ enableL2CS: false, polynomialFeatures: false });
    expect(r.enableL2CS).toBe(false);
    expect(r.polynomialFeatures).toBe(false);
  });

  it('um valor inválido não contamina os outros', () => {
    const r = sanitizeExperiment({
      expandFactor: 'lixo' as unknown as number,
      l2csCadenceMs: 150,
      enableL2CS: false,
    });
    expect(r.expandFactor).toBe(1.4);   // default
    expect(r.l2csCadenceMs).toBe(150);  // preservado
    expect(r.enableL2CS).toBe(false);   // preservado
  });

  it('avisa no console quando descarta um valor', () => {
    // Silenciar seria trocar um bug barulhento por um silencioso. Quem
    // configurou algo pelo console precisa saber que foi ignorado.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sanitizeExperiment({ l2csCadenceMs: 0 });
    expect(warn).toHaveBeenCalled();
  });
});
