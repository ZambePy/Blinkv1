import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  listarCameras,
  classificarFps,
  contarFps,
  FPS_BOM,
  FPS_BAIXO,
} from './devices';

// -----------------------------------------------------------------------------
// O pipeline assume 30 fps em vários pontos — as janelas de baseline da
// calibração ("~1 s a 30 fps") e o detector de flicker, que resolve 50/60 Hz a
// partir dessa taxa. A 15 fps toda janela temporal vale metade dos quadros, e
// o relatório sai pior sem ninguém saber por quê.
//
// Daí medir de verdade em vez de acreditar no que a webcam declara.
// -----------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listarCameras', () => {
  it('devolve só entradas de vídeo', () => {
    // `enumerateDevices` mistura microfone e alto-falante na mesma lista.
    const dispositivos = [
      { kind: 'videoinput', deviceId: 'cam1', label: 'Webcam integrada' },
      { kind: 'audioinput', deviceId: 'mic1', label: 'Microfone' },
      { kind: 'audiooutput', deviceId: 'spk1', label: 'Alto-falante' },
      { kind: 'videoinput', deviceId: 'cam2', label: 'Logitech C920' },
    ];
    vi.stubGlobal('navigator', {
      mediaDevices: { enumerateDevices: () => Promise.resolve(dispositivos) },
    });

    return listarCameras().then((cams) => {
      expect(cams).toHaveLength(2);
      expect(cams.map((c) => c.deviceId)).toEqual(['cam1', 'cam2']);
    });
  });

  it('devolve lista vazia quando o navegador não expõe mediaDevices', async () => {
    // Um throw aqui derrubaria a tela de preparo inteira, e com ela o caminho
    // até a calibração.
    vi.stubGlobal('navigator', {});
    await expect(listarCameras()).resolves.toEqual([]);
  });

  it('devolve lista vazia quando enumerateDevices rejeita', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: { enumerateDevices: () => Promise.reject(new Error('bloqueado')) },
    });
    await expect(listarCameras()).resolves.toEqual([]);
  });

  it('dá um nome utilizável quando o label vem vazio', async () => {
    // Antes de conceder permissão o navegador esconde os labels. "Câmera 1" é
    // pior que "Logitech C920" e infinitamente melhor que uma linha em branco.
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: () =>
          Promise.resolve([{ kind: 'videoinput', deviceId: 'cam1', label: '' }]),
      },
    });

    const [cam] = await listarCameras();
    expect(cam.label.trim()).not.toBe('');
  });
});

describe('classificarFps', () => {
  it('30 fps é bom', () => {
    expect(classificarFps(30)).toBe('boa');
  });

  it('exatamente no limiar bom ainda é bom', () => {
    expect(classificarFps(FPS_BOM)).toBe('boa');
  });

  it('logo abaixo do limiar bom vira baixa', () => {
    expect(classificarFps(FPS_BOM - 0.1)).toBe('baixa');
  });

  it('15 fps é baixa, não ruim — o caso que o pedido cita', () => {
    expect(classificarFps(15)).toBe('baixa');
  });

  it('logo abaixo do limiar baixo vira ruim', () => {
    expect(classificarFps(FPS_BAIXO - 0.1)).toBe('ruim');
  });

  it('nenhuma taxa produz veredito de bloqueio', () => {
    // A classificação existe para AVISAR. Se ela pudesse dizer "não dá",
    // alguém acabaria usando isso para travar o botão de continuar — e uma
    // webcam barata deixaria o paciente sem comunicação.
    for (const fps of [0, 1, 5, 14.9, 15, 23.9, 24, 30, 60]) {
      expect(['boa', 'baixa', 'ruim']).toContain(classificarFps(fps));
    }
  });
});

describe('contarFps', () => {
  it('converte contagem e duração em taxa', () => {
    expect(contarFps(90, 3000)).toBeCloseTo(30, 5);
  });

  it('mede 15 quando a webcam entrega 15', () => {
    expect(contarFps(45, 3000)).toBeCloseTo(15, 5);
  });

  it('duração zero devolve 0 em vez de infinito', () => {
    // Uma divisão por zero aqui viraria `Infinity`, que classifica como "boa"
    // e esconde exatamente o problema que a tela existe para mostrar.
    expect(contarFps(10, 0)).toBe(0);
  });

  it('nenhum frame em três segundos é 0, não NaN', () => {
    expect(contarFps(0, 3000)).toBe(0);
  });
});
