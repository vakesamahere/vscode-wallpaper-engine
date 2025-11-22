const vscode = acquireVsCodeApi();
const SERVER_ROOT = document
  .getElementById("settings-script")
  .getAttribute("data-server-root");

function updateProp(key, val) {
  vscode.postMessage({ command: "updateProp", key, value: val });
}

function updateGeneral(key, val) {
  vscode.postMessage({ command: "updateGeneral", key, value: val });
}

// --- Toolbar Handlers ---
document.getElementById("btn-refresh").addEventListener("click", () => {
  vscode.postMessage({ command: "refresh" });
});
document.getElementById("btn-switch").addEventListener("click", () => {
  vscode.postMessage({ command: "switch" });
});
document.getElementById("btn-browser").addEventListener("click", () => {
  vscode.postMessage({ command: "openBrowser" });
});

// --- Server Status Handlers ---
const httpStatusEl = document.getElementById("http-status");
const wsStatusEl = document.getElementById("ws-status");

async function checkHTTP() {
  httpStatusEl.innerText = "Checking...";
  httpStatusEl.style.color = "orange";
  try {
    const start = Date.now();
    const res = await fetch(SERVER_ROOT + "/ping");
    const ms = Date.now() - start;
    if (res.ok || res.status === 205) {
      httpStatusEl.innerText = `OK (${ms}ms)`;
      httpStatusEl.style.color = "#4caf50";
    } else {
      httpStatusEl.innerText = `Error ${res.status}`;
      httpStatusEl.style.color = "red";
    }
  } catch (e) {
    httpStatusEl.innerText = "Failed";
    httpStatusEl.style.color = "red";
  }
}

function checkWS() {
  wsStatusEl.innerText = "Connecting...";
  wsStatusEl.style.color = "orange";
  try {
    const wsUrl = SERVER_ROOT.replace("http", "ws");
    const ws = new WebSocket(wsUrl);
    const start = Date.now();

    ws.onopen = () => {
      const ms = Date.now() - start;
      wsStatusEl.innerText = `Connected (${ms}ms)`;
      wsStatusEl.style.color = "#4caf50";
      ws.close();
    };

    ws.onerror = () => {
      wsStatusEl.innerText = "Error";
      wsStatusEl.style.color = "red";
    };
  } catch (e) {
    wsStatusEl.innerText = "Exception";
    wsStatusEl.style.color = "red";
  }
}

document.getElementById("btn-test-http").addEventListener("click", checkHTTP);
document.getElementById("btn-test-ws").addEventListener("click", checkWS);
document.getElementById("btn-stop-server").addEventListener("click", () => {
  vscode.postMessage({ command: "stopServer" });
  httpStatusEl.innerText = "Stopped";
  httpStatusEl.style.color = "red";
  wsStatusEl.innerText = "Stopped";
  wsStatusEl.style.color = "red";
});

// Initial check
setTimeout(() => {
  checkHTTP();
  checkWS();
}, 1000);

// --- Search Handler ---
document.getElementById("search-input").addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase();
  const items = document.querySelectorAll("#propsPanel .control-item");
  items.forEach((item) => {
    const text = item.innerText.toLowerCase();
    if (text.includes(term)) {
      item.classList.remove("hidden");
    } else {
      item.classList.add("hidden");
    }
  });
});

function getSafeValue(p) {
  if (p.value !== undefined && p.value !== null) {
    return p.value;
  }
  if (p.default !== undefined && p.default !== null) {
    return p.default;
  }
  if (p.type === "color") {
    return "1 1 1";
  }
  if (p.type === "slider") {
    return p.min || 0;
  }
  if (p.type === "bool") {
    return false;
  }
  if (p.type === "combo") {
    return (p.options && p.options[0] && p.options[0].value) || "";
  }
  return "";
}

function weColorToHex(str) {
  if (!str || typeof str !== "string") {
    return "#ffffff";
  }
  const parts = str.split(" ").map(parseFloat);
  if (parts.length < 3) {
    return "#ffffff";
  }
  const toHex = (n) => {
    const hex = Math.floor(Math.min(1, Math.max(0, n)) * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return "#" + toHex(parts[0]) + toHex(parts[1]) + toHex(parts[2]);
}

function renderGeneralSettings() {
  const panel = document.getElementById("generalPanel");
  panel.innerHTML = "";

  // Audio Source Select
  const audioDiv = document.createElement("div");
  audioDiv.className = "control-item";
  const audioLbl = document.createElement("label");
  audioLbl.innerText = "Audio Source";
  audioDiv.appendChild(audioLbl);

  const audioSelect = document.createElement("select");
  const audioOptions = [
    { value: "simulate", label: "Simulate (Sine Wave)" },
    { value: "mic", label: "Microphone (Real Audio)" },
    { value: "system", label: "System Audio (Screen Share)" },
    { value: "off", label: "Off (Silence)" },
  ];
  audioOptions.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.innerText = opt.label;
    audioSelect.appendChild(o);
  });
  audioSelect.value = "off"; // Default
  audioSelect.onchange = (e) => updateGeneral("audioSource", e.target.value);
  audioDiv.appendChild(audioSelect);
  panel.appendChild(audioDiv);

  const generalProps = [
    {
      key: "audioVolume",
      label: "Audio Volume (0-100)",
      type: "slider",
      min: 0,
      max: 100,
      value: 50,
    },
  ];

  generalProps.forEach((p) => {
    const div = document.createElement("div");
    div.className = "control-item";
    const lbl = document.createElement("label");
    lbl.innerText = p.label;
    div.appendChild(lbl);

    let input;
    if (p.type === "slider") {
      const valSpan = document.createElement("span");
      valSpan.innerText = p.value;
      lbl.appendChild(valSpan);
      input = document.createElement("input");
      input.type = "range";
      input.min = p.min;
      input.max = p.max;
      input.value = p.value;
      input.oninput = (e) => {
        valSpan.innerText = e.target.value;
        updateGeneral(p.key, parseFloat(e.target.value));
      };
    } else if (p.type === "bool") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = p.value;
      input.onchange = (e) => updateGeneral(p.key, e.target.checked);
    }

    if (input) {
      div.appendChild(input);
      panel.appendChild(div);
    }
  });
}

function renderUI(json) {
  const panel = document.getElementById("propsPanel");
  panel.innerHTML = "";
  const props =
    json.properties || (json.general && json.general.properties) || {};

  Object.keys(props).forEach((key) => {
    const p = props[key];
    const safeVal = getSafeValue(p);

    const div = document.createElement("div");
    div.className = "control-item";
    const lbl = document.createElement("label");
    // Use innerHTML to render HTML tags in labels
    lbl.innerHTML = p.text || key;
    div.appendChild(lbl);

    let input;
    if (p.type === "slider") {
      const valSpan = document.createElement("span");
      valSpan.innerText = safeVal;
      lbl.appendChild(valSpan);
      input = document.createElement("input");
      input.type = "range";
      input.min = p.min ?? 0;
      input.max = p.max ?? 100;
      input.step = p.step ?? 1;
      input.value = safeVal;
      input.oninput = (e) => {
        let v = parseFloat(e.target.value);
        if (p.step % 1 !== 0) {
          v = parseFloat(v.toFixed(2));
        }
        valSpan.innerText = v;
        updateProp(key, v);
      };
    } else if (p.type === "color") {
      input = document.createElement("input");
      input.type = "color";
      input.value = weColorToHex(safeVal);
      input.oninput = (e) => {
        const h = e.target.value;
        const r = parseInt(h.substr(1, 2), 16) / 255;
        const g = parseInt(h.substr(3, 2), 16) / 255;
        const b = parseInt(h.substr(5, 2), 16) / 255;
        updateProp(key, `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`);
      };
    } else if (p.type === "bool") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = safeVal;
      input.onchange = (e) => updateProp(key, e.target.checked);
    } else if (p.type === "combo") {
      input = document.createElement("select");
      (p.options || []).forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt.value;
        o.innerText = opt.label;
        if (opt.value === safeVal) {
          o.selected = true;
        }
        input.appendChild(o);
      });
      input.onchange = (e) => updateProp(key, e.target.value);
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.value = safeVal;
      input.onchange = (e) => updateProp(key, e.target.value);
    }

    if (input) {
      div.appendChild(input);
      panel.appendChild(div);
    }
  });
}

console.log("Settings Webview Loaded");
renderGeneralSettings(); // Render general settings immediately
fetch(SERVER_ROOT + "/project.json")
  .then((res) => res.json())
  .then((json) => renderUI(json))
  .catch(
    (e) =>
      (document.getElementById("propsPanel").innerText = "Error: " + e.message)
  );
