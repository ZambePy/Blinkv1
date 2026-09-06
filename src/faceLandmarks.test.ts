import { describe, it, expect } from 'vitest';
import {
  FACE_MESH_LANDMARK_COUNT,
  FACE_MESH_SEM_IRIS,
  OLHO_ESQUERDO,
  OLHO_DIREITO,
  IRIS_ESQUERDA,
  IRIS_DIREITA,
  NARIZ_PONTA,
  TESTA_TOPO,
  assertFaceMeshCompleto,
  FaceMeshTopologyError,
} from './faceLandmarks';
import { analyzeFace, extractCompactFeatures } from './extractor';
import type { Point3D } from './extractor';

// Índices de landmark com nome, validados contra a topologia do Face Mesh, e
// falha visível (não vetor vazio silencioso) quando a topologia muda.

describe('topologia — os índices batem com o Face Mesh do MediaPipe', () => {
  it('478 com íris, 468 sem', () => {
    expect(FACE_MESH_LANDMARK_COUNT).toBe(478);
    expect(FACE_MESH_SEM_IRIS).toBe(468);
    expect(FACE_MESH_LANDMARK_COUNT - FACE_MESH_SEM_IRIS).toBe(10); // 5 por olho
  });

  it('todo índice do mesh facial cai abaixo de 468', () => {
    const doMesh = [
      OLHO_ESQUERDO.externo, OLHO_ESQUERDO.interno, OLHO_ESQUERDO.superior, OLHO_ESQUERDO.inferior,
      OLHO_DIREITO.externo, OLHO_DIREITO.interno, OLHO_DIREITO.superior, OLHO_DIREITO.inferior,
      NARIZ_PONTA, TESTA_TOPO,
    ];
    for (const i of doMesh) expect(i).toBeLessThan(FACE_MESH_SEM_IRIS);
  });

  it('todo índice de íris cai na faixa de refinamento (468–477)', () => {
    const daIris = [
      ...Object.values(IRIS_ESQUERDA),
      ...Object.values(IRIS_DIREITA),
    ];
    expect(daIris).toHaveLength(10);
    for (const i of daIris) {
      expect(i).toBeGreaterThanOrEqual(FACE_MESH_SEM_IRIS);
      expect(i).toBeLessThan(FACE_MESH_LANDMARK_COUNT);
    }
    // Os dois anéis são disjuntos e cobrem os 10 pontos sem repetir.
    expect(new Set(daIris).size).toBe(10);
  });

  it('a íris esquerda vem antes da direita, como o MediaPipe ordena', () => {
    expect(IRIS_ESQUERDA.centro).toBe(468);
    expect(IRIS_DIREITA.centro).toBe(473);
    for (const i of Object.values(IRIS_ESQUERDA)) expect(i).toBeLessThan(IRIS_DIREITA.centro);
  });

  it('os pares esquerda/direita são simétricos, nunca o mesmo ponto', () => {
    expect(OLHO_ESQUERDO.externo).not.toBe(OLHO_DIREITO.externo);
    expect(OLHO_ESQUERDO.interno).not.toBe(OLHO_DIREITO.interno);
  });
});

describe('assertFaceMeshCompleto — falha visível', () => {
  it('aceita 478 sem reclamar', () => {
    expect(() => assertFaceMeshCompleto({ length: 478 })).not.toThrow();
  });

  it('468 lança erro tipado, dizendo o que fazer', () => {
    expect(() => assertFaceMeshCompleto({ length: 468 })).toThrow(FaceMeshTopologyError);
    try {
      assertFaceMeshCompleto({ length: 468 });
    } catch (e) {
      const msg = (e as Error).message;
      // A mensagem precisa dizer a CAUSA e a AÇÃO, não só o número.
      expect(msg).toContain('468');
      expect(msg).toMatch(/íris|iris/i);
      expect(msg).toContain('refineLandmarks');
    }
  });

  it('mesh grande com contagem errada também é rejeitado', () => {
    expect(() => assertFaceMeshCompleto({ length: 470 })).toThrow(FaceMeshTopologyError);
    expect(() => assertFaceMeshCompleto({ length: 500 })).toThrow(FaceMeshTopologyError);
  });

  it('contagem ABAIXO de 468 não é erro de topologia — é quadro sem rosto', () => {
    // A distinção que importa: com 100 pontos não há como saber se é modelo
    // errado ou detecção truncada, e o contrato do extractor é devolver vazio.
    // A partir de 468 dá para saber — é um mesh facial de verdade com a
    // topologia errada, e aí a falha é permanente e tem que aparecer.
    expect(() => assertFaceMeshCompleto({ length: 0 })).not.toThrow();
    expect(() => assertFaceMeshCompleto({ length: 100 })).not.toThrow();
    expect(() => assertFaceMeshCompleto({ length: 467 })).not.toThrow();
  });

  it('o erro carrega a contagem recebida, para o diagnóstico', () => {
    try {
      assertFaceMeshCompleto({ length: 468 });
    } catch (e) {
      expect((e as FaceMeshTopologyError).recebido).toBe(468);
      expect((e as Error).name).toBe('FaceMeshTopologyError');
    }
  });
});

describe('analyzeFace com topologia errada', () => {
  function mesh(n: number): Point3D[] {
    return Array.from({ length: n }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  }

  it('468 landmarks LANÇA, em vez de devolver vetor vazio em silêncio', () => {
    // Era este o comportamento antigo: `return { featuresLeft: [] }`. O engine
    // tem ramo para features vazias, então o app ligava, rodava, e nunca
    // rastreava — sem uma linha no console dizendo por quê.
    expect(() => analyzeFace(mesh(468))).toThrow(FaceMeshTopologyError);
    expect(() => extractCompactFeatures(mesh(468))).toThrow(FaceMeshTopologyError);
  });

  it('quadro sem rosto (100 pontos) continua devolvendo vazio, sem lançar', () => {
    // O caminho transitório não pode virar exceção só porque o caminho
    // permanente ganhou uma.
    expect(analyzeFace(mesh(100)).present).toBe(false);
    const r = extractCompactFeatures(mesh(100));
    expect(r.featuresLeft).toEqual([]);
    expect(r.featuresRight).toEqual([]);
  });

  it('478 landmarks não lança por topologia', () => {
    // Pode devolver features vazias por outros motivos (rosto degenerado), mas
    // não pode lançar erro de TOPOLOGIA.
    expect(() => analyzeFace(mesh(478))).not.toThrow(FaceMeshTopologyError);
  });
});
