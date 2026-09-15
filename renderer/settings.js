async function boot() {
  const prefs = await window.rim.prefs();
  const list = await window.rim.providers();
  const disabled = new Set(prefs.disabled || []);

  document.querySelectorAll("[data-edge]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.edge === prefs.edge);
    btn.onclick = () => window.rim.setPrefs({ edge: btn.dataset.edge }).then(boot);
  });

  for (const id of ["collapsed", "hideOnFullscreen"]) {
    const el = document.getElementById(id);
    el.checked = !!prefs[id];
    el.onchange = () => window.rim.setPrefs({ [id]: el.checked });
  }

  const box = document.getElementById("providers");
  box.innerHTML = "";
  for (const provider of list) {
    const label = document.createElement("label");
    label.className = "row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !disabled.has(provider.id);
    input.onchange = () => {
      const next = new Set(disabled);
      if (input.checked) next.delete(provider.id);
      else next.add(provider.id);
      window.rim.setPrefs({ disabled: [...next] });
    };
    label.append(input, document.createTextNode(provider.displayName));
    box.append(label);
  }
}

boot();
