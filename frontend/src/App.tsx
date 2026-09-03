import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { GazeProvider } from './context/GazeContext';
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { ToastProvider } from './context/ToastContext';
import { ReminderProvider } from './context/ReminderContext';
import { EmergencyProvider } from './context/EmergencyContext';
import { DebugHUD } from './components/DebugHUD';
import { DriftIndicator } from './components/DriftIndicator';
import { FatigueIndicator } from './components/FatigueIndicator';

// Ondas de onboarding carregadas cedo — poucas telas, alta chance de uso imediato
import { InitialSplash } from './pages/onboarding/InitialSplash';
import { LoginScreen } from './pages/auth/LoginScreen';

// Lazy loading — Vite fatia o bundle por rota.
// Os módulos exportam como named export; envolvemos para satisfazer o contrato do lazy().
type AnyComponent = React.ComponentType<Record<string, never>>;
const lazyNamed = (loader: () => Promise<Record<string, AnyComponent>>, name: string) =>
  lazy(async () => {
    const mod = await loader();
    return { default: mod[name] };
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
const TutorialScreen = lazyNamed(() => import('./pages/help/TutorialScreen'), 'TutorialScreen');
const ProfileSelect = lazyNamed(() => import('./pages/auth/ProfileSelect'), 'ProfileSelect');
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

const Protected: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <>{children}</>
);

/**
 * Router da aplicação — B2.12.
 *
 * **`HashRouter`, não `BrowserRouter`.** No build empacotado o Electron faz
 * `win.loadFile(...)`, então o app roda sob `file://`. `BrowserRouter` usa a
 * History API: `navigate('/menu')` produz `file:///menu`, um caminho que não
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
    <AuthProvider>
      <SettingsProvider>
        <ToastProvider>
          <GazeProvider>
            <ReminderProvider>
              <AppRouter>
                <EmergencyProvider>
                  <DebugHUD />
                  <DriftIndicator />
                  <FatigueIndicator />
                  <Suspense fallback={<RouteFallback />}>
                    <Routes>
                  {/* Onboarding — públicas */}
                  <Route path="/" element={<InitialSplash />} />
                  <Route path="/login" element={<LoginScreen />} />
                  <Route path="/tutorial" element={<TutorialScreen />} />
                  <Route path="/profiles" element={<ProfileSelect />} />
                  <Route
                    path="/calibration-check"
                    element={
                      <Protected>
                        <CalibrationCheck />
                      </Protected>
                    }
                  />
                  <Route
                    path="/welcome"
                    element={
                      <Protected>
                        <WelcomeScreen />
                      </Protected>
                    }
                  />

                  {/* Menu Principal */}
                  <Route
                    path="/menu"
                    element={
                      <Protected>
                        <MainMenu />
                      </Protected>
                    }
                  />

                  {/* Modo Descanso (B3-3) */}
                  <Route
                    path="/rest"
                    element={
                      <Protected>
                        <RestScreen />
                      </Protected>
                    }
                  />

                  {/* Comunicação */}
                  <Route
                    path="/keyboard"
                    element={
                      <Protected>
                        <KeyboardScreen />
                      </Protected>
                    }
                  />
                  <Route
                    path="/phrases"
                    element={
                      <Protected>
                        <QuickPhrasesScreen />
                      </Protected>
                    }
                  />
                  <Route
                    path="/pictograms"
                    element={
                      <Protected>
                        <PictogramScreen />
                      </Protected>
                    }
                  />
                  <Route
                    path="/chatbot"
                    element={
                      <Protected>
                        <ChatbotScreen />
                      </Protected>
                    }
                  />
                  <Route
                    path="/emergency"
                    element={
                      <Protected>
                        <EmergencyEscalation />
                      </Protected>
                    }
                  />
                  <Route
                    path="/options"
                    element={
                      <Protected>
                        <MyOptionsScreen />
                      </Protected>
                    }
                  />

                  {/* Saúde e Cuidador */}
                  <Route
                    path="/caregiver"
                    element={
                      <Protected>
                        <CaregiverDashboard />
                      </Protected>
                    }
                  />
                  <Route
                    path="/caregiver/guide"
                    element={
                      <Protected>
                        <CaregiverGuide />
                      </Protected>
                    }
                  />
                  <Route
                    path="/meditation"
                    element={
                      <Protected>
                        <MeditationScreen />
                      </Protected>
                    }
                  />
                  <Route
                    path="/iamok"
                    element={
                      <Protected>
                        <IAmOkScreen />
                      </Protected>
                    }
                  />

                  {/* Lazer */}
                  <Route
                    path="/games"
                    element={
                      <Protected>
                        <GamesMenu />
                      </Protected>
                    }
                  />
                  <Route
                    path="/games/bubble"
                    element={
                      <Protected>
                        <BubblePopGame />
                      </Protected>
                    }
                  />
                  <Route
                    path="/games/follow"
                    element={
                      <Protected>
                        <FollowTarget />
                      </Protected>
                    }
                  />
                  <Route
                    path="/games/memory"
                    element={
                      <Protected>
                        <MemoryGame />
                      </Protected>
                    }
                  />
                  <Route
                    path="/drawing"
                    element={
                      <Protected>
                        <DrawingGame />
                      </Protected>
                    }
                  />
                  <Route
                    path="/gallery"
                    element={
                      <Protected>
                        <GalleryScreen />
                      </Protected>
                    }
                  />
                  <Route
                    path="/photo"
                    element={
                      <Protected>
                        <PhotoCaptureScreen />
                      </Protected>
                    }
                  />
                  <Route
                    path="/camera"
                    element={
                      <Protected>
                        <PhotoCaptureScreen />
                      </Protected>
                    }
                  />
                  <Route
                    path="/games/photo"
                    element={
                      <Protected>
                        <PhotoCaptureScreen />
                      </Protected>
                    }
                  />
                  <Route
                    path="/news"
                    element={
                      <Protected>
                        <NewsScreen />
                      </Protected>
                    }
                  />

                  {/* Sistema */}
                  <Route
                    path="/settings"
                    element={
                      <Protected>
                        <SettingsScreen />
                      </Protected>
                    }
                  />
                  <Route
                    path="/virtual-mouse"
                    element={
                      <Protected>
                        <VirtualMouseScreen />
                      </Protected>
                    }
                  />
                </Routes>
              </Suspense>
              </EmergencyProvider>
            </AppRouter>
          </ReminderProvider>
        </GazeProvider>
      </ToastProvider>
    </SettingsProvider>
  </AuthProvider>
  );
}

export default App;
