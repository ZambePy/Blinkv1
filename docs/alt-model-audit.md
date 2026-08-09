# Auditoria — Modelo alternativo Keras (`resources/models/gaze_encoder.onnx`)

**Data:** 2026-08-02
**Escopo:** extrair números reais e comparáveis do modelo em `python_ml/` (não integrar).
**Artefatos auditados:**
- `python_ml/preprocess.py`
- `python_ml/train_cnn.py`
- `python_ml/export_onnx.py`
- `python_ml/train_svr_test.py`
- `python_ml/checkpoints/{gaze_cnn_best.keras, gaze_cnn_last.keras, training_log.csv, checkpoint_state.json}`
- `python_ml/datasets/prototype_nc_mpiifacegaze/processed/metadata.json`
- `python_ml/datasets/prototype_nc_mpiifacegaze/raw/Data/p??/Calibration/screenSize.mat`
- `resources/models/gaze_encoder.onnx`

Ad-hoc eval executado nesta auditoria: `python_ml/eval_test_p14.py` (script novo, isolado, apenas para medir — não integra nada). Resultados brutos em `python_ml/eval_test_p14_results.json`.

---

## 1. Como o alvo `gaze_xy ∈ [0,1]` foi calculado

Origem no arquivo `python_ml/preprocess.py`:

- `_read_screen_size` (linhas 72–74) lê **`screenSize.mat` de cada sujeito** e extrai apenas `width_pixel` e `height_pixel`.
- A label é gerada em `process_subject` (linhas 197–200):
  ```python
  label = np.array([
      np.clip(gaze_x / screen_w, 0.0, 1.0),
      np.clip(gaze_y / screen_h, 0.0, 1.0),
  ], dtype=np.float32)
  ```
  onde `gaze_x`, `gaze_y` vêm em pixels da anotação `pXX.txt` e `screen_w`, `screen_h` são pixels da tela **daquele sujeito**.

**Conclusão da questão 2 do briefing:** o alvo usa o tamanho de tela **por sujeito**, mas **em pixels** — não usa `width_mm`/`height_mm` nem `monitorPose.mat`/`Camera.mat`. É fração de tela 2D no espaço da tela do próprio sujeito; **não** é gaze em cm relativo à câmera. Isso já sinaliza que este modelo não é diretamente comparável com um baseline que reporta cm em coordenadas de câmera.

### Tabela real de tela por sujeito (extraída de `Calibration/screenSize.mat`)

| Sujeito | width_pixel | height_pixel | width_mm | height_mm |
|---------|------------:|-------------:|---------:|----------:|
| p00 | 1280 | 800 | 286.47 | 179.04 |
| p01 | 1440 | 900 | 286.47 | 179.04 |
| p02 | 1280 | 800 | 286.47 | 179.04 |
| p03 | 1440 | 900 | 286.47 | 179.04 |
| p04 | 1280 | 800 | 286.47 | 179.04 |
| p05 | 1440 | 900 | 286.47 | 179.04 |
| p06 | 1680 | 1050 | 331.70 | 207.31 |
| p07 | 1440 | 900 | 286.47 | 179.04 |
| p08 | 1440 | 900 | 286.47 | 179.04 |
| p09 | 1440 | 900 | 286.47 | 179.04 |
| p10 | 1440 | 900 | 286.47 | 179.04 |
| p11 | 1280 | 800 | 286.47 | 179.04 |
| p12 | 1280 | 800 | 286.47 | 179.04 |
| p13 | 1280 | 800 | 286.47 | 179.04 |
| **p14 (TESTE)** | **1440** | **900** | **286.47** | **179.04** |

Portanto p14 = **28.647×17.904 cm** (não 30×19 cm da conversão original — mas relativamente próximo).

---

## 2. Integridade do protocolo de avaliação

### 2.1. Split disjunto por sujeito — VERDADEIRO

`preprocess.py:47-50` hardcoda:
```python
TRAIN_SUBJECTS = set(ALL_SUBJECTS[:12])    # p00–p11
VAL_SUBJECTS   = set(ALL_SUBJECTS[12:14])  # p12, p13
TEST_SUBJECTS  = set(ALL_SUBJECTS[14:])    # p14
```
Em `main` (linhas 262–271), cada sujeito é roteado para exatamente um writer TFRecord baseado nessa filiação, e `process_subject` só grava sob o writer daquele split. **Não há caminho de código que copie o mesmo sujeito para dois splits.** Confere com `metadata.json`: `train.subjects = p00..p11`, `val.subjects = p12,p13`, `test.subjects = p14`.

### 2.2. Augmentation apenas no treino — VERDADEIRO

`train_cnn.py:226-227`:
```python
train_ds = build_dataset("train", augment=True,  batch_size=batch_size)
val_ds   = build_dataset("val",   augment=False, batch_size=batch_size)
```
O `test.tfrecord` **não é sequer aberto durante `run_training`** — não há vazamento possível. O jitter (`_augment`, linhas 74–90) só entra quando `augment=True`. Meu script de avaliação (`eval_test_p14.py`) também não aplica augment.

### 2.3. `restore_best_weights=True` — pesos exportados são os da época 72

`train_cnn.py:244-249` define `EarlyStopping(monitor='val_loss', patience=10, restore_best_weights=True)`. Adicionalmente, `ModelCheckpoint(BEST_CKPT, monitor='val_loss', save_best_only=True)` (linhas 250–255) grava `gaze_cnn_best.keras` **somente** quando `val_loss` melhora. Do `training_log.csv`: a última melhoria foi época 72 (0-indexed 71) com `val_loss = 0.04540`. Épocas 73–82 não superaram esse valor → `gaze_cnn_best.keras` = **pesos da época 72**.

`export_onnx.py:41` faz `KERAS_MODEL = CKPT_DIR / "gaze_cnn_best.keras"` e a exportação carrega esse arquivo. Portanto **`resources/models/gaze_encoder.onnx` contém o encoder derivado dos pesos da época 72**, não da 82.

- `gaze_cnn_last.keras` = época 82 (irrelevante, não exportado).
- `checkpoint_state.json` = `{"last_epoch": 82}` (usado só para `--resume`).

---

## 3. Erro real em cm/px no conjunto de TESTE (p14)

O script `eval_test_p14.py` carregou `gaze_cnn_best.keras`, iterou os 1.500 samples de `test.tfrecord` (subject_id verificado = `{14}`), obteve as predições e converteu para cm com **os valores reais de p14** (1440×900 px, 286.47×179.04 mm).

### 3.1. Números crus (fração)

| Métrica | Val (p12+p13, log de treino, ép. 72) | Teste (p14, medido agora) |
|---|---:|---:|
| MSE (fração²) | 0.04540 | **0.01651** |
| MAE (fração) | 0.16524 | **0.09975** |

*Comentário:* o test loss em p14 é **menor** que o val loss em p12+p13. Isso não é vazamento (verificado no item 2.1); é apenas o efeito de reportar um único sujeito. p14 é individualmente mais "fácil" que a média de p12+p13. Para o número que reflete generalização inter-sujeito com este pipeline, o valor honesto continua sendo o **val_loss** ou uma LOSO real (não feita aqui).

### 3.2. Erro traduzido para pixels e cm em p14

Todas as métricas abaixo são calculadas sobre 1.500 amostras de p14.

| Métrica | Fração | Pixels (p14: 1440×900) | Centímetros (p14: 28.65×17.90) |
|---|---:|---:|---:|
| **Distância Euclidiana 2D — média** | 0.156 | **175 px** | **3.49 cm** |
| Distância Euclidiana 2D — mediana | 0.143 | 157 px | **3.12 cm** |
| Distância Euclidiana 2D — p90 | 0.277 | 314 px | 6.25 cm |
| Distância Euclidiana 2D — máx | 0.594 | 801 px | 15.94 cm |
| RMSE eixo x | 0.108 | 155 px | 3.09 cm |
| RMSE eixo y | 0.146 | 132 px | 2.62 cm |
| MAE eixo x | 0.084 | 121 px | 2.40 cm |
| MAE eixo y | 0.116 | 104 px | 2.07 cm |

### 3.3. Comparação com a estimativa manual

Sua conversão anterior (RMSE de fração de tela → cm via 30×19 cm genérico) resultava em ~6 cm quando aplicada ao val_loss 0.0454. O erro **real de teste em p14** é **3.49 cm de distância Euclidiana média** — cerca de **metade**. Duas razões:

1. Usou val_loss (p12+p13, mais difícil) em vez do test em p14.
2. Aplicou RMSE-de-fração vezes largura, o que superestima quando o erro é distribuído entre x e y.

A ordem de grandeza estava certa; o número exato estava ~2× pessimista.

---

## 4. SVR de calibração por-usuário

- **`python_ml/train_svr_test.py`** — arquivo de 1 linha, apenas o comentário `# Script de treinamento do SVR`. **Não há código de treino nem artefato offline.**
- O SVR **existe** no código, mas é **runtime, per-user, em TypeScript** — `src/svr.ts`. Usa `libsvm-js` com kernel **linear** (não RBF), auto-tuning de `C` via leave-one-**point**-out CV sobre 9 pontos de calibração. Treinado do zero para cada usuário no navegador em ~ms/s durante a calibração 3×3.
- O que ele consome: em `FEATURE_MODE='fused'` (ver `src/fusion.ts`), o embedding CNN (256 dims) é reduzido a **18 dims via PCA** e concatenado com as ~258 features geométricas por olho — vetor fundido ~276 dims. Em `FEATURE_MODE='geometry_only'` o embedding nem entra. O `train_pca.py` treina apenas a PCA; nunca um SVR offline sobre MPIIFaceGaze.
- **Nenhum número antes/depois de calibração em sujeito real do MPIIFaceGaze existe no repositório.** A única validação quantitativa do SVR é em `src/svr.convexhull.test.ts`, com fixture sintético 4-dim, avaliando comportamento de extrapolação — não erro em cm.

**Conclusão da questão 5:** o SVR é design implementado, mas sem número de avaliação offline. Só existe medição online via `src/accuracy.ts` (overlay pós-calibração, 9 pontos, roda em runtime na tela do usuário) — não gravada em nenhum lugar do repo.

---

## 5. Ausência de `docs/baseline-v1.md`

**Bloqueio material para a comparação pedida:** não existe pasta `docs/` no repositório antes desta auditoria. `git`-visíveis são apenas `IRISFLOW_PIPELINE_TECNICO.md`, `README.md` e `MANIFEST.TXT`. Não há:

- `baseline-v1.md`
- números do "nosso CNN PyTorch"
- ridge baseline
- protocolo LOSO / 5-fold estratificado documentado
- baseline de center-camera

Verificado por: `Glob **/*.md` (fora de `node_modules/`), `Grep 'baseline|LOSO|5.fold|per.subject'` no repo. Nenhum resultado relevante.

Além disso, o modelo alternativo mede **fração 2D de tela**, e o baseline principal (segundo seu briefing) mede **cm em coordenadas de câmera** (usa `monitorPose.mat`+`Camera.mat`). São grandezas físicas distintas: mesmo se o baseline existisse escrito, uma linha na mesma tabela precisaria de nota explicando que o modelo alternativo não usa a geometria 3D — ele "acerta na tela" mas ignora onde a tela está no espaço da câmera.

---

## 6. Tabela final (com os slots do baseline oficial em branco por ausência do doc)

| Modelo | Split | Erro médio (cm) | Erro mediano (cm) | Protocolo |
|---|---|---:|---:|---|
| CNN alternativa (Keras 3-branch, `gaze_encoder.onnx`) | p14 (1 sujeito, 1500 samples) | **3.49** | **3.12** | Holdout fixo por sujeito (p00–p11 train / p12–p13 val / p14 test); alvo em fração 2D de tela do próprio sujeito, convertido para cm com `width_mm`/`height_mm` reais de p14 |
| Nosso CNN (PyTorch) | LOSO/5-fold | — | — | Não documentado (`docs/baseline-v1.md` não existe no repo) |
| Nosso ridge sobre landmarks | LOSO/5-fold | — | — | Não documentado |
| Baseline center-camera | LOSO/5-fold | — | — | Não documentado |

Complementos úteis para p14 (mesma medição):

| Métrica | Valor |
|---|---:|
| p90 do erro Euclidiano | 6.25 cm |
| Máx do erro Euclidiano | 15.94 cm |
| RMSE por eixo (x / y) | 3.09 / 2.62 cm |
| MAE por eixo (x / y) | 2.40 / 2.07 cm |
| Erro Euclidiano médio em pixels | 175 px |

---

## 7. Veredito

Os números corretos **não mudam a decisão de não integrar**. Três razões:

1. **Grandeza física errada:** o modelo alvo aprendeu fração 2D de tela por sujeito, não gaze em cm relativo à câmera. Mesmo com 3.49 cm de erro médio em p14, ele não produz o vetor 3D que o pipeline principal reporta — integrá-lo exigiria retreinar com labels de `monitorPose.mat`+`Camera.mat`, não reaproveitar pesos.
2. **Protocolo mais fraco:** é holdout de 1 sujeito, não LOSO. Sem `docs/baseline-v1.md` para comparar, o número de p14 sozinho não estabelece paridade com nada — e ele é sabidamente menor que o val_loss em p12+p13 do próprio pipeline (0.017 vs 0.045 em MSE de fração), confirmando alta variância inter-sujeito.
3. **Licença bloqueia produção:** `python_ml/datasets/prototype_nc_mpiifacegaze/README.md` declara MPIIFaceGaze como CC BY-NC-SA e proíbe explicitamente uso comercial dos pesos derivados. Este ONNX é para "validação interna de arquitetura", não para embarcar.

Recomendação: manter como referência de arquitetura e como fonte de embeddings para a via `FEATURE_MODE='fused'` (que já é o uso real dele no `src/`), mas não promovê-lo à linha do baseline até que exista (a) o `docs/baseline-v1.md`, (b) uma métrica em cm de câmera compatível, e (c) resolução da licença.
