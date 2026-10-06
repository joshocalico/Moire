/** Public account metadata only. PAM remains the authority for login eligibility. */
export type LocalLoginUser = Readonly<{
  uid: bigint;
  username: string;
  displayName: string;
}>;
export interface LocalUserProvider {
  /** Fresh metadata; callers must discard results after cancellation or replacement. */
  list(signal: AbortSignal): Promise<readonly LocalLoginUser[]>;
}
