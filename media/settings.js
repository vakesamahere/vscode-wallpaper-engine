const vscode = acquireVsCodeApi();
const SERVER_ROOT = document
  .getElementById("settings-script")
  .getAttribute("data-server-root");

function updateProp(key, val) {
  vscode.postMessage({ command: "updateProp", key, value: val });
}

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
    lbl.innerText = p.text || key;
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
fetch(SERVER_ROOT + "/project.json")
  .then((res) => res.json())
  .then((json) => renderUI(json))
  .catch(
    (e) =>
      (document.getElementById("propsPanel").innerText = "Error: " + e.message)
  );
