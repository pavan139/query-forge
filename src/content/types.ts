// Content model for SQL Quest. Authored as YAML under content/, validated by
// scripts/build-content.mjs (zod) and scripts/validate-content.mjs (runs every SQL in PGlite).

export type DatasetId =
  | 'cafe'
  | 'shop'
  | 'company'
  | 'movies'
  | 'bank'
  | 'app'
  | 'school'
  | 'messy'
  | 'blank';

export type Level = 'beginner' | 'intermediate' | 'advanced' | 'expert';

/** Plain prose. Markdown with GitHub alerts: > [!TIP] > [!NOTE] > [!WARNING] > [!MISTAKE] > [!ANALOGY] > [!REAL-WORLD] */
export type Md = string;

export interface ReadStep {
  type: 'read';
  title?: string;
  md: Md;
}

/** A runnable, editable example. The learner presses Run and sees the result. */
export interface ExampleStep {
  type: 'example';
  title?: string;
  md?: Md;
  sql: string;
  /** Explanation shown below the result once it has been run. */
  after?: Md;
  dataset?: DatasetId;
  /** The example deliberately fails, to show an error message. */
  expectError?: boolean;
}

/** Write a query; auto-checked by comparing results with the solution's results. */
export interface ExerciseStep {
  type: 'exercise';
  id: string;
  title?: string;
  prompt: Md;
  starter?: string;
  solution: string;
  /** Alternative accepted solutions are not needed: results are compared, not text. */
  /** Hidden SQL run on a fresh database before the learner's SQL and before the solution. */
  setup?: string;
  /** For INSERT/UPDATE/DELETE/DDL tasks: query whose result is compared after running the SQL. */
  check?: string;
  /** Row order must match (only when the prompt asks for a specific order). */
  ordered?: boolean;
  /** Column names (aliases) must match the solution's. */
  columnNames?: boolean;
  /** The correct answer is an empty result. */
  allowEmpty?: boolean;
  hints: string[];
  explanation?: Md;
  difficulty?: 1 | 2 | 3;
  dataset?: DatasetId;
}

/** Multiple choice. answer = index (single) or array of indices (multi-select). */
export interface QuizStep {
  type: 'quiz';
  id: string;
  question: Md;
  sql?: string;
  options: string[];
  answer: number | number[];
  explanation: Md;
  dataset?: DatasetId;
}

/** Show a query, ask what it returns (row count, a value, an error...). Learner can run it after answering. */
export interface PredictStep {
  type: 'predict';
  id: string;
  question: Md;
  sql: string;
  options: string[];
  answer: number;
  explanation: Md;
  dataset?: DatasetId;
  /** The query deliberately fails (the right option describes the error). */
  expectError?: boolean;
}

/** SQL with blanks written as ___ (three underscores). answers[i] = accepted values for blank i (case-insensitive). */
export interface FillStep {
  type: 'fill';
  id: string;
  prompt: Md;
  template: string;
  answers: string[][];
  explanation?: Md;
  dataset?: DatasetId;
}

/** Arrange shuffled lines into the correct order (lines are given in the correct order). */
export interface ParsonsStep {
  type: 'parsons';
  id: string;
  prompt: Md;
  lines: string[];
  distractors?: string[];
  explanation?: Md;
  dataset?: DatasetId;
  /** Set false when the assembled lines are not a runnable script. */
  runnable?: boolean;
}

export type VizKind =
  | 'join'
  | 'groupby'
  | 'window'
  | 'execution-order'
  | 'null-logic'
  | 'set-ops'
  | 'index'
  | 'transaction';

/** Interactive built-in visualizer. config is visualizer specific (see docs/AUTHORING.md). */
export interface VizStep {
  type: 'viz';
  viz: VizKind;
  title?: string;
  md?: Md;
  config?: Record<string, unknown>;
}

/** Build a query up clause by clause; each stage runs and shows its intermediate result. */
export interface StepperStep {
  type: 'stepper';
  title: string;
  md?: Md;
  stages: { label: string; md: Md; sql: string }[];
  dataset?: DatasetId;
}

export type Step =
  | ReadStep
  | ExampleStep
  | ExerciseStep
  | QuizStep
  | PredictStep
  | FillStep
  | ParsonsStep
  | VizStep
  | StepperStep;

export type GradedStep = ExerciseStep | QuizStep | PredictStep | FillStep | ParsonsStep;

export interface CheatEntry {
  title: string;
  sql: string;
  note?: string;
}

export interface LessonDef {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  dataset?: DatasetId;
  steps: Step[];
  cheatsheet?: CheatEntry[];
}

/** Test-only questions (never shown in lessons) used by weekly/monthly/module tests. */
export type TestItem = (ExerciseStep | QuizStep | PredictStep | FillStep | ParsonsStep) & {
  lesson: string;
  difficulty: 1 | 2 | 3;
};

export interface ProjectDef {
  id: string;
  title: string;
  icon: string;
  md: Md;
  dataset: DatasetId;
  tasks: ExerciseStep[];
}

export interface ModuleDef {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  icon: string;
  level: Level;
  description: Md;
  dataset: DatasetId;
  lessons: LessonDef[];
  testPool: TestItem[];
  project?: ProjectDef;
}

export type ChallengeDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface ChallengeDef {
  id: string;
  title: string;
  difficulty: ChallengeDifficulty;
  dataset: DatasetId;
  tags: string[];
  /** Module id after which this challenge makes sense. */
  module: string;
  prompt: Md;
  starter?: string;
  solution: string;
  setup?: string;
  check?: string;
  ordered?: boolean;
  columnNames?: boolean;
  allowEmpty?: boolean;
  hints: string[];
  explanation: Md;
}

export interface GlossaryEntry {
  term: string;
  definition: Md;
  example?: string;
  module?: string;
}

export interface DatasetColumn {
  name: string;
  type: string;
  description: string;
}
export interface DatasetTable {
  name: string;
  description: string;
  rowCount: number;
  columns: DatasetColumn[];
}
export interface DatasetInfo {
  id: DatasetId;
  name: string;
  icon: string;
  tagline: string;
  description: string;
  tables: DatasetTable[];
}

/** Lightweight index loaded eagerly. Full modules are lazy-loaded. */
export interface CourseIndex {
  modules: {
    id: string;
    order: number;
    title: string;
    subtitle: string;
    icon: string;
    level: Level;
    description: Md;
    dataset: DatasetId;
    lessons: { id: string; title: string; summary: string; minutes: number; graded: number }[];
    testPoolSize: number;
    project?: { id: string; title: string; icon: string; tasks: number };
  }[];
  challengeCount: number;
  generatedAt: string;
}
