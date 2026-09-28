/**
 * GM-delegated actions. Players cannot update world settings or documents they
 * don't own, so such requests are relayed to the active GM via the system socket.
 */
import { SYSTEM_ID } from "../config.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
const handlers = new Map();
const pending = new Map();

/** Register a GM-side handler. */
export function registerGMHandler(name, fn) {
  handlers.set(name, fn);
}

export function initSocket() {
  game.socket.on(CHANNEL, async (msg) => {
    if (msg?.type === "response") {
      const p = pending.get(msg.id);
      if (p && msg.to === game.user.id) {
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
      }
      return;
    }
    if (msg?.type !== "request") return;
    if (game.users.activeGM?.id !== game.user.id) return;
    const fn = handlers.get(msg.name);
    let result = null, error = null;
    try { result = fn ? await fn(msg.data, game.users.get(msg.from)) : null; }
    catch (err) { console.error(err); error = err.message; }
    game.socket.emit(CHANNEL, { type: "response", id: msg.id, to: msg.from, result, error });
  });
}

/**
 * Run a named action as GM. Runs locally if the current user is the active GM.
 * @returns {Promise<any>}
 */
export async function asGM(name, data = {}) {
  const fn = handlers.get(name);
  if (game.user.isGM || !game.users.activeGM) {
    if (!game.user.isGM && !game.users.activeGM) {
      ui.notifications.warn("LAUNDRY.Notify.NoGM", { localize: true });
      return null;
    }
    return fn?.(data, game.user);
  }
  const id = foundry.utils.randomID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    game.socket.emit(CHANNEL, { type: "request", id, name, data, from: game.user.id });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error("GM did not respond")); }
    }, 15000);
  });
}

/** Update any document: directly if permitted, otherwise via GM. */
export async function updateDocument(doc, data, options = {}) {
  if (doc.isOwner) return doc.update(data, options);
  return asGM("updateDocument", { uuid: doc.uuid, data, options });
}

registerGMHandler("updateDocument", async ({ uuid, data, options }) => {
  const doc = await fromUuid(uuid);
  return doc?.update(data, options) ? true : false;
});
