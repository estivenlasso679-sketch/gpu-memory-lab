(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TIERS = [0.0625, 0.3125, 1.3125, 5.3125, 21.3125];
  const QUALITY = [0, 0.48, 0.70, 0.86, 1];
  const TARGETS = [3, 3, 2, 2, 2, 1, 1, 1];
  const AREAS = [1.35, 1.2, 1.05, 0.95, 0.85, 0.75, 0.65, 0.55];
  const REGIONS = 12;
  const PER_REGION = 8;

  function makeAssets() {
    return Array.from({ length: REGIONS * PER_REGION }, (_, id) => ({
      id,
      region: Math.floor(id / PER_REGION),
      material: id % PER_REGION,
      target: TARGETS[id % PER_REGION],
      area: AREAS[id % PER_REGION]
    }));
  }

  const assets = makeAssets();
  const state = {
    fixed: freshStrategy(),
    adaptive: freshStrategy(),
    camera: 0,
    step: 0,
    timer: null,
    history: []
  };

  function freshStrategy() {
    return { tiers: Array(assets.length).fill(0), lastUse: Array(assets.length).fill(-1), lastUpload: 0 };
  }

  function budget() { return Number($("budget").value); }
  function uploadLimit() { return Number($("uploadCap").value); }
  function cameraSpeed() { return Number($("speed").value); }
  function visibleRegions() { return [state.camera % REGIONS, (state.camera + 1) % REGIONS]; }
  function visibleAssets() {
    const visible = new Set(visibleRegions());
    return assets.filter((asset) => visible.has(asset.region));
  }
  function residentMiB(strategy) {
    return strategy.tiers.reduce((sum, tier) => sum + TIERS[tier], 0);
  }
  function tierCost(tier) { return TIERS[tier] - TIERS[tier - 1]; }
  function formatMiB(value) { return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} MiB`; }

  function targetFor(asset, kind) { return kind === "fixed" ? 4 : asset.target; }

  function score(asset, nextTier) {
    const visualGain = Math.max(0.01, QUALITY[nextTier] - QUALITY[nextTier - 1]);
    return (asset.area * visualGain) / tierCost(nextTier);
  }

  function visibleSet() { return new Set(visibleAssets().map((asset) => asset.id)); }

  function evictOneMip(strategy, kind, protectedId) {
    const visible = visibleSet();
    const victims = assets.filter((asset) => asset.id !== protectedId && strategy.tiers[asset.id] > 0);
    if (!victims.length) return false;

    victims.sort((a, b) => {
      if (kind === "fixed") {
        return strategy.lastUse[a.id] - strategy.lastUse[b.id] || a.area - b.area || b.id - a.id;
      }
      const aVisible = visible.has(a.id);
      const bVisible = visible.has(b.id);
      const aPriority = aVisible && strategy.tiers[a.id] < a.target ? score(a, strategy.tiers[a.id]) : 0;
      const bPriority = bVisible && strategy.tiers[b.id] < b.target ? score(b, strategy.tiers[b.id]) : 0;
      return aPriority - bPriority || strategy.lastUse[a.id] - strategy.lastUse[b.id] || a.area - b.area;
    });

    const victim = victims[0];
    strategy.tiers[victim.id] -= 1;
    return true;
  }

  function fitBudget(strategy, kind, protectedId = -1) {
    while (residentMiB(strategy) > budget() + 1e-6) {
      if (!evictOneMip(strategy, kind, protectedId)) break;
    }
  }

  function requestMipLevels(strategy, kind, visible, now) {
    let sent = 0;
    let roomForAnother = true;

    // A simple scheduler: upload one mip at a time, re-ranking after each promotion.
    // The adaptive score approximates expected on-screen visual gain per MiB.
    while (roomForAnother) {
      roomForAnother = false;
      const candidates = visible
        .filter((asset) => strategy.tiers[asset.id] < targetFor(asset, kind))
        .map((asset) => {
          const nextTier = strategy.tiers[asset.id] + 1;
          return { asset, nextTier, cost: tierCost(nextTier), score: score(asset, nextTier) };
        });

      if (kind === "adaptive") candidates.sort((a, b) => b.score - a.score || a.asset.id - b.asset.id);
      else candidates.sort((a, b) => b.asset.area - a.asset.area || a.asset.id - b.asset.id || a.nextTier - b.nextTier);

      for (const item of candidates) {
        if (item.cost > uploadLimit() - sent + 1e-6) continue;
        fitBudget(strategy, kind, item.asset.id);
        while (residentMiB(strategy) + item.cost > budget() + 1e-6) {
          if (!evictOneMip(strategy, kind, item.asset.id)) break;
        }
        if (residentMiB(strategy) + item.cost > budget() + 1e-6) continue;
        strategy.tiers[item.asset.id] = item.nextTier;
        sent += item.cost;
        roomForAnother = sent < uploadLimit() - 1e-6;
        break;
      }
    }

    strategy.lastUpload = sent;
    return sent;
  }

  function qualityCoverage(strategy, kind, visible) {
    let achieved = 0;
    let requested = 0;
    for (const asset of visible) {
      const target = targetFor(asset, kind);
      const weight = asset.area;
      achieved += QUALITY[strategy.tiers[asset.id]] * weight;
      requested += QUALITY[target] * weight;
    }
    return requested ? Math.min(1, achieved / requested) : 0;
  }

  function advance() {
    state.step += 1;
    state.camera = (state.camera + cameraSpeed()) % REGIONS;
    const visible = visibleAssets();
    const ids = visible.map((asset) => asset.id);

    for (const asset of visible) {
      state.fixed.lastUse[asset.id] = state.step;
      state.adaptive.lastUse[asset.id] = state.step;
    }

    fitBudget(state.fixed, "fixed");
    fitBudget(state.adaptive, "adaptive");
    requestMipLevels(state.fixed, "fixed", visible, state.step);
    requestMipLevels(state.adaptive, "adaptive", visible, state.step);

    state.history.push({ fixed: state.fixed.lastUpload, adaptive: state.adaptive.lastUpload });
    if (state.history.length > 24) state.history.shift();
    render(visible);
    void ids;
  }

  function drawScene(visible) {
    const canvas = $("sceneCanvas");
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#f5f7f5";
    ctx.fillRect(0, 0, rect.width, rect.height);

    const gutter = 14;
    const columnWidth = (rect.width - gutter * 3) / 2;
    const labels = [
      { title: "Máxima resolución + LRU", strategy: state.fixed, kind: "fixed", x: gutter },
      { title: "Mips adaptativos + prioridad", strategy: state.adaptive, kind: "adaptive", x: gutter * 2 + columnWidth }
    ];
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    for (const group of labels) {
      ctx.fillStyle = "#25424a";
      ctx.fillText(group.title, group.x, 20, columnWidth);
      visible.forEach((asset, index) => {
        const row = Math.floor(index / PER_REGION);
        const col = index % PER_REGION;
        const labelY = 47 + row * 93;
        if (col === 0) {
          ctx.fillStyle = "#65777d";
          ctx.font = "11px system-ui, sans-serif";
          ctx.fillText(`Región ${asset.region + 1}`, group.x, labelY, columnWidth);
          ctx.font = "600 12px system-ui, sans-serif";
        }
        const gap = 5;
        const tileWidth = Math.max(12, (columnWidth - gap * 7) / 8);
        const tileHeight = 48;
        const tileX = group.x + col * (tileWidth + gap);
        const tileY = labelY + 16;
        const tier = group.strategy.tiers[asset.id];
        const target = targetFor(asset, group.kind);
        ctx.fillStyle = tier >= target ? "#087e78" : tier > 0 ? "#d88935" : "#40535d";
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(tileX, tileY, tileWidth, tileHeight, 5);
        else ctx.rect(tileX, tileY, tileWidth, tileHeight);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(["256", "512", "1K", "2K", "4K"][tier], tileX + tileWidth / 2, tileY + 24);
        ctx.textAlign = "start";
      });
    }
  }

  function drawChart() {
    const canvas = $("chartCanvas");
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#fbfcfa";
    ctx.fillRect(0, 0, rect.width, rect.height);

    const pad = { left: 36, right: 12, top: 16, bottom: 26 };
    const width = rect.width - pad.left - pad.right;
    const height = rect.height - pad.top - pad.bottom;
    const max = Math.max(32, uploadLimit(), ...state.history.flatMap((x) => [x.fixed, x.adaptive]));
    ctx.strokeStyle = "#dfe6e2";
    ctx.lineWidth = 1;
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = "#68797e";
    for (let i = 0; i <= 2; i += 1) {
      const y = pad.top + (height * i) / 2;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(rect.width - pad.right, y); ctx.stroke();
      ctx.fillText(`${Math.round(max * (1 - i / 2))}`, 3, y + 3);
    }
    ctx.fillText("MiB", 4, 10);

    const plot = (key, color) => {
      if (!state.history.length) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      state.history.forEach((point, index) => {
        const x = pad.left + (state.history.length === 1 ? width : (index / (state.history.length - 1)) * width);
        const y = pad.top + height - (point[key] / max) * height;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    plot("fixed", "#d88935");
    plot("adaptive", "#087e78");
    ctx.fillStyle = "#68797e";
    ctx.fillText("pasos de cámara →", rect.width - 94, rect.height - 5);
  }

  function render(visible = visibleAssets()) {
    const fixedQuality = qualityCoverage(state.fixed, "fixed", visible);
    const adaptiveQuality = qualityCoverage(state.adaptive, "adaptive", visible);
    const fixedMem = residentMiB(state.fixed);
    const adaptiveMem = residentMiB(state.adaptive);
    $("stepCount").textContent = `${state.step} ${state.step === 1 ? "paso" : "pasos"}`;
    $("fixedMem").textContent = formatMiB(fixedMem);
    $("adaptiveMem").textContent = formatMiB(adaptiveMem);
    $("fixedUpload").textContent = formatMiB(state.fixed.lastUpload);
    $("adaptiveUpload").textContent = formatMiB(state.adaptive.lastUpload);
    $("qualityFixed").textContent = `${Math.round(fixedQuality * 100)}% del objetivo`;
    $("qualityAdaptive").textContent = `${Math.round(adaptiveQuality * 100)}% del objetivo`;
    $("fixedBar").style.width = `${Math.round(fixedQuality * 100)}%`;
    $("adaptiveBar").style.width = `${Math.round(adaptiveQuality * 100)}%`;
    $("simStatus").textContent = state.timer ? "En marcha" : "En pausa";

    const adaptiveIsBetter = adaptiveQuality >= fixedQuality;
    const winner = adaptiveIsBetter ? "El planificador adaptativo" : "La carga de máxima resolución";
    $("readout").innerHTML = `<strong>Qué observar:</strong> ${winner} cubre ahora ${Math.round(Math.max(adaptiveQuality, fixedQuality) * 100)}% de su propio detalle solicitado. Cada estrategia tiene un objetivo distinto; esto no es una comparación de calidad de imagen ni una prueba de rendimiento. Revisa también el gráfico de transferencia.`;
    drawScene(visible);
    drawChart();
  }

  function stop() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
    $("playBtn").textContent = "Iniciar";
    render();
  }

  function togglePlay() {
    if (state.timer) { stop(); return; }
    $("playBtn").textContent = "Pausar";
    state.timer = window.setInterval(advance, 900);
    render();
  }

  function reset() {
    stop();
    state.fixed = freshStrategy();
    state.adaptive = freshStrategy();
    state.camera = 0;
    state.step = 0;
    state.history = [];
    state.fixed.lastUpload = 0;
    state.adaptive.lastUpload = 0;
    render();
  }

  $("playBtn").addEventListener("click", togglePlay);
  $("stepBtn").addEventListener("click", advance);
  $("resetBtn").addEventListener("click", reset);
  $("speed").addEventListener("input", () => { $("speedLabel").textContent = `${cameraSpeed()}×`; });
  $("budget").addEventListener("change", reset);
  $("uploadCap").addEventListener("change", reset);
  window.addEventListener("resize", () => render());
  render();
})();

