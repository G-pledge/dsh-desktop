import { EventEmitter } from "node:events";

function decideOld({ isCurrent, restarting, quitting, ready }) {
  if (restarting || quitting) return "ignore";
  if (!ready) return "fail-start";
  return "quit-app";
}

function decideNew({ isCurrent, restarting, quitting, updating, ready }) {
  if (quitting) return "ignore";
  if (!ready) return isCurrent ? "fail-start" : "ignore";
  if (!isCurrent || restarting || updating) return "ignore";
  return "quit-app";
}

function simulate(decide) {
  let child;
  let restarting = false;
  let quitting = false;
  let updating = false;
  let quit = false;

  function attach(proc, ready) {
    proc.on("exit", () => {
      const isCurrent = child === proc;
      if (isCurrent) child = null;
      const action = decide({ isCurrent, restarting, quitting, updating, ready });
      if (action === "quit-app") {
        quitting = true;
        quit = true;
      }
    });
  }

  const oldProc = new EventEmitter();
  oldProc.pid = 1;
  child = oldProc;
  attach(oldProc, true);

  updating = true;
  restarting = true;
  child = null;
  queueMicrotask(() => oldProc.emit("exit", 1));

  const newProc = new EventEmitter();
  newProc.pid = 2;
  child = newProc;
  restarting = false;
  attach(newProc, false);

  return new Promise((resolve) => queueMicrotask(() => resolve(quit)));
}

const crash = { isCurrent: false, restarting: false, quitting: false, updating: true, ready: true };
if (decideOld(crash) !== "quit-app") {
  console.error("old policy should quit on stale exit");
  process.exit(1);
}
if (decideNew(crash) !== "ignore") {
  console.error("new policy should ignore stale exit");
  process.exit(1);
}
const newFail = { isCurrent: true, restarting: false, quitting: false, updating: true, ready: false };
if (decideNew(newFail) !== "fail-start") {
  console.error("new policy should still fail the update start");
  process.exit(1);
}

const quitOld = await simulate(decideOld);
if (!quitOld) {
  console.error("expected old policy to quit");
  process.exit(1);
}
const quitNew = await simulate(decideNew);
if (quitNew) {
  console.error("stale exit still quits the app");
  process.exit(1);
}
console.log("ok");
