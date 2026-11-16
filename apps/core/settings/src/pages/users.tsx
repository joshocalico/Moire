/**
 * Users & Login: your name, picture and password, automatic login, and the other accounts.
 *
 * - **Authorization is the system's.** Changing another account or automatic login makes the
 *   system ask for an administrator's password, in a prompt the compositor draws
 *   (docs/polkit-agent.md). Settings never asks for that password and never sees it: it calls
 *   the service and waits, saying so. A standard user can ask too; an administrator answers.
 * - **A dismissed prompt** comes back as `cancelled` and shows nothing. One the system turned
 *   away without showing it (`refused`: paused after cancels, or too many waiting) says so
 *   calmly beside the control for a few seconds, never as an error.
 * - **The sheets here are data entry and confirmation:** a new name, a new password, "delete?".
 * - Every change goes to a service Settings calls itself (the management service for your own
 *   account, moire-accounts for other accounts, moire-dm-settings for automatic login), so the
 *   prompt names Settings. Their failure sentences are shown as they are.
 */
import React, { useState, type ReactNode } from "react";
import {
  Avatar,
  Box,
  Button,
  Horizontal,
  TextBlock,
  TextField,
  Toggle,
  getUiScaleFactor,
  usePalette,
  type SettingRowSpec,
} from "@moire/ui";
import { formatTimeAgo } from "@moire/app-tools";
import {
  passwordProblem,
  realNameProblem,
  usernameProblem,
  type AccountType,
  type AccountUser,
} from "@moire/system-management/accounts-settings";
import type { SettingsResult } from "@moire/system-management/time-settings";
import type { PageContext } from "#settings/context";
import type { PageContent, SheetContent } from "#settings/model";
import { buttonRow, infoRow, section, selectRow, toggleRow } from "#settings-view/rows";
import { SheetBody } from "#settings-view/sheet-body";

const PAGE = "users";
const FIELD = 34;

function displayName(user: Pick<AccountUser, "realName" | "username">): string {
  return user.realName || user.username;
}

function typeLabel(type: AccountType): string {
  return type === "administrator" ? "Administrator" : "Standard";
}

/**
 * What a failed change says as a failure: the service's sentence. Nothing for a dismissed
 * prompt, and nothing here for a refused one, which the control's own line says
 * (`context.calls.refused`).
 */
function failureText(result: SettingsResult<unknown>): string | null {
  return result.ok || result.code === "cancelled" || result.code === "refused"
    ? null
    : result.message;
}

/**
 * Run an accounts change, closing the sheet when it worked; the service's sentence otherwise.
 * A dismissed password prompt leaves the sheet as it was, with nothing said.
 */
async function change(
  context: PageContext,
  name: string,
  call: () => Promise<SettingsResult<unknown>>,
): Promise<string | null> {
  const result = await context.calls.run(name, call);
  if (result.ok) context.closeSheet();
  return failureText(result);
}

/** Shown while a call that raises the system's password prompt is pending. */
function waitingText(context: PageContext): string {
  return context.accounts.status?.policy.canAdminister === false
    ? "Waiting for an administrator's password"
    : "Waiting for your password";
}

/** What an administrator action will ask for, for someone who isn't one. */
const NEEDS_ADMINISTRATOR = "Needs an administrator's password";

type Field = {
  id: string;
  label: string;
  password?: boolean;
  value?: string;
  problem?: (value: string) => string | null;
};

/**
 * A small form in a sheet: fields, an inline problem under each, the service's failure under
 * the form, and Cancel and the action.
 */
function FormSheet(props: {
  width: number;
  height: number;
  intro?: string;
  fields: readonly Field[];
  action: string;
  /** Said while the submit is pending, for a change that raises the system's password prompt. */
  waiting?: string;
  /** Said, as calmly, when the system turned that prompt away without showing it. */
  paused?: string | null;
  extra?: (values: Record<string, string>, set: (id: string, value: string) => void) => ReactNode;
  submit: (values: Record<string, string>) => Promise<string | null>;
  onCancel: () => void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.fields.map((field) => [field.id, field.value ?? ""])),
  );
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (id: string, value: string) => setValues((current) => ({ ...current, [id]: value }));
  const problems = props.fields.map((field) => field.problem?.(values[field.id] ?? "") ?? null);
  const submit = () => {
    setTried(true);
    if (busy || problems.some(Boolean)) return;
    setBusy(true);
    void props.submit(values).then((message) => {
      setBusy(false);
      setFailure(message);
    });
  };
  const inner = props.width - 32 * ui;
  const introH = props.intro ? 40 * ui : 0;
  const step = (16 + FIELD + 18 + 6) * ui;
  const extraY = introH + props.fields.length * step;
  const extraH = props.extra ? 40 * ui : 0;
  return (
    <Box width={props.width} height={props.height}>
      {props.intro ? (
        <TextBlock
          x={16 * ui}
          width={inner}
          height={introH - 6 * ui}
          text={props.intro}
          fontSize={12}
          color={pal.muted}
          wrap
          maxLines={2}
        />
      ) : null}
      {props.fields.map((field, index) => {
        const y = introH + index * step;
        return (
          <Box key={field.id} x={16 * ui} y={y} width={inner} height={step}>
            <TextBlock
              width={inner}
              height={16 * ui}
              text={field.label}
              fontSize={11}
              color={pal.muted}
              verticalAlign="center"
            />
            <TextField
              y={16 * ui}
              width={inner}
              height={FIELD * ui}
              password={field.password}
              autoFocus={index === 0}
              value={values[field.id] ?? ""}
              invalid={tried && !!problems[index]}
              focusId={`users:field:${field.id}`}
              onChange={(value) => set(field.id, value)}
              onSubmit={submit}
            />
            <TextBlock
              y={(16 + FIELD + 2) * ui}
              width={inner}
              height={16 * ui}
              text={tried ? (problems[index] ?? "") : ""}
              fontSize={11}
              color={pal.danger}
              maxLines={1}
              overflow="ellipsis"
            />
          </Box>
        );
      })}
      {props.extra ? (
        <Box x={16 * ui} y={extraY} width={inner} height={extraH}>
          {props.extra(values, set)}
        </Box>
      ) : null}
      <TextBlock
        x={16 * ui}
        y={extraY + extraH}
        width={inner}
        height={34 * ui}
        text={busy && props.waiting ? props.waiting : (failure ?? props.paused ?? "")}
        fontSize={12}
        color={(busy && props.waiting) || !failure ? pal.muted : pal.danger}
        wrap
        maxLines={2}
      />
      <Horizontal
        x={16 * ui}
        y={extraY + extraH + 40 * ui}
        width={inner}
        height={32 * ui}
        gap={8 * ui}
        justify="end"
      >
        <Button width={92 * ui} height={30 * ui} label="Cancel" onPress={props.onCancel} />
        <Button
          width={120 * ui}
          height={30 * ui}
          label={busy ? "Working…" : props.action}
          variant="primary"
          disabled={busy}
          focusId="users:submit"
          onPress={submit}
        />
      </Horizontal>
    </Box>
  );
}

/** Run a change and report its failure sentence, or null. */
async function run(
  context: PageContext,
  name: string,
  call: () => Promise<SettingsResult<unknown>>,
): Promise<string | null> {
  return failureText(await context.calls.run(name, call));
}

/**
 * Automatic login, for your own account. Shown only where the login daemon supports it
 * (moire-dm). The switch calls moire-dm-settings, and the system asks for an administrator's
 * password before anything changes; until that is answered the switch keeps its old position.
 */
function autologinRow(context: PageContext, standard: boolean): SettingRowSpec | null {
  const login = context.login.status;
  const client = context.login.client;
  if (!login?.available || !client) return null;
  const waiting = context.calls.busy === "autologin";
  // Whose it is comes first: a standard user still sees that another account signs in by itself.
  const description = waiting
    ? waitingText(context)
    : (context.calls.refused("autologin") ??
      (login.enabled
        ? "On · starts without asking for your password"
        : login.user
          ? `On for ${login.user}`
          : standard
            ? NEEDS_ADMINISTRATOR
            : undefined));
  return toggleRow(
    "users.autologin",
    login.enabled,
    (on) => context.attempt(PAGE, () => run(context, "autologin", () => client.setAutologin(on))),
    { description, disabled: waiting },
  );
}

function selfRows(
  context: PageContext,
  self: AccountUser | null,
  standard: boolean,
): SettingRowSpec[] {
  const ui = getUiScaleFactor();
  const system = context.system.user;
  const name = self ? displayName(self) : system.name;
  const login = self?.username ?? system.login;
  const admin = self ? self.accountType === "administrator" : system.administrator;
  const rows: SettingRowSpec[] = [
    {
      id: "users.you",
      label: name,
      description: `${login} · ${admin ? "Administrator" : "Standard account"}`,
      leading: <Avatar name={name} image={self?.iconFile ?? system.picture} size={32} />,
      height: 60,
    },
  ];
  if (!self || !context.accounts.client) return rows;
  rows.push(
    buttonRow("users.name", "Change…", () => context.openSheet(PAGE, "name"), {
      description: name,
      width: 96,
    }),
    {
      id: "users.picture",
      label: "Your picture",
      description: self.iconFile
        ? "Shown on the login screen and here"
        : "Initials until you choose one",
      control: {
        kind: "compact",
        width: 196,
        render: () => (
          <Horizontal width={196 * ui} height={32 * ui} gap={8 * ui} align="center" justify="end">
            {self.iconFile ? (
              <Button
                width={92 * ui}
                height={30 * ui}
                label="Remove"
                variant="ghost"
                focusId="users:picture:remove"
                onPress={() =>
                  context.attempt(PAGE, () =>
                    change(context, "icon", () => context.accounts.client!.setIcon(self.uid, null)),
                  )
                }
              />
            ) : null}
            <Button
              width={96 * ui}
              height={30 * ui}
              label="Choose…"
              focusId="setting:users.picture"
              onPress={() => context.openChooser("avatar")}
            />
          </Horizontal>
        ),
      },
    },
    buttonRow("users.password", "Change…", () => context.openSheet(PAGE, "password"), {
      width: 96,
    }),
  );
  const autologin = autologinRow(context, standard);
  if (autologin) rows.push(autologin);
  return rows;
}

function otherRows(
  context: PageContext,
  users: readonly AccountUser[],
  standard: boolean,
): SettingRowSpec[] {
  const editable = !!context.accounts.client;
  const rows: SettingRowSpec[] = users.map((user) => ({
    id: `user:${user.uid}`,
    label: displayName(user),
    description: [
      user.username,
      typeLabel(user.accountType),
      user.locked ? "Login disabled" : null,
      user.lastLoginMs ? `last in ${formatTimeAgo(user.lastLoginMs)}` : "never logged in",
    ]
      .filter(Boolean)
      .join(" · "),
    leading: <Avatar name={displayName(user)} image={user.iconFile} size={32} />,
    // Named, so focus finds its way back here when the user's sheet closes.
    focusId: `setting:user:${user.uid}`,
    chevron: editable,
    onPress: editable ? () => context.openSheet(PAGE, `user:${user.uid}`) : undefined,
    height: 56,
  }));
  if (editable)
    rows.push({
      id: "users:add",
      focusId: "setting:users:add",
      label: "Add a user…",
      description: standard
        ? `A standard account or an administrator · ${NEEDS_ADMINISTRATOR.toLowerCase()}`
        : "A standard account or an administrator",
      icon: "plus",
      tint: 0xff8a94a6,
      chevron: true,
      onPress: () => context.openSheet(PAGE, "add"),
    });
  return rows;
}

function userSheet(context: PageContext, user: AccountUser, administrators: number): SheetContent {
  const client = context.accounts.client!;
  const lastAdmin = user.accountType === "administrator" && administrators <= 1;
  return {
    title: displayName(user),
    subtitle: `${user.username} · ${typeLabel(user.accountType)}`,
    body: (size) => (
      <SheetBody
        {...size}
        sections={[
          section("account", undefined, [
            selectRow(
              "account-type",
              { width: context.width, height: context.height },
              user.accountType,
              [
                { id: "standard", label: "Standard" },
                { id: "administrator", label: "Administrator" },
              ],
              (type) =>
                context.attempt(PAGE, () =>
                  run(context, "type", () => client.setAccountType(user.uid, type as AccountType)),
                ),
              {
                label: "Account type",
                description:
                  context.calls.busy === "type"
                    ? waitingText(context)
                    : (context.calls.refused("type") ??
                      (lastAdmin
                        ? "The only administrator stays one"
                        : "Administrators can change any account")),
                disabled: lastAdmin || context.calls.busy === "type",
              },
            ),
            infoRow(
              "login",
              "Last login",
              user.lastLoginMs ? formatTimeAgo(user.lastLoginMs) : "Never",
            ),
          ]),
          section("actions", undefined, [
            buttonRow(
              "set-password",
              "Set…",
              () => context.openSheet(PAGE, `user-password:${user.uid}`),
              {
                label: "Password",
                description: `Give ${displayName(user)} a new password`,
                width: 88,
              },
            ),
            lastAdmin
              ? null
              : buttonRow(
                  "delete",
                  "Delete…",
                  () => context.openSheet(PAGE, `delete:${user.uid}`),
                  {
                    label: "Delete account",
                    description: "Remove this account from the computer",
                    variant: "danger",
                    width: 96,
                  },
                ),
          ]),
        ]}
      />
    ),
  };
}

export function usersPage(context: PageContext): PageContent {
  const status = context.accounts.status;
  const self = status?.users.find((user) => user.self) ?? null;
  const others = status?.users.filter((user) => !user.self) ?? [];
  // A standard user's administrator actions are answered by an administrator, at the prompt.
  const standard = status ? !status.policy.canAdminister : !context.system.user.administrator;
  const client = context.accounts.client;
  const administrators =
    status?.users.filter((user) => user.accountType === "administrator").length ?? 0;
  const minimum = status?.policy.minPasswordLength ?? 8;
  const sheets: Record<string, () => SheetContent | null> = {
    name: () =>
      self && client
        ? {
            title: "Your name",
            body: (size) => (
              <FormSheet
                {...size}
                fields={[
                  {
                    id: "name",
                    label: "Full name",
                    value: self.realName,
                    problem: realNameProblem,
                  },
                ]}
                action="Save"
                onCancel={context.closeSheet}
                submit={(values) =>
                  change(context, "name", () => client.setRealName(self.uid, values.name!.trim()))
                }
              />
            ),
          }
        : null,
    password: () =>
      client
        ? {
            title: "Change your password",
            body: (size) => (
              <FormSheet
                {...size}
                intro={`At least ${minimum} characters. You'll use it to log in and to unlock.`}
                fields={[
                  {
                    id: "current",
                    label: "Current password",
                    password: true,
                    problem: (value) => (value ? null : "Enter your current password."),
                  },
                  { id: "next", label: "New password", password: true, problem: passwordProblem },
                  { id: "again", label: "New password again", password: true },
                ]}
                action="Change"
                onCancel={context.closeSheet}
                submit={(values) =>
                  values.next !== values.again
                    ? Promise.resolve("The new passwords don't match.")
                    : change(context, "password", () =>
                        client.changePassword(values.current!, values.next!),
                      )
                }
              />
            ),
          }
        : null,
    add: () =>
      client
        ? {
            title: "Add a user",
            subtitle: standard ? NEEDS_ADMINISTRATOR : undefined,
            body: (size) => (
              <FormSheet
                {...size}
                waiting={waitingText(context)}
                paused={context.calls.refused("create")}
                fields={[
                  { id: "realName", label: "Full name", problem: realNameProblem },
                  { id: "username", label: "Username", problem: usernameProblem },
                  { id: "password", label: "Password", password: true, problem: passwordProblem },
                ]}
                action="Add user"
                extra={(values, set) => (
                  <AdminSwitch
                    on={values.admin === "yes"}
                    onChange={(on) => set("admin", on ? "yes" : "")}
                  />
                )}
                onCancel={context.closeSheet}
                submit={(values) =>
                  change(context, "create", () =>
                    client.createUser({
                      username: values.username!,
                      realName: values.realName!.trim(),
                      password: values.password!,
                      accountType: values.admin === "yes" ? "administrator" : "standard",
                    }),
                  )
                }
              />
            ),
          }
        : null,
  };
  return {
    summary: self
      ? `${displayName(self)} · ${typeLabel(self.accountType)}${others.length ? ` · ${others.length} other ${others.length === 1 ? "user" : "users"}` : ""}`
      : `${context.system.user.name} · ${context.system.user.login}`,
    banners:
      !client || (context.accounts.state && context.accounts.state.kind !== "ready")
        ? [
            {
              id: "accounts",
              title: "Accounts are managed in the system configuration",
              message:
                context.accounts.state && context.accounts.state.kind !== "ready"
                  ? context.accounts.state.message
                  : "The accounts service isn't running, so accounts can't be changed here.",
              tone: "neutral",
              icon: "lock",
            },
          ]
        : undefined,
    sections: [
      section("users.you", "You", selfRows(context, self, standard)),
      status
        ? section("users.others", "Other users", otherRows(context, others, standard))
        : section("users.others", undefined, []),
    ],
    sheet: (id) => {
      const [kind, uid] = id.split(":");
      if (kind && sheets[kind]) return sheets[kind]!();
      const user = others.find((candidate) => String(candidate.uid) === uid);
      if (!user || !client) return null;
      if (kind === "user") return userSheet(context, user, administrators);
      if (kind === "user-password")
        return {
          title: `Password for ${displayName(user)}`,
          body: (size) => (
            <FormSheet
              {...size}
              waiting={waitingText(context)}
              paused={context.calls.refused("set-password")}
              fields={[
                { id: "password", label: "New password", password: true, problem: passwordProblem },
              ]}
              action="Set password"
              onCancel={context.closeSheet}
              submit={(values) =>
                change(context, "set-password", () =>
                  client.setPassword(user.uid, values.password!),
                )
              }
            />
          ),
        };
      if (kind === "delete")
        return {
          title: `Delete ${displayName(user)}?`,
          body: (size) => <DeleteSheet context={context} user={user} {...size} />,
        };
      return null;
    },
  };
}

function AdminSwitch(props: { on: boolean; onChange: (on: boolean) => void }): ReactNode {
  const ui = getUiScaleFactor();
  return (
    <Horizontal height={32 * ui} gap={10 * ui} align="center">
      <Toggle on={props.on} focusId="users:field:admin" onChange={props.onChange} />
      <TextBlock text="Administrator" fontSize={13} verticalAlign="center" />
    </Horizontal>
  );
}

function DeleteSheet(props: {
  context: PageContext;
  user: AccountUser;
  width: number;
  height: number;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [keepHome, setKeepHome] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inner = props.width - 32 * ui;
  const remove = () => {
    if (busy) return;
    setBusy(true);
    void change(props.context, "delete", () =>
      props.context.accounts.client!.deleteUser(props.user.uid, { keepHome }),
    ).then((message) => {
      setBusy(false);
      setFailure(message);
    });
  };
  return (
    <Box width={props.width} height={props.height}>
      <TextBlock
        x={16 * ui}
        width={inner}
        height={36 * ui}
        text={`${displayName(props.user)} won't be able to log in.`}
        fontSize={12}
        color={pal.muted}
        wrap
        maxLines={2}
      />
      <Horizontal
        x={16 * ui}
        y={44 * ui}
        width={inner}
        height={32 * ui}
        gap={10 * ui}
        align="center"
      >
        <Toggle on={keepHome} focusId="users:keep-home" onChange={setKeepHome} />
        <TextBlock
          text={`Keep ${props.user.username}'s files`}
          fontSize={13}
          verticalAlign="center"
        />
      </Horizontal>
      <TextBlock
        x={16 * ui}
        y={84 * ui}
        width={inner}
        height={34 * ui}
        text={
          busy
            ? waitingText(props.context)
            : (failure ?? props.context.calls.refused("delete") ?? "")
        }
        fontSize={12}
        color={busy || !failure ? pal.muted : pal.danger}
        wrap
        maxLines={2}
      />
      <Horizontal
        x={16 * ui}
        y={124 * ui}
        width={inner}
        height={32 * ui}
        gap={8 * ui}
        justify="end"
      >
        <Button
          width={92 * ui}
          height={30 * ui}
          label="Cancel"
          onPress={props.context.closeSheet}
        />
        <Button
          width={120 * ui}
          height={30 * ui}
          label="Delete"
          variant="danger"
          disabled={busy}
          focusId="users:delete"
          onPress={remove}
        />
      </Horizontal>
    </Box>
  );
}
