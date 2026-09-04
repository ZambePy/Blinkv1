import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// -----------------------------------------------------------------------------
// Guardas de interação encontradas na revisão pré-Sprint 8.
//
// Estes testes são de CONVENÇÃO — leem o texto do arquivo em vez de executá-lo.
// Não é a forma preferida, e a razão de ser dela aqui é específica: os defeitos
// vivem no `GazeContext.tsx` e no `ScanningMode.tsx`, dentro de um `subscribe`
// e de um `setInterval`, sob um provider que exige `getUserMedia`, MediaPipe e
// um Worker — nenhum dos três existe em jsdom.
//
// Um teste de convenção que ancora a guarda é melhor que nenhum teste. O que
// ele NÃO faz é verificar comportamento: se alguém reescrever a mesma falha com
// outra sintaxe, ele passa. Está registrado para não ser confundido com
// cobertura real.
// -----------------------------------------------------------------------------

const raiz = process.cwd();
const ler = (...p: string[]) => readFileSync(join(raiz, ...p), 'utf-8');

describe('a varredura não pode acionar a emergência', () => {
  const src = ler('frontend', 'src', 'components', 'ScanningMode.tsx');

  it('`itensNavegaveis` exclui `data-emergency`', () => {
    // `blinkClick.ts` declara esta guarda como a ÚNICA não-configurável do
    // módulo. A varredura seleciona por piscada e não a aplicava — então a
    // piscada acionava, por outro caminho, exatamente o botão que ela tem
    // proibição explícita de acionar.
    //
    // E aqui é pior que no `P7.3`: lá a pessoa escolhe o alvo olhando para
    // ele. Na varredura o ciclo percorre os botões sozinho, e basta uma
    // piscada involuntária no instante em que ele passa pela emergência. O
    // paciente não escolheu — o relógio escolheu por ele.
    expect(src).toMatch(/dataset\.emergency\s*===\s*'true'\s*\)\s*return false/);
  });
});

describe('a varredura tem relógio próprio', () => {
  const src = ler('frontend', 'src', 'components', 'ScanningMode.tsx');

  it('`stepScanning` NÃO é chamado de dentro do `subscribe`', () => {
    // O engine só emite amostra enquanto `videoEl.currentTime` avança. Câmera
    // desconectada, driver travado, aba suspensa: o fluxo para. Cronometrada
    // por ele, a varredura nunca chega aos 3 s de "sem gaze" — porque nem
    // tempo ela consegue contar.
    //
    // O fallback de último recurso não pode compartilhar relógio com o sistema
    // cuja falha ele existe para cobrir.
    const dentroDoSubscribe = src.slice(
      src.indexOf('return subscribe('),
      src.indexOf('}, [subscribe]);'),
    );
    expect(dentroDoSubscribe).not.toContain('stepScanning');
  });

  it('há um `setInterval` movendo a varredura', () => {
    expect(src).toContain('setInterval');
    expect(src).toContain('stepScanning');
  });

  it('a idade da última amostra decide se o gaze está vivo', () => {
    // Sem isso, "nenhuma amostra chegando" seria indistinguível de "a última
    // amostra dizia que estava tudo bem".
    expect(src).toContain('AMOSTRA_VIVA_MS');
  });

  it('não inventa piscada quando não há amostra', () => {
    // Uma piscada fabricada faria a varredura selecionar sozinha justamente
    // quando a câmera morresse.
    expect(src).toMatch(/piscando\s*=\s*amostraViva\s*&&/);
  });
});

describe('a varredura não roda durante a calibração', () => {
  it('há guarda explícita de `calibrating`', () => {
    // Durante a coleta o `uncalibrated` vale `true`, então `gazeValido` fica
    // `false` e a varredura ligava sozinha depois de 3 s — passando a clicar
    // os botões da própria tela de calibração enquanto o paciente olha para os
    // pontos. No Dia 7 isso corromperia a coleta em silêncio: o relatório
    // registraria uma calibração concluída sobre dados que uma piscada
    // involuntária interrompeu.
    const src = ler('frontend', 'src', 'components', 'ScanningMode.tsx');
    expect(src).toMatch(/stateRef\.current\s*===\s*'calibrating'/);
  });
});

describe('a piscada-clique respeita as guardas de estado do dwell', () => {
  const src = ler('frontend', 'src', 'context', 'GazeContext.tsx');

  it('não clica com o sistema `uncalibrated` nem `degraded`, nem em alvo desabilitado', () => {
    // `stepBlinkClick` conhece duração, estabilidade, refratário e emergência.
    // Ele NÃO sabe se o sistema está calibrado — essa política vive no
    // contexto, e sem ela a piscada clicava onde o `stepDwell` se recusa:
    //
    //   - `uncalibrated`: o ponto emitido é o fallback do NARIZ. Uma piscada
    //     ali aciona um botão escolhido pela posição da cabeça.
    //   - `degraded`: a predição falhou; o dwell só permite emergência e
    //     recuperação, as duas com dwell mais LONGO. A piscada dava o caminho
    //     mais curto no estado menos confiável.
    //   - `isDisabled`: cobre `disabled`, `aria-disabled` e `data-no-dwell`.
    expect(src).toContain('piscadaPermitida');
    expect(src).toMatch(/sample\.uncalibrated\s*!==\s*true/);
    expect(src).toMatch(/piscadaPermitida[\s\S]{0,200}!isDegraded/);
    expect(src).toMatch(/piscadaPermitida[\s\S]{0,240}isDisabled\s*!==\s*true/);
  });

  it('o alvo vira `null` quando o estado proíbe, em vez de o clique ser filtrado no fim', () => {
    // Filtrar só na hora do clique deixaria o relógio de estabilidade
    // acumulando sobre um alvo que nunca poderia ser clicado — e ele
    // dispararia no instante em que o estado voltasse ao normal.
    expect(src).toMatch(/alvo:\s*piscadaPermitida\s*\?\s*node\s*:\s*null/);
  });
});

describe('a projeção da piscada não contamina a última posição conhecida', () => {
  const src = ler('src', 'tracker', 'engine.ts');

  it('`lastEmittedX/Y` é restaurado depois de emitir a projeção', () => {
    // `emit` grava `lastEmittedX/Y` sempre que `hasFace` é true, e a piscada
    // emite com `hasFace: true` (o rosto está lá; são os olhos que fecharam).
    // Sem a restauração, cada quadro de piscada sobrescrevia a âncora com o
    // ponto extrapolado — e passados os 2 s de teto o fallback "congela na
    // última posição real" congelava num palpite. Vazava também para os ramos
    // `!hasFace`, de features vazias, e para `getLastSample`.
    expect(src).toContain('const ancoraX = lastEmittedX;');
    expect(src).toMatch(/if\s*\(hold\?\.posicao\)\s*\{\s*lastEmittedX\s*=\s*ancoraX;/);
  });
});

describe('`setFilterPreset` recusado não dessincroniza o estado', () => {
  it('`activePreset` só é gravado depois da guarda da cadeia', () => {
    // Antes, uma troca recusada já tinha gravado `activePreset` e voltava sem
    // tocar em `activeConfig`: os dois ficavam permanentemente
    // dessincronizados, e a UI exibia um preset que não correspondia aos
    // parâmetros em uso.
    const src = ler('src', 'tracker', 'engine.ts');
    // A chave no fim ancora a IMPLEMENTAÇÃO. Sem ela o `indexOf` casava a
    // declaração da interface (que termina em `;`), e a busca acontecia num
    // trecho sem guarda nenhuma — o teste falhava sem que houvesse defeito.
    const iGuarda = src.indexOf(
      'setFilterPreset(preset: FilterPreset | FilterPresetV2): void {',
    );
    expect(iGuarda, 'implementação de setFilterPreset não encontrada').toBeGreaterThan(-1);
    const trecho = src.slice(iGuarda, iGuarda + 2000);
    const iCadeia = trecho.indexOf('if (cadeia)');
    const iAtribuicao = trecho.indexOf('activePreset = preset;');
    expect(iCadeia).toBeGreaterThan(-1);
    expect(iAtribuicao).toBeGreaterThan(iCadeia);
  });
});
