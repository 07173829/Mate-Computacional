(function(){
  "use strict";

  const LETTERS = "ABCDEFGHIJKLMNO".split("");

  const state = {
    n: 6,
    mode: "auto",
    builtMode: null, // modo con el que se construyó la matriz actual
    current: 1,      // pantalla visible
    W: 900, H: 500,  // tamaño del lienzo SVG (depende de la distribución en capas)
    layerOf: [],     // capa (columna) de cada vértice
    matrix: [],     // n x n, 0 = sin arista
    pos: [],        // {x,y} per vertex for layout
    dijkstra: null, // result of last run
    caso: null,     // caso real cargado (null si la matriz es aleatoria o manual)
    names: null,    // nombre de cada vértice (solo en un caso real)
    unit: "unidades"
  };

  // Números: los pesos pueden ser decimales (p. ej. 2.5 min); se muestran con
  // hasta 2 decimales para evitar ruido de coma flotante (0.1 + 0.2).
  const EPS = 1e-9;
  function fmt(x){
    if(x === Infinity) return "∞";
    return String(Math.round(x * 100) / 100);
  }
  // Interpreta el texto de una celda: "" = 0; acepta coma o punto decimal.
  function parseWeight(txt){
    const t = String(txt).trim().replace(",", ".");
    if(t === "") return 0;
    if(!/^\d+(\.\d+)?$/.test(t)) return NaN;
    return Math.round(Number(t) * 100) / 100;
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function clearCase(){
    state.caso = null; state.names = null; state.unit = "unidades";
  }

  // ---------- Navigation ----------
  function showScreen(num, pushHistory){
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("visible"));
    document.getElementById("screen-"+num).classList.add("visible");
    document.querySelectorAll(".stepper .tab").forEach(t => {
      const step = parseInt(t.dataset.step, 10);
      t.classList.toggle("active", step === num);
      t.classList.toggle("done", step < num);
      t.setAttribute("role","button");
      t.tabIndex = step === num ? -1 : 0;
    });
    if(num !== 3) stopPlaying();
    state.current = num;
    window.scrollTo(0, 0);
    if(pushHistory !== false){
      try{ history.pushState({step:num}, ""); }catch(e){ /* entorno sin historial: se ignora */ }
    }
  }

  // Pestañas del encabezado: ir a cualquier paso. Avanzar hace lo mismo que
  // los botones "Continuar" y "Generar grafo", con las mismas validaciones.
  document.querySelectorAll(".stepper .tab").forEach(tab => {
    const go = () => {
      const step = parseInt(tab.dataset.step, 10);
      if(step === state.current) return;
      if(step < state.current){ showScreen(step); return; }
      if(state.current === 1 && !goToMatrix()) return;
      if(step === 3) goToGraph();
    };
    tab.addEventListener("click", go);
    tab.addEventListener("keydown", ev => {
      if(ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); go(); }
    });
  });

  // Botón "Atrás" del navegador
  window.addEventListener("popstate", ev => {
    let step = (ev.state && ev.state.step) || 1;
    if(step >= 2 && state.matrix.length === 0) step = 1;
    if(step === 3){
      computeLayout();
      buildGraphScreen();
    }
    showScreen(step, false);
  });
  try{ history.replaceState({step:1}, ""); }catch(e){}

  function showError(id, msg){
    const el = document.getElementById(id);
    if(!msg){ el.classList.remove("show"); el.textContent=""; return; }
    el.textContent = msg;
    el.classList.add("show");
  }

  // ---------- Screen 1: config ----------
  document.querySelectorAll(".choice-card").forEach(card => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".choice-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      state.mode = card.dataset.mode;
    });
  });

  document.querySelectorAll(".choice-card").forEach(card => {
    card.setAttribute("role", "button"); card.tabIndex = 0;
    card.addEventListener("keydown", ev => {
      if(ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); card.click(); }
    });
  });

  document.getElementById("btnToMatrix").addEventListener("click", goToMatrix);

  function goToMatrix(){
    const raw = document.getElementById("nInput").value.trim();
    const n = Number(raw);
    if(raw === "" || !Number.isInteger(n) || n < 5 || n > 15){
      showError("errorConfig", "El número de vértices debe ser un entero entre 5 y 15.");
      showScreen(1);
      return false;
    }
    showError("errorConfig", null);
    const sameSetup = state.matrix.length === n && state.builtMode === state.mode;
    state.n = n;
    if(!sameSetup){
      clearCase();
      initMatrix();
      state.builtMode = state.mode;
    }
    buildMatrixScreen();
    showScreen(2);
    return true;
  }

  // Caso real precargado (ver casos.js)
  function loadCase(caso){
    state.n = caso.matriz.length;
    state.matrix = caso.matriz.map(r => r.slice());
    state.caso = caso;
    state.names = caso.nombres.slice();
    state.unit = caso.unidad;
    state.builtMode = "case";
    document.getElementById("nInput").value = state.n;
    showError("errorConfig", null);
    buildMatrixScreen();
    showScreen(2);
  }
  document.getElementById("btnLoadCase").addEventListener("click", () => {
    if(window.CASOS && window.CASOS.length) loadCase(window.CASOS[0]);
  });

  document.getElementById("btnBackConfig").addEventListener("click", () => showScreen(1));
  document.getElementById("btnBackMatrix").addEventListener("click", () => showScreen(2));
  document.getElementById("btnBackConfig3").addEventListener("click", () => showScreen(1));

  // ---------- Matrix generation ----------
  function initMatrix(){
    const n = state.n;
    const m = Array.from({length:n}, () => Array(n).fill(0));
    state.matrix = m;
    if(state.mode === "auto") randomizeMatrix();
  }

  function randomWeight(){ return Math.floor(Math.random()*19) + 1; } // 1..19

  function shuffle(arr){
    const a = arr.slice();
    for(let i=a.length-1; i>0; i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Genera un grafo "por capas": A al inicio, el último vértice al final y,
  // entre ellos, columnas de vértices conectadas solo con la columna vecina.
  // Así el dibujo queda ordenado de izquierda a derecha y sin cruces absurdos.
  function randomizeMatrix(){
    const n = state.n;
    const k = n <= 6 ? 3 : n <= 9 ? 4 : n <= 12 ? 5 : 6;   // número de columnas
    const mids = k - 2, rest = n - 2;
    const base = Math.floor(rest / mids), extra = rest % mids;
    const order = shuffle([...Array(mids).keys()]);
    const sizes = [1];
    for(let l=0; l<mids; l++) sizes.push(base + (order[l] < extra ? 1 : 0));
    sizes.push(1);

    const layers = []; let id = 0;
    sizes.forEach(sz => { const L = []; for(let q=0;q<sz;q++) L.push(id++); layers.push(L); });

    const m = Array.from({length:n}, () => Array(n).fill(0));
    const link = (a, b) => { const w = randomWeight(); m[a][b] = w; m[b][a] = w; };

    for(let l=1; l<k; l++){
      const prev = layers[l-1], cur = layers[l];
      // cada vértice se conecta con 1 a 3 vértices de la columna anterior
      cur.forEach(v => {
        const r = Math.random();
        const cnt = Math.min(prev.length, r < 0.5 ? 1 : r < 0.85 ? 2 : 3);
        shuffle(prev).slice(0, cnt).forEach(u => link(u, v));
      });
      // y ningún vértice queda sin salida hacia la columna siguiente
      prev.forEach(u => {
        if(!cur.some(v => m[u][v] > 0)) link(u, cur[Math.floor(Math.random()*cur.length)]);
      });
    }

    // Renumerar para que las letras sigan el dibujo: izquierda→derecha, arriba→abajo
    const ordered = orderLayers(layers, m);
    const newId = new Array(n); let c = 0;
    ordered.forEach(L => L.forEach(v => { newId[v] = c++; }));
    const out = Array.from({length:n}, () => Array(n).fill(0));
    for(let i=0;i<n;i++) for(let j=0;j<n;j++) if(m[i][j] > 0) out[newId[i]][newId[j]] = m[i][j];
    state.matrix = out;
  }

  // ---------- Screen 2: matrix UI ----------
  function buildMatrixScreen(){
    const n = state.n;
    const isManual = state.mode === "manual";
    const caso = state.caso;
    document.getElementById("matrixTitle").textContent = caso
      ? `Caso real: ${caso.titulo}`
      : isManual ? "Ingreso manual de la matriz" : "Matriz generada automáticamente";
    document.getElementById("matrixHint").textContent = caso
      ? `Matriz de tiempos (${caso.unidad}) entre los ${n} puntos del caso (0 = sin conexión directa). Pasa el mouse sobre una letra para ver el nombre del punto. Puedes editar cualquier peso.`
      : isManual
        ? "Ingresa el peso de cada arista (0 = sin conexión). El grafo es no dirigido: al llenar una celda, su simétrica se completa sola."
        : "Estos son los pesos generados aleatoriamente. Puedes editarlos manualmente o regenerarlos.";
    document.getElementById("btnRegenerate").style.display = (isManual || caso) ? "none" : "inline-block";

    const info = document.getElementById("caseInfo");
    if(caso){
      info.innerHTML = `<h3 class="with-ic"><svg class="ic" aria-hidden="true"><use href="#i-ambulance"/></svg> ${escapeHtml(caso.titulo)}</h3><p>${escapeHtml(caso.resumen)}</p><p class="assume"><b>Supuestos:</b> ${escapeHtml(caso.supuestos)}</p>`;
      info.classList.add("show");
    } else {
      info.innerHTML = ""; info.classList.remove("show");
    }
    document.getElementById("pastePanel").classList.remove("show");

    const th = i => state.names
      ? `<th title="${escapeHtml(state.names[i])}">${LETTERS[i]}</th>`
      : `<th>${LETTERS[i]}</th>`;
    const wrap = document.getElementById("matrixWrap");
    let html = "<table class='matrix'><thead><tr><th></th>";
    for(let j=0;j<n;j++) html += th(j);
    html += "</tr></thead><tbody>";
    for(let i=0;i<n;i++){
      html += `<tr>${th(i)}`;
      for(let j=0;j<n;j++){
        if(i===j){
          html += `<td class="diag"></td>`;
        } else {
          const val = state.matrix[i][j];
          html += `<td><input type="text" inputmode="decimal" autocomplete="off" aria-label="Peso ${LETTERS[i]}-${LETTERS[j]}" data-i="${i}" data-j="${j}" value="${fmt(val)}"></td>`;
        }
      }
      html += "</tr>";
    }
    html += "</tbody></table>";
    wrap.innerHTML = html;

    wrap.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("input", () => {
        const i = parseInt(inp.dataset.i,10), j = parseInt(inp.dataset.j,10);
        const mirror = wrap.querySelector(`input[data-i="${j}"][data-j="${i}"]`);
        const v = parseWeight(inp.value);
        const bad = isNaN(v);
        inp.classList.toggle("invalid", bad);
        if(mirror){ mirror.classList.toggle("invalid", bad); mirror.value = inp.value; }
        if(bad) return;            // el valor anterior se conserva hasta corregirlo
        state.matrix[i][j] = v;
        state.matrix[j][i] = v;
        if(!document.querySelector("#matrixWrap input.invalid")) showError("errorMatrix", null);
      });
    });
  }

  document.getElementById("btnClear").addEventListener("click", () => {
    state.matrix = Array.from({length: state.n}, () => Array(state.n).fill(0));
    showError("errorMatrix", null);
    buildMatrixScreen();
  });

  document.getElementById("btnRegenerate").addEventListener("click", () => {
    randomizeMatrix();
    buildMatrixScreen();
  });

  // ---------- Pegar matriz (desde Excel o texto) ----------
  document.getElementById("btnPaste").addEventListener("click", () => {
    const panel = document.getElementById("pastePanel");
    const area = document.getElementById("pasteArea");
    area.value = state.matrix.map(r => r.map(fmt).join("\t")).join("\n");
    panel.classList.add("show");
    area.focus(); area.select();
  });
  document.getElementById("btnPasteCancel").addEventListener("click", () => {
    document.getElementById("pastePanel").classList.remove("show");
    showError("errorMatrix", null);
  });
  document.getElementById("btnPasteApply").addEventListener("click", () => {
    const res = parseMatrix(document.getElementById("pasteArea").value, state.n);
    if(res.error){ showError("errorMatrix", res.error); return; }
    showError("errorMatrix", null);
    state.matrix = res.matrix;
    buildMatrixScreen();
  });

  function parseMatrix(text, n){
    const rows = text.trim().split(/\r?\n/).map(r => r.trim()).filter(r => r.length);
    if(rows.length !== n) return { error: `Se esperaban ${n} filas y se pegaron ${rows.length}. Si quieres otro tamaño, cambia n en la configuración.` };
    const m = [];
    for(let i=0;i<n;i++){
      const vals = rows[i].split(/[\s,;]+/).filter(v => v.length);
      if(vals.length !== n) return { error: `La fila ${i+1} (${LETTERS[i]}) tiene ${vals.length} valores; se esperaban ${n}.` };
      const row = [];
      for(let j=0;j<n;j++){
        const v = /^\d+(\.\d+)?$/.test(vals[j]) ? Math.round(Number(vals[j]) * 100) / 100 : NaN;
        if(isNaN(v)) return { error: `Valor no válido en la fila ${i+1}, columna ${j+1}: "${vals[j]}". Usa números no negativos (decimales con punto, p. ej. 2.5).` };
        row.push(v);
      }
      m.push(row);
    }
    for(let i=0;i<n;i++){
      if(m[i][i] !== 0) return { error: `La diagonal debe ser 0 (fila ${i+1} tiene ${fmt(m[i][i])}).` };
      for(let j=i+1;j<n;j++){
        if(m[i][j] !== m[j][i]) return { error: `La matriz no es simétrica: [${LETTERS[i]},${LETTERS[j]}] = ${fmt(m[i][j])} pero [${LETTERS[j]},${LETTERS[i]}] = ${fmt(m[j][i])}. El grafo es no dirigido.` };
      }
    }
    return { matrix: m };
  }

  document.getElementById("btnToGraph").addEventListener("click", goToGraph);

  function goToGraph(){
    if(document.querySelector("#matrixWrap input.invalid")){
      showError("errorMatrix", "Hay celdas con valores no válidos (marcadas en rojo). Usa números no negativos; 0 = sin conexión.");
      showScreen(2);
      return false;
    }
    if(!state.matrix.some(r => r.some(v => v > 0))){
      showError("errorMatrix", "La matriz no tiene ninguna arista. Ingresa al menos un peso mayor que 0.");
      showScreen(2);
      return false;
    }
    showError("errorMatrix", null);
    computeLayout();
    buildGraphScreen();
    showScreen(3);
    return true;
  }

  // Componentes conexas (para avisar si el grafo no es conexo)
  function components(m){
    const n = m.length, seen = new Array(n).fill(false), out = [];
    for(let s=0; s<n; s++){
      if(seen[s]) continue;
      const comp = [], stack = [s]; seen[s] = true;
      while(stack.length){
        const u = stack.pop(); comp.push(u);
        for(let v=0; v<n; v++) if(m[u][v] > 0 && !seen[v]){ seen[v] = true; stack.push(v); }
      }
      out.push(comp.sort((a,b) => a-b));
    }
    return out;
  }

  // ---------- Layered layout (columnas) ----------
  // Capa = distancia (en aristas) desde el vértice A.
  function buildLayers(m){
    const n = m.length;
    const level = new Array(n).fill(-1);
    // Un BFS por cada componente conexa: si el grafo no es conexo,
    // cada componente se dibuja también en columnas desde la izquierda.
    for(let s=0; s<n; s++){
      if(level[s] !== -1) continue;
      level[s] = 0;
      const queue = [s];
      while(queue.length){
        const u = queue.shift();
        for(let v=0; v<n; v++){
          if(m[u][v] > 0 && level[v] === -1){ level[v] = level[u] + 1; queue.push(v); }
        }
      }
    }
    const K = Math.max(...level) + 1;
    const layers = Array.from({length:K}, () => []);
    for(let v=0; v<n; v++) layers[level[v]].push(v);
    return layers;
  }

  // Ordena los vértices dentro de cada columna para reducir cruces
  // (heurística del baricentro, conservando el mejor resultado).
  function orderLayers(layers, m){
    const K = layers.length, n = m.length;
    const yOf = new Array(n).fill(0);
    const cur = layers.map(L => L.slice());
    const assign = l => cur[l].forEach((v,i) => { yOf[v] = i - (cur[l].length-1)/2; });
    cur.forEach((_, l) => assign(l));

    const crossings = () => {
      let c = 0;
      for(let l=0; l<K-1; l++){
        const es = [];
        cur[l].forEach(u => cur[l+1].forEach(v => { if(m[u][v] > 0) es.push([yOf[u], yOf[v]]); }));
        for(let a=0;a<es.length;a++) for(let b=a+1;b<es.length;b++){
          if((es[a][0]-es[b][0]) * (es[a][1]-es[b][1]) < 0) c++;
        }
      }
      return c;
    };
    const sortBy = (l, ref) => {
      const keyed = cur[l].map((v,i) => {
        let sum = 0, cnt = 0;
        cur[ref].forEach(u => { if(m[v][u] > 0){ sum += yOf[u]; cnt++; } });
        return { v, i, key: cnt ? sum/cnt : yOf[v] };
      });
      keyed.sort((a,b) => (a.key - b.key) || (a.i - b.i));
      cur[l] = keyed.map(k => k.v);
      assign(l);
    };

    let best = cur.map(L => L.slice()), bestC = crossings();
    for(let it=0; it<6 && bestC > 0; it++){
      for(let l=1; l<K; l++) sortBy(l, l-1);
      for(let l=K-2; l>=0; l--) sortBy(l, l+1);
      const c = crossings();
      if(c < bestC){ bestC = c; best = cur.map(L => L.slice()); }
    }
    return best;
  }

  function computeLayout(){
    const m = state.matrix;
    const layers = orderLayers(buildLayers(m), m);
    const K = layers.length;
    const maxSize = Math.max(...layers.map(L => L.length));
    const gapY = 100, margin = 90;
    const W = Math.min(1500, Math.max(820, 2*margin + (K-1)*190));
    const H = Math.max(440, (maxSize-1)*gapY + 2*margin + 30);
    state.W = W; state.H = H;
    state.layerOf = new Array(state.n);
    state.pos = new Array(state.n);
    layers.forEach((L, l) => {
      const x = K === 1 ? W/2 : margin + l*(W - 2*margin)/(K-1);
      L.forEach((v, i) => {
        state.layerOf[v] = l;
        state.pos[v] = { x, y: H/2 + (i - (L.length-1)/2) * gapY };
      });
    });
  }

  // ---------- Screen 3: graph + selects ----------
  function buildGraphScreen(){
    const n = state.n;
    const originSel = document.getElementById("originSelect");
    const destSel = document.getElementById("destSelect");
    originSel.innerHTML = ""; destSel.innerHTML = "";
    for(let i=0;i<n;i++){
      const txt = escapeHtml(state.names ? `${LETTERS[i]} — ${state.names[i]}` : LETTERS[i]);
      originSel.innerHTML += `<option value="${i}">${txt}</option>`;
      destSel.innerHTML += `<option value="${i}">${txt}</option>`;
    }
    if(state.caso){
      originSel.selectedIndex = state.caso.origen;
      destSel.selectedIndex = state.caso.destino;
    } else {
      originSel.selectedIndex = 0;
      destSel.selectedIndex = n - 1;
    }

    // Leyenda con los nombres reales de los vértices
    const legendPanel = document.getElementById("legendPanel");
    if(state.names){
      document.getElementById("legendList").innerHTML = state.names
        .map((nm, i) => `<li><b>${LETTERS[i]}</b><span>${escapeHtml(nm)}</span></li>`).join("");
      legendPanel.style.display = "block";
    } else {
      legendPanel.style.display = "none";
    }

    // Aviso si el grafo no es conexo (se permite continuar)
    const comps = components(state.matrix);
    const warn = document.getElementById("warnGraph");
    if(comps.length > 1){
      warn.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> Aviso: el grafo no es conexo; tiene ${comps.length} componentes (` +
        comps.map(c => "{" + c.map(v => LETTERS[v]).join(", ") + "}").join(" ") +
        `). Entre vértices de componentes distintas no existe camino.`;
      warn.classList.add("show");
    } else {
      warn.innerHTML = ""; warn.classList.remove("show");
    }

    document.getElementById("graphSvg").setAttribute("viewBox", `0 0 ${state.W} ${state.H}`);
    document.querySelector(".graph-layout").classList.add("wide");
    document.querySelector(".canvas-frame").style.maxWidth = Math.round(state.W * 1.12) + "px";

    document.getElementById("resultCard").classList.remove("show");
    document.getElementById("stepsWrap").style.display = "none";
    showError("errorPath", null);

    hideAnimBar();
    renderGraph({});
    const svg = document.getElementById("graphSvg");
    svg.classList.remove("intro"); void svg.getBoundingClientRect(); svg.classList.add("intro");
    clearTimeout(state.introTimer);
    state.introTimer = setTimeout(() => svg.classList.remove("intro"), 1400);
  }

  // Distancia de un punto a un segmento (para ubicar pesos sin cruces)
  function distPointSeg(px, py, a, b){
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx*dx + dy*dy;
    let t = len2 ? ((px - a.x)*dx + (py - a.y)*dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t*dx), py - (a.y + t*dy));
  }

  // Punto de una arista en t∈[0,1]: recta si c es null, curva de Bézier si no
  function edgePoint(a, c, b, t){
    if(!c) return { x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t };
    const u = 1 - t;
    return { x: u*u*a.x + 2*u*t*c.x + t*t*b.x, y: u*u*a.y + 2*u*t*c.y + t*t*b.y };
  }

  // Aristas entre columnas vecinas = rectas. Las que unen vértices de la misma
  // columna o saltan columnas se curvan hacia el lado más despejado.
  function buildEdgeGeometry(edges){
    const pos = state.pos, n = state.n;
    edges.forEach(e => {
      const a = pos[e.i], b = pos[e.j];
      e.c = null;
      if(Math.abs(state.layerOf[e.i] - state.layerOf[e.j]) !== 1){
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const px = -dy/len, py = dx/len, mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
        const same = state.layerOf[e.i] === state.layerOf[e.j];
        const amp = same ? Math.max(60, len*0.35) : len*0.22;
        const clearance = sign => {
          const c = { x: mx + sign*px*amp, y: my + sign*py*amp };
          let best = Infinity;
          for(let s=1; s<16; s++){
            const q = edgePoint(a, c, b, s/16);
            for(let k=0; k<n; k++){
              if(k === e.i || k === e.j) continue;
              best = Math.min(best, Math.hypot(q.x - pos[k].x, q.y - pos[k].y));
            }
          }
          return best;
        };
        const sign = clearance(1) >= clearance(-1) ? 1 : -1;
        e.c = { x: mx + sign*px*amp, y: my + sign*py*amp };
      }
      e.pts = [];
      for(let s=0; s<=16; s++) e.pts.push(edgePoint(a, e.c, b, s/16));
    });
  }

  // Elige para cada arista el punto donde su peso se lee mejor:
  // lejos de otros pesos, de otras aristas y de los vértices.
  function computeLabelPositions(edges){
    const pos = state.pos, n = state.n;
    const candidates = [];
    for(let t = 0.2; t <= 0.801; t += 0.05) candidates.push(+t.toFixed(2));
    candidates.sort((a,b) => Math.abs(a-0.5) - Math.abs(b-0.5));

    const placed = [];
    edges.forEach(e => {
      const a = pos[e.i], b = pos[e.j];
      let best = null, bestScore = -Infinity;

      candidates.forEach(t => {
        const q = edgePoint(a, e.c, b, t);
        if(Math.hypot(q.x - a.x, q.y - a.y) < 34 || Math.hypot(q.x - b.x, q.y - b.y) < 34) return;
        let score = 40;
        placed.forEach(p => { score = Math.min(score, Math.hypot(q.x - p.x, q.y - p.y)); });
        for(let k=0; k<n; k++){
          if(k === e.i || k === e.j) continue;
          score = Math.min(score, Math.hypot(q.x - pos[k].x, q.y - pos[k].y));
        }
        edges.forEach(o => {
          if(o === e) return;
          for(let s=0; s<16; s++){
            score = Math.min(score, 2 * distPointSeg(q.x, q.y, o.pts[s], o.pts[s+1]));
          }
        });
        if(score > bestScore){ bestScore = score; best = q; }
      });

      if(!best) best = edgePoint(a, e.c, b, 0.5);
      e.lx = best.x; e.ly = best.y;
      placed.push(best);
    });
  }

  // Capas del dibujo: aristas, recorrido del camino mínimo (se dibuja de origen a
  // destino), pesos, vértices y etiquetas [d, P] sobre cada vértice (animación).
  function renderGraph(view){
    view = view || {};
    const n = state.n, m = state.matrix, pos = state.pos;
    const path = view.path || [];
    const key = (a, b) => Math.min(a,b) + "-" + Math.max(a,b);
    const onPath = new Set();
    for(let k=0;k<path.length-1;k++) onPath.add(key(path[k], path[k+1]));
    const pathNodes = new Set(path);

    const edges = [];
    for(let i=0;i<n;i++){
      for(let j=i+1;j<n;j++){
        if(m[i][j] > 0) edges.push({ i, j, w: m[i][j], key: i+"-"+j, inPath: onPath.has(i+"-"+j) });
      }
    }
    buildEdgeGeometry(edges);
    computeLabelPositions(edges);
    const byKey = {};
    edges.forEach(e => { byKey[e.key] = e; });
    const dOf = (e, from, to) => {
      const a = pos[from], b = pos[to];
      return e.c ? `M ${a.x} ${a.y} Q ${e.c.x} ${e.c.y} ${b.x} ${b.y}` : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    };

    let html = "";
    edges.forEach(e => { html += `<path class="edge" data-e="${e.key}" d="${dOf(e, e.i, e.j)}"/>`; });
    html += `<g class="route">`;
    for(let k=0;k<path.length-1;k++){
      const e = byKey[key(path[k], path[k+1])];
      html += `<path class="route-seg" pathLength="1" style="--k:${k}" d="${dOf(e, path[k], path[k+1])}"/>`;
    }
    html += `</g>`;
    edges.forEach(e => {
      const txt = fmt(e.w);
      const w = Math.max(24, txt.length * 8 + 12), h = 18;
      html += `<g class="edge-label ${e.inPath?'in-path':''}" data-e="${e.key}">
        <rect x="${e.lx - w/2}" y="${e.ly - h/2}" width="${w}" height="${h}" rx="3"></rect>
        <text x="${e.lx}" y="${e.ly + 1}">${txt}</text>
      </g>`;
    });
    for(let i=0;i<n;i++){
      const p = pos[i];
      let cls = pathNodes.has(i) ? "in-path" : "";
      if(i === view.origin) cls += " origin";
      if(i === view.dest) cls += " dest";
      const tag = i === view.origin ? "origen" : i === view.dest ? "destino" : "";
      html += `<g class="node ${cls}" data-v="${i}" style="--k:${i}">
        <circle class="ring" cx="${p.x}" cy="${p.y}" r="20"/>
        <circle class="dot" cx="${p.x}" cy="${p.y}" r="20"/>
        <text x="${p.x}" y="${p.y+1}">${LETTERS[i]}</text>
        ${tag ? `<text class="node-tag" x="${p.x}" y="${p.y+34}">${tag}</text>` : ""}
      </g>`;
    }
    for(let i=0;i<n;i++){
      const p = pos[i];
      html += `<g class="badge" data-v="${i}" data-x="${p.x}">
        <rect x="${p.x - 16}" y="${p.y - 49}" width="32" height="24" rx="3"></rect>
        <text x="${p.x}" y="${p.y - 36}">∞</text>
      </g>`;
    }
    const svg = document.getElementById("graphSvg");
    svg.innerHTML = html;
    svg.classList.remove("anim", "final", "drawing");
  }

  // ---------- Dijkstra ----------
  // Versión con matriz de adyacencia, O(n²). Se detiene cuando fija el destino:
  // a partir de ese momento su distancia ya no puede mejorar (pesos no negativos).
  // Guarda cada iteración para mostrar el desarrollo paso a paso.
  function runDijkstra(src, dst){
    const n = state.n, m = state.matrix;
    const dist = new Array(n).fill(Infinity);
    const prev = new Array(n).fill(-1);
    const fixed = new Array(n).fill(false);
    dist[src] = 0;
    const steps = [];   // una entrada por iteración

    while(true){
      // vértice no fijado con menor distancia acumulada (empate: el de menor letra)
      let u = -1;
      for(let v=0; v<n; v++){
        if(!fixed[v] && dist[v] < Infinity && (u === -1 || dist[v] < dist[u] - EPS)) u = v;
      }
      if(u === -1) break;                 // no quedan vértices alcanzables
      fixed[u] = true;

      const step = { u, d: dist[u], p: prev[u], relax: [], isDest: u === dst };
      if(u !== dst){
        for(let v=0; v<n; v++){
          if(m[u][v] > 0 && !fixed[v]){
            const cand = dist[u] + m[u][v];
            const better = cand < dist[v] - EPS;
            step.relax.push({ v, w: m[u][v], cand, old: dist[v], oldP: prev[v], updated: better });
            if(better){ dist[v] = cand; prev[v] = u; }
          }
        }
      }
      step.labels = dist.map((d, v) => ({ d, p: prev[v], fixed: fixed[v] }));
      steps.push(step);
      if(u === dst) break;
    }

    let path = [];
    if(fixed[dst]){
      for(let cur = dst; cur !== -1; cur = prev[cur]) path.unshift(cur);
    }
    return { dist, prev, fixed, steps, path, optimal: fixed[dst] ? allShortestPaths(src, dst, dist, fixed) : [] };
  }

  // Todas las rutas de costo mínimo (para avisar si hay empate).
  // Un vértice p precede a v en algún camino mínimo si d(p) + w(p,v) = d(v);
  // con pesos positivos, todos esos p ya están fijados cuando se fija el destino.
  function allShortestPaths(src, dst, dist, fixed, limit){
    limit = limit || 6;
    const m = state.matrix, n = state.n, out = [];
    let total = 0;
    const walk = (v, suffix) => {
      if(v === src){ total++; if(out.length < limit) out.push([src, ...suffix]); return; }
      for(let p=0; p<n; p++){
        if(fixed[p] && m[p][v] > 0 && Math.abs(dist[p] + m[p][v] - dist[v]) < EPS) walk(p, [v, ...suffix]);
      }
    };
    walk(dst, []);
    return { paths: out, total };
  }

  // Si cambian origen o destino, el resultado anterior ya no aplica
  ["originSelect", "destSelect"].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
      document.getElementById("resultCard").classList.remove("show");
      document.getElementById("stepsWrap").style.display = "none";
      showError("errorPath", null);
      hideAnimBar();
      renderGraph({});
    });
  });

  document.getElementById("btnCalc").addEventListener("click", () => {
    const o = parseInt(document.getElementById("originSelect").value,10);
    const d = parseInt(document.getElementById("destSelect").value,10);
    if(o === d){
      showError("errorPath", "El origen y el destino deben ser distintos.");
      return;
    }
    showError("errorPath", null);

    const result = runDijkstra(o, d);
    state.dijkstra = result;
    stopPlaying();

    if(result.path.length === 0){
      showError("errorPath", `No existe camino entre ${LETTERS[o]} y ${LETTERS[d]}: están en componentes distintas del grafo.`);
      document.getElementById("resultCard").classList.remove("show");
      renderGraph({ origin: o, dest: d });
      renderTrace(result, o, d);
      document.getElementById("stepsWrap").style.display = "block";
      showAnimBar(result);
      return;
    }

    renderGraph({ path: result.path, origin: o, dest: d });
    drawRoute();

    const unit = escapeHtml(state.unit);
    document.getElementById("resultCost").innerHTML = `${fmt(result.dist[d])} <span>${unit}</span>`;
    let pathHtml = `<svg class="ic" aria-hidden="true"><use href="#i-route"/></svg> Ruta: ` + result.path.map(i=>`<b>${LETTERS[i]}</b>`).join(" → ");
    if(state.names){
      pathHtml += `<ol class="path-names">` +
        result.path.map(i => `<li>${escapeHtml(state.names[i])}</li>`).join("") + `</ol>`;
    }
    const opt = result.optimal;
    if(opt.total > 1){
      const others = opt.paths.filter(pth => pth.join() !== result.path.join());
      pathHtml += `<div class="ties"><svg class="ic" aria-hidden="true"><use href="#i-info"/></svg> Hay ${opt.total} rutas con el mismo costo mínimo. Otra${opt.total > 2 ? "s" : ""}: ` +
        others.map(pth => pth.map(i => LETTERS[i]).join(" → ")).join("; ") +
        (opt.total > opt.paths.length ? "; …" : "") + `</div>`;
    }
    document.getElementById("resultPath").innerHTML = pathHtml;
    document.getElementById("resultCard").classList.add("show");

    renderTrace(result, o, d);
    document.getElementById("stepsWrap").style.display = "block";
    showAnimBar(result);
  });

  // ---------- Desarrollo paso a paso ----------
  // Tabla: una columna por iteración con la etiqueta [distancia, procedencia] de
  // cada vértice al terminar esa iteración. Naranja = vértice fijado en esa
  // iteración; texto naranja = etiqueta actualizada; ✓ = ya fijado antes; ∞ = sin etiqueta.
  function renderTrace(result, o, d){
    const n = state.n, steps = result.steps;
    const L = i => LETTERS[i];
    const lab = (dd, pp) => dd === Infinity ? "∞" : `[${fmt(dd)}, ${pp === -1 ? "—" : L(pp)}]`;

    let head = "<thead><tr><th>Vértice</th>";
    steps.forEach((st, k) => { head += `<th>Iteración ${k+1}<small>se fija ${L(st.u)}</small></th>`; });
    head += "</tr></thead>";

    let body = "<tbody>";
    for(let v=0; v<n; v++){
      body += `<tr><th>${L(v)}${v===o ? " (origen)" : v===d ? " (destino)" : ""}</th>`;
      steps.forEach((st, k) => {
        const lb = st.labels[v];
        const fixedBefore = k > 0 && steps[k-1].labels[v].fixed;
        if(st.u === v){
          body += `<td class="final-cell">${lab(lb.d, lb.p)}</td>`;
        } else if(fixedBefore){
          body += `<td class="done-cell">✓</td>`;
        } else if(st.relax.some(r => r.v === v && r.updated)){
          body += `<td class="selected-cell">${lab(lb.d, lb.p)}</td>`;
        } else {
          body += `<td>${lab(lb.d, lb.p)}</td>`;
        }
      });
      body += "</tr>";
    }
    body += "</tbody>";
    document.getElementById("traceTable").innerHTML = head + body;

    // Explicación de cada iteración con las comparaciones que hace el algoritmo
    const unitTxt = state.unit === "unidades" ? "" : " " + escapeHtml(state.unit);
    let items = `<li><b>Inicio:</b> <code>${L(o)}</code> recibe la etiqueta <code>[0, —]</code> y los demás vértices <code>∞</code>.</li>`;
    steps.forEach((st, k) => {
      let txt = `<b>Iteración ${k+1}:</b> entre los vértices no fijados, el de menor distancia acumulada es <code>${L(st.u)}</code> (${fmt(st.d)}), así que se fija con la etiqueta <code>${lab(st.d, st.p)}</code>.`;
      if(st.isDest){
        txt += ` Es el destino: su distancia ya no puede mejorar, así que el algoritmo termina.`;
      } else if(st.relax.length === 0){
        txt += ` No tiene vecinos sin fijar, así que no se actualiza ninguna etiqueta.`;
      } else {
        txt += ` Se revisan sus vecinos sin fijar:<ul>` + st.relax.map(r => {
          const calc = `${fmt(st.d)} + ${fmt(r.w)} = ${fmt(r.cand)}`;
          if(r.old === Infinity) return `<li><code>${L(r.v)}</code>: ${calc} &lt; ∞ → nueva etiqueta <code>${lab(r.cand, st.u)}</code></li>`;
          if(r.updated) return `<li><code>${L(r.v)}</code>: ${calc} &lt; ${fmt(r.old)} → se actualiza a <code>${lab(r.cand, st.u)}</code></li>`;
          return `<li><code>${L(r.v)}</code>: ${calc} ≥ ${fmt(r.old)} → se mantiene <code>${lab(r.old, r.oldP)}</code></li>`;
        }).join("") + `</ul>`;
      }
      items += `<li>${txt}</li>`;
    });
    if(result.path.length){
      items += `<li><b>Resultado:</b> siguiendo las procedencias desde <code>${L(d)}</code> hacia atrás se obtiene la ruta ` +
        `${result.path.map(L).join(" → ")}, con costo mínimo <code>${fmt(result.dist[d])}${unitTxt}</code>.</li>`;
    } else {
      items += `<li><b>Resultado:</b> ya no quedan vértices alcanzables y <code>${L(d)}</code> sigue con etiqueta ∞: no existe camino desde <code>${L(o)}</code>.</li>`;
    }
    document.getElementById("narrative").innerHTML = items;
  }

  // ---------- Animación paso a paso ----------
  // Cuadros: 0 = inicio, 1..S = una iteración de Dijkstra cada uno, S+1 = resultado.
  // En cada cuadro: el vértice que se fija se ilumina, sus aristas revisadas se
  // marcan (verde = mejora la etiqueta, gris punteado = no mejora), la etiqueta
  // [d, P] de cada vértice se actualiza encima de él, y se resaltan la columna
  // correspondiente de la tabla y la línea de la explicación.
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const anim = { result: null, k: -1, frames: 0, active: false, playing: false, timer: null };
  const $ = id => document.getElementById(id);

  function drawRoute(){
    const svg = $("graphSvg");
    svg.classList.remove("drawing"); void svg.getBoundingClientRect(); svg.classList.add("drawing");
  }

  function showAnimBar(result){
    anim.result = result;
    anim.frames = result.steps.length + 2;
    exitAnim();
    $("animBar").classList.add("show");
  }
  function hideAnimBar(){
    stopPlaying();
    anim.active = false;
    $("animBar").classList.remove("show");
  }

  function setPlayButton(){
    const btn = $("animPlay"), use = btn.querySelector("use"), lbl = btn.querySelector("span");
    const atEnd = anim.active && anim.k >= anim.frames - 1;
    use.setAttribute("href", anim.playing ? "#i-pause" : "#i-play");
    lbl.textContent = anim.playing ? "Pausar" : !anim.active ? "Animar paso a paso" : atEnd ? "Repetir" : "Continuar";
  }

  function stopPlaying(){
    clearTimeout(anim.timer);
    anim.playing = false;
    if($("animPlay")) setPlayButton();
  }

  function scheduleNext(){
    clearTimeout(anim.timer);
    anim.timer = setTimeout(() => {
      if(!anim.playing) return;
      if(anim.k < anim.frames - 1){ applyFrame(anim.k + 1); }
      if(anim.k >= anim.frames - 1) stopPlaying(); else scheduleNext();
    }, parseInt($("animSpeed").value, 10));
  }

  function togglePlay(){
    if(anim.playing){ stopPlaying(); return; }
    if(!anim.active || anim.k >= anim.frames - 1) applyFrame(0);
    anim.playing = true;
    setPlayButton();
    scheduleNext();
  }

  function exitAnim(){
    stopPlaying();
    anim.active = false; anim.k = -1;
    const svg = $("graphSvg");
    svg.classList.remove("anim", "final");
    svg.querySelectorAll(".node").forEach(g => g.classList.remove("fixed", "current", "reached"));
    svg.querySelectorAll("path.edge, .edge-label").forEach(el => el.classList.remove("tree", "relax-upd", "relax-keep"));
    $("traceTable").querySelectorAll("th, td").forEach(c => c.classList.remove("cur-col", "future"));
    $("narrative").querySelectorAll(":scope > li").forEach(li => li.classList.remove("cur", "future"));
    $("resultCard").classList.remove("pending");
    $("animBar").classList.remove("active");
    document.querySelector(".graph-layout").classList.remove("animating");
    $("animCaption").innerHTML = "";
    $("animCounter").textContent = "Presiona ▶ para ver el algoritmo paso a paso";
    $("animExit").hidden = true;
    ["animFirst", "animPrev"].forEach(id => { $(id).disabled = true; });
    ["animNext", "animLast"].forEach(id => { $(id).disabled = false; });
    setPlayButton();
  }

  function applyFrame(k){
    const r = anim.result; if(!r) return;
    const steps = r.steps, S = steps.length, last = anim.frames - 1;
    k = Math.max(0, Math.min(k, last));
    const forward = k > anim.k;
    const entering = !anim.active;
    anim.k = k; anim.active = true;
    // al empezar, la barra y el grafo quedan juntos en pantalla (útil para exponer)
    if(entering) $("animBar").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    const o = parseInt($("originSelect").value, 10);
    const isFinal = k === last;
    const st = k >= 1 && k <= S ? steps[k-1] : null;
    const labels = k === 0
      ? Array.from({length: state.n}, (_, v) => ({ d: v === o ? 0 : Infinity, p: -1, fixed: false }))
      : steps[Math.min(k, S) - 1].labels;
    const cur = st ? st.u : -1;

    const svg = $("graphSvg");
    svg.classList.add("anim");
    svg.classList.toggle("final", isFinal);
    if(isFinal && r.path.length) drawRoute();

    // vértices
    svg.querySelectorAll(".node").forEach(g => {
      const v = +g.dataset.v, lb = labels[v];
      g.classList.toggle("current", !isFinal && v === cur);
      g.classList.toggle("fixed", !isFinal && lb.fixed && v !== cur);
      g.classList.toggle("reached", !isFinal && !lb.fixed && lb.d < Infinity);
    });
    // etiquetas [d, P] sobre cada vértice
    svg.querySelectorAll(".badge").forEach(g => {
      const v = +g.dataset.v, lb = labels[v], x = +g.dataset.x;
      const txt = lb.d === Infinity ? "∞" : `[${fmt(lb.d)}, ${lb.p === -1 ? "—" : LETTERS[lb.p]}]`;
      const t = g.querySelector("text"), rect = g.querySelector("rect");
      const changed = t.textContent !== txt;
      t.textContent = txt;
      const w = Math.max(32, txt.length * 8.7 + 14);
      rect.setAttribute("x", x - w/2); rect.setAttribute("width", w);
      g.classList.toggle("is-inf", lb.d === Infinity);
      g.classList.toggle("is-fixed", lb.fixed);
      if(changed && forward && !reduceMotion){
        g.classList.remove("changed"); void svg.getBoundingClientRect(); g.classList.add("changed");
      }
    });
    // aristas: árbol de caminos mínimos construido hasta ahora + aristas revisadas
    svg.querySelectorAll("path.edge, .edge-label").forEach(el => el.classList.remove("tree", "relax-upd", "relax-keep"));
    const mark = (a, b, cls) => svg.querySelectorAll(`[data-e="${Math.min(a,b)}-${Math.max(a,b)}"]`).forEach(el => el.classList.add(cls));
    if(!isFinal){
      for(let j=0; j<Math.min(k, S); j++) if(steps[j].p !== -1) mark(steps[j].p, steps[j].u, "tree");
      if(st) st.relax.forEach(rx => mark(st.u, rx.v, rx.updated ? "relax-upd" : "relax-keep"));
    }

    // tabla: columna actual resaltada, columnas futuras atenuadas
    const table = $("traceTable");
    table.querySelectorAll("tr").forEach(tr => {
      Array.from(tr.children).forEach((cell, ci) => {
        if(ci === 0) return;
        cell.classList.toggle("cur-col", ci === k && k <= S);
        cell.classList.toggle("future", ci > k);
      });
    });
    const th = table.querySelector(`thead th:nth-child(${Math.min(k, S) + 1})`);
    const wrap = table.parentElement;
    if(th && k >= 1){
      wrap.scrollTo({ left: Math.max(0, th.offsetLeft - wrap.clientWidth/2 + th.offsetWidth/2), behavior: reduceMotion ? "auto" : "smooth" });
    }
    // explicación: línea actual
    const items = $("narrative").querySelectorAll(":scope > li");
    items.forEach((li, i) => { li.classList.toggle("cur", i === k); li.classList.toggle("future", i > k); });
    $("animCaption").innerHTML = items[k] ? items[k].innerHTML : "";

    // barra de control
    $("animCounter").textContent = k === 0 ? `Inicio · ${S} iteraciones en total`
      : isFinal ? "Resultado" : `Iteración ${k} de ${S}`;
    $("resultCard").classList.toggle("pending", !isFinal);
    $("animBar").classList.add("active");
    $("animBar").classList.toggle("final", isFinal);
    document.querySelector(".graph-layout").classList.add("animating");
    $("animExit").hidden = false;
    $("animFirst").disabled = $("animPrev").disabled = k === 0;
    $("animNext").disabled = $("animLast").disabled = isFinal;
    setPlayButton();
  }

  $("animPlay").addEventListener("click", togglePlay);
  $("animFirst").addEventListener("click", () => { stopPlaying(); applyFrame(0); });
  $("animPrev").addEventListener("click", () => { stopPlaying(); applyFrame(anim.k - 1); });
  $("animNext").addEventListener("click", () => { stopPlaying(); applyFrame(anim.active ? anim.k + 1 : 0); });
  $("animLast").addEventListener("click", () => { stopPlaying(); applyFrame(anim.frames - 1); });
  $("animExit").addEventListener("click", () => { exitAnim(); drawRoute(); });
  $("animSpeed").addEventListener("change", () => { if(anim.playing) scheduleNext(); });

  // Atajos de teclado para exponer: ← →, espacio, Inicio/Fin, Esc
  document.addEventListener("keydown", ev => {
    if(state.current !== 3 || !$("animBar").classList.contains("show")) return;
    const tag = (ev.target.tagName || "").toUpperCase();
    if(tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if(ev.key === "ArrowRight"){ ev.preventDefault(); $("animNext").click(); }
    else if(ev.key === "ArrowLeft"){ ev.preventDefault(); if(anim.active) $("animPrev").click(); }
    else if(ev.key === " " && tag !== "BUTTON"){ ev.preventDefault(); togglePlay(); }
    else if(ev.key === "Home"){ ev.preventDefault(); $("animFirst").click(); }
    else if(ev.key === "End"){ ev.preventDefault(); $("animLast").click(); }
    else if(ev.key === "Escape" && anim.active){ $("animExit").click(); }
  });

  // init
  document.getElementById("nInput").value = 6;
})();
