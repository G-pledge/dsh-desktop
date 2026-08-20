const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

window.dshDesktop.onStatus((text) => {
  statusEl.textContent = text;
});

window.dshDesktop.onLog((text) => {
  logEl.textContent += text;
  logEl.scrollTop = logEl.scrollHeight;
});
