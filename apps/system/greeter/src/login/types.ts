import type {
  AnswerLogin,
  BeginLogin,
  LoginController,
  LoginId,
  LoginState,
  SessionSelection,
  // oxlint-disable-next-line import/no-relative-parent-imports -- Fixture-only C55 contract has no production package export.
} from "../../../display-manager/src/types";

/** Fixture-only presentation. It cannot authenticate an account or establish a native seat. */
export type GreeterMotionSnapshot = Readonly<{
  reducedMotion: boolean;
  status: "ready" | "saving" | "saved" | "failed";
}>;
export type GreeterMotionPreferences = {
  readonly qualification: "fixture";
  snapshot(): GreeterMotionSnapshot;
  subscribe(listener: () => void): () => void;
  setReducedMotion(value: boolean): Promise<void>;
  dispose(): void;
};
export type LoginUiSnapshot = Readonly<{
  qualification: "fixture";
  state: LoginState;
  selection: SessionSelection;
  motion: GreeterMotionSnapshot;
  active: boolean;
  message: string;
}>;
export type LoginActions = Readonly<{
  begin(request: BeginLogin): Promise<void>;
  answer(request: AnswerLogin): Promise<void>;
  cancel(attemptId: LoginId): Promise<void>;
  saveReducedMotion(value: boolean): Promise<void>;
}>;
export type LoginBindingOptions = Readonly<{
  qualification: "fixture";
  controller: LoginController;
  selection: SessionSelection;
  preferences: GreeterMotionPreferences;
  /** Window owner synchronously removes input and presentation; lifecycle owner verifies closure. */
  retirePresentation: () => void;
}>;
export type LoginBinding = {
  readonly qualification: "fixture";
  readonly actions: LoginActions;
  snapshot(): LoginUiSnapshot;
  subscribe(listener: () => void): () => void;
  /** No controller/authority disposal ownership. This only detaches presentation subscriptions. */
  detach(): void;
  dispose(): void;
};
