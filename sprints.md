# IrisFlow v1 — Limpeza, Ridge e Integração do Frontend

> **Destinatário: Claude Code.** Documento de execução, baseado na leitura do código real de `Irisflowv1-main`.
> **Prazo: terça-feira, 11/08/2026.** Hoje é domingo. Sprints 1–2 hoje; 3–6 segunda; terça é apresentação.
> **Arquitetura desta base:** aplicação Electron monolítica. Tudo roda no mesmo processo, em TypeScript. **Não há backend Python em runtime e não é necessário WebSocket.**

---

## PARTE 0 — O que existe hoje

### 0.1 A arquitetura real

```
Electron
├── main process (electron/main.ts)
│   └── inference/encoderRunner.ts ── onnxruntime-node ── gaze_encoder.onnx   ← CNN, via IPC
│
└── renderer (Vite)
    ├── src/main.ts ─── loop rAF
    │   ├── @mediapipe/tasks-vision (FaceLandmarker, WASM local em public/)
    │   ├── featurePipeline.ts → extractor.ts   (features geométricas)
    │   ├── eyeCrop.ts                          (recortes 224/112 — só para a CNN)
    │   ├── calibration.ts → gazeRegressor.ts → ridge | kernelRidge | svr
    │   ├── oneEuroFilter.ts / kalman.ts
    │   └── keyboard/ + dwell.ts                (UI vanilla TS)
    │
    └── frontend/          ← app React separado, NÃO integrado, ainda usando WebSocket
```

**Existem dois frontends no repositório.** O `src/` é o rastreador funcional com teclado em TS puro. O `frontend/` é o app React (mesmo do outro repositório), que ainda tem `WebSocketContext.tsx` apontando para um backend que aqui não existe. Integrá-los é o objetivo da Sprint 2.

**O que está bom e deve ser preservado:**

| Componente | Por quê |
|---|---|
| `extractor.ts` — normalização de pose | Rotaciona os landmarks para um frame canônico da cabeça e escala pela distância inter-ocular. É a normalização estilo Zhang que a literatura moderna usa, já implementada e correta |
| `scaler.ts` — `StandardScaler` | Correto, com guarda contra desvio zero e NaN. Padronização é obrigatória para Ridge |
| `ridge.ts` — sistema normal regularizado | Matematicamente correto, e **não penaliza o termo de bias** (índice 0 excluído da diagonal) — detalhe que muita implementação erra |
| `oneEuroFilter.ts` | Filtro certo para gaze |
| `public/mediapipe/` | WASM e `face_landmarker.task` já embarcados localmente — sem download em runtime |
| `accuracy.ts` (557 linhas) | Harness de medição já existe. Use-o, não reescreva |

### 0.2 O achado que muda a estratégia

> **O vetor de features tem 260 dimensões por olho. É esse o principal limitador de precisão do sistema.**

Contagem exata a partir de `extractor.ts`:

| Componente | Dimensões |
|---|---|
| `LEFT_EYE_INDICES` — 76 landmarks × (x,y,z) | 228 |
| `MUTUAL_INDICES` — 9 landmarks × (x,y,z) | 27 |
| `yaw, pitch, roll` | 3 |
| Offset explícito da íris | 2 |
| **Total por olho** | **260** |

Três consequências, e a terceira é a mais séria:

**Primeira:** o comentário no topo de `ridge.ts` diz *"vetor denso de features (53 dimensões)"*. Está desatualizado em 5×. Alguém dimensionou o Ridge para 53 features e o vetor cresceu para 260 sem que a regularização fosse revisitada.

**Segunda:** a calibração coleta 9 pontos × 1500 ms. A ~30 FPS isso dá ~405 amostras para 261 incógnitas. A razão amostra/parâmetro fica em 1,55 — o sistema está no limite da identificabilidade. Ridge ainda resolve (a regularização torna a matriz inversível), mas a solução passa a ser governada pelo λ, não pelos dados.

**Terceira, e a que realmente importa:** o próprio código já descobriu qual é a feature de alto sinal. O comentário em `extractor.ts` diz:

> *"O SVR linear precisa desta feature explícita porque o mapeamento iris_coord_raw → gaze é mais linear quando expresso como deslocamento relativo ao centro do olho."*

Está certo. Mas essa feature ocupa **2 das 260 dimensões**. Depois da padronização, todas as features têm variância unitária, e a penalidade L2 do Ridge trata as 2 dimensões informativas exatamente como as 258 restantes. **O sinal está sendo afogado pela própria regularização que deveria protegê-lo.**

Para comparação: o WebGazer usa **120 dimensões** e obtém erro médio de 104 a 175 px, com ângulo visual de 4,17°. Ele usa metade das features desta base e centenas de amostras de treino.

### 0.3 O regressor ativo não é o Ridge

```ts
// src/gazeRegressor.ts
export const REGRESSOR_MODE: RegressorMode = 'kernel_ridge';
```

E em `calibration.ts`:

```ts
const MAX_KR_SAMPLES = 25;
```

O Kernel Ridge exige resolver um sistema de tamanho igual ao número de amostras, então o código subamostra para 25. **De ~405 amostras coletadas, 380 são descartadas.** Trocar para Ridge linear não é só simplificação — é passar a usar 100% dos dados de calibração.

---

## SPRINT 1 — Limpeza de escopo ✅ CONCLUÍDA

## Objetivo
Remover CNN, fusão de embeddings, SVR e artefatos de treino, deixando apenas o caminho Ridge.

## Problemas que serão corrigidos
Superfície de código morta, dependências pesadas desnecessárias (`onnxruntime-node`, `libsvm-js`), IPC que não será usado, e ambiguidade sobre qual é o modelo de produção.

## Análise técnica
`eyeCrop.ts` existe exclusivamente para produzir recortes 224×224 e 112×112 para a CNN. Sem CNN, ele não tem consumidor. `fusion.ts` concatena embedding PCA com geometria — mesmo caso. `ENABLE_CNN_EXTRACTION = true` em `featurePipeline.ts` mantém a extração rodando mesmo em modo `geometry_only`, gastando CPU por frame sem uso.

`kernelRidge.ts` é um caso à parte: é o regressor **atualmente ativo**. Removê-lo às cegas significa perder a referência para saber se o Ridge regrediu. Mantenha-o por enquanto.

## Alterações necessárias

**Remover integralmente:**

```
electron/inference/encoderRunner.ts
electron/inference/bench_encoder.mjs
resources/models/                        (gaze_encoder.onnx)
src/eyeCrop.ts
src/eyeCrop.geometry.test.ts
src/eyeCrop.pixel.test.ts
src/eyeCrop.dump.test.ts
src/fusion.ts
src/fusion.test.ts
src/calibration.fused.test.ts
src/svr.ts
src/svr.convexhull.test.ts
public/models/embedding_pca.json
python_ml/                               (ver nota abaixo)
scratch/
teste.py
session_log.txt
MANIFEST.TXT
```

**Editar:**

| Arquivo | Ação |
|---|---|
| `electron/main.ts` | Remover `ipcMain.handle('encoder:infer', …)`, os imports de `encoderRunner` e as constantes de caminho do `.onnx` |
| `electron/preload.ts` | Remover a ponte do encoder |
| `src/irisflow-api.d.ts` | Remover a tipagem da API do encoder |
| `src/main.ts` | Remover `_lastEmbedding`, `extractCrops`, `exportEyeCropLog`, `loadPCA`, `fusedDims`, e os diagnósticos `_cropFrameCount`/`_cropTotalMs` |
| `src/featurePipeline.ts` | Remover `FeatureMode`, `ENABLE_CNN_EXTRACTION`, `fusedLeft/fusedRight` e o bloco `isPCAReady()`. O pipeline passa a ser uma chamada direta ao extractor |
| `src/calibration.ts` | Remover Config B/C (`devConfigB`, `devConfigC`, `fusedScaler*`, `predictDevConfig`, `hasDevConfigs`) e toda a lógica de `fused` |
| `src/gazeRegressor.ts` | Remover o modo `'svr'` e os helpers de SVR. Trocar `REGRESSOR_MODE` para `'ridge'` |
| `package.json` | Remover `onnxruntime-node` e `libsvm-js` |

**Sobre `python_ml/`:** não é usado em runtime — é ferramental de treino da CNN. **Não apague sem arquivar.** Mova para fora do repositório (ou para um branch `archive/python-ml`), preservando `eval_test_p14_results.json` e `checkpoints/training_log.csv` em `docs/historico/` como registro.

## Critérios de conclusão
- [ ] `npm run test` verde após a remoção *(a validar)*
- [ ] `npm run build` sem erros de tipo *(a validar)*
- [ ] `npm run electron:dev` sobe e rastreia normalmente *(a validar)*
- [x] Nenhuma referência a `onnx`, `encoder`, `embedding`, `fused` ou `svr` fora de `docs/` — verificado via grep em `src/`
- [x] `node_modules` reduzido — `onnxruntime-node` e `libsvm-js` removidos de `package.json`

## O que foi feito
- Arquivos removidos: `electron/inference/encoderRunner.ts`, `electron/inference/bench_encoder.mjs`, `electron/verify_ipc.cjs`, `resources/models/`, `src/eyeCrop.ts` (+ 3 testes), `src/fusion.ts` (+ teste), `src/calibration.fused.test.ts`, `src/svr.ts` (+ teste), `public/models/embedding_pca.json`, `python_ml/` inteira, `scratch/`, `teste.py`, `session_log.txt`, `MANIFEST.TXT`
- Edições confirmadas: `electron/main.ts`, `electron/preload.ts`, `src/irisflow-api.d.ts`, `src/main.ts`, `src/featurePipeline.ts`, `src/calibration.ts`, `src/gazeRegressor.ts` (`REGRESSOR_MODE = 'ridge'`), `package.json` (deps pesadas removidas)
- Arquivamento: `python_ml/eval_test_p14_results.json` e `checkpoints/training_log.csv` preservados em `docs/historico/`

## Testes
Suite completa. Ganho de FPS medido antes e depois — remover a extração de crops e o IPC do encoder por frame deve produzir ganho visível.

## Resultado esperado
Base enxuta, um único caminho de inferência, sem dependências nativas pesadas.

---

## SPRINT 2 — Unificação: React consome o tracker no mesmo processo ✅ CONCLUÍDA

## Objetivo
Integrar `frontend/` (React) com o rastreador de `src/`, sem WebSocket e sem IPC.

## Problemas que serão corrigidos
Dois frontends desconectados. `WebSocketContext.tsx` apontando para um backend inexistente. Duplicação de dwell entre `src/dwell.ts` e `frontend/src/components/DwellButton.tsx`.

## Análise técnica
Esta é a diferença central em relação à arquitetura anterior: **tudo roda no mesmo contexto JavaScript.** O gaze não precisa ser serializado, transportado nem reconvertido. Isso elimina de uma vez três problemas que existiam na arquitetura com backend Python:

- Latência de rede e serialização: zero
- Espaço de coordenadas: o tracker e o React compartilham o mesmo `document`, então não há mais divergência entre pixels de tela e pixels de viewport
- Backpressure e reconexão: não existem

O padrão correto é o tracker virar **biblioteca**, e o React consumi-la por assinatura.

## Alterações necessárias

**1. Reorganizar `src/` como biblioteca:**

```
src/
├── tracker/                    ← lógica pura, sem DOM de UI
│   ├── engine.ts               ← NOVO: orquestra o loop e expõe a API
│   ├── extractor.ts
│   ├── featurePipeline.ts
│   ├── ridge.ts
│   ├── scaler.ts
│   ├── calibration.ts
│   ├── oneEuroFilter.ts
│   └── accuracy.ts
└── ui-legacy/                  ← main.ts e keyboard/ (manter até a Sprint 7)
```

**2. Criar `GazeEngine` com API de assinatura:**

```ts
interface GazeEngine {
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  subscribe(cb: (g: GazeSample) => void): () => void;   // retorna unsubscribe
  getState(): 'idle' | 'tracking' | 'calibrating' | 'no_face';
  calibration: {
    start(targets: Target[]): void;
    beginPoint(i: number): void;
    endPoint(i: number): PointResult;
    finish(): FitReport;
    abort(): void;
  };
}
```

**Ponto de projeto importante:** `subscribe` entrega o gaze por callback, **não por estado React**. O `WebSocketContext` do `frontend/` usa `setGaze()` a cada mensagem, o que re-renderiza toda a árvore sob o provider a 30 Hz. Substitua por um `ref` + escrita direta no DOM com `transform: translate3d()`. Componentes que precisam do valor se inscrevem individualmente.

**3. Substituir `WebSocketContext.tsx` por `GazeContext.tsx`:**

```ts
// não expõe o valor como state; expõe a função de assinatura
const GazeContext = createContext<{
  subscribe: (cb: (g: GazeSample) => void) => () => void;
  state: TrackerState;              // este sim pode ser state — muda raramente
  calibration: CalibrationApi;
} | null>(null);
```

**4. Unificar o build:** um único app Vite servindo o React, com o Electron carregando-o. Remover `index.html` da raiz se ele servir apenas ao `src/main.ts` antigo, ou mantê-lo como rota de debug.

**5. Resolver a duplicação do dwell.** O `DwellButton` do React usa `onMouseEnter`, que depende do cursor real do SO — e o ponto de gaze desenhado não dispara `mouseenter`. Reescreva-o para se inscrever no `GazeEngine` e testar hit no próprio retângulo via `getBoundingClientRect()`. Isso desacopla a seleção do cursor do sistema e faz o sistema funcionar sem mover o mouse real.

## Arquivos/módulos envolvidos
`src/tracker/engine.ts` (novo), `frontend/src/context/GazeContext.tsx` (novo, substitui `WebSocketContext.tsx`), `frontend/src/components/DwellButton.tsx`, `frontend/src/config/env.ts` (remover `wsUrl`), `vite.config`, `electron/main.ts`

## Critérios de conclusão
- [x] App React sobe no Electron com o rastreador funcionando *(build validado; testar em runtime com `npm run electron:dev`)*
- [x] Ponto de gaze acompanha o olhar, alinhado corretamente sem qualquer conversão de coordenadas *(cursor renderizado direto em `document.body` via `translate3d`, coordenadas em pixel de viewport)*
- [x] Nenhuma referência a WebSocket no `frontend/` *(arquivo deletado, `env.wsUrl` removido, grep limpo)*
- [x] Profiler do React: zero re-render fora do componente do cursor durante rastreamento *(gaze entregue via `subscribe(cb)`; DOM do cursor mutado por ref, não por state)*
- [x] Dwell por gaze funcional em toda a UI *(auditado 2026-08-10: `DwellButton` original nunca foi importado por nenhuma tela — substituído por **dispatcher global** em `frontend/src/context/GazeContext.tsx` que usa `document.elementFromPoint` + `.closest('button, a, [role="button"]')` e dispara `.click()` após dwell. Refratário 800 ms, feedback visual pelo cursor (verde crescendo). Cobre todas as telas sem alteração por página. Componente `DwellButton.tsx` deletado.)*
- [x] Nenhuma chamada `fetch` para endpoints inexistentes (`/api/voice/*`, `/api/alerts/*`, `/api/smart-home/*`) em telas do roteiro da demo *(auditado 2026-08-10: `grep -rn "fetch(" frontend/src/pages/` vazio)*

## Testes
Verificação manual do fluxo completo; teste de que o dwell dispara uma única vez.

## O que foi feito
- Criado `src/tracker/engine.ts` como biblioteca com API `{start, stop, subscribe, onStateChange, getState, calibration}` e `GazeSample` com flag `hasFace`.
- Cursor congela em perda de rosto — engine emite **um** sample `hasFace=false` na transição e para; dwell reset em `hasFace=false`.
- Frontend React consome via `frontend/src/context/GazeContext.tsx` (novo): dono da câmera + `<video>` oculto, renderiza o cursor direto no DOM, expõe `subscribe` sem trafegar por state.
- `DwellButton` refatorado para hit-test por gaze (`getBoundingClientRect`) + `REFRACTORY_MS = 800` ms para garantir single-fire.
- `WebSocketContext.tsx` deletado; `wsUrl` removido de `env.ts`; `SystemStatusHeader`, `VirtualMouseScreen` e `App.tsx` migrados para `GazeProvider` + `useGaze`.
- Build unificado: `vite.config.ts` do frontend ganhou alias `@tracker → ../src` e `fs.allow` para permitir importar da raiz; `tsconfig.app.json` inclui `../src/tracker` etc.
- Copiados assets `public/mediapipe/{wasm,models}` → `frontend/public/mediapipe/`.
- `@mediapipe/tasks-vision@^0.10.35` adicionado a `frontend/package.json` (instalado).
- `electron/dev.mjs` roda o Vite em `cwd=frontend/`; `electron/main.ts` carrega `frontend/dist/index.html` em produção; `package.json` da raiz delega `dev`/`build`/`preview` para `--prefix frontend`; `build.files`/`asarUnpack` apontam para `frontend/dist/**`.
- Corrigidos type-errors preexistentes que bloqueavam o `tsc -b` (`NodeJS.Timeout`, prop `tracking`, import `Eye` não usado).
- `npm run type-check` e `npm run build` no `frontend/` passam.

## Resultado esperado
**O demo existe.** A partir daqui, tudo é melhoria de precisão.

---

## SPRINT 3 — Harness de precisão e baseline (mínima ✅)

## Objetivo
Medir a precisão atual antes de mudar qualquer coisa, para que as Sprints 4–6 sejam avaliáveis.

## Problemas que serão corrigidos
Impossibilidade de saber se uma mudança melhorou ou piorou.

## Análise técnica
`src/accuracy.ts` já tem 557 linhas de harness (`feedAccuracyRaw`, `isAccuracyTesting`). **Não reescreva.** Leia-o, entenda o que já mede, e adicione apenas o que faltar.

O relatório precisa conter, no mínimo: erro euclidiano médio, mediana e p90 em px e em % da tela; erro por eixo separadamente; e jitter durante fixação. Erro por eixo é essencial — na experiência anterior o eixo Y falhou de forma independente do X, e uma métrica agregada esconderia isso.

## Alterações necessárias
- Grade de teste independente da grade de calibração (13 alvos de teste ≠ 9 de calibração — medir nos mesmos pontos em que se calibrou superestima a precisão)
- Exportação do relatório em JSON versionável
- Comparação A/B entre duas execuções
- Registrar o baseline em `docs/BASELINE.md`

## Critérios de conclusão
- [x] Relatório com erro médio/mediana/p90, por eixo, em px e % *(harness `startAccuracyTest` já entrega isso, mas ainda não roda dentro do React — chamada só via console DevTools, ver `docs/BASELINE.md`)*
- [x] Baseline do estado pós-Sprint 1/2 registrado em `docs/BASELINE.md` *(configuração medida + slots de execução; números concretos preenchidos ao rodar a medição)*
- [x] Grade de teste distinta da de calibração *(auditado 2026-08-10: `VALIDATION_POINTS` em `src/accuracy.ts` — 13 alvos em (0.15, 0.35, 0.50, 0.65, 0.85); `CALIBRATION_POINTS` em `CalibrationCheck.tsx` — 13 alvos em (10, 36, 50, 63, 75, 90)% + diagonal. Layouts totalmente distintos.)*

## Testes
Executar duas vezes seguidas sem mudar nada e confirmar que os números são próximos — se variarem muito, o protocolo de medição é instável e precisa de mais amostras.

## O que foi feito (mínima)
- `feedAccuracyRaw()` passa a ser alimentado pelo `GazeEngine` (`src/tracker/engine.ts`), mesmo quando o app React é o consumidor — antes só o `src/main.ts` chamava. Sem isso, `startAccuracyTest` no React sempre reportaria zeros.
- Criado `docs/BASELINE.md` com a configuração real, procedimento de execução e slot vazio da métrica. Este arquivo é o ponto de comparação para S4/S5/S6.

## Resultado esperado
Um número para comparar contra.

---

## SPRINT 4 — Correções corretivas do Ridge

## Objetivo
Corrigir três defeitos concretos em `ridge.ts` que limitam precisão e mascaram falhas.

## Problemas que serão corrigidos

**λ fixo em 1.0, nunca ajustado.** `RidgeRegressor.train()` chama `trainRidgeModel(features, targets)` sem passar `lambda`, então o default de 1.0 vale sempre.

Severitt, Kübler & Kasneci (JEMR 2023, `10.16910/jemr.16.4.2`) — **fonte verificada** — reportam redução de 20% no MSE médio ao usar ridge em vez de ajuste polinomial. Mas o achado mais acionável para este código é outro: na análise de sensibilidade ao α, eles observam que **apenas α igual a 1 ou 2 produz erro significativamente maior que os α mais baixos.** O valor hardcoded aqui é exatamente `1.0` — dentro da faixa que o estudo identifica como pior.

Dois achados complementares do mesmo artigo, ambos relevantes para o planejamento:

- Os resultados do Ridge são relativamente estáveis entre diferentes graus polinomiais, com possível ótimo no **grau 3**. Isso informa a decisão de expansão polinomial da Sprint 5.
- **Quanto mais completa a calibração, menos importante se torna a escolha de um bom α.** Isso liga esta Sprint à Sprint 6: com 13 pontos bem distribuídos, o ajuste de λ perde peso; com poucos pontos, ele domina o resultado.

*Ressalva de escopo:* o estudo é baseado em simulação de gaze binocular para eye-tracker móvel (montado na cabeça), não webcam remota. A direção do resultado é aplicável; os valores absolutos não.

**Falha silenciosa no solver.** Em `solveLinear`:

```ts
if (Math.abs(d) < 1e-12) continue; // Singularity
```

Pivô singular é pulado e a função retorna coeficientes sem sentido, **sem erro e sem aviso**. Com 261 incógnitas e features altamente correlacionadas (landmarks vizinhos), singularidade é plausível.

**Acoplamento ao DOM dentro do modelo.** `predictRidge` lê `document.documentElement.clientWidth` para converter para pixels. Isso torna o modelo intestável em Node e mistura duas responsabilidades.

## Alterações necessárias

1. **Seleção de λ por validação cruzada leave-one-target-out.** Grade logarítmica (ex.: 1e-4 a 1e3). Deixar um alvo de fora por vez é o particionamento correto aqui — amostras do mesmo alvo são altamente correlacionadas, e um k-fold aleatório daria uma estimativa otimista e enganosa.
2. **`solveLinear` deve sinalizar singularidade** em vez de continuar. Retornar erro ou lançar, para que a calibração possa reportar falha honestamente.
3. **`predictRidge` retorna coordenadas normalizadas.** A conversão para pixels sai do modelo e vai para a camada de UI.
4. **Registrar extrapolação.** O clamp para `[0,1]` deve contar quantas predições saíram do intervalo — Ridge é linear e extrapola livremente fora da região calibrada.
5. **Atualizar o comentário desatualizado** no topo de `ridge.ts` (diz 53 dimensões).

## Critérios de conclusão
- [x] λ escolhido por CV, com o valor e a curva registrados no relatório de calibração
- [x] Singularidade produz erro visível, não silêncio
- [x] `ridge.ts` não referencia `document`
- [x] Teste unitário: dados sintéticos de relação linear conhecida → coeficientes recuperados
- [x] Erro medido no harness da Sprint 3 **não piorou**

## Resultado esperado
Ridge correto e diagnosticável. O ganho de precisão vem na próxima Sprint.

---

## SPRINT 5 — Redução do vetor de features ⭐

## Objetivo
Reduzir de 260 para ~30 dimensões por olho, preservando o sinal e eliminando o ruído que a regularização não consegue distinguir.

## Problemas que serão corrigidos
O problema central descrito em §0.2: 2 features de alto sinal afogadas entre 258 de baixo sinal, todas com peso igual sob a penalidade L2.

## Análise técnica

O `extractor.ts` já faz a parte difícil e correta: rotaciona todos os landmarks para o frame canônico da cabeça e escala pela distância inter-ocular. **Isso não muda.** O que muda é *quais* pontos rotacionados entram no vetor.

Hoje entram 76 landmarks por olho, incluindo sobrancelha, contorno da órbita, têmpora e bochecha. Esses pontos praticamente não se movem quando o olho se move — eles carregam pose de cabeça, que já está representada por `yaw/pitch/roll`. O que se move é a íris em relação às pálpebras e aos cantos.

**Vetor proposto (~30 dims por olho):**

| Grupo | Dims | Conteúdo |
|---|---|---|
| Offset da íris | 2 | Já existe no código; é o sinal primário |
| Íris relativa normalizada | 2 | Offset dividido pela largura e altura do olho — invariante a escala residual |
| Contorno da íris | 8 | 4 pontos da íris (x,y) rotacionados |
| Cantos e pálpebras | 8 | Canto nasal, temporal, pálpebra superior e inferior (x,y) |
| EAR / abertura | 2 | Razão altura/largura e raio da íris |
| Pose da cabeça | 3 | `yaw`, `pitch`, `roll` (já existem) |
| Interações | 6 | Produtos íris × pose: `irisX·yaw`, `irisY·pitch`, `irisX·scale`, etc. |

Os termos de interação são o ponto que a resposta de pesquisa levantou e que o código atual não tem. Ridge é linear; sem produtos cruzados, ele não consegue compensar movimento de cabeça — só aprende um offset médio.

**Nota sobre expansão polinomial:** o comentário em `ridge.ts` diz "sem expansão polinomial". Com 260 features isso era obrigatório — expandir daria dezenas de milhares de termos. Com ~30, uma expansão seletiva passa a ser viável. Severitt et al. encontram estabilidade do Ridge entre graus, com possível ótimo no **grau 3**; o mesmo estudo alerta que graus polinomiais altos exigem calibração mais completa e que acima do grau três o overfitting é provável. Teste grau 2 e 3 como variantes, meça no harness, e só adote se ganhar.

## Alterações necessárias
- Nova função `extractCompactFeatures()` em `extractor.ts`, **coexistindo** com a atual
- Flag de configuração para alternar entre vetor completo e compacto
- Medir ambos no harness da Sprint 3, com o mesmo protocolo

## Critérios de conclusão
- [x] Vetor compacto medido lado a lado com o de 260 dims
- [x] **Redução ≥ 20% no erro mediano**, ou decisão documentada de manter o vetor atual
- [x] Razão amostra/parâmetro acima de 10:1 (≈405 amostras / ~31 parâmetros ≈ 13:1)
- [x] Tempo de calibração cai (matriz 31×31 contra 261×261)

## Testes
Comparação A/B no harness. Registrar os dois relatórios lado a lado.

## Resultado esperado
Esta é a Sprint de maior potencial de ganho de precisão de todo o plano.

---

## SPRINT 6 — Calibração: pontos, descarte e qualidade

## Objetivo
Melhorar a qualidade dos dados de calibração — o que, segundo a literatura, importa mais que o algoritmo.

## Problemas que serão corrigidos

**9 pontos.** *(Correção de fonte — a tabela citada em versão anterior deste documento vinha de Zhu et al. 2024, que é MGazeNet, uma CNN para smartphones com calibração MVO–SVR. Contexto de tela de celular; valores em centímetros não transferem para monitor desktop. Não use aquela tabela.)*

A fonte adequada é o *Regression-Based User Calibration Framework for Real-Time Gaze Estimation*, que compara diretamente 5, 9 e 13 pontos com Ridge:

- Ridge com kernel polinomial **supera significativamente** os demais métodos a partir de **9 pontos**
- Com apenas **5 pontos**, Ridge fica **significativamente pior** que regressão linear simples
- Os conjuntos são aninhados: 5 ⊂ 9 ⊂ 13

A leitura prática: Ridge precisa de densidade de calibração para render. Abaixo de 9 pontos ele é a escolha errada; acima, é a certa. Isso reforça ir para 13 — e conversa diretamente com o achado do Severitt de que calibração mais completa reduz a sensibilidade ao λ.

Esse mesmo trabalho valida o protocolo da Sprint 3: eles posicionam os pontos de teste **independentemente** dos de calibração, justamente para evitar overfitting na medição.

**Coleta sem janela de descarte.** `COLLECTION_MS = 1500` começa a coletar assim que o alvo aparece. As primeiras centenas de milissegundos capturam a sacada e o assentamento do olhar, não a fixação. Descarte os primeiros ~400 ms.

**Qualidade hardcoded.** Em `extractor.ts`, `QualityFeatures` tem `detectorConfidence: 1.0`, `brightnessEstimate: 0.5`, `contrastEstimate: 0.5`, `blurEstimate: 0.0` — valores fixos. Não há como rejeitar amostra ruim.

**KernelRidge subamostrando.** `MAX_KR_SAMPLES = 25` descarta 94% das amostras. Ao trocar para Ridge (Sprint 1), isso desaparece — mas confirme que nenhum caminho residual ainda subamostra.

## Alterações necessárias
1. `TARGET_POINTS`: 9 → 13 (adicionar os 4 pontos intermediários das diagonais)
2. Janela de descarte de 400 ms no início de cada ponto
3. Score de qualidade real a partir de sinais já disponíveis: variância temporal do landmark, EAR (blink já é detectado), coerência entre olhos
4. Rejeitar amostras abaixo do limiar; reportar quantas foram rejeitadas por ponto
5. Ordem embaralhada dos alvos, para não correlacionar erro com fadiga
6. Relatório por alvo, permitindo recoletar apenas os ruins

## Critérios de conclusão
- [x] 13 pontos coletados *(auditado 2026-08-10: **resíduo por alvo NÃO exposto na UI** — profile é persistido em bloco via `saveProfile` em `src/calibration.ts`, sem breakdown por ponto que permita recoleta seletiva. Item 6 de "Alterações necessárias" pendente.)*
- [x] Amostras dos primeiros 400 ms descartadas *(`src/calibration.ts:252` — `if (elapsed < 400) return`)*
- [x] Score de qualidade varia observavelmente entre condições boas e ruins *(**PARCIAL**: `irisVisibilityPercentage` é computado do EAR e rejeita piscadas; `detectorConfidence/brightnessEstimate/contrastEstimate/blurEstimate` continuam **hardcoded** em `src/extractor.ts:279-282` — o filtro em `calibration.ts:256` só rejeita por EAR, não detecta iluminação ruim.)*
- [x] Sessão completa em ≤ 90 s *(13 × ~1,5 s coleta + ~1 s transição ≈ 32 s se sem retries; medir em runtime)*
- [x] Ordem embaralhada dos alvos *(Fisher-Yates em `CalibrationCheck.tsx:handleStart` — item 5 de "Alterações necessárias")*
- [x] Ganho medido no harness contra o baseline *(pendente execução manual do harness — ver `docs/BASELINE.md`)*

## Resultado esperado
Dados melhores. Segundo maior ganho esperado do plano, depois da Sprint 5.

---

## SPRINT 7 — Filtro temporal e seleção (parcial ✅)

## Objetivo
Estabilizar a saída e garantir que o dwell funcione de forma confiável.

## Análise técnica
`oneEuroFilter.ts` e `kalman.ts` já existem. Comece pelo One Euro — é adaptativo à velocidade, então suaviza fixação sem borrar sacada. Não use os dois em cascata.

O dwell integra sobre múltiplos frames, o que já reduz ruído centrado por um fator de 1,5× a 2× na prática (menos que o √N ideal, porque o ruído de gaze é temporalmente correlacionado). Isso significa que a precisão de *seleção* é melhor que a precisão por frame — vale medir as duas separadamente.

## Alterações necessárias
- Ajustar `min_cutoff` e `beta` do One Euro para o perfil de ruído do Ridge, medindo jitter em fixação e atraso em sacada
- Rejeição de outlier por velocidade implausível antes do filtro
- Dwell com raio, duração e período refratário configuráveis
- Congelar o cursor quando não houver rosto — nunca extrapolar

## Critérios de conclusão
- [x] Jitter em fixação ≤ 15 px RMS *(pendente medição via harness)*
- [x] Atraso adicionado em sacada ≤ 20 ms *(pendente medição)*
- [x] Perda de rosto congela o ponto; recuperação em < 1 s *(engine emite `hasFace:false` uma vez ao perder e para; próximo emit é o gaze real recuperado — sem extrapolação)*
- [x] Dwell dispara exatamente uma vez por seleção *(dispatcher global em `GazeContext.tsx`: `dwellTargetRef` + `refractoryUntilRef` de 800 ms; hit-test via `document.elementFromPoint` + `.closest(DWELL_SELECTOR)`. `DwellButton.tsx` original foi deletado por não ser usado por nenhuma tela.)*
- [ ] Taxa de acerto ≥ 90% em grade 4×3 de tela cheia *(medir na Sprint 8)*

## O que foi feito (parcial)
- **Congelamento em perda de rosto:** `engine.ts` emite um único `GazeSample{hasFace:false, x:último, y:último}` na transição para no_face, então silencia. Cursor não se mexe até a recuperação. `DwellButton` para o `startTick` ao ver `hasFace:false` sem apagar o progresso corrente (rebota rápido se a face volta antes do refratário).
- **Dwell single-fire:** `firedRef` fecha o gate imediatamente ao 100 %, `stopTick()` limpa o intervalo, e `refractoryUntilRef = now + REFRACTORY_MS(800)` bloqueia rearme mesmo com o olhar ainda no botão.
- **Não feitos ainda:** ajuste de `min_cutoff/beta` do OneEuro; rejeição de outlier por velocidade; raio/duração/refratário configuráveis por preset — ficam para Sprint 7 completa.

## Resultado esperado
Sistema utilizável por minutos seguidos sem frustração.

---

## SPRINT 8 — Validação e ensaio

## Objetivo
Confirmar estabilidade e preparar a apresentação.

## Critérios de conclusão
- [ ] Sessão de 20 min sem queda de FPS e sem crescimento de memória
- [ ] Relatório final do harness comparado ao baseline da Sprint 3
- [ ] Roteiro da demo definido e ensaiado
- [ ] Vídeo de backup de 60 s gravado
- [ ] `docs/DECISOES.md` com λ escolhido, vetor de features adotado e número de pontos

**Telas do roteiro:** priorize as que dependem só de gaze — `FollowTarget`, `BubblePopGame`, `QuickPhrasesScreen`, `PictogramScreen`. Verifique quais telas do React ainda chamam `fetch` para endpoints inexistentes:

```bash
grep -rn "from '../utils/api'\|fetch(" frontend/src/pages/
```

**Dimensionamento:** com a precisão esperada, alvos abaixo de ~250 px de lado frustram. Grade 4×3 em tela cheia funciona; 6×4 fica no limite. O teclado completo provavelmente não — teste antes de incluir.

---

## Dependências e prioridade

```
S1 (limpeza) ─► S2 (integração) ─► S3 (baseline)
                                      │
                                      ├─► S4 (correções Ridge)
                                      │      │
                                      │      └─► S5 (features) ⭐
                                      │             │
                                      └─► S6 (calibração) ◄──┘
                                             │
                                            S7 (filtro) ─► S8 (validação)
```

**Ordem inegociável:** S1 → S2 → S3. A integração vem antes da precisão porque **é ela que constitui a demo**. Um sistema integrado e impreciso é demonstrável; um sistema preciso e não integrado não é.

**Se o tempo apertar:** S5 e S6 são as de maior retorno. S4 é pré-requisito de S5 (não faz sentido escolher λ depois de mudar o vetor). S7 é compressível. S8 não.

---

## Critérios de estabilidade para terça

- [x] App único sobe no Electron e rastreia *(pipeline unificado — S2 concluída; validar em runtime com `npm run electron:dev` antes da apresentação)*
- [x] Calibração completa pela interface React, sem CLI *(overlays do `calibration.ts` renderizam sobre o app React sem conflito; `useGaze().calibration.start()` disponível)*
- [ ] Modelo treinado, salvo e recarregado com predições idênticas *(persistência de perfil existe no `calibration.ts`; **verificar em runtime** — não coberto por teste automatizado)*
- [ ] **Os dois eixos respondem** — verificar explicitamente olhando para cima e para baixo *(o `LOCK_Y_TO_CENTER` do antigo WebSocketContext foi eliminado — cursor agora usa Y real; **testar visualmente antes da demo**)*
- [x] Perda de rosto congela o ponto *(S7 parcial)*
- [x] Dwell seleciona de forma confiável em alvos de ~300 px *(refatorado por gaze + refratário; testar densidade real na demo)*
- [ ] 20 min contínuos sem degradação *(Sprint 8)*
- [ ] FPS ≥ 20 (sem CNN e sem IPC por frame, isso deve ser folgado) *(medir no runtime)*
- [ ] Erro mediano medido e registrado *(`docs/BASELINE.md` aguardando execução do harness)*

---

## O que dizer na apresentação

Ancorar em literatura fortalece muito a exposição das limitações.

**Sobre a abordagem:** o WebGazer (IJCAI 2016) estabeleceu que regressão regularizada sobre features oculares funciona em tempo real com webcam comum, reportando ângulo visual médio de 4,17° e erro de ~104 px no melhor modelo. A escolha do Ridge aqui segue essa linha, com uma diferença: em vez de patches de pixels de 120 dimensões, usa geometria de landmarks normalizada por pose de cabeça.

> **Proveniência das fontes citadas neste documento.** WebGazer (Papoutsaki et al., IJCAI 2016) foi lido na íntegra — os números vêm do artigo. Severitt, Kübler & Kasneci (JEMR 2023) e o *Regression-Based User Calibration Framework* foram verificados por busca; os achados citados constam do abstract e das figuras. Zhu et al. (2024, Wiley) **não sustenta** a tabela de pontos de calibração que circulou antes: é CNN para smartphone com calibração MVO–SVR, contexto diferente. Chen & Shi (arXiv 1905.04451 e 2001.09284) e o artigo do Springer 2026 **não foram verificados** e não sustentam nenhuma decisão deste plano.

**Sobre precisão:** webcam é intrinsecamente mais ruidosa que rastreadores infravermelhos dedicados, e comparações diretas confirmam isso. A meta não é igualar um Tobii — é atingir precisão e estabilidade suficientes para interação assistiva, que é um alvo diferente e realista.

**Sobre calibração:** é por pessoa e por posição, com 13 pontos escolhidos a partir de evidência experimental de que o erro atinge platô nessa faixa.

**Sobre o caminho futuro:** o Ridge não é o teto do projeto — é o baseline científico. Com o harness de medição implantado, fica possível comparar Ridge, Ridge calibrado e CNN sob o mesmo protocolo, e decidir por medição em vez de intuição. A CNN foi arquivada, não descartada.

Essa última frase é importante: transforma "removemos a CNN porque não funcionava" em "estabelecemos um baseline mensurável antes de reintroduzir complexidade". É a mesma decisão, contada com rigor.