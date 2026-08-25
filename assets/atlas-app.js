(function () {
	"use strict";

	const $ = (selector, root = document) => root.querySelector(selector);
	const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
	const CONFIG = JSON.parse($("#wd-data-config").textContent);
	const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	const REGION_LABELS = ["Karakoram", "Hindu Kush", "W. Himalaya", "C. Himalaya", "N. India"];
	const REGION_LONG = ["Karakoram", "Hindu Kush", "Western Himalaya", "Central Himalaya", "North India"];
	const REGION_COLORS = ["#8f2938", "#233f78", "#08736f", "#5c7d43", "#c3931d"];
	const REGION_KEYS = ["rk", "rh", "rw", "rc", "rn"];
	const REGION_BOXES = [[74, 78, 35, 37.5], [68, 73, 34, 37], [73, 79, 30, 34], [79, 86, 27, 30.5], [74, 85, 25, 30]];
	const SEASONS = {
		djfm: [12, 1, 2, 3],
		all: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
		amj: [4, 5, 6],
		jjas: [6, 7, 8, 9],
		on: [10, 11]
	};
	const DEFAULT_VIEW = { ...CONFIG.bounds };
	const TABLE_PAGE_SIZE = 50;
	const MAP_TRACK_LIMIT = 6500;

	let DATA;
	let CAT;
	let OFF;
	let META;
	let PLON;
	let PLAT;
	let PVORT;
	let PRAIN;
	let filtered = [];
	let selected = -1;
	let hovered = -1;
	let focusFix = 0;
	let tablePage = 0;
	let filterTimer = 0;
	let urlTimer = 0;
	let toastTimer = 0;
	let activeTab = "explore";
	let idToIndex = new Map();

	const state = {
		months: new Set(SEASONS.djfm),
		regions: new Set(),
		yearMin: 1950,
		yearMax: 2025,
		intensityMin: 0,
		rainMin: 0,
		lengthMin: 0,
		durationMin: 0,
		query: "",
		mapLayer: "auto",
		mapColour: "single",
		showRegionBoxes: true
	};

	const map = {
		base: null,
		data: null,
		overlay: null,
		baseContext: null,
		dataContext: null,
		overlayContext: null,
		pick: document.createElement("canvas"),
		pickContext: null,
		width: 1,
		height: 1,
		dpr: 1,
		view: { ...DEFAULT_VIEW },
		rendered: [],
		drag: null,
		moved: false
	};

	initialise().catch((error) => {
		console.error(error);
		const loading = $("#wdLoading");
		loading.innerHTML = `<strong>Could not load the catalogue.</strong> ${escapeHtml(error.message || String(error))}`;
		loading.setAttribute("data-tone", "flag");
	});

	async function initialise() {
		const [catalogueBuffer, fixesBuffer] = await Promise.all([
			fetchInflated(CONFIG.catalogue),
			fetchInflated(CONFIG.fixes)
		]);
		DATA = JSON.parse(new TextDecoder().decode(catalogueBuffer));
		CAT = DATA.cat;
		OFF = DATA.off;
		META = DATA.meta;

		const fixes = new Int16Array(fixesBuffer);
		if (fixes.length !== META.npts * 4) {
			throw new Error(`Fix asset contains ${fixes.length} values; expected ${META.npts * 4}.`);
		}
		PLON = fixes.subarray(0, META.npts);
		PLAT = fixes.subarray(META.npts, META.npts * 2);
		PVORT = fixes.subarray(META.npts * 2, META.npts * 3);
		PRAIN = fixes.subarray(META.npts * 3, META.npts * 4);
		for (let i = 0; i < META.ntracks; i += 1) idToIndex.set(String(CAT.id[i]), i);

		state.yearMin = Math.min(...CAT.year);
		state.yearMax = Math.max(...CAT.year);
		readUrlState();
		buildFilterControls();
		bindInterface();
		setupMap();
		$("#wdMethodTracks").textContent = META.ntracks.toLocaleString();
		$("#wdMethodFixes").textContent = META.npts.toLocaleString();
		$("#wdLoading").hidden = true;
		$("#wdFilters").hidden = false;
		applyFilters({ resetPage: false });
		if (selected >= 0) selectTrack(selected, { fit: false, updateUrl: false });
		switchTab(activeTab, { updateUrl: false });
	}

	async function fetchInflated(url) {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${response.status} while loading ${url}`);
		const compressed = await response.arrayBuffer();
		const bytes = new Uint8Array(compressed);
		if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return compressed;
		if (!("DecompressionStream" in window)) {
			throw new Error("This browser does not support gzip decompression streams.");
		}
		const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
		return new Response(stream).arrayBuffer();
	}

	function buildFilterControls() {
		const monthCounts = Array(12).fill(0);
		const regionCounts = Array(REGION_LABELS.length).fill(0);
		for (let i = 0; i < META.ntracks; i += 1) {
			monthCounts[CAT.month[i] - 1] += 1;
			regionCounts[CAT.dom[i]] += 1;
		}
		$("#wdMonthChips").innerHTML = MONTHS.map((month, index) =>
			`<button class="mla-chip" type="button" data-month="${index + 1}" aria-pressed="false">${month}<span class="mla-sr-only"> (${monthCounts[index].toLocaleString()} catalogue systems)</span></button>`
		).join("");
		$("#wdRegionChips").innerHTML = REGION_LABELS.map((region, index) =>
			`<button class="mla-chip" type="button" data-region="${index}" aria-pressed="false"><span class="mla-swatch" style="background:${REGION_COLORS[index]}"></span>${region}<span class="wd-footnote">${regionCounts[index].toLocaleString()}</span></button>`
		).join("");
		syncControlsFromState();
	}

	function bindInterface() {
		$("#wdDownloadFixes").disabled = selected < 0;
		$$('[role="tab"][data-tab]').forEach((button) => {
			button.addEventListener("click", () => switchTab(button.dataset.tab));
			button.addEventListener("keydown", handleTabKey);
		});
		$("#wdSearch").addEventListener("input", (event) => {
			state.query = event.target.value.trim();
			scheduleFilters();
		});
		for (const [id, key] of [["#wdYearMin", "yearMin"], ["#wdYearMax", "yearMax"], ["#wdLengthMin", "lengthMin"], ["#wdDurationMin", "durationMin"]]) {
			$(id).addEventListener("change", (event) => {
				state[key] = Number(event.target.value) || 0;
				applyFilters();
			});
		}
		$("#wdIntensityMin").addEventListener("input", (event) => {
			state.intensityMin = Number(event.target.value);
			$("#wdIntensityOutput").textContent = `P${state.intensityMin}+`;
			scheduleFilters();
		});
		$("#wdRainMin").addEventListener("input", (event) => {
			state.rainMin = Number(event.target.value);
			$("#wdRainOutput").textContent = `P${state.rainMin}+`;
			scheduleFilters();
		});
		$("#wdSeason").addEventListener("change", (event) => {
			if (SEASONS[event.target.value]) {
				state.months = new Set(SEASONS[event.target.value]);
				syncMonthChips();
				applyFilters();
			}
		});
		$("#wdMonthChips").addEventListener("click", (event) => {
			const button = event.target.closest("[data-month]");
			if (!button) return;
			const month = Number(button.dataset.month);
			if (state.months.has(month)) {
				if (state.months.size > 1) state.months.delete(month);
			} else {
				state.months.add(month);
			}
			syncMonthChips();
			syncSeasonSelect();
			applyFilters();
		});
		$("#wdRegionChips").addEventListener("click", (event) => {
			const button = event.target.closest("[data-region]");
			if (!button) return;
			const region = Number(button.dataset.region);
			state.regions.has(region) ? state.regions.delete(region) : state.regions.add(region);
			syncRegionChips();
			applyFilters();
		});
		$("#wdResetFilters").addEventListener("click", resetFilters);
		$("#wdShare").addEventListener("click", copyViewLink);

		$("#wdMapLayer").addEventListener("change", (event) => {
			state.mapLayer = event.target.value;
			drawMap();
			scheduleUrlUpdate();
		});
		$("#wdMapColour").addEventListener("change", (event) => {
			state.mapColour = event.target.value;
			drawMap();
			scheduleUrlUpdate();
		});
		$("#wdRegionBoxes").addEventListener("change", (event) => {
			state.showRegionBoxes = event.target.checked;
			drawMap();
			scheduleUrlUpdate();
		});
		$("#wdZoomOut").addEventListener("click", () => zoomMap(0.72));
		$("#wdZoomIn").addEventListener("click", () => zoomMap(1.38));
		$("#wdZoomReset").addEventListener("click", resetMapView);
		$("#wdFitSubset").addEventListener("click", fitSubset);

		$("#wdPreviousFix").addEventListener("click", () => setFocusFix(focusFix - 1));
		$("#wdNextFix").addEventListener("click", () => setFocusFix(focusFix + 1));
		$("#wdTrackFix").addEventListener("input", (event) => setFocusFix(Number(event.target.value)));
		$("#wdEvolutionMetric").addEventListener("change", drawLifeChart);
		$("#wdProfileMetric").addEventListener("change", drawProfileChart);
		$("#wdTableSort").addEventListener("change", () => { tablePage = 0; renderTable(); });
		$("#wdTablePrevious").addEventListener("click", () => { tablePage = Math.max(0, tablePage - 1); renderTable(); });
		$("#wdTableNext").addEventListener("click", () => { tablePage += 1; renderTable(); });
		$("#wdExtremeMetric").addEventListener("change", renderExtremes);

		$("#wdDownloadSummaries").addEventListener("click", downloadSummaries);
		$("#wdDownloadGeojson").addEventListener("click", downloadGeoJson);
		$("#wdDownloadQuery").addEventListener("click", downloadQuery);
		$("#wdDownloadFixes").addEventListener("click", downloadSelectedFixes);

		window.addEventListener("resize", debounce(() => renderActiveTab(), 160));
		window.addEventListener("popstate", () => window.location.reload());
	}

	function scheduleFilters() {
		window.clearTimeout(filterTimer);
		filterTimer = window.setTimeout(() => applyFilters(), 90);
	}

	function resetFilters() {
		state.months = new Set(SEASONS.djfm);
		state.regions.clear();
		state.yearMin = Math.min(...CAT.year);
		state.yearMax = Math.max(...CAT.year);
		state.intensityMin = 0;
		state.rainMin = 0;
		state.lengthMin = 0;
		state.durationMin = 0;
		state.query = "";
		syncControlsFromState();
		applyFilters();
	}

	function syncControlsFromState() {
		$("#wdSearch").value = state.query;
		$("#wdYearMin").value = state.yearMin;
		$("#wdYearMax").value = state.yearMax;
		$("#wdIntensityMin").value = state.intensityMin;
		$("#wdIntensityOutput").textContent = `P${state.intensityMin}+`;
		$("#wdRainMin").value = state.rainMin;
		$("#wdRainOutput").textContent = `P${state.rainMin}+`;
		$("#wdLengthMin").value = state.lengthMin;
		$("#wdDurationMin").value = state.durationMin;
		$("#wdMapLayer").value = state.mapLayer;
		$("#wdMapColour").value = state.mapColour;
		$("#wdRegionBoxes").checked = state.showRegionBoxes;
		syncMonthChips();
		syncRegionChips();
		syncSeasonSelect();
	}

	function syncMonthChips() {
		$$('[data-month]', $("#wdMonthChips")).forEach((button) => {
			button.setAttribute("aria-pressed", String(state.months.has(Number(button.dataset.month))));
		});
	}

	function syncRegionChips() {
		$$('[data-region]', $("#wdRegionChips")).forEach((button) => {
			button.setAttribute("aria-pressed", String(state.regions.has(Number(button.dataset.region))));
		});
	}

	function syncSeasonSelect() {
		const months = [...state.months].sort((a, b) => a - b).join(",");
		const match = Object.entries(SEASONS).find(([, values]) => [...values].sort((a, b) => a - b).join(",") === months);
		if (match) {
			$("#wdSeason").value = match[0];
		} else {
			let custom = $('#wdSeason option[value="custom"]');
			if (!custom) {
				custom = document.createElement("option");
				custom.value = "custom";
				custom.textContent = "Custom months";
				$("#wdSeason").appendChild(custom);
			}
			$("#wdSeason").value = "custom";
		}
	}

	function applyFilters(options = {}) {
		const yearMin = Math.min(state.yearMin, state.yearMax);
		const yearMax = Math.max(state.yearMin, state.yearMax);
		const useRegions = state.regions.size > 0;
		const query = state.query.toLowerCase();
		const dateQuery = /^\d{4}-\d{2}-\d{2}$/.test(query) ? query : "";
		const idQuery = query.replace(/^wd\s*#?\s*/i, "");
		const next = [];
		for (let i = 0; i < META.ntracks; i += 1) {
			if (!state.months.has(CAT.month[i])) continue;
			if (CAT.year[i] < yearMin || CAT.year[i] > yearMax) continue;
			if (CAT.pct_int[i] < state.intensityMin || CAT.pct_pr[i] < state.rainMin) continue;
			if (CAT.len_km[i] < state.lengthMin || CAT.dur[i] < state.durationMin) continue;
			if (useRegions && !state.regions.has(CAT.dom[i])) continue;
			if (query) {
				if (dateQuery) {
					if (genesisDate(i) !== dateQuery) continue;
				} else if (!String(CAT.id[i]).includes(idQuery)) continue;
			}
			next.push(i);
		}
		filtered = next;
		if (options.resetPage !== false) tablePage = 0;
		updateFilterSummary();
		updateStats();
		renderTable();
		renderDossier();
		renderActiveTab();
		scheduleUrlUpdate();
	}

	function updateFilterSummary() {
		$("#wdResultCount").innerHTML = `<strong>${filtered.length.toLocaleString()}</strong> of ${META.ntracks.toLocaleString()} disturbances`;
		const pieces = [];
		if (state.intensityMin) pieces.push(`vorticity P${state.intensityMin}+`);
		if (state.rainMin) pieces.push(`rain P${state.rainMin}+`);
		if (state.regions.size) pieces.push(`${state.regions.size} impact region${state.regions.size === 1 ? "" : "s"}`);
		$("#wdFilterBadge").textContent = pieces.length ? pieces.join(" · ") : describeMonths();
	}

	function describeMonths() {
		const match = Object.entries(SEASONS).find(([, values]) => sameSet(state.months, new Set(values)));
		return match ? ({ djfm: "Winter selection", all: "All months", amj: "Spring selection", jjas: "Summer-monsoon selection", on: "Autumn selection" })[match[0]] : `${state.months.size} selected months`;
	}

	function updateStats() {
		let intensity = 0;
		let rain = 0;
		let duration = 0;
		for (const index of filtered) {
			intensity += CAT.pk_int[index];
			rain += CAT.pk_pr[index];
			duration += CAT.dur[index];
		}
		const count = filtered.length || 1;
		const cards = [
			["Systems", filtered.length.toLocaleString(), `${(filtered.length / META.ntracks * 100).toFixed(1)}% of catalogue`],
			["Mean peak ζ", filtered.length ? (intensity / count).toFixed(1) : "—", "10⁻⁵ s⁻¹ · 450–300 hPa"],
			["Mean peak rain", filtered.length ? (rain / count).toFixed(1) : "—", "mm · track-centred 24 h"],
			["Mean lifetime", filtered.length ? Math.round(duration / count).toLocaleString() : "—", "hours"]
		];
		$("#wdStats").innerHTML = cards.map(([label, value, note]) => `<div class="mla-card mla-stat"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join("");
	}

	function switchTab(tab, options = {}) {
		if (!$( `[data-panel="${tab}"]` )) tab = "explore";
		activeTab = tab;
		$$('[role="tab"][data-tab]').forEach((button) => {
			const active = button.dataset.tab === tab;
			button.setAttribute("aria-selected", String(active));
			button.tabIndex = active ? 0 : -1;
		});
		$$('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
		renderActiveTab();
		if (options.updateUrl !== false) scheduleUrlUpdate();
	}

	function handleTabKey(event) {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const tabs = $$('[role="tab"][data-tab]');
		let index = tabs.indexOf(event.currentTarget);
		if (event.key === "ArrowRight") index = (index + 1) % tabs.length;
		if (event.key === "ArrowLeft") index = (index - 1 + tabs.length) % tabs.length;
		if (event.key === "Home") index = 0;
		if (event.key === "End") index = tabs.length - 1;
		tabs[index].focus();
		switchTab(tabs[index].dataset.tab);
	}

	function renderActiveTab() {
		if (!DATA) return;
		if (activeTab === "explore") {
			sizeMap();
			drawMap();
			drawLifeChart();
			drawProfileChart();
		} else if (activeTab === "climatology") {
			drawClimatology();
		} else if (activeTab === "extremes") {
			renderExtremes();
		}
	}

	function setupMap() {
		map.base = $("#wdMapBase");
		map.data = $("#wdMapData");
		map.overlay = $("#mlaMapOverlay");
		map.baseContext = map.base.getContext("2d");
		map.dataContext = map.data.getContext("2d");
		map.overlayContext = map.overlay.getContext("2d");
		map.pickContext = map.pick.getContext("2d", { willReadFrequently: true });

		map.overlay.addEventListener("pointerdown", (event) => {
			map.drag = { x: event.clientX, y: event.clientY, view: { ...map.view }, pointerId: event.pointerId };
			map.moved = false;
			map.overlay.setPointerCapture(event.pointerId);
			map.overlay.classList.add("is-dragging");
		});
		map.overlay.addEventListener("pointermove", (event) => {
			if (map.drag) {
				const dx = event.clientX - map.drag.x;
				const dy = event.clientY - map.drag.y;
				if (Math.hypot(dx, dy) > 3) map.moved = true;
				const spanLon = map.drag.view.east - map.drag.view.west;
				const spanLat = map.drag.view.north - map.drag.view.south;
				map.view.west = map.drag.view.west - dx / map.width * spanLon;
				map.view.east = map.drag.view.east - dx / map.width * spanLon;
				map.view.south = map.drag.view.south + dy / map.height * spanLat;
				map.view.north = map.drag.view.north + dy / map.height * spanLat;
				clampMapView();
				drawMap();
			} else {
				handleMapHover(event);
			}
		});
		map.overlay.addEventListener("pointerup", (event) => {
			if (map.drag && !map.moved) selectMapFeature(event);
			map.drag = null;
			map.overlay.classList.remove("is-dragging");
			try { map.overlay.releasePointerCapture(event.pointerId); } catch (_) { /* already released */ }
			scheduleUrlUpdate();
		});
		map.overlay.addEventListener("pointercancel", () => {
			map.drag = null;
			map.overlay.classList.remove("is-dragging");
		});
		map.overlay.addEventListener("pointerleave", () => {
			if (!map.drag) {
				hovered = -1;
				hideMapTip();
				drawMapOverlay();
			}
		});
		map.overlay.addEventListener("wheel", (event) => {
			event.preventDefault();
			const rect = map.overlay.getBoundingClientRect();
			const focus = screenToLonLat(event.clientX - rect.left, event.clientY - rect.top);
			zoomMap(event.deltaY < 0 ? 1.25 : 0.8, focus);
		}, { passive: false });
	}

	function sizeMap() {
		const rect = $("#wdMapStack").getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return false;
		map.width = rect.width;
		map.height = rect.height;
		map.dpr = Math.min(window.devicePixelRatio || 1, window.matchMedia("(max-width:760px)").matches ? 1.5 : 2);
		for (const canvas of [map.base, map.data, map.overlay]) {
			canvas.width = Math.round(map.width * map.dpr);
			canvas.height = Math.round(map.height * map.dpr);
		}
		for (const context of [map.baseContext, map.dataContext, map.overlayContext]) {
			context.setTransform(map.dpr, 0, 0, map.dpr, 0, 0);
		}
		map.pick.width = Math.round(map.width);
		map.pick.height = Math.round(map.height);
		return true;
	}

	function drawMap() {
		if (!map.base || map.width < 2) return;
		drawMapBase();
		drawMapData();
		drawMapOverlay();
	}

	function drawMapBase() {
		const context = map.baseContext;
		context.clearRect(0, 0, map.width, map.height);
		context.fillStyle = css("--mla-sea", "#e7eee7");
		context.fillRect(0, 0, map.width, map.height);
		context.save();
		context.strokeStyle = "rgba(43, 33, 25, .14)";
		context.fillStyle = "rgba(43, 33, 25, .58)";
		context.lineWidth = 1;
		context.font = "10px effra, Arial, sans-serif";
		for (let lon = Math.ceil(map.view.west / 10) * 10; lon <= map.view.east; lon += 10) {
			const x = projectX(lon);
			context.beginPath(); context.moveTo(x, 0); context.lineTo(x, map.height); context.stroke();
			context.fillText(`${Math.abs(lon)}°${lon < 0 ? "W" : "E"}`, x + 4, map.height - 8);
		}
		for (let lat = Math.ceil(map.view.south / 10) * 10; lat <= map.view.north; lat += 10) {
			const y = projectY(lat);
			context.beginPath(); context.moveTo(0, y); context.lineTo(map.width, y); context.stroke();
			context.fillText(`${Math.abs(lat)}°${lat < 0 ? "S" : "N"}`, 5, y - 5);
		}
		context.restore();

		drawContextLines(context, window.WD_COAST_LINES || [], "rgba(53, 70, 62, .60)", 1.15);
		drawContextLines(context, window.WD_BORDER_LINES || [], "rgba(78, 60, 43, .46)", 0.8);
		if (state.showRegionBoxes) drawImpactBoxes(context);
	}

	function drawContextLines(context, lines, stroke, width) {
		context.save();
		context.strokeStyle = stroke;
		context.lineWidth = width;
		context.lineJoin = "round";
		context.lineCap = "round";
		for (const line of lines) {
			if (line.length < 4) continue;
			context.beginPath();
			for (let i = 0; i < line.length; i += 2) {
				const x = projectX(line[i] / 10);
				const y = projectY(line[i + 1] / 10);
				i === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
			}
			context.stroke();
		}
		context.restore();
	}

	function drawImpactBoxes(context) {
		context.save();
		context.setLineDash([4, 4]);
		context.font = "10px effra, Arial, sans-serif";
		context.textBaseline = "top";
		REGION_BOXES.forEach((box, index) => {
			const x = projectX(box[0]);
			const x2 = projectX(box[1]);
			const y = projectY(box[3]);
			const y2 = projectY(box[2]);
			context.fillStyle = withAlpha(REGION_COLORS[index], 0.075);
			context.strokeStyle = withAlpha(REGION_COLORS[index], 0.62);
			context.fillRect(x, y, x2 - x, y2 - y);
			context.strokeRect(x, y, x2 - x, y2 - y);
			context.fillStyle = REGION_COLORS[index];
			context.fillText(REGION_LABELS[index], x + 3, y + 3);
		});
		context.restore();
	}

	function drawMapData() {
		const context = map.dataContext;
		context.clearRect(0, 0, map.width, map.height);
		map.pickContext.clearRect(0, 0, map.width, map.height);
		map.rendered = [];
		const layer = resolvedMapLayer();
		if (layer === "density") drawDensity(context);
		else if (layer === "tracks") drawTracks(context);
		else drawEndpoints(context, layer === "lysis");
		updateMapLegend(layer);
	}

	function resolvedMapLayer() {
		return state.mapLayer === "auto" ? (filtered.length > 700 ? "density" : "tracks") : state.mapLayer;
	}

	function drawDensity(context) {
		const grid = new Map();
		for (const index of filtered) {
			const [start, length] = OFF[index];
			const cells = new Set();
			for (let j = 0; j < length; j += 1) {
				const point = start + j;
				const lon = Math.floor(PLON[point] / 100);
				const lat = Math.floor(PLAT[point] / 100);
				cells.add(`${lon},${lat}`);
			}
			for (const key of cells) grid.set(key, (grid.get(key) || 0) + 1);
		}
		const maximum = Math.max(1, ...grid.values());
		for (const [key, count] of grid) {
			const [lon, lat] = key.split(",").map(Number);
			if (lon + 1 < map.view.west || lon > map.view.east || lat + 1 < map.view.south || lat > map.view.north) continue;
			const x = projectX(lon);
			const y = projectY(lat + 1);
			const width = projectX(lon + 1) - x + 0.5;
			const height = projectY(lat) - y + 0.5;
			context.fillStyle = densityColour(Math.sqrt(count / maximum));
			context.fillRect(x, y, width, height);
		}
	}

	function drawTracks(context) {
		let list = filtered;
		if (list.length > MAP_TRACK_LIMIT) {
			const sampled = [];
			const step = list.length / MAP_TRACK_LIMIT;
			for (let cursor = 0; cursor < list.length; cursor += step) sampled.push(list[Math.floor(cursor)]);
			if (selected >= 0 && !sampled.includes(selected)) sampled.push(selected);
			list = sampled;
		}
		map.rendered = list;
		const alpha = list.length > 4000 ? 0.16 : list.length > 1200 ? 0.26 : list.length > 300 ? 0.43 : 0.76;
		const width = list.length > 2000 ? 0.7 : list.length > 500 ? 0.9 : 1.25;
		context.save();
		context.lineJoin = "round";
		context.lineCap = "round";
		map.pickContext.lineJoin = "round";
		map.pickContext.lineCap = "round";
		map.pickContext.lineWidth = 7;
		for (let renderedIndex = 0; renderedIndex < list.length; renderedIndex += 1) {
			const index = list[renderedIndex];
			drawTrackPath(context, index, colourForTrack(index), width, alpha);
			const pickId = renderedIndex + 1;
			drawTrackPath(map.pickContext, index, `rgb(${pickId & 255},${(pickId >> 8) & 255},${(pickId >> 16) & 255})`, 7, 1);
		}
		context.restore();
	}

	function drawEndpoints(context, useLysis) {
		let list = filtered;
		if (list.length > 12000) {
			const step = list.length / 12000;
			list = Array.from({ length: 12000 }, (_, i) => list[Math.floor(i * step)]);
		}
		map.rendered = list;
		for (let renderedIndex = 0; renderedIndex < list.length; renderedIndex += 1) {
			const index = list[renderedIndex];
			const [start, length] = OFF[index];
			const point = useLysis ? start + length - 1 : start;
			const x = projectX(PLON[point] / 100);
			const y = projectY(PLAT[point] / 100);
			context.beginPath();
			context.arc(x, y, filtered.length > 3000 ? 1.5 : 2.5, 0, Math.PI * 2);
			context.fillStyle = withAlpha(colourForTrack(index), filtered.length > 3000 ? 0.45 : 0.78);
			context.fill();
			const pickId = renderedIndex + 1;
			map.pickContext.beginPath();
			map.pickContext.arc(x, y, 6, 0, Math.PI * 2);
			map.pickContext.fillStyle = `rgb(${pickId & 255},${(pickId >> 8) & 255},${(pickId >> 16) & 255})`;
			map.pickContext.fill();
		}
	}

	function drawTrackPath(context, index, stroke, width, alpha) {
		const [start, length] = OFF[index];
		context.beginPath();
		for (let j = 0; j < length; j += 1) {
			const point = start + j;
			const x = projectX(PLON[point] / 100);
			const y = projectY(PLAT[point] / 100);
			j === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
		}
		context.globalAlpha = alpha;
		context.strokeStyle = stroke;
		context.lineWidth = width;
		context.stroke();
		context.globalAlpha = 1;
	}

	function drawMapOverlay() {
		const context = map.overlayContext;
		context.clearRect(0, 0, map.width, map.height);
		if (hovered >= 0 && hovered !== selected) drawHighlightedTrack(context, hovered, "#fffaf0", 3, false);
		if (selected >= 0) drawHighlightedTrack(context, selected, colourForTrack(selected), 3.2, true);
	}

	function drawHighlightedTrack(context, index, colour, width, showFocus) {
		context.save();
		context.shadowColor = "rgba(23, 41, 79, .55)";
		context.shadowBlur = 8;
		drawTrackPath(context, index, colour, width, 1);
		context.shadowBlur = 0;
		const [start, length] = OFF[index];
		const genesis = [projectX(PLON[start] / 100), projectY(PLAT[start] / 100)];
		const lysis = [projectX(PLON[start + length - 1] / 100), projectY(PLAT[start + length - 1] / 100)];
		context.lineWidth = 2;
		context.strokeStyle = colour;
		context.fillStyle = css("--mla-card", "#fffaf0");
		context.beginPath(); context.arc(genesis[0], genesis[1], 4.5, 0, Math.PI * 2); context.fill(); context.stroke();
		context.fillStyle = colour;
		context.beginPath(); context.arc(lysis[0], lysis[1], 4.5, 0, Math.PI * 2); context.fill();
		if (showFocus) {
			const point = start + clamp(focusFix, 0, length - 1);
			const x = projectX(PLON[point] / 100);
			const y = projectY(PLAT[point] / 100);
			const radius = 6 + clamp((PVORT[point] / 10 - 10) / 8, 0, 6);
			context.fillStyle = withAlpha(vorticityColour(PVORT[point] / 10), 0.22);
			context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
			context.fillStyle = vorticityColour(PVORT[point] / 10);
			context.strokeStyle = css("--mla-card", "#fffaf0");
			context.lineWidth = 2;
			context.beginPath(); context.arc(x, y, 4, 0, Math.PI * 2); context.fill(); context.stroke();
		}
		context.restore();
	}

	function handleMapHover(event) {
		const index = pickMapFeature(event.clientX, event.clientY, 3);
		if (index !== hovered) {
			hovered = index;
			drawMapOverlay();
		}
		if (index < 0) {
			hideMapTip();
			return;
		}
		const rect = $("#wdMapStack").getBoundingClientRect();
		const tip = $("#wdMapTip");
		tip.innerHTML = `<strong>WD ${CAT.id[index]}</strong><br>${formatGenesis(index)} · ${REGION_LONG[CAT.dom[index]]}<br>Peak ζ ${CAT.pk_int[index].toFixed(1)} ×10⁻⁵ s⁻¹ (P${Math.round(CAT.pct_int[index])}) · ${CAT.pk_pr[index].toFixed(1)} mm`;
		tip.style.left = `${event.clientX - rect.left}px`;
		tip.style.top = `${event.clientY - rect.top}px`;
		tip.dataset.visible = "true";
	}

	function hideMapTip() {
		$("#wdMapTip").dataset.visible = "false";
	}

	function selectMapFeature(event) {
		const index = pickMapFeature(event.clientX, event.clientY, window.matchMedia("(pointer:coarse)").matches ? 15 : 5);
		if (index < 0) return;
		if (index === selected) {
			const rect = map.overlay.getBoundingClientRect();
			focusFix = nearestFix(index, event.clientX - rect.left, event.clientY - rect.top);
		}
		selectTrack(index, { fit: false });
	}

	function pickMapFeature(clientX, clientY, tolerance) {
		if (!map.rendered.length) return -1;
		const rect = map.overlay.getBoundingClientRect();
		const centerX = Math.round(clientX - rect.left);
		const centerY = Math.round(clientY - rect.top);
		const x0 = Math.max(0, centerX - tolerance);
		const y0 = Math.max(0, centerY - tolerance);
		const x1 = Math.min(map.pick.width - 1, centerX + tolerance);
		const y1 = Math.min(map.pick.height - 1, centerY + tolerance);
		if (x1 < x0 || y1 < y0) return -1;
		const width = x1 - x0 + 1;
		const height = y1 - y0 + 1;
		const pixels = map.pickContext.getImageData(x0, y0, width, height).data;
		let bestId = 0;
		let bestDistance = Infinity;
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const offset = (y * width + x) * 4;
				const id = pixels[offset] | (pixels[offset + 1] << 8) | (pixels[offset + 2] << 16);
				if (!id) continue;
				const distance = (x0 + x - centerX) ** 2 + (y0 + y - centerY) ** 2;
				if (distance < bestDistance) { bestDistance = distance; bestId = id; }
			}
		}
		return bestId > 0 && bestId <= map.rendered.length ? map.rendered[bestId - 1] : -1;
	}

	function nearestFix(index, screenX, screenY) {
		const [start, length] = OFF[index];
		let nearest = 0;
		let distance = Infinity;
		for (let j = 0; j < length; j += 1) {
			const point = start + j;
			const dx = projectX(PLON[point] / 100) - screenX;
			const dy = projectY(PLAT[point] / 100) - screenY;
			const next = dx * dx + dy * dy;
			if (next < distance) { distance = next; nearest = j; }
		}
		return nearest;
	}

	function updateMapLegend(layer) {
		const legend = $("#wdMapLegend");
		if (layer === "density") {
			legend.innerHTML = '<span class="mla-legend-item"><span class="mla-swatch" style="background:linear-gradient(90deg,#d7e7df,#08736f,#17294f)"></span>Unique-track density · 1° cells</span>';
			return;
		}
		if (state.mapColour === "region") {
			legend.innerHTML = REGION_LABELS.map((label, index) => `<span class="mla-legend-item"><span class="mla-swatch" style="background:${REGION_COLORS[index]}"></span>${label}</span>`).join("");
		} else if (state.mapColour === "intensity") {
			legend.innerHTML = '<span class="mla-legend-item"><span class="mla-swatch" style="background:linear-gradient(90deg,#3978a8,#08736f,#c3931d,#aa3d2d,#8f2938)"></span>Peak 450–300 hPa vorticity percentile</span>';
		} else if (state.mapColour === "year") {
			legend.innerHTML = '<span class="mla-legend-item"><span class="mla-swatch" style="background:linear-gradient(90deg,#233f78,#08736f,#c3931d,#aa3d2d)"></span>Genesis year · 1950–2025</span>';
		} else {
			legend.innerHTML = `<span class="mla-legend-item"><span class="mla-swatch" style="background:${css("--mla-atlas-blue", "#3978a8")}"></span>${layer === "tracks" ? "Individual trajectories" : layer === "genesis" ? "Genesis locations" : "Lysis locations"}</span>`;
		}
		if (selected >= 0) legend.insertAdjacentHTML("beforeend", '<span class="wd-map-marker-key"><i></i><i></i> genesis / lysis</span>');
	}

	function colourForTrack(index) {
		if (state.mapColour === "region") return REGION_COLORS[CAT.dom[index]];
		if (state.mapColour === "intensity") return percentileColour(CAT.pct_int[index]);
		if (state.mapColour === "year") return yearColour(CAT.year[index]);
		return css("--mla-atlas-blue", "#3978a8");
	}

	function projectX(lon) { return (lon - map.view.west) / (map.view.east - map.view.west) * map.width; }
	function projectY(lat) { return (map.view.north - lat) / (map.view.north - map.view.south) * map.height; }
	function screenToLonLat(x, y) {
		return {
			lon: map.view.west + x / map.width * (map.view.east - map.view.west),
			lat: map.view.north - y / map.height * (map.view.north - map.view.south)
		};
	}

	function zoomMap(factor, focus = null) {
		const center = focus || { lon: (map.view.west + map.view.east) / 2, lat: (map.view.south + map.view.north) / 2 };
		const nextWidth = clamp((map.view.east - map.view.west) / factor, 6, DEFAULT_VIEW.east - DEFAULT_VIEW.west + 30);
		const nextHeight = clamp((map.view.north - map.view.south) / factor, 4, DEFAULT_VIEW.north - DEFAULT_VIEW.south + 20);
		const fx = (center.lon - map.view.west) / (map.view.east - map.view.west);
		const fy = (map.view.north - center.lat) / (map.view.north - map.view.south);
		map.view.west = center.lon - fx * nextWidth;
		map.view.east = map.view.west + nextWidth;
		map.view.north = center.lat + fy * nextHeight;
		map.view.south = map.view.north - nextHeight;
		clampMapView();
		drawMap();
		scheduleUrlUpdate();
	}

	function clampMapView() {
		const lonSpan = map.view.east - map.view.west;
		const latSpan = map.view.north - map.view.south;
		if (map.view.west < -20) { map.view.west = -20; map.view.east = map.view.west + lonSpan; }
		if (map.view.east > 145) { map.view.east = 145; map.view.west = map.view.east - lonSpan; }
		if (map.view.south < -10) { map.view.south = -10; map.view.north = map.view.south + latSpan; }
		if (map.view.north > 75) { map.view.north = 75; map.view.south = map.view.north - latSpan; }
	}

	function resetMapView() {
		map.view = { ...DEFAULT_VIEW };
		drawMap();
		scheduleUrlUpdate();
	}

	function fitSubset() {
		if (!filtered.length) return;
		let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
		for (const index of filtered) {
			const [start, length] = OFF[index];
			for (let j = 0; j < length; j += 1) {
				const point = start + j;
				const lon = PLON[point] / 100;
				const lat = PLAT[point] / 100;
				west = Math.min(west, lon); east = Math.max(east, lon);
				south = Math.min(south, lat); north = Math.max(north, lat);
			}
		}
		const lonPad = Math.max(2, (east - west) * 0.06);
		const latPad = Math.max(1.5, (north - south) * 0.08);
		map.view = { west: west - lonPad, east: east + lonPad, south: south - latPad, north: north + latPad };
		clampMapView();
		drawMap();
		scheduleUrlUpdate();
	}

	function selectTrack(index, options = {}) {
		if (index < 0 || index >= META.ntracks) return;
		const changed = selected !== index;
		selected = index;
		if (changed) {
			const [start, length] = OFF[index];
			let peak = 0;
			for (let j = 1; j < length; j += 1) {
				if (PVORT[start + j] > PVORT[start + peak]) peak = j;
			}
			focusFix = peak;
		}
		const length = OFF[index][1];
		$("#wdTrackFix").max = Math.max(0, length - 1);
		$("#wdTrackFix").value = focusFix;
		$("#wdTimeControls").hidden = false;
		$("#wdDownloadFixes").disabled = false;
		renderDossier();
		renderTable();
		updateFocusReadout();
		drawMap();
		drawLifeChart();
		if (options.fit) fitSelectedTrack(index);
		if (options.updateUrl !== false) scheduleUrlUpdate();
	}

	function clearSelection() {
		selected = -1;
		hovered = -1;
		focusFix = 0;
		$("#wdTimeControls").hidden = true;
		$("#wdDownloadFixes").disabled = true;
		renderDossier();
		renderTable();
		drawMap();
		drawLifeChart();
		scheduleUrlUpdate();
	}

	function fitSelectedTrack(index) {
		const [start, length] = OFF[index];
		let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
		for (let j = 0; j < length; j += 1) {
			const point = start + j;
			const lon = PLON[point] / 100;
			const lat = PLAT[point] / 100;
			west = Math.min(west, lon); east = Math.max(east, lon);
			south = Math.min(south, lat); north = Math.max(north, lat);
		}
		const lonPad = Math.max(2, (east - west) * 0.12);
		const latPad = Math.max(1.5, (north - south) * 0.16);
		map.view = { west: west - lonPad, east: east + lonPad, south: south - latPad, north: north + latPad };
		clampMapView();
		drawMap();
		scheduleUrlUpdate();
	}

	function setFocusFix(value) {
		if (selected < 0) return;
		focusFix = clamp(value, 0, OFF[selected][1] - 1);
		$("#wdTrackFix").value = focusFix;
		updateFocusReadout();
		drawMapOverlay();
		drawLifeChart();
	}

	function updateFocusReadout() {
		if (selected < 0) return;
		const [start] = OFF[selected];
		const point = start + focusFix;
		$("#wdFocusTime").textContent = `${formatTrackTime(selected, focusFix)} · ${(PLAT[point] / 100).toFixed(2)}°N, ${(PLON[point] / 100).toFixed(2)}°E`;
		$("#wdFocusVort").textContent = `${(PVORT[point] / 10).toFixed(1)} ×10⁻⁵ s⁻¹`;
		$("#wdPreviousFix").disabled = focusFix <= 0;
		$("#wdNextFix").disabled = focusFix >= OFF[selected][1] - 1;
	}

	function renderDossier() {
		const dossier = $("#wdDossier");
		if (selected < 0) {
			dossier.innerHTML = '<p class="mla-dossier-empty">Select a track on the map or from a table to open its dossier.</p>';
			return;
		}
		const index = selected;
		const [start, length] = OFF[index];
		const last = start + length - 1;
		const regionValues = REGION_KEYS.map((key) => Number(CAT[key][index]) || 0);
		const maximumRegion = Math.max(1, ...regionValues);
		dossier.innerHTML = `
			<div class="mla-dossier-head">
				<div><span class="mla-badge" data-tone="official">WD ${CAT.id[index]}</span><h3>${formatGenesis(index)}</h3><p class="mla-dossier-sub"><span class="mla-swatch" style="background:${REGION_COLORS[CAT.dom[index]]}"></span> Dominant rain: ${REGION_LONG[CAT.dom[index]]}</p></div>
				<button class="mla-btn mla-btn-icon mla-btn-small" id="wdCloseDossier" type="button" aria-label="Close dossier">×</button>
			</div>
			<div class="mla-fact-grid">
				<div class="mla-fact"><span>Peak 450–300 hPa ζ</span><strong>${CAT.pk_int[index].toFixed(1)}</strong><small>10⁻⁵ s⁻¹ · P${Math.round(CAT.pct_int[index])}</small></div>
				<div class="mla-fact"><span>Peak 24 h rain</span><strong>${CAT.pk_pr[index].toFixed(1)} mm</strong><small>P${Math.round(CAT.pct_pr[index])}</small></div>
				<div class="mla-fact"><span>Path length</span><strong>${Math.round(CAT.len_km[index]).toLocaleString()} km</strong><small>P${Math.round(CAT.pct_len[index])}</small></div>
				<div class="mla-fact"><span>Lifetime</span><strong>${CAT.dur[index]} h</strong><small>${length} three-hourly fixes</small></div>
				<div class="mla-fact"><span>Genesis</span><strong class="wd-coordinate">${(PLAT[start] / 100).toFixed(2)}°N</strong><small>${(PLON[start] / 100).toFixed(2)}°E</small></div>
				<div class="mla-fact"><span>Lysis</span><strong class="wd-coordinate">${(PLAT[last] / 100).toFixed(2)}°N</strong><small>${(PLON[last] / 100).toFixed(2)}°E · ${formatTrackTime(index, length - 1)}</small></div>
			</div>
			<div class="mla-match-box"><h4>Peak regional 24 h rainfall</h4><div class="wd-region-list">${regionValues.map((value, region) => `<div class="wd-region-row"><span>${REGION_LABELS[region]}</span><span class="wd-region-bar"><i style="width:${value / maximumRegion * 100}%;background:${REGION_COLORS[region]}"></i></span><strong>${value.toFixed(1)} mm</strong></div>`).join("")}</div></div>
			<div class="mla-dossier-actions"><button class="mla-btn mla-btn-small" id="wdFitSelected" type="button">Fit track on map</button><button class="mla-btn mla-btn-small" id="wdDossierDownload" type="button">Download fixes</button></div>`;
		$("#wdCloseDossier").addEventListener("click", clearSelection);
		$("#wdFitSelected").addEventListener("click", () => fitSelectedTrack(index));
		$("#wdDossierDownload").addEventListener("click", downloadSelectedFixes);
	}

	function renderTable() {
		if (!CAT) return;
		const sort = $("#wdTableSort").value;
		const direction = sort === "date" ? -1 : -1;
		const ordered = filtered.slice().sort((a, b) => (tableSortValue(a, sort) - tableSortValue(b, sort)) * direction || CAT.id[a] - CAT.id[b]);
		const pages = Math.max(1, Math.ceil(ordered.length / TABLE_PAGE_SIZE));
		tablePage = clamp(tablePage, 0, pages - 1);
		const start = tablePage * TABLE_PAGE_SIZE;
		const rows = ordered.slice(start, start + TABLE_PAGE_SIZE);
		const table = $("#wdTopTable");
		table.tHead.innerHTML = '<tr><th>Track</th><th>Genesis</th><th>Dominant rain region</th><th class="mla-num">Peak ζ</th><th class="mla-num">Peak rain</th><th class="mla-num">Length</th><th class="mla-num">Duration</th></tr>';
		table.tBodies[0].innerHTML = rows.map((index) => `<tr data-index="${index}" data-selected="${index === selected}"><td><button class="mla-row-button" type="button">WD ${CAT.id[index]}</button></td><td>${formatGenesis(index)}</td><td><span class="mla-swatch" style="background:${REGION_COLORS[CAT.dom[index]]}"></span> ${REGION_LABELS[CAT.dom[index]]}</td><td class="mla-num">${CAT.pk_int[index].toFixed(1)} <span class="wd-footnote">P${Math.round(CAT.pct_int[index])}</span></td><td class="mla-num">${CAT.pk_pr[index].toFixed(1)} mm</td><td class="mla-num">${Math.round(CAT.len_km[index]).toLocaleString()} km</td><td class="mla-num">${CAT.dur[index]} h</td></tr>`).join("");
		$$('[data-index]', table.tBodies[0]).forEach((row) => row.addEventListener("click", () => selectTrack(Number(row.dataset.index), { fit: false })));
		$("#wdTablePage").textContent = ordered.length ? `Showing ${start + 1}–${Math.min(start + TABLE_PAGE_SIZE, ordered.length)} of ${ordered.length.toLocaleString()} · page ${tablePage + 1} of ${pages}` : "No systems match the filters";
		$("#wdTablePrevious").disabled = tablePage === 0;
		$("#wdTableNext").disabled = tablePage >= pages - 1;
	}

	function tableSortValue(index, sort) {
		if (sort === "intensity") return CAT.pk_int[index];
		if (sort === "rain") return CAT.pk_pr[index];
		if (sort === "length") return CAT.len_km[index];
		if (sort === "duration") return CAT.dur[index];
		return genesisMillis(index);
	}

	function drawLifeChart() {
		const canvas = $("#wdLifeChart");
		const chart = prepareCanvas(canvas);
		if (!chart) return;
		const { context, width, height } = chart;
		if (selected < 0) {
			drawEmptyChart(context, width, height, "Select a disturbance to inspect its three-hourly evolution.");
			$("#wdLifeData").innerHTML = "";
			return;
		}
		const points = trackPoints(selected);
		const metric = $("#wdEvolutionMetric").value;
		const values = points.map((point) => metric === "rain" ? (point.rain ?? 0) : point.vorticity);
		const rains = points.map((point) => point.rain ?? 0);
		const plot = chartFrame(context, width, height, {
			left: 52,
			right: metric === "vorticity" ? 46 : 22,
			top: 25,
			bottom: 42,
			yMax: niceMaximum(values),
			yLabel: metric === "rain" ? "24 h rain (mm)" : "450–300 hPa ζ (10⁻⁵ s⁻¹)",
			xLabel: "Hours since genesis"
		});
		const x = (index) => plot.left + (points.length === 1 ? plot.width / 2 : index / (points.length - 1) * plot.width);
		if (metric === "vorticity") {
			const rainMax = Math.max(1, ...rains);
			const barWidth = Math.max(1, plot.width / points.length * 0.58);
			context.fillStyle = "rgba(57, 120, 168, .28)";
			points.forEach((point, index) => {
				if (!point.rain) return;
				const barHeight = point.rain / rainMax * plot.height * 0.72;
				context.fillRect(x(index) - barWidth / 2, plot.bottom - barHeight, barWidth, barHeight);
			});
			context.save();
			context.fillStyle = css("--mla-atlas-blue", "#3978a8");
			context.font = "11px effra, Arial, sans-serif";
			context.textAlign = "right";
			context.fillText(`rain max ${rainMax.toFixed(1)} mm`, width - 10, 16);
			context.restore();
		}
		drawLineSeries(context, values, x, (value) => plot.bottom - value / plot.yMax * plot.height, metric === "rain" ? css("--mla-atlas-blue", "#3978a8") : css("--mla-madder", "#aa3d2d"), true, plot);
		const markerX = x(focusFix);
		const markerY = plot.bottom - values[focusFix] / plot.yMax * plot.height;
		context.strokeStyle = css("--mla-indigo", "#233f78");
		context.lineWidth = 1;
		context.setLineDash([4, 4]);
		context.beginPath(); context.moveTo(markerX, plot.top); context.lineTo(markerX, plot.bottom); context.stroke();
		context.setLineDash([]);
		context.fillStyle = css("--mla-indigo-deep", "#17294f");
		context.beginPath(); context.arc(markerX, markerY, 4, 0, Math.PI * 2); context.fill();
		$("#wdLifeReadout").textContent = `${formatTrackTime(selected, focusFix)} · ζ ${points[focusFix].vorticity.toFixed(1)} ×10⁻⁵ s⁻¹ · ${points[focusFix].rain == null ? "rain unavailable" : `${points[focusFix].rain.toFixed(2)} mm`}`;
		$("#wdLifeData").innerHTML = accessibleTable(["UTC", "Latitude", "Longitude", "450–300 hPa vorticity (10^-5 s^-1)", "24 h precipitation (mm)"], points.map((point, index) => [formatTrackTime(selected, index), point.lat.toFixed(2), point.lon.toFixed(2), point.vorticity.toFixed(1), point.rain == null ? "NA" : point.rain.toFixed(2)]));
	}

	function drawProfileChart() {
		const canvas = $("#wdProfileChart");
		const chart = prepareCanvas(canvas);
		if (!chart) return;
		const { context, width, height } = chart;
		if (!filtered.length) {
			drawEmptyChart(context, width, height, "No systems match the current filters.");
			return;
		}
		const metric = $("#wdProfileMetric").value;
		const binCount = 21;
		const bins = Array.from({ length: binCount }, () => []);
		for (const index of filtered) {
			const [start, length] = OFF[index];
			const sums = Array(binCount).fill(0);
			const counts = Array(binCount).fill(0);
			for (let j = 0; j < length; j += 1) {
				const bin = length === 1 ? 0 : Math.round(j / (length - 1) * (binCount - 1));
				const point = start + j;
				const value = metric === "rain" ? (PRAIN[point] === -32768 ? null : PRAIN[point] / 100) : PVORT[point] / 10;
				if (value == null || !Number.isFinite(value)) continue;
				sums[bin] += value;
				counts[bin] += 1;
			}
			for (let bin = 0; bin < binCount; bin += 1) if (counts[bin]) bins[bin].push(sums[bin] / counts[bin]);
		}
		const summary = bins.map((values, index) => {
			values.sort((a, b) => a - b);
			return { life: index * 5, q1: quantile(values, 0.25), median: quantile(values, 0.5), q3: quantile(values, 0.75), n: values.length };
		});
		const maximum = niceMaximum(summary.map((row) => row.q3 || 0));
		const plot = chartFrame(context, width, height, { left: 52, right: 22, top: 22, bottom: 42, yMax: maximum, yLabel: metric === "rain" ? "24 h rain (mm)" : "450–300 hPa ζ (10⁻⁵ s⁻¹)", xLabel: "Life fraction (%)" });
		const x = (index) => plot.left + index / (binCount - 1) * plot.width;
		const y = (value) => plot.bottom - value / maximum * plot.height;
		context.beginPath();
		summary.forEach((row, index) => index === 0 ? context.moveTo(x(index), y(row.q3 || 0)) : context.lineTo(x(index), y(row.q3 || 0)));
		for (let index = summary.length - 1; index >= 0; index -= 1) context.lineTo(x(index), y(summary[index].q1 || 0));
		context.closePath();
		context.fillStyle = metric === "rain" ? "rgba(57, 120, 168, .19)" : "rgba(170, 61, 45, .18)";
		context.fill();
		drawLineSeries(context, summary.map((row) => row.median || 0), x, y, metric === "rain" ? css("--mla-atlas-blue", "#3978a8") : css("--mla-madder", "#aa3d2d"), false, plot);
		$("#wdProfileReadout").textContent = `${filtered.length.toLocaleString()} systems · line is median; shading is interquartile range`;
		$("#wdProfileData").innerHTML = accessibleTable(["Life fraction (%)", "Systems", "Lower quartile", "Median", "Upper quartile"], summary.map((row) => [row.life, row.n, formatNumber(row.q1, 2), formatNumber(row.median, 2), formatNumber(row.q3, 2)]));
	}

	function drawClimatology() {
		drawAnnualChart();
		drawMonthChart();
		drawRegionChart();
		drawGenesisChart();
	}

	function drawAnnualChart() {
		const chart = prepareCanvas($("#wdAnnualChart"));
		if (!chart) return;
		const years = [];
		for (let year = Math.min(...CAT.year); year <= Math.max(...CAT.year); year += 1) years.push(year);
		const counts = new Map(years.map((year) => [year, 0]));
		for (const index of filtered) counts.set(CAT.year[index], (counts.get(CAT.year[index]) || 0) + 1);
		const values = years.map((year) => counts.get(year));
		const plot = chartFrame(chart.context, chart.width, chart.height, { left: 48, right: 20, top: 22, bottom: 40, yMax: niceMaximum(values), yLabel: "Genesis systems", xLabel: "Genesis year" });
		const barWidth = plot.width / years.length;
		chart.context.fillStyle = withAlpha(css("--mla-indigo", "#233f78"), 0.72);
		values.forEach((value, index) => {
			const height = value / plot.yMax * plot.height;
			chart.context.fillRect(plot.left + index * barWidth, plot.bottom - height, Math.max(1, barWidth - 0.7), height);
		});
		chart.context.fillStyle = css("--mla-muted", "#665d52");
		chart.context.font = "11px effra, Arial, sans-serif";
		chart.context.textAlign = "center";
		for (let year = Math.ceil(years[0] / 10) * 10; year <= years.at(-1); year += 10) {
			const x = plot.left + (year - years[0] + 0.5) / years.length * plot.width;
			chart.context.fillText(String(year), x, plot.bottom + 17);
		}
		$("#wdAnnualData").innerHTML = accessibleTable(["Year", "Genesis systems"], years.map((year) => [year, counts.get(year)]));
	}

	function drawMonthChart() {
		const chart = prepareCanvas($("#wdMonthChart"));
		if (!chart) return;
		const counts = Array(12).fill(0);
		const intensity = Array(12).fill(0);
		for (const index of filtered) {
			const month = CAT.month[index] - 1;
			counts[month] += 1;
			intensity[month] += CAT.pk_int[index];
		}
		const means = counts.map((count, month) => count ? intensity[month] / count : 0);
		const plot = chartFrame(chart.context, chart.width, chart.height, { left: 48, right: 44, top: 23, bottom: 40, yMax: niceMaximum(counts), yLabel: "Genesis systems", xLabel: "Genesis month" });
		const barWidth = plot.width / 12;
		counts.forEach((value, month) => {
			const height = value / plot.yMax * plot.height;
			chart.context.fillStyle = withAlpha(css("--mla-indigo", "#233f78"), state.months.has(month + 1) ? 0.72 : 0.22);
			chart.context.fillRect(plot.left + month * barWidth + 2, plot.bottom - height, barWidth - 4, height);
		});
		const meanMaximum = Math.max(1, ...means) * 1.12;
		const x = (index) => plot.left + (index + 0.5) * barWidth;
		const y = (value) => plot.bottom - value / meanMaximum * plot.height;
		drawLineSeries(chart.context, means, x, y, css("--mla-madder", "#aa3d2d"), false, plot);
		chart.context.fillStyle = css("--mla-muted", "#665d52");
		chart.context.font = "11px effra, Arial, sans-serif";
		chart.context.textAlign = "center";
		MONTHS.forEach((month, index) => chart.context.fillText(month, x(index), plot.bottom + 17));
		chart.context.textAlign = "right";
		chart.context.fillStyle = css("--mla-madder", "#aa3d2d");
		chart.context.fillText(`mean ζ · max ${Math.max(...means).toFixed(1)}`, chart.width - 8, 15);
		$("#wdMonthData").innerHTML = accessibleTable(["Month", "Genesis systems", "Mean peak vorticity (10^-5 s^-1)"], MONTHS.map((month, index) => [month, counts[index], means[index].toFixed(2)]));
	}

	function drawRegionChart() {
		const chart = prepareCanvas($("#wdRegionChart"));
		if (!chart) return;
		const counts = Array(REGION_LABELS.length).fill(0);
		for (const index of filtered) counts[CAT.dom[index]] += 1;
		const maximum = Math.max(1, ...counts);
		const left = 116;
		const right = 35;
		const top = 22;
		const rowHeight = (chart.height - top - 24) / counts.length;
		chart.context.font = "12px effra, Arial, sans-serif";
		counts.forEach((value, index) => {
			const y = top + index * rowHeight;
			const width = (chart.width - left - right) * value / maximum;
			chart.context.fillStyle = withAlpha(REGION_COLORS[index], 0.76);
			chart.context.fillRect(left, y + 5, width, rowHeight - 12);
			chart.context.fillStyle = css("--mla-ink", "#282119");
			chart.context.textAlign = "right";
			chart.context.fillText(REGION_LABELS[index], left - 8, y + rowHeight / 2 + 3);
			chart.context.textAlign = "left";
			chart.context.fillText(`${value.toLocaleString()} · ${filtered.length ? (value / filtered.length * 100).toFixed(1) : "0.0"}%`, left + width + 7, y + rowHeight / 2 + 3);
		});
		$("#wdRegionData").innerHTML = accessibleTable(["Dominant rainfall region", "Systems", "Share (%)"], REGION_LONG.map((label, index) => [label, counts[index], filtered.length ? (counts[index] / filtered.length * 100).toFixed(2) : "0.00"]));
	}

	function drawGenesisChart() {
		const chart = prepareCanvas($("#wdGenesisChart"));
		if (!chart) return;
		const { context, width, height } = chart;
		context.fillStyle = css("--mla-sea", "#e7eee7");
		context.fillRect(0, 0, width, height);
		const bounds = { west: 22, east: 109, south: 6, north: 54 };
		const x = (lon) => (lon - bounds.west) / (bounds.east - bounds.west) * width;
		const y = (lat) => (bounds.north - lat) / (bounds.north - bounds.south) * height;
		const grid = new Map();
		for (const index of filtered) {
			const lon = Math.floor(CAT.glon[index]);
			const lat = Math.floor(CAT.glat[index]);
			const key = `${lon},${lat}`;
			grid.set(key, (grid.get(key) || 0) + 1);
		}
		const maximum = Math.max(1, ...grid.values());
		for (const [key, value] of grid) {
			const [lon, lat] = key.split(",").map(Number);
			context.fillStyle = densityColour(Math.sqrt(value / maximum));
			context.fillRect(x(lon), y(lat + 1), x(lon + 1) - x(lon) + 0.5, y(lat) - y(lat + 1) + 0.5);
		}
		drawProjectedContext(context, window.WD_COAST_LINES || [], x, y, "rgba(53, 70, 62, .62)", 1.1);
		drawProjectedContext(context, window.WD_BORDER_LINES || [], x, y, "rgba(78, 60, 43, .43)", 0.75);
		context.fillStyle = "rgba(40, 33, 25, .74)";
		context.font = "11px effra, Arial, sans-serif";
		context.fillText(`maximum ${maximum.toLocaleString()} genesis systems per 1° cell`, 12, 18);
	}

	function drawProjectedContext(context, lines, x, y, stroke, width) {
		context.save();
		context.strokeStyle = stroke;
		context.lineWidth = width;
		context.lineJoin = "round";
		for (const line of lines) {
			context.beginPath();
			for (let i = 0; i < line.length; i += 2) {
				const px = x(line[i] / 10);
				const py = y(line[i + 1] / 10);
				i === 0 ? context.moveTo(px, py) : context.lineTo(px, py);
			}
			context.stroke();
		}
		context.restore();
	}

	function renderExtremes() {
		if (!CAT) return;
		const metric = $("#wdExtremeMetric").value;
		const ordered = filtered.slice().sort((a, b) => extremeDirection(metric) * (extremeValue(b, metric) - extremeValue(a, metric)) || CAT.id[a] - CAT.id[b]);
		const leaders = ordered.slice(0, 3);
		$("#wdRecordCards").innerHTML = leaders.map((index, rank) => `<article class="mla-card mla-record" data-index="${index}"><span class="mla-eyebrow">Rank ${rank + 1}</span><h3><button class="mla-row-button" type="button">WD ${CAT.id[index]}</button></h3><p>${formatGenesis(index)} · ${REGION_LONG[CAT.dom[index]]}</p><strong>${formatExtreme(index, metric)}</strong></article>`).join("") || '<p>No systems match the current filters.</p>';
		$$('[data-index]', $("#wdRecordCards")).forEach((card) => card.addEventListener("click", () => { selectTrack(Number(card.dataset.index), { fit: true }); switchTab("explore"); }));
		const table = $("#wdExtremeTable");
		table.tHead.innerHTML = `<tr><th>Rank</th><th>Track</th><th>Genesis</th><th>Dominant rain region</th><th class="mla-num">${extremeLabel(metric)}</th></tr>`;
		table.tBodies[0].innerHTML = ordered.slice(0, 50).map((index, rank) => `<tr data-index="${index}"><td>${rank + 1}</td><td><button class="mla-row-button" type="button">WD ${CAT.id[index]}</button></td><td>${formatGenesis(index)}</td><td>${REGION_LONG[CAT.dom[index]]}</td><td class="mla-num">${formatExtreme(index, metric)}</td></tr>`).join("");
		$$('[data-index]', table.tBodies[0]).forEach((row) => row.addEventListener("click", () => { selectTrack(Number(row.dataset.index), { fit: true }); switchTab("explore"); }));
	}

	function extremeDirection(metric) {
		return ["southGenesis", "westGenesis"].includes(metric) ? -1 : 1;
	}

	function extremeValue(index, metric) {
		if (metric === "intensity") return CAT.pk_int[index];
		if (metric === "rain") return CAT.pk_pr[index];
		if (metric === "length") return CAT.len_km[index];
		if (metric === "duration") return CAT.dur[index];
		if (metric === "northGenesis" || metric === "southGenesis") return CAT.glat[index];
		return CAT.glon[index];
	}

	function extremeLabel(metric) {
		return ({ intensity: "Peak 450–300 hPa ζ", rain: "Peak 24 h rain", length: "Path length", duration: "Duration", northGenesis: "Genesis latitude", southGenesis: "Genesis latitude", eastGenesis: "Genesis longitude", westGenesis: "Genesis longitude" })[metric];
	}

	function formatExtreme(index, metric) {
		const value = extremeValue(index, metric);
		if (metric === "intensity") return `${value.toFixed(1)} ×10⁻⁵ s⁻¹ · P${Math.round(CAT.pct_int[index])}`;
		if (metric === "rain") return `${value.toFixed(1)} mm · P${Math.round(CAT.pct_pr[index])}`;
		if (metric === "length") return `${Math.round(value).toLocaleString()} km`;
		if (metric === "duration") return `${value} h`;
		if (metric === "northGenesis" || metric === "southGenesis") return `${value.toFixed(2)}°N`;
		return `${value.toFixed(2)}°E`;
	}

	function downloadSummaries() {
		const header = ["track_id", "genesis_utc", "lysis_utc", "genesis_lon_deg_e", "genesis_lat_deg_n", "lysis_lon_deg_e", "lysis_lat_deg_n", "fix_count", "duration_h", "path_length_km", "peak_vorticity_450_300hpa_1e-5_s-1", "vorticity_catalogue_percentile", "peak_24h_precipitation_mm", "precipitation_catalogue_percentile", "dominant_rainfall_region", "karakoram_peak_24h_mm", "hindu_kush_peak_24h_mm", "western_himalaya_peak_24h_mm", "central_himalaya_peak_24h_mm", "north_india_peak_24h_mm"];
		const rows = filtered.map((index) => {
			const [start, length] = OFF[index];
			const last = start + length - 1;
			return [CAT.id[index], isoTrackTime(index, 0), isoTrackTime(index, length - 1), PLON[start] / 100, PLAT[start] / 100, PLON[last] / 100, PLAT[last] / 100, length, CAT.dur[index], CAT.len_km[index], CAT.pk_int[index], CAT.pct_int[index], CAT.pk_pr[index], CAT.pct_pr[index], REGION_LONG[CAT.dom[index]], ...REGION_KEYS.map((key) => CAT[key][index])];
		});
		downloadBlob(csvText(header, rows), "text/csv;charset=utf-8", exportName("summaries.csv"));
		showToast(`Prepared ${filtered.length.toLocaleString()} system summaries.`);
	}

	function downloadGeoJson() {
		showToast("Preparing GeoJSON…");
		const collection = {
			type: "FeatureCollection",
			name: "Filtered western disturbances",
			properties: { catalogue: CONFIG.catalogueVersion, generated_utc: new Date().toISOString(), filters: serialisableFilters() },
			features: filtered.map((index) => {
				const [start, length] = OFF[index];
				const coordinates = [];
				for (let j = 0; j < length; j += 1) coordinates.push([PLON[start + j] / 100, PLAT[start + j] / 100]);
				return {
					type: "Feature",
					id: CAT.id[index],
					properties: {
						track_id: CAT.id[index], genesis_utc: isoTrackTime(index, 0), lysis_utc: isoTrackTime(index, length - 1),
						duration_h: CAT.dur[index], path_length_km: CAT.len_km[index],
						peak_vorticity_450_300hpa_1e5_s: CAT.pk_int[index], vorticity_percentile: CAT.pct_int[index],
						peak_24h_precipitation_mm: CAT.pk_pr[index], precipitation_percentile: CAT.pct_pr[index], dominant_rainfall_region: REGION_LONG[CAT.dom[index]]
					},
					geometry: { type: "LineString", coordinates }
				};
			})
		};
		downloadBlob(JSON.stringify(collection), "application/geo+json", exportName("tracks.geojson"));
	}

	function downloadQuery() {
		const payload = {
			schema: "western-disturbances-atlas-query-v1",
			catalogue: CONFIG.catalogueVersion,
			catalogue_asset: CONFIG.catalogue,
			fix_asset: CONFIG.fixes,
			generated_utc: new Date().toISOString(),
			result_count: filtered.length,
			selected_track_id: selected >= 0 ? CAT.id[selected] : null,
			filters: serialisableFilters(),
			view_url: window.location.href
		};
		downloadBlob(JSON.stringify(payload, null, 2) + "\n", "application/json", exportName("query.json"));
	}

	function downloadSelectedFixes() {
		if (selected < 0) {
			showToast("Select a disturbance before downloading fixes.");
			return;
		}
		const index = selected;
		const [start, length] = OFF[index];
		const rows = [];
		for (let j = 0; j < length; j += 1) {
			const point = start + j;
			rows.push([CAT.id[index], isoTrackTime(index, j), j * CONFIG.stepHours, PLON[point] / 100, PLAT[point] / 100, PVORT[point] / 10, PRAIN[point] === -32768 ? "" : PRAIN[point] / 100]);
		}
		downloadBlob(csvText(["track_id", "time_utc", "hours_since_genesis", "longitude_deg_e", "latitude_deg_n", "vorticity_450_300hpa_1e-5_s-1", "precipitation_24h_mm"], rows), "text/csv;charset=utf-8", `wd-${CAT.id[index]}-fixes.csv`);
	}

	function serialisableFilters() {
		return {
			genesis_months: [...state.months].sort((a, b) => a - b),
			genesis_year: [Math.min(state.yearMin, state.yearMax), Math.max(state.yearMin, state.yearMax)],
			minimum_vorticity_catalogue_percentile: state.intensityMin,
			minimum_precipitation_catalogue_percentile: state.rainMin,
			minimum_path_length_km: state.lengthMin,
			minimum_duration_h: state.durationMin,
			dominant_rainfall_regions: [...state.regions].sort((a, b) => a - b).map((region) => REGION_LONG[region]),
			search: state.query || null
		};
	}

	function csvText(header, rows) {
		return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
	}

	function csvCell(value) {
		const text = value == null ? "" : String(value);
		return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
	}

	function downloadBlob(content, type, filename) {
		const blob = content instanceof Blob ? content : new Blob([content], { type });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function exportName(suffix) {
		return `western-disturbances-${new Date().toISOString().slice(0, 10)}-${suffix}`;
	}

	function readUrlState() {
		const params = new URLSearchParams(window.location.search);
		if (params.has("months")) {
			const months = params.get("months").split(",").map(Number).filter((month) => month >= 1 && month <= 12);
			if (months.length) state.months = new Set(months);
		}
		if (params.has("years")) {
			const [minimum, maximum] = params.get("years").split(",").map(Number);
			if (Number.isFinite(minimum)) state.yearMin = clamp(minimum, Math.min(...CAT.year), Math.max(...CAT.year));
			if (Number.isFinite(maximum)) state.yearMax = clamp(maximum, Math.min(...CAT.year), Math.max(...CAT.year));
		}
		if (params.has("ip")) state.intensityMin = clamp(Number(params.get("ip")) || 0, 0, 99);
		if (params.has("rp")) state.rainMin = clamp(Number(params.get("rp")) || 0, 0, 99);
		if (params.has("length")) state.lengthMin = Math.max(0, Number(params.get("length")) || 0);
		if (params.has("duration")) state.durationMin = Math.max(0, Number(params.get("duration")) || 0);
		if (params.has("regions")) state.regions = new Set(params.get("regions").split(",").map(Number).filter((region) => region >= 0 && region < REGION_LABELS.length));
		if (params.has("q")) state.query = params.get("q").slice(0, 60);
		if (["auto", "density", "tracks", "genesis", "lysis"].includes(params.get("layer"))) state.mapLayer = params.get("layer");
		if (["single", "intensity", "region", "year"].includes(params.get("colour"))) state.mapColour = params.get("colour");
		if (params.get("boxes") === "0") state.showRegionBoxes = false;
		if (["explore", "climatology", "extremes", "data"].includes(params.get("tab"))) activeTab = params.get("tab");
		if (params.has("selected")) selected = idToIndex.get(params.get("selected")) ?? -1;
		if (params.has("view")) {
			const values = params.get("view").split(",").map(Number);
			if (values.length === 4 && values.every(Number.isFinite) && values[1] > values[0] && values[3] > values[2]) {
				map.view = { west: values[0], east: values[1], south: values[2], north: values[3] };
				clampMapView();
			}
		}
	}

	function scheduleUrlUpdate() {
		window.clearTimeout(urlTimer);
		urlTimer = window.setTimeout(updateUrl, 120);
	}

	function updateUrl() {
		if (!DATA) return;
		const params = new URLSearchParams();
		params.set("months", [...state.months].sort((a, b) => a - b).join(","));
		if (state.yearMin !== Math.min(...CAT.year) || state.yearMax !== Math.max(...CAT.year)) params.set("years", `${state.yearMin},${state.yearMax}`);
		if (state.intensityMin) params.set("ip", state.intensityMin);
		if (state.rainMin) params.set("rp", state.rainMin);
		if (state.lengthMin) params.set("length", state.lengthMin);
		if (state.durationMin) params.set("duration", state.durationMin);
		if (state.regions.size) params.set("regions", [...state.regions].sort((a, b) => a - b).join(","));
		if (state.query) params.set("q", state.query);
		if (state.mapLayer !== "auto") params.set("layer", state.mapLayer);
		if (state.mapColour !== "single") params.set("colour", state.mapColour);
		if (!state.showRegionBoxes) params.set("boxes", "0");
		if (activeTab !== "explore") params.set("tab", activeTab);
		if (selected >= 0) params.set("selected", CAT.id[selected]);
		if (!viewsEqual(map.view, DEFAULT_VIEW)) params.set("view", [map.view.west, map.view.east, map.view.south, map.view.north].map((value) => value.toFixed(2)).join(","));
		const next = `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`;
		window.history.replaceState(null, "", next);
	}

	async function copyViewLink() {
		updateUrl();
		try {
			await navigator.clipboard.writeText(window.location.href);
			showToast("View link copied.");
		} catch (_) {
			window.prompt("Copy this atlas view link", window.location.href);
		}
	}

	function trackPoints(index) {
		const [start, length] = OFF[index];
		const points = [];
		for (let j = 0; j < length; j += 1) {
			const point = start + j;
			points.push({ lon: PLON[point] / 100, lat: PLAT[point] / 100, vorticity: PVORT[point] / 10, rain: PRAIN[point] === -32768 ? null : PRAIN[point] / 100 });
		}
		return points;
	}

	function genesisMillis(index) {
		return Date.UTC(CAT.year[index], CAT.month[index] - 1, CAT.day[index], CAT.hour[index]);
	}

	function genesisDate(index) {
		return new Date(genesisMillis(index)).toISOString().slice(0, 10);
	}

	function formatGenesis(index) {
		return `${String(CAT.day[index]).padStart(2, "0")} ${MONTHS[CAT.month[index] - 1]} ${CAT.year[index]} · ${String(CAT.hour[index]).padStart(2, "0")} UTC`;
	}

	function formatTrackTime(index, fix) {
		const date = new Date(genesisMillis(index) + fix * CONFIG.stepHours * 3600000);
		return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${String(date.getUTCHours()).padStart(2, "0")}:00 UTC`;
	}

	function isoTrackTime(index, fix) {
		return new Date(genesisMillis(index) + fix * CONFIG.stepHours * 3600000).toISOString().replace(".000Z", "Z");
	}

	function prepareCanvas(canvas) {
		if (!canvas) return null;
		const rect = canvas.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return null;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.round(rect.width * dpr);
		canvas.height = Math.round(rect.height * dpr);
		const context = canvas.getContext("2d");
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		context.clearRect(0, 0, rect.width, rect.height);
		return { context, width: rect.width, height: rect.height };
	}

	function chartFrame(context, width, height, options) {
		const left = options.left;
		const right = options.right;
		const top = options.top;
		const bottom = height - options.bottom;
		const plotWidth = width - left - right;
		const plotHeight = bottom - top;
		const yMax = Math.max(1, options.yMax);
		context.save();
		context.font = "11px effra, Arial, sans-serif";
		context.strokeStyle = "rgba(40, 33, 25, .16)";
		context.fillStyle = css("--mla-muted", "#665d52");
		context.lineWidth = 1;
		for (let tick = 0; tick <= 4; tick += 1) {
			const y = top + tick / 4 * plotHeight;
			context.beginPath(); context.moveTo(left, y); context.lineTo(width - right, y); context.stroke();
			context.textAlign = "right";
			context.textBaseline = "middle";
			context.fillText(formatAxis(yMax * (1 - tick / 4)), left - 7, y);
		}
		context.textAlign = "center";
		context.textBaseline = "alphabetic";
		context.fillText(options.xLabel, left + plotWidth / 2, height - 8);
		context.save();
		context.translate(13, top + plotHeight / 2);
		context.rotate(-Math.PI / 2);
		context.fillText(options.yLabel, 0, 0);
		context.restore();
		context.restore();
		return { left, right: width - right, top, bottom, width: plotWidth, height: plotHeight, yMax };
	}

	function drawLineSeries(context, values, x, y, colour, fill, plot) {
		if (!values.length) return;
		if (fill) {
			const gradient = context.createLinearGradient(0, plot.top, 0, plot.bottom);
			gradient.addColorStop(0, withAlpha(colour, 0.26));
			gradient.addColorStop(1, withAlpha(colour, 0.02));
			context.beginPath();
			context.moveTo(x(0), plot.bottom);
			values.forEach((value, index) => context.lineTo(x(index), y(value)));
			context.lineTo(x(values.length - 1), plot.bottom);
			context.closePath();
			context.fillStyle = gradient;
			context.fill();
		}
		context.beginPath();
		values.forEach((value, index) => index === 0 ? context.moveTo(x(index), y(value)) : context.lineTo(x(index), y(value)));
		context.strokeStyle = colour;
		context.lineWidth = 2.2;
		context.lineJoin = "round";
		context.lineCap = "round";
		context.stroke();
	}

	function drawEmptyChart(context, width, height, message) {
		context.fillStyle = css("--mla-muted", "#665d52");
		context.font = "13px effra, Arial, sans-serif";
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText(message, width / 2, height / 2);
	}

	function accessibleTable(headers, rows) {
		return `<div class="mla-table-wrap"><table class="mla-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
	}

	function quantile(sorted, probability) {
		if (!sorted.length) return null;
		const position = (sorted.length - 1) * probability;
		const lower = Math.floor(position);
		const fraction = position - lower;
		return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
	}

	function niceMaximum(values) {
		const maximum = Math.max(1, ...values.filter(Number.isFinite));
		const power = 10 ** Math.floor(Math.log10(maximum));
		const scaled = maximum / power;
		const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
		return nice * power;
	}

	function formatAxis(value) {
		return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : value >= 10 ? value.toFixed(0) : value.toFixed(1);
	}

	function formatNumber(value, decimals) {
		return value == null || !Number.isFinite(value) ? "NA" : value.toFixed(decimals);
	}

	function densityColour(value) {
		const stops = [[238, 239, 220], [150, 201, 178], [8, 115, 111], [23, 41, 79]];
		return interpolateStops(stops, clamp(value, 0, 1), 0.86);
	}

	function percentileColour(percentile) {
		const stops = [[57, 120, 168], [8, 115, 111], [195, 147, 29], [170, 61, 45], [143, 41, 56]];
		return interpolateStops(stops, clamp(percentile / 100, 0, 1), 1);
	}

	function yearColour(year) {
		const stops = [[35, 63, 120], [8, 115, 111], [195, 147, 29], [170, 61, 45]];
		return interpolateStops(stops, clamp((year - 1950) / 75, 0, 1), 1);
	}

	function vorticityColour(value) {
		return percentileColour(clamp((value - 10) / 45 * 100, 0, 100));
	}

	function interpolateStops(stops, value, alpha) {
		const position = value * (stops.length - 1);
		const lower = Math.min(stops.length - 2, Math.floor(position));
		const fraction = position - lower;
		const first = stops[lower];
		const second = stops[lower + 1];
		const channels = first.map((channel, index) => Math.round(channel + (second[index] - channel) * fraction));
		return `rgba(${channels[0]},${channels[1]},${channels[2]},${alpha})`;
	}

	function withAlpha(colour, alpha) {
		if (/^#[0-9a-f]{6}$/i.test(colour)) {
			const value = parseInt(colour.slice(1), 16);
			return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
		}
		const rgb = colour.match(/[\d.]+/g);
		return rgb && rgb.length >= 3 ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})` : colour;
	}

	function css(name, fallback) {
		return getComputedStyle($("#western-disturbances-atlas")).getPropertyValue(name).trim() || fallback;
	}

	function showToast(message) {
		const toast = $("#wdToast");
		toast.textContent = message;
		toast.dataset.visible = "true";
		window.clearTimeout(toastTimer);
		toastTimer = window.setTimeout(() => { toast.dataset.visible = "false"; }, 2600);
	}

	function debounce(callback, delay) {
		let timer = 0;
		return (...args) => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => callback(...args), delay);
		};
	}

	function escapeHtml(value) {
		return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
	}

	function sameSet(first, second) {
		return first.size === second.size && [...first].every((value) => second.has(value));
	}

	function viewsEqual(first, second) {
		return ["west", "east", "south", "north"].every((key) => Math.abs(first[key] - second[key]) < 0.01);
	}

	function clamp(value, minimum, maximum) {
		return Math.min(maximum, Math.max(minimum, value));
	}
})();
