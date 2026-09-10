import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { GazeProvider } from './context/GazeContext';
import { AuthProvider } from './context/AuthContext';
import { LicenseProvider } from './context/LicenseContext';
import { ProtectedRoute } from './components/ui/ProtectedRoute';
import { PreparoGate } from './pages/setup/PreparoGate';
import { GraceBanner } from './components/ui/GraceBanner';
import { SettingsProvider } from './context/SettingsContext';
import { ToastProvider } from './context/ToastContext';
import { ReminderProvider } from './context/ReminderContext';
import { EmergencyProvider } from './context/EmergencyContext';
import { CloudProvider } from './cloud/CloudContext';
import { CloudBanners } from './cloud/CloudBanners';
import { DebugHUD } from './components/DebugHUD';
import { PreflightPanel } from './components/PreflightPanel';
import { FatigueIndicator } from './components/FatigueIndicator';

// Ondas de onboarding carregadas cedo — poucas telas, alta chance de uso imediato
import { InitialSplash } from './pages/onboarding/InitialSplash';
import { LoginScreen } from './pages/auth/LoginScreen';

// Lazy loading — Vite fatia o bundle por rota.
// Os módulos exportam como named export; envolvemos para satisfazer o contrato do lazy().
// O módulo pode exportar outras coisas além de componentes (listas de frases,
// por exemplo); só o export pedido precisa ser um componente.
type AnyComponent = React.ComponentType<Record<string, never>>;
const lazyNamed = <M extends Record<string, unknown>, K extends keyof M & string>(
  loader: () => Promise<M>,
  name: M[K] extends AnyComponent ? K : never,
) =>
  lazy(async () => {
    const mod = await loader();
    return { default: mod[name] as AnyComponent };
  });

const MainMenu = lazyNamed(() => import('./pages/MainMenu'), 'MainMenu');
const WelcomeScreen = lazyNamed(() => import('./pages/WelcomeScreen'), 'WelcomeScreen');
const KeyboardScreen = lazyNamed(() => import('./pages/KeyboardScreen'), 'KeyboardScreen');
const QuickPhrasesScreen = lazyNamed(
  () => import('./pages/QuickPhrasesScreen'),
  'QuickPhrasesScreen'
);
const SettingsScreen = lazyNamed(() => import('./pages/SettingsScreen'), 'SettingsScreen');
const GamesMenu = lazyNamed(() => import('./pages/GamesMenu'), 'GamesMenu');
const BubblePopGame = lazyNamed(() => import('./pages/BubblePopGame'), 'BubblePopGame');
const TutorialWizard = lazyNamed(() => import('./pages/tutorial/TutorialWizard'), 'TutorialWizard');
const ProfileSelect = lazyNamed(() => import('./pages/auth/ProfileSelect'), 'ProfileSelect');
const IntroScreen = lazyNamed(() => import('./pages/onboarding/IntroScreen'), 'IntroScreen');
const ConsentScreen = lazyNamed(() => import('./pages/onboarding/ConsentScreen'), 'ConsentScreen');
const ActivatedScreen = lazyNamed(() => import('./pages/auth/ActivatedScreen'), 'ActivatedScreen');
const SetupWizard = lazyNamed(() => import('./pages/setup/SetupWizard'), 'SetupWizard');
const ResultadoDaCalibracao = lazyNamed(
  () => import('./pages/calibration/ResultadoDaCalibracao'),
  'ResultadoDaCalibracao'
);
const ContaEAssinatura = lazyNamed(
  () => import('./pages/conta/ContaEAssinatura'),
  'ContaEAssinatura'
);
const RelatorioDaSessao = lazyNamed(
  () => import('./pages/relatorio/RelatorioDaSessao'),
  'RelatorioDaSessao'
);
const ChecagemRapida = lazyNamed(() => import('./pages/retomada/ChecagemRapida'), 'ChecagemRapida');
const ConversationScreen = lazyNamed(
  () => import('./pages/caregiver/ConversationScreen'),
  'ConversationScreen'
);
const VoiceControlScreen = lazyNamed(() => import('./pages/core/EmBreveScreen'), 'VoiceControlScreen');
const AccessibilityScreen = lazyNamed(() => import('./pages/core/EmBreveScreen'), 'AccessibilityScreen');
const HistoricoDeSessoes = lazyNamed(
  () => import('./pages/historico/HistoricoDeSessoes'),
  'HistoricoDeSessoes'
);
const CalibrationCheck = lazyNamed(
  () => import('./pages/onboarding/CalibrationCheck'),
  'CalibrationCheck'
);
const ChatbotScreen = lazyNamed(() => import('./pages/ai/ChatbotScreen'), 'ChatbotScreen');
const FollowTarget = lazyNamed(() => import('./pages/games/FollowTarget'), 'FollowTarget');
const MemoryGame = lazyNamed(() => import('./pages/games/MemoryGame'), 'MemoryGame');
const DrawingGame = lazyNamed(() => import('./pages/games/DrawingGame'), 'DrawingGame');
const MyOptionsScreen = lazyNamed(() => import('./pages/core/MyOptionsScreen'), 'MyOptionsScreen');
const PictogramScreen = lazyNamed(() => import('./pages/core/PictogramScreen'), 'PictogramScreen');
const RestScreen = lazyNamed(() => import('./pages/core/RestScreen'), 'RestScreen');
const EmergencyEscalation = lazyNamed(
  () => import('./pages/output/EmergencyEscalation'),
  'EmergencyEscalation'
);
const GalleryScreen = lazyNamed(
  () => import('./pages/entertainment/GalleryScreen'),
  'GalleryScreen'
);
const PhotoCaptureScreen = lazyNamed(
  () => import('./pages/entertainment/PhotoCaptureScreen'),
  'PhotoCaptureScreen'
);
const NewsScreen = lazyNamed(() => import('./pages/entertainment/NewsScreen'), 'NewsScreen');
const CaregiverDashboard = lazyNamed(
  () => import('./pages/caregiver/CaregiverDashboard'),
  'CaregiverDashboard'
);
const CaregiverGuide = lazyNamed(
  () => import('./pages/caregiver/CaregiverGuide'),
  'CaregiverGuide'
);
const MeditationScreen = lazyNamed(
  () => import('./pages/health/MeditationScreen'),
  'MeditationScreen'
);
const IAmOkScreen = lazyNamed(() => import('./pages/caregiver/IAmOkScreen'), 'IAmOkScreen');
const VirtualMouseScreen = lazyNamed(
  () => import('./pages/VirtualMouseScreen'),
  'VirtualMouseScreen'
);
const VozScreen = lazyNamed(() => import('./pages/settings/VozScreen'), 'VozScreen');

const RouteFallback: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(160deg, #f0f4ff 0%, #e8f0fb 50%, #f1f5f9 100%)',
      color: '#1B54A8',
      fontSize: '1.1rem',
      fontWeight: 700,
    }}
  >
    Carregando…
  </div>
);

// O `Protected` que morava aqui era `({ children }) => <>{children}</>`: toda
// rota "protegida" era publica, e bastava digitar a URL para chegar ao menu sem
// licenca, sem consentimento e sem perfil. O portao de verdade esta em
// `components/ui/ProtectedRoute`, com a ordem das verificacoes sob teste.

/**
 * Router da aplicação.
 *
 * **`HashRouter`, não `BrowserRouter`.** No build empacotado o Electron faz
 * `win.loadFile(...)`, então o app roda sob `file://`. `BrowserRouter` usa a
 * history API: `navigate('/menu')` produz `file:///menu`, um caminho que não
 * existe no disco. Qualquer reload, crash-recovery do Chromium ou
 * `location.reload()` cai em "file not found" e o app morre em **tela branca**,
 * sem console para o cuidador diagnosticar.
 *
 * Com `HashRouter` a rota vive depois do `#`, que o `file://` ignora: o
 * documento carregado é sempre o mesmo `index.html`.
 *
 * Exportado para o teste poder afirmar a escolha. A verificação definitiva é
 * manual, num build empacotado — o plano registra este item como *suspeita*
 * justamente porque o pacote não foi executado na análise. Mas o par
 * `BrowserRouter` + `loadFile` é incompatível por construção, e a alternativa
 * (protocolo customizado via `loadURL`) é bem mais invasiva.
 */
export const AppRouter = HashRouter;

function App() {
  return (
    <LicenseProvider>
      <AuthProvider>
        <SettingsProvider>
          <ToastProvider>
            <GazeProvider>
              {/* Nuvem (conversa com o cuidador, socorro, resumo da calibração).
                  Dentro do GazeProvider — lê o engine para o heartbeat — e
                  abaixo do LicenseProvider — segue a licença. Fora do router:
                  a mensagem do cuidador é falada em qualquer tela. Sem
                  VITE_SUPABASE_URL é inerte. */}
              <CloudProvider>
              <ReminderProvider>
                <AppRouter>
                  <EmergencyProvider>
                    <GraceBanner />
                    <CloudBanners />
                    <DebugHUD />
                    <PreflightPanel />
                    <FatigueIndicator />
                    <Suspense fallback={<RouteFallback />}>
                      <Routes>
                        {/* Onboarding — públicas */}
                        <Route path="/" element={<InitialSplash />} />
                        <Route path="/intro" element={<IntroScreen />} />
                        <Route path="/login" element={<LoginScreen />} />
                        <Route path="/activated" element={<ActivatedScreen />} />
                        <Route path="/consent" element={<ConsentScreen />} />
                        <Route
                          path="/tutorial"
                          element={
                            <ProtectedRoute>
                              <TutorialWizard />
                            </ProtectedRoute>
                          }
                        />
                        <Route path="/profiles" element={<ProfileSelect />} />
                        <Route
                          path="/calibration-check"
                          element={
                            <ProtectedRoute>
                              {/* O preparo bloqueia a CALIBRAÇÃO, não o app:
                                  calibrar num ambiente não conferido produz um
                                  mapeamento ruim que o paciente carrega pela
                                  sessão inteira, sem ter como diagnosticar. */}
                              <PreparoGate>
                                <CalibrationCheck />
                              </PreparoGate>
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/calibration/resultado"
                          element={
                            <ProtectedRoute>
                              <ResultadoDaCalibracao />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/conta"
                          element={
                            <ProtectedRoute>
                              <ContaEAssinatura />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/retomada"
                          element={
                            <ProtectedRoute>
                              <ChecagemRapida />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/historico"
                          element={
                            <ProtectedRoute>
                              <HistoricoDeSessoes />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/relatorio"
                          element={
                            <ProtectedRoute>
                              <RelatorioDaSessao />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/setup"
                          element={
                            <ProtectedRoute>
                              <SetupWizard />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/welcome"
                          element={
                            <ProtectedRoute>
                              <WelcomeScreen />
                            </ProtectedRoute>
                          }
                        />

                        {/* Menu Principal */}
                        <Route
                          path="/menu"
                          element={
                            <ProtectedRoute>
                              <MainMenu />
                            </ProtectedRoute>
                          }
                        />

                        {/* Modo Descanso */}
                        <Route
                          path="/rest"
                          element={
                            <ProtectedRoute>
                              <RestScreen />
                            </ProtectedRoute>
                          }
                        />

                        {/* Comunicação */}
                        <Route
                          path="/keyboard"
                          element={
                            <ProtectedRoute>
                              <KeyboardScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/phrases"
                          element={
                            <ProtectedRoute>
                              <QuickPhrasesScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/pictograms"
                          element={
                            <ProtectedRoute>
                              <PictogramScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/chatbot"
                          element={
                            <ProtectedRoute>
                              <ChatbotScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/emergency"
                          element={
                            <ProtectedRoute>
                              <EmergencyEscalation />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/options"
                          element={
                            <ProtectedRoute>
                              <MyOptionsScreen />
                            </ProtectedRoute>
                          }
                        />

                        {/* Saúde e Cuidador */}
                        <Route
                          path="/caregiver"
                          element={
                            <ProtectedRoute>
                              <CaregiverDashboard />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/voice"
                          element={
                            <ProtectedRoute>
                              <VoiceControlScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/accessibility"
                          element={
                            <ProtectedRoute>
                              <AccessibilityScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/conversation"
                          element={
                            <ProtectedRoute>
                              <ConversationScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/caregiver/guide"
                          element={
                            <ProtectedRoute>
                              <CaregiverGuide />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/meditation"
                          element={
                            <ProtectedRoute>
                              <MeditationScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/iamok"
                          element={
                            <ProtectedRoute>
                              <IAmOkScreen />
                            </ProtectedRoute>
                          }
                        />

                        {/* Lazer */}
                        <Route
                          path="/games"
                          element={
                            <ProtectedRoute>
                              <GamesMenu />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/games/bubble"
                          element={
                            <ProtectedRoute>
                              <BubblePopGame />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/games/follow"
                          element={
                            <ProtectedRoute>
                              <FollowTarget />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/games/memory"
                          element={
                            <ProtectedRoute>
                              <MemoryGame />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/drawing"
                          element={
                            <ProtectedRoute>
                              <DrawingGame />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/gallery"
                          element={
                            <ProtectedRoute>
                              <GalleryScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/photo"
                          element={
                            <ProtectedRoute>
                              <PhotoCaptureScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/camera"
                          element={
                            <ProtectedRoute>
                              <PhotoCaptureScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/games/photo"
                          element={
                            <ProtectedRoute>
                              <PhotoCaptureScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/news"
                          element={
                            <ProtectedRoute>
                              <NewsScreen />
                            </ProtectedRoute>
                          }
                        />

                        {/* Sistema */}
                        <Route
                          path="/settings"
                          element={
                            <ProtectedRoute>
                              <SettingsScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/settings/voice"
                          element={
                            <ProtectedRoute>
                              <VozScreen />
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/virtual-mouse"
                          element={
                            <ProtectedRoute>
                              <VirtualMouseScreen />
                            </ProtectedRoute>
                          }
                        />
                      </Routes>
                    </Suspense>
                  </EmergencyProvider>
                </AppRouter>
              </ReminderProvider>
              </CloudProvider>
            </GazeProvider>
          </ToastProvider>
        </SettingsProvider>
      </AuthProvider>
    </LicenseProvider>
  );
}

export default App;
