/* ─── RENDERER ────────────────────────────────────────────────────────
   Owns the presentation. Knows nothing about editing or the text model.

   renderBlock(div, ast, isRaw) → styled DOM  (or raw text if editing)
   renderBody(body, model, activeIndex) → full document DOM

   When rendering in "styled" mode, the renderer builds a mapping array:
     [ { el, rawStart, rawEnd }, ... ]
   This lets the engine map a DOM cursor position back to a raw-text
   offset when the user clicks into a rendered block. */

function renderBlock(div, ast, isRaw) {
  div.className = "";
  div.removeAttribute("data-raw");

  if (isRaw) {
    div.textContent = ast.raw;
    div.classList.add("md-raw");
    div._mapping = null;
    return;
  }

  switch (ast.type) {
    case "heading":
      div.classList.add("md-h" + ast.level);
      renderInline(div, ast.content);
      break;
    case "quote":
      div.classList.add("md-quote");
      renderInline(div, ast.content);
      break;
    case "divider":
      div.classList.add("md-divider");
      div.appendChild(document.createElement("hr"));
      break;
    case "codeblock":
      div.classList.add("md-codeblock");
      const pre = document.createElement("pre");
      pre.textContent = ast.raw;
      div.appendChild(pre);
      break;
    case "list":
      div.classList.add("md-li");
      renderInline(div, ast.content);
      break;
    case "numbered":
      div.classList.add("md-li", "md-num");
      div.dataset.num = ast.num;
      renderInline(div, ast.content);
      break;
    case "checklist":
      div.classList.add("md-li", "md-check");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = ast.checked;
      cb.disabled = true;
      div.appendChild(cb);
      renderInline(div, ast.content);
      break;
    case "paragraph":
    default:
      div.classList.add("md-p");
      renderInline(div, ast.content);
      break;
  }
}

function renderInline(container, nodes) {
  const mapping = [];
  for (const n of nodes) {
    let el;
    if (n.type === "text") {
      el = document.createTextNode(n.text);
    } else if (n.type === "bold") {
      el = document.createElement("strong");
      el.textContent = n.text;
    } else if (n.type === "italic") {
      el = document.createElement("em");
      el.textContent = n.text;
    } else if (n.type === "strike") {
      el = document.createElement("s");
      el.textContent = n.text;
    } else if (n.type === "code") {
      el = document.createElement("code");
      el.textContent = n.text;
    }
    container.appendChild(el);
    // Every node gets a mapping entry so cursor utilities can map
    // any text node back to its raw-text offset, including plain
    // text that sits between formatted elements.
    mapping.push({ el, rawStart: n.rawStart, rawEnd: n.rawEnd });
  }
  container._mapping = mapping;
}

/* Rebuild the entire body from the model. */
function renderBody(body, model, activeIndex) {
  body.innerHTML = "";
  for (let i = 0; i < model.blockCount(); i++) {
    const div = document.createElement("div");
    body.appendChild(div);
    const text = model.getBlock(i);
    const ast = parseBlock(text);
    renderBlock(div, ast, i === activeIndex);
  }
}
