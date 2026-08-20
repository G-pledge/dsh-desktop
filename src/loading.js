const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

window.dshDesktop.onStatus((t) => {
  statusEl.textContent = t;
});

window.dshDesktop.onLog((t) => {
  logEl.textContent += t;
  logEl.scrollTop = logEl.scrollHeight;
});
