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

  // Etiqueta de un vértice: "A" o "A — Nombre" si el caso tiene nombres
  function label(i){
    return state.names ? `${LETTERS[i]} — ${state.names[i]}` : LETTERS[i];
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
      if(step < num){ t.setAttribute("role","button"); t.tabIndex = 0; }
      else { t.removeAttribute("role"); t.tabIndex = -1; }
    });
    state.current = num;
    window.scrollTo(0, 0);
    if(pushHistory !== false){
      try{ history.pushState({step:num}, ""); }catch(e){ /* entorno sin historial: se ignora */ }
    }
  }

  // Pestañas del encabezado: permiten volver a cualquier paso anterior
  document.querySelectorAll(".stepper .tab").forEach(tab => {
    const go = () => {
      const step = parseInt(tab.dataset.step, 10);
      if(step < state.current) showScreen(step);
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

  document.getElementById("btnToMatrix").addEventListener("click", () => {
    const n = parseInt(document.getElementById("nInput").value, 10);
    if(isNaN(n) || n < 5 || n > 15){
      showError("errorConfig", "El número de vértices debe estar entre 5 y 15.");
      return;
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
  });

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
      info.innerHTML = `<h3>${escapeHtml(caso.titulo)}</h3><p>${escapeHtml(caso.resumen)}</p><p class="assume"><b>Supuestos:</b> ${escapeHtml(caso.supuestos)}</p>`;
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
          html += `<td><input type="number" min="0" step="1" data-i="${i}" data-j="${j}" value="${val}"></td>`;
        }
      }
      html += "</tr>";
    }
    html += "</tbody></table>";
    wrap.innerHTML = html;

    wrap.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("input", () => {
        const i = parseInt(inp.dataset.i,10), j = parseInt(inp.dataset.j,10);
        let v = parseInt(inp.value,10);
        if(isNaN(v) || v < 0) v = 0;
        state.matrix[i][j] = v;
        state.matrix[j][i] = v;
        const mirror = wrap.querySelector(`input[data-i="${j}"][data-j="${i}"]`);
        if(mirror) mirror.value = v;
      });
    });
  }

  document.getElementById("btnRegenerate").addEventListener("click", () => {
    randomizeMatrix();
    buildMatrixScreen();
  });

  // ---------- Pegar matriz (desde Excel o texto) ----------
  document.getElementById("btnPaste").addEventListener("click", () => {
    const panel = document.getElementById("pastePanel");
    const area = document.getElementById("pasteArea");
    area.value = state.matrix.map(r => r.join("\t")).join("\n");
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
        const v = Number(vals[j]);
        if(!Number.isInteger(v) || v < 0) return { error: `Valor no válido en la fila ${i+1}, columna ${j+1}: "${vals[j]}". Usa enteros no negativos.` };
        row.push(v);
      }
      m.push(row);
    }
    for(let i=0;i<n;i++){
      if(m[i][i] !== 0) return { error: `La diagonal debe ser 0 (fila ${i+1} tiene ${m[i][i]}).` };
      for(let j=i+1;j<n;j++){
        if(m[i][j] !== m[j][i]) return { error: `La matriz no es simétrica: [${LETTERS[i]},${LETTERS[j]}] = ${m[i][j]} pero [${LETTERS[j]},${LETTERS[i]}] = ${m[j][i]}. El grafo es no dirigido.` };
      }
    }
    return { matrix: m };
  }

  document.getElementById("btnToGraph").addEventListener("click", () => {
    if(!state.matrix.some(r => r.some(v => v > 0))){
      showError("errorMatrix", "La matriz no tiene ninguna arista. Ingresa al menos un peso mayor que 0.");
      return;
    }
    showError("errorMatrix", null);
    computeLayout();
    buildGraphScreen();
    showScreen(3);
  });

  function isConnected(m){
    const n = m.length;
    const visited = new Array(n).fill(false);
    const stack = [0];
    visited[0] = true;
    let count = 1;
    while(stack.length){
      const u = stack.pop();
      for(let v=0; v<n; v++){
        if(m[u][v] > 0 && !visited[v]){
          visited[v] = true; count++; stack.push(v);
        }
      }
    }
    return count === n;
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
      destSel.selectedIndex = Math.min(1, n-1);
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
      warn.innerHTML = `Aviso: el grafo no es conexo; tiene ${comps.length} componentes (` +
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

    renderGraph(null);
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

  function renderGraph(pathEdgesSet, pathNodesSet, originIdx, destIdx){
    const n = state.n, m = state.matrix, pos = state.pos;
    const svg = document.getElementById("graphSvg");

    const edges = [];
    for(let i=0;i<n;i++){
      for(let j=i+1;j<n;j++){
        if(m[i][j] > 0){
          edges.push({ i, j, w: m[i][j], inPath: !!(pathEdgesSet && pathEdgesSet.has(i+"-"+j)) });
        }
      }
    }
    buildEdgeGeometry(edges);
    computeLabelPositions(edges);

    let html = "";
    // 1) aristas normales, 2) aristas del camino (quedan encima)
    [false, true].forEach(flag => {
      edges.filter(e => e.inPath === flag).forEach(e => {
        const a = pos[e.i], b = pos[e.j];
        const d = e.c ? `M ${a.x} ${a.y} Q ${e.c.x} ${e.c.y} ${b.x} ${b.y}` : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
        html += `<g class="edge"><path d="${d}" class="${e.inPath?'in-path':''}"/></g>`;
      });
    });
    // 3) pesos, siempre sobre todas las líneas
    [false, true].forEach(flag => {
      edges.filter(e => e.inPath === flag).forEach(e => {
        const txt = String(e.w);
        const w = Math.max(24, txt.length * 8 + 12), h = 18;
        html += `<g class="edge-label ${e.inPath?'in-path':''}">
          <rect x="${e.lx - w/2}" y="${e.ly - h/2}" width="${w}" height="${h}" rx="3"></rect>
          <text x="${e.lx}" y="${e.ly + 1}">${txt}</text>
        </g>`;
      });
    });
    // 4) vértices
    for(let i=0;i<n;i++){
      const p = pos[i];
      let cls = "";
      if(pathNodesSet && pathNodesSet.has(i)) cls = "in-path";
      if(i === originIdx) cls += " origin";
      if(i === destIdx) cls += " dest";
      html += `<g class="node ${cls}">
        <circle cx="${p.x}" cy="${p.y}" r="20"/>
        <text x="${p.x}" y="${p.y+1}">${LETTERS[i]}</text>
      </g>`;
    }
    svg.innerHTML = html;
  }

  // ---------- Dijkstra ----------
  function runDijkstra(src, dst){
    const n = state.n, m = state.matrix;
    const dist = new Array(n).fill(Infinity);
    const prev = new Array(n).fill(-1);
    const visited = new Array(n).fill(false);
    dist[src] = 0;

    // history[v] = list of {value:{d,p}, iteration, isFinal}
    const history = Array.from({length:n}, () => []);
    let iteration = 0;

    for(let count=0; count<n; count++){
      // pick unvisited vertex with min dist
      let u = -1, best = Infinity;
      for(let v=0; v<n; v++){
        if(!visited[v] && dist[v] < best){ best = dist[v]; u = v; }
      }
      if(u === -1) break; // remaining vertices unreachable
      visited[u] = true;
      iteration++;

      // record this vertex as finalized at this iteration
      history[u].push({ d: dist[u], p: prev[u], iteration, isFinal:true });

      // relax neighbors
      for(let v=0; v<n; v++){
        if(m[u][v] > 0 && !visited[v]){
          const nd = dist[u] + m[u][v];
          if(nd < dist[v]){
            dist[v] = nd;
            prev[v] = u;
            history[v].push({ d: nd, p: u, iteration, isFinal:false });
          }
        }
      }
    }

    // reconstruct path
    let path = [];
    if(dist[dst] < Infinity){
      let cur = dst;
      while(cur !== -1){ path.unshift(cur); cur = prev[cur]; }
    }

    return { dist, prev, history, path, totalIterations: iteration };
  }

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

    if(result.path.length === 0){
      showError("errorPath", `No existe camino entre ${LETTERS[o]} y ${LETTERS[d]}.`);
      document.getElementById("resultCard").classList.remove("show");
      document.getElementById("stepsWrap").style.display = "none";
      renderGraph(null, null, o, d);
      return;
    }

    // path sets for highlighting
    const nodeSet = new Set(result.path);
    const edgeSet = new Set();
    for(let k=0;k<result.path.length-1;k++){
      const a = result.path[k], b = result.path[k+1];
      edgeSet.add(Math.min(a,b)+"-"+Math.max(a,b));
    }
    renderGraph(edgeSet, nodeSet, o, d);

    // result card
    document.getElementById("resultCost").innerHTML = `${result.dist[d]} <span>${escapeHtml(state.unit)}</span>`;
    let pathHtml = "Ruta: " + result.path.map(i=>`<b>${LETTERS[i]}</b>`).join(" → ");
    if(state.names){
      pathHtml += `<ol class="path-names">` +
        result.path.map(i => `<li>${escapeHtml(state.names[i])}</li>`).join("") + `</ol>`;
    }
    document.getElementById("resultPath").innerHTML = pathHtml;
    document.getElementById("resultCard").classList.add("show");

    renderTrace(result, o, d);
    document.getElementById("stepsWrap").style.display = "block";
  });

  // ---------- Step-by-step trace table ----------
  function renderTrace(result, o, d){
    const n = state.n;
    const table = document.getElementById("traceTable");
    const iterations = result.totalIterations;

    let head = "<thead><tr><th>Vértice</th>";
    for(let k=1;k<=iterations;k++) head += `<th>Iteración ${k}</th>`;
    head += "</tr></thead>";

    let body = "<tbody>";
    for(let v=0; v<n; v++){
      body += `<tr><th>${LETTERS[v]}${v===o?' (origen)':''}</th>`;
      for(let k=1;k<=iterations;k++){
        const entries = result.history[v].filter(e => e.iteration === k);
        if(entries.length === 0){
          body += "<td>—</td>";
        } else {
          const cellsHtml = entries.map(e => {
            const label = e.p === -1 ? `[${e.d}, —]` : `[${e.d}, ${LETTERS[e.p]}]`;
            return e.isFinal ? `<span class="final-cell-inline">${label}</span>` : label;
          }).join("<br>");
          const finalEntry = entries.find(e => e.isFinal);
          body += `<td class="${finalEntry ? 'final-cell' : 'selected-cell'}">${cellsHtml}</td>`;
        }
      }
      body += "</tr>";
    }
    body += "</tbody>";
    table.innerHTML = head + body;

    // narrative
    const narrative = document.getElementById("narrative");
    let items = "";
    items += `<li>Se etiqueta el vértice de origen <code>${LETTERS[o]}</code> con distancia acumulada 0.</li>`;
    // rebuild order of finalization from history
    const finalOrder = [];
    for(let v=0; v<n; v++){
      const f = result.history[v].find(e => e.isFinal);
      if(f) finalOrder.push({v, ...f});
    }
    finalOrder.sort((a,b)=>a.iteration-b.iteration);
    finalOrder.forEach(f => {
      if(f.v === o) return;
      const from = f.p === -1 ? "—" : LETTERS[f.p];
      items += `<li>Iteración ${f.iteration}: se fija <code>${LETTERS[f.v]}</code> con distancia acumulada <code>${f.d}</code> desde <code>${from}</code>, y se etiquetan sus vértices adyacentes no visitados.</li>`;
    });
    if(result.dist[d] < Infinity){
      const u = state.unit === "unidades" ? "" : " " + escapeHtml(state.unit);
      items += `<li><b>Resultado:</b> el costo mínimo de ${LETTERS[o]} a ${LETTERS[d]} es <code>${result.dist[d]}${u}</code>, siguiendo la ruta ${result.path.map(i=>LETTERS[i]).join(" → ")}.</li>`;
    }
    narrative.innerHTML = items;
  }

  // init
  document.getElementById("nInput").value = 6;
})();
