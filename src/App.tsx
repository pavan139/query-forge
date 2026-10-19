import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Celebrations } from './components/Celebrations.tsx';
import { Shell } from './components/Shell.tsx';
import { useStore } from './state/store.ts';
import { useActivityTracker, useThemeSync } from './lib/hooks.ts';
import { Home } from './pages/Home.tsx';
import { Onboarding } from './pages/Onboarding.tsx';

const Learn = lazy(() => import('./pages/Learn.tsx'));
const ModulePage = lazy(() => import('./pages/ModulePage.tsx'));
const LessonPage = lazy(() => import('./pages/LessonPage.tsx'));
const Review = lazy(() => import('./pages/Review.tsx'));
const Tests = lazy(() => import('./pages/Tests.tsx'));
const TestRunner = lazy(() => import('./pages/TestRunner.tsx'));
const TestResult = lazy(() => import('./pages/TestResult.tsx'));
const Practice = lazy(() => import('./pages/Practice.tsx'));
const ChallengePage = lazy(() => import('./pages/ChallengePage.tsx'));
const Projects = lazy(() => import('./pages/Projects.tsx'));
const ProjectPage = lazy(() => import('./pages/ProjectPage.tsx'));
const Playground = lazy(() => import('./pages/Playground.tsx'));
const Reference = lazy(() => import('./pages/Reference.tsx'));
const Datasets = lazy(() => import('./pages/Datasets.tsx'));
const Achievements = lazy(() => import('./pages/Achievements.tsx'));
const Settings = lazy(() => import('./pages/Settings.tsx'));
const Certificate = lazy(() => import('./pages/Certificate.tsx'));
const Progress = lazy(() => import('./pages/Progress.tsx'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.getElementById('main-scroll')?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

export function App() {
  const onboarded = useStore((s) => s.profile.onboarded);
  useThemeSync();
  useActivityTracker();

  if (!onboarded) return <Onboarding />;

  return (
    <>
    <Celebrations />
    <Shell>
      <ScrollToTop />
      <Suspense
        fallback={
          <div className="flex h-64 items-center justify-center text-muted">
            <Loader2 className="animate-spin" />
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/learn" element={<Learn />} />
          <Route path="/learn/:moduleId" element={<ModulePage />} />
          <Route path="/lesson/:lessonId" element={<LessonPage />} />
          <Route path="/review" element={<Review />} />
          <Route path="/tests" element={<Tests />} />
          <Route path="/tests/run" element={<TestRunner />} />
          <Route path="/tests/result/:attemptId" element={<TestResult />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/practice/:challengeId" element={<ChallengePage />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:moduleId" element={<ProjectPage />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/reference" element={<Reference />} />
          <Route path="/datasets" element={<Datasets />} />
          <Route path="/datasets/:datasetId" element={<Datasets />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/certificate" element={<Certificate />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
    </>
  );
}
