import { describe, it, expect } from 'vitest';
import { buildAutoRecordingFilename } from './autoRecording';

// D2 (ROADMAP.md) — auto-gravação da sessão de calibração+precisão salva
// direto no disco (Electron) ou dispara download (browser). Estes testes
// protegem o gerador de nome contra três regressões concretas:
//   (i)  formato precisa ser aceito por Windows (:. → -), senão o
//        writeFile do main.ts falha em silêncio no NTFS;
//   (ii) segundos NÃO podem cair fora do slice — se duas calibrações
//        rodam no mesmo minuto, o nome precisa diferenciá-las
//        (bug real observado na primeira sessão: nome saía
//        "2026-08-26_01-19-_..." cortando os segundos);
//   (iii) condição óptica e modo (quick vs full) aparecem no nome pra
//         o operador identificar sem abrir o arquivo.

describe('buildAutoRecordingFilename', () => {
  it('usa timestamp completo com segundos (regressão do slice 17→19)', () => {
    const name = buildAutoRecordingFilename({
      opticalCondition: 'oculos_simples',
      quick: false,
      nowIso: '2026-08-26T01:19:47.123Z',
    });
    // Deve conter "01-19-47" (com segundos). Bug antigo cortava em "01-19-".
    expect(name).toContain('01-19-47');
    expect(name).not.toMatch(/01-19-_/);
  });

  it('substitui separadores proibidos em Windows (: e .)', () => {
    const name = buildAutoRecordingFilename({
      opticalCondition: 'sem_oculos',
      quick: false,
      nowIso: '2026-08-26T01:19:47.123Z',
    });
    expect(name).not.toContain(':');
    // Fora da extensão ".jsonl", nenhum ponto deve sobrar.
    expect(name.slice(0, -6)).not.toContain('.');
  });

  it('inclui a condição óptica no nome', () => {
    for (const cond of ['sem_oculos', 'oculos_simples', 'oculos_progressivo', 'lentes_contato', 'desconhecido'] as const) {
      const name = buildAutoRecordingFilename({
        opticalCondition: cond,
        quick: false,
        nowIso: '2026-08-26T12:00:00.000Z',
      });
      expect(name, `condicao=${cond}`).toContain(cond);
    }
  });

  it('marca modo quick como "calib-quick+precisao" (diferencia da grade full)', () => {
    const full = buildAutoRecordingFilename({
      opticalCondition: 'desconhecido',
      quick: false,
      nowIso: '2026-08-26T12:00:00.000Z',
    });
    const quick = buildAutoRecordingFilename({
      opticalCondition: 'desconhecido',
      quick: true,
      nowIso: '2026-08-26T12:00:00.000Z',
    });
    expect(full).toContain('calib+precisao');
    expect(full).not.toContain('calib-quick');
    expect(quick).toContain('calib-quick+precisao');
  });

  it('termina em .jsonl (o handler do Electron rejeita outras extensões)', () => {
    const name = buildAutoRecordingFilename({
      opticalCondition: 'desconhecido',
      quick: false,
      nowIso: '2026-08-26T12:00:00.000Z',
    });
    expect(name.endsWith('.jsonl')).toBe(true);
  });

  it('prefixo canônico irisflow-recording- (mesma família do export manual)', () => {
    const name = buildAutoRecordingFilename({
      opticalCondition: 'desconhecido',
      quick: false,
      nowIso: '2026-08-26T12:00:00.000Z',
    });
    expect(name.startsWith('irisflow-recording-')).toBe(true);
  });
});
