/** Device-free contracts. Fixture proofs never establish real authentication or native seat ownership. */
declare const identifier: unique symbol;
export type LoginId = string & { readonly [identifier]: true };
export function loginId(value: unknown): LoginId {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(value))
    throw new Error("Invalid login identity");
  return value as LoginId;
}
export type SessionSelection = Readonly<{
  id: LoginId;
  generation: string;
  label: string;
  protocol: "wayland";
  desktop: string;
  descriptorPath: string;
  argv: readonly [string, ...string[]];
}>;
export type BrokerReply =
  | Readonly<{ kind: "success" }>
  | Readonly<{ kind: "prompt"; style: "visible" | "secret" | "info" | "error"; message: string }>
  | Readonly<{ kind: "denied" | "error"; message: string }>;
export type BrokerLaunch = Readonly<{ command: readonly string[]; environment: readonly string[] }>;
export type LoginBroker = {
  readonly qualification: "fixture";
  begin(account: string): Promise<BrokerReply>;
  answer(response: string | null): Promise<BrokerReply>;
  start(request: BrokerLaunch): Promise<BrokerReply>;
  cancel(): Promise<BrokerReply>;
  close(): void;
};
export type GreeterIdentity = Readonly<{
  id: LoginId;
  generation: number;
  qualification: "fixture";
}>;
export type UserSessionIdentity = Readonly<{
  id: LoginId;
  generation: number;
  qualification: "fixture";
}>;
export type ReleaseResult<T> =
  | Readonly<{ kind: "released"; identity: T }>
  | Readonly<{ kind: "unresolved"; message: string }>;
export type SessionLifecycleAuthority = {
  readonly qualification: "fixture";
  createGreeter(): Promise<GreeterIdentity>;
  retireGreeter(identity: GreeterIdentity): Promise<ReleaseResult<GreeterIdentity>>;
  observeStarted(
    request: Readonly<{ attemptId: LoginId; selection: SessionSelection }>,
  ): Promise<UserSessionIdentity>;
  cancelLaunch(attemptId: LoginId): Promise<ReleaseResult<LoginId>>;
  retireSession(identity: UserSessionIdentity): Promise<ReleaseResult<UserSessionIdentity>>;
  dispose(): Promise<void>;
};
export type LoginPrompt = Readonly<{
  id: LoginId;
  style: "visible" | "secret" | "info" | "error";
  message: string;
}>;
export type LoginState =
  | Readonly<{ kind: "inactive" }>
  | Readonly<{ kind: "ready"; greeter: GreeterIdentity; message: string }>
  | Readonly<{
      kind: "authenticating";
      attemptId: LoginId;
      selection: SessionSelection;
      account: string;
    }>
  | Readonly<{
      kind: "prompt";
      attemptId: LoginId;
      selection: SessionSelection;
      account: string;
      prompt: LoginPrompt;
    }>
  | Readonly<{
      kind: "retiring-greeter" | "starting-session";
      attemptId: LoginId;
      selection: SessionSelection;
    }>
  | Readonly<{
      kind: "running" | "stopping";
      session: UserSessionIdentity;
      selection: SessionSelection;
    }>
  | Readonly<{ kind: "blocked"; message: string }>;
export type LoginControllerOptions = {
  readonly qualification: "fixture";
  createBroker: () => Promise<LoginBroker>;
  loadSelection: () => Promise<SessionSelection>;
  brokerLaunch: (selection: SessionSelection) => BrokerLaunch;
  lifecycle: SessionLifecycleAuthority;
  consoleRequested: () => boolean;
  timeoutMs?: number;
};
export type BeginLogin = Readonly<{
  greeter: GreeterIdentity;
  account: string;
  sessionId: LoginId;
  catalogGeneration: string;
}>;
export type AnswerLogin = Readonly<{
  attemptId: LoginId;
  promptId: LoginId;
  response: string | null;
}>;
export type LoginController = {
  readonly state: LoginState;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  beginLogin(request: BeginLogin): Promise<void>;
  answerPrompt(request: AnswerLogin): Promise<void>;
  cancelLogin(attemptId: LoginId): Promise<void>;
  logout(identity: UserSessionIdentity): Promise<void>;
  dispose(): Promise<void>;
};
