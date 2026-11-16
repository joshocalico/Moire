/**
 * A fake AccountsService (`org.freedesktop.Accounts`) on a private bus, for the accounts smokes.
 * Every change is recorded with its caller and D-Bus flags; arguments are kept so a smoke can
 * check that no plaintext password arrives.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DbusRemoteError, variant, type DbusVariant, type SessionBus } from "@moire/dbus";

const ACCOUNTS = "org.freedesktop.Accounts";
export const ACCOUNTS_ROOT = "/org/freedesktop/Accounts";
const USER = `${ACCOUNTS}.User`;

type FakeUser = { path: string; props: Record<string, DbusVariant> };
export type AccountCall = {
  member: string;
  path: string;
  body: unknown[];
  flags: number;
  sender: string;
};

export function fakeUser(
  uid: number,
  name: string,
  real: string,
  type: number,
  extra: Record<string, DbusVariant> = {},
): FakeUser {
  return {
    path: `${ACCOUNTS_ROOT}/User${uid}`,
    props: {
      Uid: variant("t", BigInt(uid)),
      UserName: variant("s", name),
      RealName: variant("s", real),
      AccountType: variant("i", type),
      IconFile: variant("s", ""),
      Locked: variant("b", false),
      LoginTime: variant("x", uid === 1000 ? 1_790_000_000n : 0n),
      SystemAccount: variant("b", false),
      LocalAccount: variant("b", true),
      Shell: variant("s", "/run/current-system/sw/bin/bash"),
      ...extra,
    },
  };
}

export async function startFakeAccounts(bus: SessionBus, iconDirectory: string) {
  const users = new Map<number, FakeUser>();
  const calls: AccountCall[] = [];
  let nextUid = 1002;
  /** The next SetPassword fails (for the add-user rollback). */
  let failPassword = false;
  const record = (member: string, objectPath: string, context: Context) =>
    calls.push({
      member,
      path: objectPath,
      body: context.body,
      flags: context.message.flags ?? 0,
      sender: context.message.sender ?? "",
    });
  type Context = { body: unknown[]; message: { flags?: number; sender?: string } };
  const exportUser = (user: FakeUser) => {
    users.set(Number(user.props.Uid!.value), user);
    bus.exportObject(user.path, {
      name: "org.freedesktop.DBus.Properties",
      methods: {
        GetAll: {
          inSignature: "s",
          outSignature: "a{sv}",
          handler: ({ body }) => {
            assert.equal(body[0], USER);
            return { body: [user.props] };
          },
        },
      },
    });
    const setter = (member: string, signature: string, apply: (body: unknown[]) => void) => ({
      inSignature: signature,
      outSignature: "",
      handler: (context: Context) => {
        record(member, user.path, context);
        apply(context.body);
        return {};
      },
    });
    bus.exportObject(user.path, {
      name: USER,
      methods: {
        SetRealName: setter("SetRealName", "s", ([name]) => {
          user.props.RealName = variant("s", name);
        }),
        SetIconFile: setter("SetIconFile", "s", ([file]) => {
          // AccountsService copies the file into its own store.
          const stored = file
            ? path.join(iconDirectory, `icon-${String(user.props.UserName!.value)}`)
            : "";
          if (file) fs.copyFileSync(String(file), stored);
          user.props.IconFile = variant("s", stored);
        }),
        SetAccountType: setter("SetAccountType", "i", ([type]) => {
          user.props.AccountType = variant("i", type);
        }),
        SetPassword: setter("SetPassword", "ss", () => {
          if (failPassword) {
            failPassword = false;
            throw new DbusRemoteError(`${ACCOUNTS}.Error.Failed`, "chpasswd: detail");
          }
        }),
      },
    });
  };
  bus.exportObject(ACCOUNTS_ROOT, {
    name: ACCOUNTS,
    methods: {
      ListCachedUsers: {
        inSignature: "",
        outSignature: "ao",
        // Like AccountsService, the cache can miss someone who never signed in through a DM.
        handler: () => ({
          body: [
            [...users.values()]
              .filter((user) => user.path !== `${ACCOUNTS_ROOT}/User1000`)
              .map((user) => user.path),
          ],
        }),
      },
      FindUserById: {
        inSignature: "x",
        outSignature: "o",
        handler: ({ body }) => {
          const user = users.get(Number(body[0]));
          if (!user) throw new DbusRemoteError(`${ACCOUNTS}.Error.UserDoesNotExist`, "none");
          return { body: [user.path] };
        },
      },
      CreateUser: {
        inSignature: "ssi",
        outSignature: "o",
        handler: (context) => {
          record("CreateUser", ACCOUNTS_ROOT, context);
          const { body } = context;
          if ([...users.values()].some((user) => user.props.UserName!.value === body[0]))
            throw new DbusRemoteError(`${ACCOUNTS}.Error.UserExists`, "exists");
          const user = fakeUser(nextUid++, String(body[0]), String(body[1]), Number(body[2]));
          exportUser(user);
          return { body: [user.path] };
        },
      },
      DeleteUser: {
        inSignature: "xb",
        outSignature: "",
        handler: (context) => {
          record("DeleteUser", ACCOUNTS_ROOT, context);
          users.delete(Number(context.body[0]));
          return {};
        },
      },
    },
  });
  assert.equal(await bus.requestName(ACCOUNTS), 1);
  return {
    users,
    calls,
    exportUser,
    failNextPassword() {
      failPassword = true;
    },
  };
}
