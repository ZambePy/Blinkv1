# Auditoria de UX e Segurança Clínica (Sprint B0)

Este documento registra a análise de conformidade de Usabilidade e Segurança Clínica das 25 telas do sistema IrisFlow, sob critérios da literatura de comunicação alternativa (CAA) para pacientes com Esclerose Lateral Amiotrófica (ELA).

---

## B0-1 — Inventário de Telas e Alvos

A tabela abaixo avalia cada uma das 25 telas em relação aos critérios ergonômicos da literatura. 
*Nota: A 60 cm de distância e resolução padrão de 1920×1080, **1° de ângulo visual ≈ 40 px**. O alvo mínimo aceitável é **5,0° (200 px)**, o recomendado é **6,6° (264 px)**, e o espaçamento mínimo é **1,5° (60 px)**.*

| Tela | Alvos | Menor Alvo (px / °) | Espaçamento Mínimo | "Voltar" Canônico? | Emergência Acessível? | Contraste ≥ 4.5:1? | Operável com Olhar? |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1. `WelcomeScreen.tsx` | 1 | 48px (1.2°) ❌ | -- | Não (Inicial) | ❌ Não | ✅ Sim | ❌ Difícil (alvo pequeno) |
| 2. `LoginScreen.tsx` | 2 | 150px (3.8°) ❌ | 80px (2.0°) | Não (Fluxo) | ❌ Não | ✅ Sim | ❌ Não (campo texto exige teclado físico) |
| 3. `ProfileSelect.tsx` | 2 | 150px (3.8°) ❌ | 80px (2.0°) | Não | ❌ Não | ✅ Sim | ⚠️ Parcial (alvos subdimensionados) |
| 4. `InitialSplash.tsx` | 1 | 48px (1.2°) ❌ | -- | Não | ❌ Não | ✅ Sim | ❌ Não (exige clique do cuidador) |
| 5. `CalibrationCheck.tsx` | 1 | 48px (1.2°) ❌ | -- | ✅ Sim | ❌ Não | ✅ Sim | ⚠️ Parcial |
| 6. `MainMenu.tsx` | 6 | 64px (1.6°) ❌ | 80px (2.0°) | Não (Raiz) | ❌ Não | ✅ Sim | ⚠️ Parcial (Sair e ícones muito pequenos) |
| 7. `KeyboardScreen.tsx` | 45 | 149px (3.7°) ❌ | 16px (0.4°) ❌ | ❌ Não (Custom) | ❌ Não | ✅ Sim | ⚠️ Crítico (Jitter causa muitos erros) |
| 8. `QuickPhrasesScreen.tsx`| 6 | 150px (3.8°) ❌ | 40px (1.0°) ❌ | ❌ Não | ❌ Não | ✅ Sim | ⚠️ Parcial |
| 9. `PictogramScreen.tsx` | 12 | 180px (4.5°) ❌ | 40px (1.0°) ❌ | ✅ Sim | ❌ Não | ✅ Sim | ⚠️ Parcial |
| 10. `ChatbotScreen.tsx` | 3 | 150px (3.8°) ❌ | 40px (1.0°) ❌ | ✅ Sim | ❌ Não | ✅ Sim | ❌ Difícil (caixa de texto não adaptada) |
| 11. `MyOptionsScreen.tsx` | 3 | 150px (3.8°) ❌ | 40px (1.0°) ❌ | ❌ Não | ❌ Não | ✅ Sim | ⚠️ Parcial |
| 12. `GamesMenu.tsx` | 4 | 32px (0.8°) ❌ | 40px (1.0°) ❌ | ❌ Não | ❌ Não | ✅ Sim | ❌ Crítico (botão minúsculo) |
| 13. `MemoryGame.tsx` | 13 | 120px (3.0°) ❌ | 40px (1.0°) ❌ | ✅ Sim | ❌ Não | ✅ Sim | ❌ Crítico |
| 14. `DrawingGame.tsx` | 6 | 50px (1.2°) ❌ | 40px (1.0°) ❌ | ✅ Sim | ❌ Não | ✅ Sim | ❌ Crítico (paleta pequena demais) |
| 15. `FollowTarget.tsx` | 1 | 80px (2.0°) ❌ | -- | ✅ Sim | ❌ Não | ✅ Sim | ✅ Sim (alvo dinâmico) |
| 16. `BubblePopGame.tsx` | ~5 | 80px (2.0°) ❌ | Dinâmico | ❌ Não | ❌ Não | ✅ Sim | ⚠️ Parcial |
| 17. `GalleryScreen.tsx` | 4 | 150px (3.8°) ❌ | 80px (2.0°) | ✅ Sim | ❌ Não | ✅ Sim | ⚠️ Parcial |
| 18. `NewsScreen.tsx` | 8 | 150px (3.8°) ❌ | 40px (1.0°) ❌ | ✅ Sim | ❌ Não | ✅ Sim | ⚠️ Parcial |
| 19. `MeditationScreen.tsx` | 3 | 150px (3.8°) ❌ | -- | ✅ Sim | ❌ Não | ✅ Sim | ⚠️ Parcial |
| 20. `TutorialScreen.tsx` | 2 | 150px (3.8°) ❌ | 80px (2.0°) | ❌ Não | ❌ Não | ✅ Sim | ⚠️ Parcial |
| 21. `SettingsScreen.tsx` | 18 | 24px (0.6°) ❌ | 10px (0.2°) ❌ | ❌ Não | ❌ Não | ✅ Sim | ❌ Não (Painel exclusivo do cuidador) |
| 22. `CaregiverDashboard.tsx`| 8 | 48px (1.2°) ❌ | 80px (2.0°) | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não (Painel exclusivo do cuidador) |
| 23. `IAmOkScreen.tsx` | 3 | 48px (1.2°) ❌ | -- | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não (Para uso pós-alerta de emergência) |
| 24. `EmergencyEscalation.tsx`| 5 | 180px (4.5°) ❌ | 80px (2.0°) | ✅ Sim | ✅ Sim (Alvo) | ✅ Sim | ✅ Sim |
| 25. `VirtualMouseScreen.tsx` | 8 | 150px (3.8°) ❌ | 20px (0.5°) ❌ | ❌ Não | ❌ Não | ✅ Sim | ❌ Crítico |

### Conclusões do Inventário (B0-1):
1. **Dimensionamento Abaixo do Mínimo:** Nenhuma tela do paciente (exceto a tela de emergência em si) atende ao critério de tamanho recomendado de **264 px (6.6°)**. A maioria das telas utiliza alvos de **150 px (3.8°)**, reduzindo drasticamente o acerto em caso de tremor, fadiga ou pequenos desvios de calibração.
2. **Espaçamento Insuficiente:** Telas cruciais como `KeyboardScreen` e `VirtualMouseScreen` possuem espaçamento de apenas 10-16 px entre alvos (critério mínimo é 60 px). Isso provoca o "efeito Midas" (seleções acidentais vizinhas).
3. **Ausência de Posição Canônica do Voltar:** O botão de retorno é implementado de formas diferentes e em coordenadas variadas, ou simplesmente está ausente em telas secundárias, correndo o risco de prender o paciente.

---

## B0-2 — Análise do Tempo de Dwell

Hoje, o `GazeContext` estabelece três velocidades de acionamento:
* **Rápido:** 800 ms
* **Normal:** 1500 ms
* **Lento:** 2500 ms

### Diagnóstico Técnico:
1. **Fadiga Ocular:** Manter a fixação estável em um alvo subdimensionado por 1.500 ms exige um esforço visual desnecessário. A literatura mostra que a carga de trabalho de fixação sobe em formato de rampa a partir de 700 ms.
2. **Tempo de Reação Elevado:** O tempo total para expressar uma palavra de 5 letras com 1.500 ms de dwell é de quase 8 segundos, gerando frustração.
3. **Direção Correta:** Não se deve aumentar o dwell para mitigar a imprecisão de alvos pequenos. A solução de engenharia correta é **aumentar os botões** e **reduzir o dwell** para algo em torno de **600 ms a 1000 ms**, oferecendo uma histerese dinâmica (tempo de tolerância se o olhar sair temporariamente do alvo).

---

## B0-3 — Auditoria de Segurança Clínica

Fizemos uma análise detalhada baseada no mapeamento de riscos de uso (IEC 62366):

### 1. Risco de Aprisionamento (Dead-ends)
* **Telas Sem Retorno:** Telas como `KeyboardScreen`, `GamesMenu` e `SettingsScreen` usam redirecionamentos personalizados e não possuem o componente `BackButton` canônico no topo esquerdo. Se houver desvio de calibração, o usuário pode ficar preso no teclado sem conseguir voltar ao menu inicial.
* **Modais Sem Escape:** A janela de erro ou confirmações não possuem áreas de descanso neutras de olhar suficientemente grandes (Rest Zones).

### 2. Acessibilidade à Emergência (Urgência Médica)
* **⚠️ Risco Crítico:** A tela de emergência (`EmergencyEscalation.tsx`) existe no roteamento, mas **o botão de emergência está ausente das principais telas de uso do paciente** (ex: `KeyboardScreen`, `PictogramScreen` e `MainMenu` do paciente).
* Se o paciente estiver engasgando ou sentindo dor forte enquanto digita no teclado, ele precisa voltar várias telas para encontrar ajuda ou simplesmente não consegue disparar o alerta.
* **Emergência sob Calibração Degradada:** O *dwell dispatcher* bloqueia cliques quando o motor está no estado `degraded`. Embora haja a regra de exceção para botões com `data-emergency="true"`, o fato de o botão de emergência não estar visível nas telas inviabiliza essa proteção.

### 3. Ações Irreversíveis Sem Confirmação
* **Saída Instantânea:** No menu principal, olhar para o botão "Sair" desloga o usuário instantaneamente sem qualquer diálogo de confirmação.
* **Seleção de Perfil:** Na tela `ProfileSelect.tsx`, olhar para o perfil ativa o rastreamento e altera os dados do regressor sem confirmação de segurança, o que pode levar o paciente a selecionar o perfil errado acidentalmente.

---

## Recomendações de Mitigação (Sprint B1+)

1. **Implementar a Biblioteca `gazeMetrics.ts` (B1-1):** Converter os valores fixos de CSS/Styling para utilizarem variáveis customizadas de CSS (`--gaze-target-min`, `--gaze-spacing-min`), garantindo conformidade matemática.
2. **Desenvolver o `GazeButton` Canônico (B1-2):** Substituir todas as tags `<button>` nativas das páginas do paciente pelo novo componente visual, que aplicará de forma homogênea a área de acionamento ampliada ($1.2\times$), feedback de progresso não regressivo e acessibilidade a leitores de tela.
3. **Menu Global de Emergência:** Garantir a presença de um botão de emergência fixo no canto superior ou inferior da viewport em todas as telas em que o paciente possa operar de forma autônoma.
